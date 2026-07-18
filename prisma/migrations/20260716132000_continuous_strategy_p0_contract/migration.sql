-- P0 continuous-strategy contract phase.
-- Columns still omitted by legacy application writers intentionally remain
-- nullable; their final NOT NULL cut-over is tracked by the D02 audit.

-- StoryRun versions are required, while valid engine/strategy combinations are
-- owned by the canonical game registry. Keeping the pair vocabulary out of a
-- database CHECK allows a newly registered continuous game to onboard without
-- a schema migration.
ALTER TABLE "StoryRun"
    ALTER COLUMN "engineVersion" SET DEFAULT 'legacy_v1',
    ALTER COLUMN "engineVersion" SET NOT NULL,
    ALTER COLUMN "strategyVersion" SET DEFAULT 'legacy_v1',
    ALTER COLUMN "strategyVersion" SET NOT NULL;

ALTER TABLE "StoryRun" DROP CONSTRAINT IF EXISTS "StoryRun_engine_strategy_version_pair_check";

-- Defaults keep the legacy action writer deployable while the read/write path
-- moves to actorKind, command hashes and slot fencing.
ALTER TABLE "PlayerAction"
    ALTER COLUMN "actionSlot" SET DEFAULT 'MAIN',
    ALTER COLUMN "controlEpoch" SET DEFAULT 0;

DROP INDEX "PlayerAction_nodeId_roleId_key";
CREATE UNIQUE INDEX "PlayerAction_nodeId_roleId_actionSlot_key"
    ON "PlayerAction"("nodeId", "roleId", "actionSlot");
CREATE UNIQUE INDEX "PlayerAction_idempotencyKey_key"
    ON "PlayerAction"("idempotencyKey");
CREATE UNIQUE INDEX "PlayerAction_sourceInteractionRequestId_key"
    ON "PlayerAction"("sourceInteractionRequestId");
CREATE INDEX "PlayerAction_targetRoleId_idx" ON "PlayerAction"("targetRoleId");

CREATE UNIQUE INDEX "StoryEvent_dedupeKey_key" ON "StoryEvent"("dedupeKey");
CREATE UNIQUE INDEX "StoryEvent_runId_sequence_key" ON "StoryEvent"("runId", "sequence");
CREATE INDEX "StoryEvent_sourceActionId_idx" ON "StoryEvent"("sourceActionId");

CREATE UNIQUE INDEX "SceneSnapshot_dedupeKey_key" ON "SceneSnapshot"("dedupeKey");
CREATE UNIQUE INDEX "NarrativeEntry_dedupeKey_key" ON "NarrativeEntry"("dedupeKey");

-- Keep StoryTaskOutbox_nodeId_key temporarily for the legacy API findUnique
-- path. It must be removed when that writer switches to dedupeKey.
CREATE UNIQUE INDEX "StoryTaskOutbox_dedupeKey_key" ON "StoryTaskOutbox"("dedupeKey");

-- A role can have at most one unresolved forced reaction in a node.
CREATE UNIQUE INDEX "InteractionRequest_nodeId_targetRoleId_open_key"
    ON "InteractionRequest"("nodeId", "targetRoleId")
    WHERE "status" = 'OPEN';

-- Window and participant state machines.
ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_status_check"
CHECK ("status" IN (
    'PREPARING',
    'MAIN_OPEN',
    'INTERACTION_GRACE',
    'CLOSING',
    'RESOLVING',
    'PROJECTING',
    'RESOLVED'
));

ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_closing_reason_check"
CHECK (
    "closingReason" IS NULL
    OR "closingReason" IN ('ALL_DONE', 'MAIN_TIMEOUT', 'GRACE_TIMEOUT', 'ADMIN_FORCE')
);

ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_versions_check"
CHECK (
    "version" >= 1
    AND "projectionVersion" >= 0
    AND ("openingSnapshotVersion" IS NULL OR "openingSnapshotVersion" >= 0)
);

ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_time_order_check"
CHECK (
    ("mainOpenedAt" IS NULL OR "mainClosesAt" IS NULL OR "mainOpenedAt" <= "mainClosesAt")
    AND ("graceOpenedAt" IS NULL OR "graceMinClosesAt" IS NULL OR "graceOpenedAt" <= "graceMinClosesAt")
    AND ("graceMinClosesAt" IS NULL OR "graceClosesAt" IS NULL OR "graceMinClosesAt" <= "graceClosesAt")
);

ALTER TABLE "ActionWindowParticipant" ADD CONSTRAINT "ActionWindowParticipant_main_status_check"
CHECK ("mainStatus" IN ('PENDING', 'SUBMITTED', 'TIMED_OUT'));

ALTER TABLE "ActionWindowParticipant" ADD CONSTRAINT "ActionWindowParticipant_maneuver_status_check"
CHECK ("maneuverStatus" IN ('LOCKED', 'AVAILABLE', 'SUBMITTED', 'PASSED', 'EXPIRED'));

ALTER TABLE "ActionWindowParticipant" ADD CONSTRAINT "ActionWindowParticipant_reaction_status_check"
CHECK ("reactionStatus" IN ('NOT_OPEN', 'PENDING', 'RESPONDED', 'FALLBACK', 'EXPIRED'));

ALTER TABLE "ActionWindowParticipant" ADD CONSTRAINT "ActionWindowParticipant_version_check"
CHECK ("version" >= 1);

-- Authoritative control and fencing-token transitions.
ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_mode_check"
CHECK ("mode" IN (
    'HUMAN_ACTIVE',
    'HUMAN_OFFLINE_GRACE',
    'AI_ACTIVE',
    'HUMAN_RECLAIM_PENDING',
    'SYSTEM'
));

ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_reason_check"
CHECK (
    "reason" IS NULL
    OR "reason" IN ('ROOM_STARTED', 'INITIAL_AI_AGENT', 'SYSTEM_ROLE', 'EXPLICIT_EXIT', 'DISCONNECT_TIMEOUT', 'HUMAN_RECLAIM', 'SYSTEM')
);

ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_epoch_check"
CHECK ("epoch" >= 1);

ALTER TABLE "RoleControlTransition" ADD CONSTRAINT "RoleControlTransition_mode_check"
CHECK (
    "fromMode" IN ('HUMAN_ACTIVE', 'HUMAN_OFFLINE_GRACE', 'AI_ACTIVE', 'HUMAN_RECLAIM_PENDING', 'SYSTEM')
    AND "toMode" IN ('HUMAN_ACTIVE', 'HUMAN_OFFLINE_GRACE', 'AI_ACTIVE', 'HUMAN_RECLAIM_PENDING', 'SYSTEM')
);

ALTER TABLE "RoleControlTransition" ADD CONSTRAINT "RoleControlTransition_epoch_check"
CHECK ("fromEpoch" >= 1 AND "toEpoch" >= "fromEpoch");

ALTER TABLE "RoleControlTransition" ADD CONSTRAINT "RoleControlTransition_effective_slot_check"
CHECK (
    "effectiveSlot" IS NULL
    OR "effectiveSlot" IN ('MAIN', 'MANEUVER', 'REACTION')
);

-- Action command identity, slot and visibility vocabulary. Nullable preserves
-- the current writer until the application contract lands.
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_action_slot_check"
CHECK (
    "actionSlot" IS NULL
    OR "actionSlot" IN ('MAIN', 'MANEUVER', 'REACTION', 'SYSTEM_ACTION')
);

ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_actor_kind_check"
CHECK (
    "actorKind" IS NULL
    OR "actorKind" IN ('HUMAN', 'AI_TAKEOVER', 'SYSTEM', 'TIMEOUT_FALLBACK', 'LEGACY_AI')
);

ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_visibility_check"
CHECK (
    "visibility" IS NULL
    OR "visibility" IN ('PUBLIC', 'OBSERVABLE', 'LIMITED', 'PRIVATE')
);

ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_control_epoch_check"
CHECK ("controlEpoch" IS NULL OR "controlEpoch" >= 0);

ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_status_check"
CHECK ("status" IN ('OPEN', 'RESPONDED', 'EXPIRED', 'DOWNGRADED'));

ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_time_check"
CHECK ("opensAt" <= "expiresAt");

-- Resource ledger and event/delivery sequence invariants.
ALTER TABLE "RoleAsset" ADD CONSTRAINT "RoleAsset_quantity_version_check"
CHECK ("quantity" >= 0 AND "version" >= 1);

ALTER TABLE "RoleAsset" ADD CONSTRAINT "RoleAsset_visibility_check"
CHECK ("visibility" IN ('PUBLIC', 'OBSERVABLE', 'LIMITED', 'PRIVATE'));

ALTER TABLE "StoryEvent" ADD CONSTRAINT "StoryEvent_sequence_check"
CHECK ("sequence" IS NULL OR "sequence" >= 1);

ALTER TABLE "StoryEvent" ADD CONSTRAINT "StoryEvent_audience_type_check"
CHECK (
    "audienceType" IS NULL
    OR "audienceType" IN ('PUBLIC', 'OBSERVABLE', 'LIMITED', 'PRIVATE')
);

ALTER TABLE "StoryEventCursor" ADD CONSTRAINT "StoryEventCursor_sequence_version_check"
CHECK ("nextSequence" >= 1 AND "version" >= 1);

ALTER TABLE "EventDeliveryCursor" ADD CONSTRAINT "EventDeliveryCursor_sequence_version_check"
CHECK ("nextSequence" >= 1 AND "version" >= 1);

ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_sequence_check"
CHECK ("deliverySequence" >= 1);

-- Role Agent persistence contracts.
ALTER TABLE "RoleAgentPolicy" ADD CONSTRAINT "RoleAgentPolicy_status_check"
CHECK ("status" IN ('ACTIVE', 'SUPERSEDED'));

ALTER TABLE "RoleAgentProjection" ADD CONSTRAINT "RoleAgentProjection_slot_epoch_check"
CHECK (
    "actionSlot" IN ('MAIN', 'MANEUVER', 'REACTION')
    AND "controlEpoch" >= 1
    AND "openingSnapshotVersion" >= 0
);

ALTER TABLE "RoleAgentDecision" ADD CONSTRAINT "RoleAgentDecision_status_check"
CHECK ("status" IN (
    'PENDING',
    'SEALED_ACT',
    'SEALED_FALLBACK',
    'PASS',
    'STALE',
    'NO_OP',
    'FAILED'
));

ALTER TABLE "RoleAgentDecision" ADD CONSTRAINT "RoleAgentDecision_slot_epoch_attempt_check"
CHECK (
    "actionSlot" IN ('MAIN', 'MANEUVER', 'REACTION')
    AND "controlEpoch" >= 1
    AND "openingSnapshotVersion" >= 0
    AND "providerAttempts" >= 0
);

-- The compatibility vocabulary admits the currently deployed lowercase
-- resolve_node worker until D02 application dual-write is complete.
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_task_type_check"
CHECK ("taskType" IN (
    'resolve_node',
    'RESOLVE_WINDOW',
    'PROJECT_REPAIR',
    'ROLE_AGENT_DECISION'
));

ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_status_check"
CHECK ("status" IN (
    'pending', 'running', 'completed', 'failed',
    'PENDING', 'RUNNING', 'RETRY', 'COMPLETED', 'FAILED'
));

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
        'REPAIRED'
    )
);

ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_attempt_lease_check"
CHECK (
    "attempt" >= 0
    AND "maxAttempts" >= 1
    AND "leaseVersion" >= 0
    AND ("controlEpoch" IS NULL OR "controlEpoch" >= 1)
);

ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_dedupe_format_check"
CHECK (
    "dedupeKey" IS NULL
    OR "dedupeKey" LIKE 'RESOLVE_LEGACY:%'
    OR "dedupeKey" LIKE 'RESOLVE:%'
    OR "dedupeKey" LIKE 'PROJECT_REPAIR:%'
    OR "dedupeKey" LIKE 'AI_TAKEOVER:%'
);

-- Resolution can resume only through the persisted workflow/checkpoint ledger.
ALTER TABLE "ResolutionWorkflow" ADD CONSTRAINT "ResolutionWorkflow_status_check"
CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED'));

ALTER TABLE "ResolutionWorkflow" ADD CONSTRAINT "ResolutionWorkflow_version_check"
CHECK ("version" >= 1);

ALTER TABLE "ResolutionCheckpoint" ADD CONSTRAINT "ResolutionCheckpoint_key_check"
CHECK (
    "checkpointKey" IN (
        'RULES_APPLIED',
        'PUBLIC_PROJECTED',
        'PUBLISHED',
        'NEXT_WINDOW_OPENED',
        'RUN_COMPLETED'
    )
    OR "checkpointKey" ~ '^ROLE_PROJECTED:[^:]+$'
);
