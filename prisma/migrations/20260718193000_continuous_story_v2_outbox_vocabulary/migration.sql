-- Extend the durable worker vocabulary for independent actor turns. These
-- tasks never participate in an ActionWindow or shared-round barrier.
ALTER TABLE "StoryTaskOutbox" DROP CONSTRAINT IF EXISTS "StoryTaskOutbox_task_type_check";
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_task_type_check"
CHECK ("taskType" IN (
    'resolve_node',
    'RESOLVE_WINDOW',
    'PROJECT_REPAIR',
    'ROLE_AGENT_DECISION',
    'ACTOR_AGENT_TURN_V2'
));

ALTER TABLE "StoryTaskOutbox" DROP CONSTRAINT IF EXISTS "StoryTaskOutbox_outcome_check";
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_outcome_check"
CHECK (
    "outcome" IS NULL
    OR "outcome" IN (
        'SEALED_ACT',
        'SEALED_FALLBACK',
        'PASS',
        'STALE',
        'NO_OP',
        'RESOLVED',
        'REPAIRED',
        'COMPLETED',
        'ACTOR_TURN_RESOLVED',
        'CONTROL_RECLAIMED'
    )
);

ALTER TABLE "StoryTaskOutbox" DROP CONSTRAINT IF EXISTS "StoryTaskOutbox_dedupe_format_check";
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_dedupe_format_check"
CHECK (
    "dedupeKey" LIKE 'RESOLVE_LEGACY:%'
    OR "dedupeKey" LIKE 'RESOLVE:%'
    OR "dedupeKey" LIKE 'RESOLVE_WINDOW:%'
    OR "dedupeKey" LIKE 'PROJECT_REPAIR:%'
    OR "dedupeKey" LIKE 'AI_TAKEOVER:%'
    OR "dedupeKey" LIKE 'ROLE_AGENT:%'
    OR "dedupeKey" LIKE 'ACTOR_AGENT_TURN_V2:%'
);
