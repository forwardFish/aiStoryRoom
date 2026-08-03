-- OpenNovel impact delivery has two idempotent success outcomes in addition
-- to the legacy structured-pipeline publication outcome. The resultJson keeps
-- the detailed receipt, while this constrained column records the durable
-- task completion vocabulary.
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
        'ACTOR_IMPACT_SYNCED',
        'ACTOR_IMPACT_ALREADY_SYNCED',
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
