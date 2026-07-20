-- Independent actor generation uses its own durable task vocabulary. None of
-- these task types joins an ActionWindow or waits for another role.
ALTER TABLE "StoryTaskOutbox" DROP CONSTRAINT IF EXISTS "StoryTaskOutbox_task_type_check";
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_task_type_check"
CHECK ("taskType" IN (
    'resolve_node',
    'RESOLVE_WINDOW',
    'PROJECT_REPAIR',
    'ROLE_AGENT_DECISION',
    'ACTOR_OPENING_V2',
    'ACTOR_AGENT_TURN_V2',
    'ACTOR_RESULT_V2',
    'ACTOR_IMPACT_V2',
    'CONDITIONAL_ACTION_V2'
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
        'ACTOR_OPENING_READY',
        'ACTOR_TURN_RESOLVED',
        'ACTOR_RESULT_ALREADY_PUBLISHED',
        'ACTOR_RESULT_PUBLISHED',
        'ACTOR_IMPACT_PUBLISHED',
        'AGENT_CONTROL_ENDED',
        'TURN_ALREADY_MOVED',
        'TARGET_STORY_COMPLETED',
        'CONDITION_ALREADY_SETTLED',
        'CONDITION_EXPIRED',
        'CONDITION_INVALID',
        'CONDITION_RULES_CONFIRMED',
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
    OR "dedupeKey" LIKE 'ACTOR_OPENING_V2:%'
    OR "dedupeKey" LIKE 'ACTOR_AGENT_TURN_V2:%'
    OR "dedupeKey" LIKE 'ACTOR_RESULT_V2:%'
    OR "dedupeKey" LIKE 'ACTOR_IMPACT_V2:%'
    OR "dedupeKey" LIKE 'CONDITIONAL_ACTION_V2:%'
);
