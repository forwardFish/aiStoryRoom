-- P0 continuous-strategy stable backfill phase.
-- No RoleControl rows or opening projections are fabricated for legacy runs.

-- Every pre-existing run is permanently pinned to the legacy engine pair.
UPDATE "StoryRun"
SET
    "engineVersion" = 'legacy_v1',
    "strategyVersion" = 'legacy_v1'
WHERE "engineVersion" IS NULL OR "strategyVersion" IS NULL;

-- Preserve the old action meaning without inventing provider, policy or
-- interaction provenance. The hash uses immutable legacy columns only.
UPDATE "PlayerAction"
SET
    "actionSlot" = COALESCE("actionSlot", 'MAIN'),
    "actorKind" = COALESCE(
        "actorKind",
        CASE WHEN "userId" IS NOT NULL THEN 'HUMAN' ELSE 'LEGACY_AI' END
    ),
    "controlEpoch" = COALESCE("controlEpoch", 0),
    "actionKey" = COALESCE("actionKey", 'legacy:' || "actionType"),
    "idempotencyKey" = COALESCE("idempotencyKey", 'legacy:' || "id"),
    "requestHash" = COALESCE(
        "requestHash",
        encode(
            sha256(
                convert_to(
                    concat_ws(
                        '|',
                        'LEGACY_ACTION',
                        COALESCE("userId", ''),
                        "roleId",
                        'MAIN',
                        "id",
                        "actionType"
                    ),
                    'UTF8'
                )
            ),
            'hex'
        )
    ),
    "visibility" = COALESCE("visibility", 'LIMITED'),
    "sealedAt" = COALESCE("sealedAt", "createdAt");

-- Old node-resolution commands become task-level dedupe rows. New writers use
-- RESOLVE/PROJECT_REPAIR/AI_TAKEOVER formats after the application cut-over.
UPDATE "StoryTaskOutbox"
SET
    "dedupeKey" = COALESCE("dedupeKey", 'RESOLVE_LEGACY:' || "nodeId"),
    "leaseVersion" = COALESCE("leaseVersion", 0);

-- Assign a deterministic audit sequence to historic events. Ordering by
-- createdAt then id makes reruns stable and does not leak delivery semantics.
WITH ranked_events AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "runId"
            ORDER BY "createdAt", "id"
        )::INTEGER AS next_sequence
    FROM "StoryEvent"
)
UPDATE "StoryEvent" AS event
SET
    "sequence" = ranked_events.next_sequence,
    "dedupeKey" = COALESCE(event."dedupeKey", 'LEGACY_EVENT:' || event."id"),
    "audienceType" = COALESCE(
        event."audienceType",
        CASE WHEN event."roleKey" IS NULL THEN 'PUBLIC' ELSE 'PRIVATE' END
    )
FROM ranked_events
WHERE event."id" = ranked_events."id";

-- Where a legacy roleKey still resolves, preserve an explicit private audience.
UPDATE "StoryEvent" AS event
SET "audienceRoleIdsJson" = jsonb_build_array(role."id")
FROM "StoryRole" AS role
WHERE
    event."audienceRoleIdsJson" IS NULL
    AND event."roleKey" IS NOT NULL
    AND role."runId" = event."runId"
    AND role."roleKey" = event."roleKey";

-- Seed the authoritative per-run sequence cursor to max(sequence)+1 exactly
-- once during migration; runtime allocation must use cursor CAS, never MAX+1.
INSERT INTO "StoryEventCursor" (
    "id",
    "runId",
    "nextSequence",
    "version",
    "updatedAt"
)
SELECT
    'legacy-event-cursor:' || run."id",
    run."id",
    COALESCE(MAX(event."sequence"), 0) + 1,
    1,
    CURRENT_TIMESTAMP
FROM "StoryRun" AS run
LEFT JOIN "StoryEvent" AS event ON event."runId" = run."id"
GROUP BY run."id"
ON CONFLICT ("runId") DO UPDATE
SET
    "nextSequence" = GREATEST(
        "StoryEventCursor"."nextSequence",
        EXCLUDED."nextSequence"
    ),
    "updatedAt" = CURRENT_TIMESTAMP;

-- Stable projection keys make retry/readback idempotent without reconstructing
-- private historic projection content.
UPDATE "SceneSnapshot"
SET "dedupeKey" = COALESCE("dedupeKey", 'LEGACY_SCENE_SNAPSHOT:' || "id");

UPDATE "NarrativeEntry"
SET "dedupeKey" = COALESCE("dedupeKey", 'LEGACY_NARRATIVE_ENTRY:' || "id");
