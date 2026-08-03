import { Prisma } from "@prisma/client";

export type MultiplayerWorldCommitFence = {
  taskId: string;
  leaseOwner: string;
  leaseVersion: number;
};

export type MultiplayerWorldCommitResult = {
  resolutionId: string;
  appliedWorldSequence: number;
};

/**
 * Commit the side-effect-bounded multiplayer hot path in one PostgreSQL
 * statement. Every eligibility predicate is checked again inside the same
 * statement that advances StoryRun. A complex action returns null without any
 * write and is handled by the complete application transaction.
 */
export async function tryFastMultiplayerWorldCommit(
  prisma: Pick<Prisma.TransactionClient, "$queryRaw">,
  entryId: string,
  fence: MultiplayerWorldCommitFence
): Promise<MultiplayerWorldCommitResult | null> {
  const rows = await prisma.$queryRaw<MultiplayerWorldCommitResult[]>(Prisma.sql`
    WITH valid_lease AS (
      SELECT task.id
      FROM "StoryTaskOutbox" task
      WHERE task.id = ${fence.taskId}
        AND task."taskType" = 'ACTOR_RESULT_V2'
        AND task.status = 'RUNNING'
        AND task."leaseOwner" = ${fence.leaseOwner}
        AND task."leaseVersion" = ${fence.leaseVersion}
        AND task."leaseExpiresAt" > CURRENT_TIMESTAMP
        AND task."inputRefId" = ${entryId}
    ), candidate AS (
      SELECT entry.*, turn."stageIndex"
      FROM "MultiplayerWorldCommitEntry" entry
      JOIN "ActorTurn" turn ON turn.id = entry."turnId"
      CROSS JOIN valid_lease
      WHERE entry.id = ${entryId}
        AND entry.state IN ('RESERVED', 'READY')
        AND turn.status = 'RESOLVING'
        AND entry."mutationJson"->>'schemaVersion' = 'pending_world_mutation_v1'
        AND entry."mutationJson"#>>'{fastWorldCommit,schemaVersion}' = 'multiplayer_fast_world_commit_v1'
        AND COALESCE((entry."mutationJson"#>>'{fastWorldCommit,eligible}')::boolean, false)
        AND jsonb_typeof(entry."mutationJson"#>'{fastWorldCommit,canonFacts}') = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM "ConditionalActionV2" condition
          WHERE condition."runId" = entry."runId"
            AND condition.status = 'ARMED'
            AND condition."sourceSubmissionId" <> entry."submissionId"
        )
    ), advanced_run AS (
      UPDATE "StoryRun" run
      SET "worldSequence" = run."worldSequence" + 1,
          "currentDay" = GREATEST(
            run."currentDay",
            COALESCE(NULLIF(candidate."mutationJson"->>'toStageIndex', '')::integer, candidate."stageIndex")
          ),
          version = run.version + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM candidate
      WHERE run.id = candidate."runId"
      RETURNING run.id AS "runId", run."worldSequence" AS "appliedWorldSequence"
    ), inserted_resolution AS (
      INSERT INTO "ActionResolution" (
        id, "runId", "threadId", "turnId", "submissionId", "roleId",
        "playerActionId", "baseWorldSequence", "appliedWorldSequence",
        "outcomeJson", "statePatchJson", "resultNarrative", "nextHook",
        "qualityStatus", "resolvedAt", "createdAt"
      )
      SELECT candidate.id, candidate."runId", candidate."threadId",
        candidate."turnId", candidate."submissionId", candidate."roleId",
        candidate."playerActionId", advanced_run."appliedWorldSequence" - 1,
        advanced_run."appliedWorldSequence", candidate."outcomeJson",
        candidate."mutationJson" || jsonb_build_object(
          'baseWorldSequence', advanced_run."appliedWorldSequence" - 1,
          'nextWorldSequence', advanced_run."appliedWorldSequence"
        ), '', '', 'WORLD_COMMITTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM candidate
      JOIN advanced_run ON advanced_run."runId" = candidate."runId"
      RETURNING id AS "resolutionId", "appliedWorldSequence"
    ), fact_plan AS (
      SELECT candidate."runId", candidate."nodeId", candidate."playerActionId",
        fact.id, fact."factKey", fact.content, fact.visibility,
        fact."knownByRoleIds"
      FROM candidate
      JOIN inserted_resolution ON inserted_resolution."resolutionId" = candidate.id
      CROSS JOIN LATERAL jsonb_to_recordset(candidate."mutationJson"#>'{fastWorldCommit,canonFacts}') AS fact(
        id text,
        "factKey" text,
        content text,
        visibility text,
        "knownByRoleIds" jsonb
      )
    ), upserted_facts AS (
      INSERT INTO "CanonFact" (
        id, "runId", "sourceNodeId", "factKey", content, status, visibility,
        "sourceEventIdsJson", "sourceActionIdsJson", "knownByRoleIdsJson",
        "createdAt", "updatedAt"
      )
      SELECT fact_plan.id, fact_plan."runId", fact_plan."nodeId",
        fact_plan."factKey", fact_plan.content, 'confirmed', fact_plan.visibility,
        '[]'::jsonb, jsonb_build_array(fact_plan."playerActionId"),
        COALESCE(fact_plan."knownByRoleIds", '[]'::jsonb),
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM fact_plan
      ON CONFLICT ("runId", "factKey") DO UPDATE SET
        content = EXCLUDED.content,
        status = 'confirmed',
        visibility = EXCLUDED.visibility,
        "sourceActionIdsJson" = (
          SELECT COALESCE(jsonb_agg(values.value ORDER BY values.value), '[]'::jsonb)
          FROM (
            SELECT DISTINCT value
            FROM jsonb_array_elements_text(
              COALESCE("CanonFact"."sourceActionIdsJson", '[]'::jsonb)
              || EXCLUDED."sourceActionIdsJson"
            )
          ) values
        ),
        "knownByRoleIdsJson" = (
          SELECT COALESCE(jsonb_agg(values.value ORDER BY values.value), '[]'::jsonb)
          FROM (
            SELECT DISTINCT value
            FROM jsonb_array_elements_text(
              COALESCE("CanonFact"."knownByRoleIdsJson", '[]'::jsonb)
              || EXCLUDED."knownByRoleIdsJson"
            )
          ) values
        ),
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING id
    ), committed_entry AS (
      UPDATE "MultiplayerWorldCommitEntry" entry
      SET state = 'COMMITTED',
          "committedResolutionId" = inserted_resolution."resolutionId",
          "committedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM inserted_resolution
      WHERE entry.id = inserted_resolution."resolutionId"
      RETURNING entry.id
    ), updated_action AS (
      UPDATE "PlayerAction" action
      SET "resolvedJson" = jsonb_build_object(
            'appliedWorldSequence', inserted_resolution."appliedWorldSequence",
            'storyGenerationStatus', 'PENDING_ROLE_RUNTIME',
            'worldCommitted', true
          ),
          "updatedAt" = CURRENT_TIMESTAMP
      FROM candidate, inserted_resolution
      WHERE action.id = candidate."playerActionId"
      RETURNING action.id
    ), expired_conditions AS (
      UPDATE "ConditionalActionV2" condition
      SET status = 'EXPIRED', "expiredAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      FROM candidate, inserted_resolution
      WHERE condition."runId" = candidate."runId"
        AND condition.status = 'ARMED'
        AND condition."expiresAtStage" < candidate."stageIndex"
      RETURNING condition.id
    ), expired_commitments AS (
      UPDATE "CommitmentV2" commitment
      SET status = 'EXPIRED', "expiredAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      FROM candidate, inserted_resolution
      WHERE commitment."runId" = candidate."runId"
        AND commitment.status = 'ACTIVE'
        AND commitment."expiresAtStage" < candidate."stageIndex"
      RETURNING commitment.id
    ), replayed AS (
      SELECT resolution.id AS "resolutionId", resolution."appliedWorldSequence"
      FROM "MultiplayerWorldCommitEntry" entry
      JOIN "ActionResolution" resolution ON resolution.id = entry."committedResolutionId"
      CROSS JOIN valid_lease
      WHERE entry.id = ${entryId}
        AND entry.state IN ('COMMITTED', 'PUBLISHED')
    )
    SELECT "resolutionId", "appliedWorldSequence" FROM inserted_resolution
    UNION ALL
    SELECT "resolutionId", "appliedWorldSequence" FROM replayed
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  if (!row.resolutionId || !Number.isInteger(row.appliedWorldSequence) || row.appliedWorldSequence < 1) {
    throw new Error("MULTIPLAYER_FAST_WORLD_COMMIT_RESULT_INVALID");
  }
  return row;
}
