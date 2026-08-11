-- Align the durable PostgreSQL allowlists with the B0 synchronized-settlement
-- runtime while preserving every value admitted by the existing continuous,
-- OpenNovel, Solo and maneuver engines. This migration is intentionally
-- additive at the vocabulary level and does not rewrite application data.

ALTER TABLE "ActionWindow" DROP CONSTRAINT IF EXISTS "ActionWindow_status_check";
ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_status_check"
CHECK ("status" IN (
    'PREPARING',
    'MAIN_OPEN',
    'INTERACTION_GRACE',
    'CLOSING',
    'RESOLVING',
    'PROJECTING',
    'RESOLVED',
    'OPEN',
    'LOCKED',
    'SETTLING',
    'COMMITTED',
    'PUBLISHING',
    'COMPLETED',
    'FAILED_RETRYABLE',
    'FAILED_HARD',
    'ABORTED'
));

ALTER TABLE "ActionWindow" DROP CONSTRAINT IF EXISTS "ActionWindow_closing_reason_check";
ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_closing_reason_check"
CHECK (
    "closingReason" IS NULL
    OR "closingReason" IN (
        'ALL_DONE',
        'ALL_LAYOUTS_DONE',
        'MAIN_TIMEOUT',
        'GRACE_TIMEOUT',
        'GRACE_DEADLINE',
        'ADMIN_FORCE',
        'ALL_READY',
        'DEADLINE',
        'IMMEDIATE'
    )
);

ALTER TABLE "ActionWindowParticipant" DROP CONSTRAINT IF EXISTS "ActionWindowParticipant_main_status_check";
ALTER TABLE "ActionWindowParticipant" ADD CONSTRAINT "ActionWindowParticipant_main_status_check"
CHECK ("mainStatus" IN (
    'PENDING',
    'SUBMITTED',
    'TIMED_OUT',
    'B0_PENDING',
    'B0_READY',
    'B0_LOCKED',
    'B0_COMMITTED',
    'B0_COMPLETED'
));

ALTER TABLE "PlayerAction" DROP CONSTRAINT IF EXISTS "PlayerAction_action_slot_check";
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_action_slot_check"
CHECK (
    "actionSlot" IS NULL
    OR "actionSlot" IN (
        'MAIN',
        'MANEUVER',
        'MANEUVER_1',
        'MANEUVER_2',
        'REACTION',
        'SYSTEM_ACTION',
        'B0_PRIMARY'
    )
    OR "actionSlot" LIKE 'TURN:%'
    OR "actionSlot" LIKE 'SOLO:%'
    OR "actionSlot" LIKE 'SOLO_CLARIFICATION:%'
    OR "actionSlot" LIKE 'CONDITION:%'
);

ALTER TABLE "PlayerAction" DROP CONSTRAINT IF EXISTS "PlayerAction_actor_kind_check";
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_actor_kind_check"
CHECK (
    "actorKind" IS NULL
    OR "actorKind" IN (
        'HUMAN',
        'AI',
        'AI_TAKEOVER',
        'SYSTEM',
        'TIMEOUT_FALLBACK',
        'LEGACY_AI',
        'CONDITIONAL'
    )
);

ALTER TABLE "StoryEvent" DROP CONSTRAINT IF EXISTS "StoryEvent_audience_type_check";
ALTER TABLE "StoryEvent" ADD CONSTRAINT "StoryEvent_audience_type_check"
CHECK (
    "audienceType" IS NULL
    OR "audienceType" IN (
        'ALL_MEMBERS',
        'ROLE',
        'MEMBER',
        'PUBLIC',
        'OBSERVABLE',
        'LIMITED',
        'PRIVATE',
        'SYSTEM'
    )
);

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
    'CONDITIONAL_ACTION_V2',
    'B0_SETTLEMENT_REQUESTED',
    'B0_PUBLISH_STRUCTURED_RESULTS',
    'B0_NARRATIVE_GENERATION',
    'B0_WINDOW_EVENT'
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
        'CONTROL_RECLAIMED',
        'COMMITTED',
        'ALREADY_COMMITTED',
        'PUBLISHED',
        'ALREADY_PUBLISHED',
        'NARRATED',
        'RECORDED'
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
    OR "dedupeKey" LIKE 'b0-%'
);

ALTER TABLE "ResolutionWorkflow" DROP CONSTRAINT IF EXISTS "ResolutionWorkflow_status_check";
ALTER TABLE "ResolutionWorkflow" ADD CONSTRAINT "ResolutionWorkflow_status_check"
CHECK ("status" IN (
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'B0_PREPARED',
    'B0_RESOLVING'
));

ALTER TABLE "ResolutionCheckpoint" DROP CONSTRAINT IF EXISTS "ResolutionCheckpoint_key_check";
ALTER TABLE "ResolutionCheckpoint" ADD CONSTRAINT "ResolutionCheckpoint_key_check"
CHECK (
    "checkpointKey" IN (
        'RULES_APPLIED',
        'PUBLIC_PROJECTED',
        'PUBLISHED',
        'NEXT_WINDOW_OPENED',
        'RUN_COMPLETED',
        'B0_BATCH_COMMITTED'
    )
    OR "checkpointKey" ~ '^ROLE_PROJECTED:[^:]+$'
);
