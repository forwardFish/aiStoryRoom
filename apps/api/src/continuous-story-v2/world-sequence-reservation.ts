import { Prisma } from "@prisma/client";

export type MultiplayerCommandReservationInput = {
  ids: {
    playerActionId: string;
    submissionId: string;
    entryId: string;
    taskId: string;
  };
  run: { id: string; nodeId: string; observedWorldSequence: number };
  turn: {
    id: string;
    threadId: string;
    roleId: string;
    stageIndex: number;
    turnIndex: number;
    revision: number;
  };
  control: { epoch: number; allowedModes: [string, string] };
  agentFence?: { taskId: string; leaseOwner: string; leaseVersion: number };
  playerAction: {
    userId: string | null;
    playerType: string;
    actionType: string;
    targetType: string | null;
    targetId: string | null;
    targetText: string | null;
    method: string;
    intent: string;
    riskLevel: string;
    freeText: string | null;
    normalizedJson: unknown;
    guardReason: string | null;
    actorKind: string;
    actionKey: string | null;
    idempotencyKey: string;
    requestHash: string;
    visibility: string | null;
    targetRoleId: string | null;
    leverageKey: string | null;
    immediateJson: unknown;
  };
  submission: {
    candidateId: string | null;
    customAction: string | null;
    normalizedActionJson: unknown;
    rawIntentJson: unknown;
    normalizedIntentJson: unknown;
    immutableIntentHash: string;
    guardDecisionJson: unknown;
    selectedLeverageKeysJson: unknown;
    idempotencyKey: string;
    requestHash: string;
  };
  entry: { outcomeJson: unknown; mutationJson: unknown };
  task: { resultJson: unknown };
  creditChargeId: string | null;
};

export type MultiplayerCommandReservation = {
  entryId: string;
  taskId: string;
  submissionId: string;
  observedWorldSequence: number;
};

/**
 * Seal one role command in a single PostgreSQL statement. This hot path does
 * not touch StoryRun.worldSequence: formal ordering is allocated only after
 * the deterministic world result is ready to commit.
 */
export async function reserveMultiplayerCommand(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: MultiplayerCommandReservationInput
): Promise<MultiplayerCommandReservation> {
  const fence = input.agentFence;
  const rows = await tx.$queryRaw<MultiplayerCommandReservation[]>(Prisma.sql`
    WITH claimed_turn AS (
      UPDATE "ActorTurn" turn_row
      SET status = 'RESOLVING', "qualityStatus" = 'GENERATING', "updatedAt" = CURRENT_TIMESTAMP
      WHERE turn_row.id = ${input.turn.id}
        AND turn_row.status = 'OPEN'
        AND turn_row.revision = ${input.turn.revision}
        AND EXISTS (
          SELECT 1 FROM "RoleControl" control
          WHERE control."runId" = ${input.run.id}
            AND control."roleId" = ${input.turn.roleId}
            AND control.epoch = ${input.control.epoch}
            AND control.mode IN (${input.control.allowedModes[0]}, ${input.control.allowedModes[1]})
        )
        AND (
          ${!fence}
          OR EXISTS (
            SELECT 1 FROM "StoryTaskOutbox" lease
            WHERE lease.id = ${fence?.taskId || ""}
              AND lease."taskType" = 'ACTOR_AGENT_TURN_V2'
              AND lease.status = 'RUNNING'
              AND lease."leaseOwner" = ${fence?.leaseOwner || ""}
              AND lease."leaseVersion" = ${fence?.leaseVersion ?? -1}
              AND lease."leaseExpiresAt" > CURRENT_TIMESTAMP
              AND lease."inputRefId" = ${input.turn.id}
          )
        )
      RETURNING turn_row.*
    ), inserted_action AS (
      INSERT INTO "PlayerAction" (
        id, "runId", "nodeId", "chapterIndex", "userId", "roleId", "playerType",
        "actionType", "targetType", "targetId", "targetText", method, intent,
        "riskLevel", "freeText", "normalizedJson", "guardStatus", "guardReason",
        "auditStatus", status, "actionSlot", "actorKind", "controlEpoch", "policyVersion",
        provider, "modelName", "actionKey", "idempotencyKey", "requestHash", visibility,
        "targetRoleId", "leverageKey", "sealedAt", "immediateJson", "resolvedJson",
        "resolvedAt", "createdAt", "updatedAt"
      )
      SELECT ${input.ids.playerActionId}, ${input.run.id}, ${input.run.nodeId},
        ${input.turn.stageIndex}, ${input.playerAction.userId}, ${input.turn.roleId},
        ${input.playerAction.playerType}, ${input.playerAction.actionType},
        ${input.playerAction.targetType}, ${input.playerAction.targetId},
        ${input.playerAction.targetText}, ${input.playerAction.method},
        ${input.playerAction.intent}, ${input.playerAction.riskLevel},
        ${input.playerAction.freeText}, ${JSON.stringify(input.playerAction.normalizedJson)}::jsonb,
        'ok', ${input.playerAction.guardReason}, 'ok', 'accepted', ${`TURN:${input.turn.id}`},
        ${input.playerAction.actorKind}, ${input.control.epoch}, 'continuous_story_v2',
        'pending', 'story-generation-v2.1', ${input.playerAction.actionKey},
        ${input.playerAction.idempotencyKey}, ${input.playerAction.requestHash},
        ${input.playerAction.visibility}, ${input.playerAction.targetRoleId},
        ${input.playerAction.leverageKey}, CURRENT_TIMESTAMP,
        ${JSON.stringify(input.playerAction.immediateJson)}::jsonb,
        jsonb_build_object('storyGenerationStatus', 'RESERVED'), CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM claimed_turn
      RETURNING *
    ), inserted_submission AS (
      INSERT INTO "DecisionSubmission" (
        id, "runId", "threadId", "turnId", "roleId", "userId", "playerActionId",
        "candidateId", "customAction", "normalizedActionJson", "rawIntentJson",
        "normalizedIntentJson", "immutableIntentHash", "guardDecisionJson",
        "selectedLeverageKeysJson", "controlEpoch", "idempotencyKey", "requestHash",
        status, "submittedAt"
      )
      SELECT ${input.ids.submissionId}, ${input.run.id}, ${input.turn.threadId},
        ${input.turn.id}, ${input.turn.roleId}, inserted_action."userId", inserted_action.id,
        ${input.submission.candidateId}, ${input.submission.customAction},
        ${JSON.stringify(input.submission.normalizedActionJson)}::jsonb,
        ${JSON.stringify(input.submission.rawIntentJson)}::jsonb,
        ${JSON.stringify(input.submission.normalizedIntentJson)}::jsonb,
        ${input.submission.immutableIntentHash},
        ${JSON.stringify(input.submission.guardDecisionJson)}::jsonb,
        ${JSON.stringify(input.submission.selectedLeverageKeysJson)}::jsonb,
        ${input.control.epoch}, ${input.submission.idempotencyKey},
        ${input.submission.requestHash}, 'GENERATING', CURRENT_TIMESTAMP
      FROM inserted_action
      RETURNING *
    ), attached_charge AS (
      UPDATE "CreditCharge" charge
      SET "playerActionId" = ${input.ids.playerActionId}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE charge.id = ${input.creditChargeId}
        AND (charge."playerActionId" IS NULL OR charge."playerActionId" = ${input.ids.playerActionId})
      RETURNING charge.id
    ), inserted_entry AS (
      INSERT INTO "MultiplayerWorldCommitEntry" (
        id, "runId", "nodeId", "threadId", "turnId", "roleId", "submissionId",
        "playerActionId", "idempotencyKey", "requestHash", "observedWorldSequence",
        "outcomeJson", "mutationJson", state, "createdAt", "updatedAt"
      )
      SELECT ${input.ids.entryId}, ${input.run.id}, ${input.run.nodeId},
        ${input.turn.threadId}, ${input.turn.id}, ${input.turn.roleId},
        inserted_submission.id, inserted_action.id, ${input.submission.idempotencyKey},
        ${input.submission.requestHash}, ${input.run.observedWorldSequence},
        ${JSON.stringify(input.entry.outcomeJson)}::jsonb,
        ${JSON.stringify(input.entry.mutationJson)}::jsonb,
        'RESERVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM inserted_submission
      CROSS JOIN inserted_action
      WHERE ${input.creditChargeId}::text IS NULL OR EXISTS (SELECT 1 FROM attached_charge)
      RETURNING *
    ), inserted_task AS (
      INSERT INTO "StoryTaskOutbox" (
        id, "runId", "nodeId", "dedupeKey", "roleId", "actionSlot", "controlEpoch",
        "taskType", status, "inputRefId", attempt, "maxAttempts", "nextRetryAt",
        "leaseVersion", "resultJson", "createdAt", "updatedAt"
      )
      SELECT ${input.ids.taskId}, ${input.run.id}, ${input.run.nodeId},
        ${`ACTOR_RESULT_V2:${input.ids.entryId}`}, ${input.turn.roleId}, 'ACTOR_RESULT',
        ${input.control.epoch}, 'ACTOR_RESULT_V2', 'PENDING', inserted_entry.id,
        0, 5, CURRENT_TIMESTAMP, 0, ${JSON.stringify(input.task.resultJson)}::jsonb,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM inserted_entry
      RETURNING *
    )
    SELECT inserted_entry.id AS "entryId",
           inserted_task.id AS "taskId",
           inserted_entry."submissionId" AS "submissionId",
           inserted_entry."observedWorldSequence" AS "observedWorldSequence"
    FROM inserted_entry, inserted_task
  `);
  const row = rows[0];
  if (!row) throw new Error("MULTIPLAYER_COMMAND_RESERVATION_REJECTED");
  if (!Number.isInteger(row.observedWorldSequence) || row.observedWorldSequence < 0) {
    throw new Error("OBSERVED_WORLD_SEQUENCE_INVALID");
  }
  return row;
}
