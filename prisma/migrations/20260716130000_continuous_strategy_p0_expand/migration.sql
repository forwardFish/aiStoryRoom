-- P0 continuous-strategy expand phase.
-- Existing writers remain valid: all newly required columns on existing tables
-- are nullable until application dual-write and the later contract migration.

-- AlterTable
ALTER TABLE "StoryRun"
    ADD COLUMN "engineVersion" TEXT,
    ADD COLUMN "strategyVersion" TEXT;

-- AlterTable
ALTER TABLE "PlayerAction"
    ADD COLUMN "actionSlot" TEXT,
    ADD COLUMN "actorKind" TEXT,
    ADD COLUMN "controlEpoch" INTEGER,
    ADD COLUMN "policyVersion" TEXT,
    ADD COLUMN "provider" TEXT,
    ADD COLUMN "modelName" TEXT,
    ADD COLUMN "actionKey" TEXT,
    ADD COLUMN "idempotencyKey" TEXT,
    ADD COLUMN "requestHash" TEXT,
    ADD COLUMN "sourceInteractionRequestId" TEXT,
    ADD COLUMN "visibility" TEXT,
    ADD COLUMN "targetRoleId" TEXT,
    ADD COLUMN "leverageKey" TEXT,
    ADD COLUMN "sealedAt" TIMESTAMP(3),
    ADD COLUMN "expiresAt" TIMESTAMP(3),
    ADD COLUMN "immediateJson" JSONB,
    ADD COLUMN "resolvedJson" JSONB,
    ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoryEvent"
    ADD COLUMN "sequence" INTEGER,
    ADD COLUMN "dedupeKey" TEXT,
    ADD COLUMN "audienceType" TEXT,
    ADD COLUMN "audienceRoleIdsJson" JSONB,
    ADD COLUMN "sourceActionId" TEXT;

-- AlterTable
ALTER TABLE "SceneSnapshot" ADD COLUMN "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "NarrativeEntry" ADD COLUMN "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "StoryTaskOutbox"
    ADD COLUMN "dedupeKey" TEXT,
    ADD COLUMN "windowId" TEXT,
    ADD COLUMN "roleId" TEXT,
    ADD COLUMN "actionSlot" TEXT,
    ADD COLUMN "controlEpoch" INTEGER,
    ADD COLUMN "outcome" TEXT,
    ADD COLUMN "inputRefId" TEXT,
    ADD COLUMN "checkpointKey" TEXT,
    ADD COLUMN "leaseVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ActionWindow" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "mainOpenedAt" TIMESTAMP(3),
    "mainClosesAt" TIMESTAMP(3),
    "graceOpenedAt" TIMESTAMP(3),
    "graceMinClosesAt" TIMESTAMP(3),
    "graceClosesAt" TIMESTAMP(3),
    "aiQueueDrainedAt" TIMESTAMP(3),
    "closingReason" TEXT,
    "resolutionTaskId" TEXT,
    "openingSnapshotVersion" INTEGER,
    "projectionVersion" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMP(3),
    "configJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionWindowOpeningProjection" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "projectionJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionWindowOpeningProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionWindowParticipant" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "mainStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "maneuverStatus" TEXT NOT NULL DEFAULT 'LOCKED',
    "reactionStatus" TEXT NOT NULL DEFAULT 'NOT_OPEN',
    "maneuverUsedAt" TIMESTAMP(3),
    "reactionUsedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ActionWindowParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleControl" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "humanPlayerId" TEXT,
    "mode" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "offlineSince" TIMESTAMP(3),
    "takeoverAt" TIMESTAMP(3),
    "reclaimAfterWindowId" TEXT,
    "stageLeaveWindowId" TEXT,
    "policyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleControlTransition" (
    "id" TEXT NOT NULL,
    "roleControlId" TEXT NOT NULL,
    "fromMode" TEXT NOT NULL,
    "toMode" TEXT NOT NULL,
    "fromEpoch" INTEGER NOT NULL,
    "toEpoch" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "initiatedByUserId" TEXT,
    "effectiveWindowId" TEXT,
    "effectiveSlot" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleControlTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionRequest" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "sourceActionId" TEXT NOT NULL,
    "targetRoleId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "defaultOutcomeJson" JSONB NOT NULL,
    "responseActionId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InteractionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAsset" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerRoleId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "stateJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssetMutation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "mutationType" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "fromRoleId" TEXT,
    "toRoleId" TEXT,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAssetMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryEventCursor" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryEventCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDeliveryCursor" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDeliveryCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT,
    "deliverySequence" INTEGER NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAgentPolicy" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "goalsJson" JSONB NOT NULL,
    "riskProfileJson" JSONB NOT NULL,
    "assetPriorityJson" JSONB NOT NULL,
    "actionWeightsJson" JSONB NOT NULL,
    "fallbackBySlotJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "RoleAgentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAgentProjection" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "actionSlot" TEXT NOT NULL,
    "controlEpoch" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "openingSnapshotVersion" INTEGER NOT NULL,
    "projectionJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAgentProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAgentDecision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "actionSlot" TEXT NOT NULL,
    "controlEpoch" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "openingSnapshotVersion" INTEGER NOT NULL,
    "taskDedupeKey" TEXT NOT NULL,
    "projectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "visibleFactIdsJson" JSONB NOT NULL,
    "chosenActionKey" TEXT,
    "targetRoleId" TEXT,
    "leverageKey" TEXT,
    "shortRationale" TEXT,
    "provider" TEXT,
    "modelName" TEXT,
    "providerAttempts" INTEGER NOT NULL DEFAULT 0,
    "providerResponseHash" TEXT,
    "guardDecisionJson" JSONB,
    "playerActionId" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionWorkflow" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "resolutionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "rulesInputHash" TEXT NOT NULL,
    "rulesOutputJson" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ResolutionWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionCheckpoint" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "checkpointKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "outputRefType" TEXT,
    "outputRefId" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResolutionCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionWindow_nodeId_key" ON "ActionWindow"("nodeId");
CREATE UNIQUE INDEX "ActionWindow_resolutionTaskId_key" ON "ActionWindow"("resolutionTaskId");
CREATE INDEX "ActionWindow_status_mainClosesAt_idx" ON "ActionWindow"("status", "mainClosesAt");
CREATE INDEX "ActionWindow_status_graceClosesAt_idx" ON "ActionWindow"("status", "graceClosesAt");
CREATE INDEX "ActionWindow_runId_status_idx" ON "ActionWindow"("runId", "status");

CREATE UNIQUE INDEX "ActionWindowOpeningProjection_windowId_roleId_key" ON "ActionWindowOpeningProjection"("windowId", "roleId");
CREATE INDEX "ActionWindowOpeningProjection_windowId_snapshotVersion_idx" ON "ActionWindowOpeningProjection"("windowId", "snapshotVersion");

CREATE UNIQUE INDEX "ActionWindowParticipant_windowId_roleId_key" ON "ActionWindowParticipant"("windowId", "roleId");
CREATE INDEX "ActionWindowParticipant_windowId_mainStatus_doneAt_idx" ON "ActionWindowParticipant"("windowId", "mainStatus", "doneAt");

CREATE UNIQUE INDEX "RoleControl_runId_roleId_key" ON "RoleControl"("runId", "roleId");
CREATE INDEX "RoleControl_mode_lastHeartbeatAt_idx" ON "RoleControl"("mode", "lastHeartbeatAt");
CREATE INDEX "RoleControl_humanPlayerId_idx" ON "RoleControl"("humanPlayerId");

CREATE UNIQUE INDEX "RoleControlTransition_idempotencyKey_key" ON "RoleControlTransition"("idempotencyKey");
CREATE INDEX "RoleControlTransition_roleControlId_createdAt_idx" ON "RoleControlTransition"("roleControlId", "createdAt");
CREATE INDEX "RoleControlTransition_effectiveWindowId_idx" ON "RoleControlTransition"("effectiveWindowId");

CREATE UNIQUE INDEX "InteractionRequest_responseActionId_key" ON "InteractionRequest"("responseActionId");
CREATE UNIQUE INDEX "InteractionRequest_dedupeKey_key" ON "InteractionRequest"("dedupeKey");
CREATE INDEX "InteractionRequest_runId_status_idx" ON "InteractionRequest"("runId", "status");
CREATE INDEX "InteractionRequest_windowId_targetRoleId_status_idx" ON "InteractionRequest"("windowId", "targetRoleId", "status");
CREATE INDEX "InteractionRequest_sourceActionId_idx" ON "InteractionRequest"("sourceActionId");

CREATE UNIQUE INDEX "RoleAsset_runId_assetKey_key" ON "RoleAsset"("runId", "assetKey");
CREATE INDEX "RoleAsset_ownerRoleId_status_idx" ON "RoleAsset"("ownerRoleId", "status");

CREATE UNIQUE INDEX "RoleAssetMutation_idempotencyKey_key" ON "RoleAssetMutation"("idempotencyKey");
CREATE INDEX "RoleAssetMutation_assetId_createdAt_idx" ON "RoleAssetMutation"("assetId", "createdAt");
CREATE INDEX "RoleAssetMutation_actionId_idx" ON "RoleAssetMutation"("actionId");

CREATE UNIQUE INDEX "StoryEventCursor_runId_key" ON "StoryEventCursor"("runId");

CREATE UNIQUE INDEX "EventDeliveryCursor_roomId_userId_key" ON "EventDeliveryCursor"("roomId", "userId");
CREATE INDEX "EventDeliveryCursor_userId_idx" ON "EventDeliveryCursor"("userId");

CREATE UNIQUE INDEX "EventDelivery_roomId_userId_deliverySequence_key" ON "EventDelivery"("roomId", "userId", "deliverySequence");
CREATE UNIQUE INDEX "EventDelivery_eventId_userId_key" ON "EventDelivery"("eventId", "userId");
CREATE INDEX "EventDelivery_userId_deliveredAt_idx" ON "EventDelivery"("userId", "deliveredAt");
CREATE INDEX "EventDelivery_roleId_idx" ON "EventDelivery"("roleId");

CREATE UNIQUE INDEX "RoleAgentPolicy_runId_roleId_policyVersion_key" ON "RoleAgentPolicy"("runId", "roleId", "policyVersion");
CREATE INDEX "RoleAgentPolicy_runId_roleId_status_idx" ON "RoleAgentPolicy"("runId", "roleId", "status");

CREATE UNIQUE INDEX "RoleAgentProjection_windowId_roleId_actionSlot_controlEpoch_key" ON "RoleAgentProjection"("windowId", "roleId", "actionSlot", "controlEpoch");
CREATE INDEX "RoleAgentProjection_runId_roleId_createdAt_idx" ON "RoleAgentProjection"("runId", "roleId", "createdAt");

CREATE UNIQUE INDEX "RoleAgentDecision_taskDedupeKey_key" ON "RoleAgentDecision"("taskDedupeKey");
CREATE UNIQUE INDEX "RoleAgentDecision_playerActionId_key" ON "RoleAgentDecision"("playerActionId");
CREATE UNIQUE INDEX "RoleAgentDecision_windowId_roleId_actionSlot_controlEpoch_key" ON "RoleAgentDecision"("windowId", "roleId", "actionSlot", "controlEpoch");
CREATE INDEX "RoleAgentDecision_runId_roleId_createdAt_idx" ON "RoleAgentDecision"("runId", "roleId", "createdAt");
CREATE INDEX "RoleAgentDecision_projectionId_idx" ON "RoleAgentDecision"("projectionId");

CREATE UNIQUE INDEX "ResolutionWorkflow_windowId_key" ON "ResolutionWorkflow"("windowId");
CREATE UNIQUE INDEX "ResolutionWorkflow_nodeId_key" ON "ResolutionWorkflow"("nodeId");
CREATE UNIQUE INDEX "ResolutionWorkflow_resolutionId_key" ON "ResolutionWorkflow"("resolutionId");
CREATE INDEX "ResolutionWorkflow_runId_status_idx" ON "ResolutionWorkflow"("runId", "status");

CREATE UNIQUE INDEX "ResolutionCheckpoint_workflowId_checkpointKey_key" ON "ResolutionCheckpoint"("workflowId", "checkpointKey");

CREATE INDEX "StoryTaskOutbox_runId_taskType_status_idx" ON "StoryTaskOutbox"("runId", "taskType", "status");
CREATE INDEX "StoryTaskOutbox_windowId_roleId_actionSlot_idx" ON "StoryTaskOutbox"("windowId", "roleId", "actionSlot");
CREATE INDEX "StoryTaskOutbox_leaseOwner_leaseExpiresAt_idx" ON "StoryTaskOutbox"("leaseOwner", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_resolutionTaskId_fkey" FOREIGN KEY ("resolutionTaskId") REFERENCES "StoryTaskOutbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActionWindowOpeningProjection" ADD CONSTRAINT "ActionWindowOpeningProjection_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ActionWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionWindowOpeningProjection" ADD CONSTRAINT "ActionWindowOpeningProjection_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActionWindowParticipant" ADD CONSTRAINT "ActionWindowParticipant_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ActionWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionWindowParticipant" ADD CONSTRAINT "ActionWindowParticipant_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_humanPlayerId_fkey" FOREIGN KEY ("humanPlayerId") REFERENCES "StoryPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_reclaimAfterWindowId_fkey" FOREIGN KEY ("reclaimAfterWindowId") REFERENCES "ActionWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_stageLeaveWindowId_fkey" FOREIGN KEY ("stageLeaveWindowId") REFERENCES "ActionWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RoleControlTransition" ADD CONSTRAINT "RoleControlTransition_roleControlId_fkey" FOREIGN KEY ("roleControlId") REFERENCES "RoleControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleControlTransition" ADD CONSTRAINT "RoleControlTransition_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleControlTransition" ADD CONSTRAINT "RoleControlTransition_effectiveWindowId_fkey" FOREIGN KEY ("effectiveWindowId") REFERENCES "ActionWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ActionWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_sourceActionId_fkey" FOREIGN KEY ("sourceActionId") REFERENCES "PlayerAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_targetRoleId_fkey" FOREIGN KEY ("targetRoleId") REFERENCES "StoryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_responseActionId_fkey" FOREIGN KEY ("responseActionId") REFERENCES "PlayerAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_sourceInteractionRequestId_fkey" FOREIGN KEY ("sourceInteractionRequestId") REFERENCES "InteractionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_targetRoleId_fkey" FOREIGN KEY ("targetRoleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RoleAsset" ADD CONSTRAINT "RoleAsset_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAsset" ADD CONSTRAINT "RoleAsset_ownerRoleId_fkey" FOREIGN KEY ("ownerRoleId") REFERENCES "StoryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoleAssetMutation" ADD CONSTRAINT "RoleAssetMutation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "RoleAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleAssetMutation" ADD CONSTRAINT "RoleAssetMutation_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "PlayerAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleAssetMutation" ADD CONSTRAINT "RoleAssetMutation_fromRoleId_fkey" FOREIGN KEY ("fromRoleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleAssetMutation" ADD CONSTRAINT "RoleAssetMutation_toRoleId_fkey" FOREIGN KEY ("toRoleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StoryEvent" ADD CONSTRAINT "StoryEvent_sourceActionId_fkey" FOREIGN KEY ("sourceActionId") REFERENCES "PlayerAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoryEventCursor" ADD CONSTRAINT "StoryEventCursor_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventDeliveryCursor" ADD CONSTRAINT "EventDeliveryCursor_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventDeliveryCursor" ADD CONSTRAINT "EventDeliveryCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StoryEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RoleAgentPolicy" ADD CONSTRAINT "RoleAgentPolicy_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAgentPolicy" ADD CONSTRAINT "RoleAgentPolicy_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoleAgentProjection" ADD CONSTRAINT "RoleAgentProjection_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAgentProjection" ADD CONSTRAINT "RoleAgentProjection_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ActionWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAgentProjection" ADD CONSTRAINT "RoleAgentProjection_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoleAgentDecision" ADD CONSTRAINT "RoleAgentDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAgentDecision" ADD CONSTRAINT "RoleAgentDecision_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ActionWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAgentDecision" ADD CONSTRAINT "RoleAgentDecision_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleAgentDecision" ADD CONSTRAINT "RoleAgentDecision_targetRoleId_fkey" FOREIGN KEY ("targetRoleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleAgentDecision" ADD CONSTRAINT "RoleAgentDecision_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "RoleAgentProjection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAgentDecision" ADD CONSTRAINT "RoleAgentDecision_playerActionId_fkey" FOREIGN KEY ("playerActionId") REFERENCES "PlayerAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ActionWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ResolutionWorkflow" ADD CONSTRAINT "ResolutionWorkflow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResolutionWorkflow" ADD CONSTRAINT "ResolutionWorkflow_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ActionWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResolutionWorkflow" ADD CONSTRAINT "ResolutionWorkflow_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResolutionWorkflow" ADD CONSTRAINT "ResolutionWorkflow_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "DirectorResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ResolutionCheckpoint" ADD CONSTRAINT "ResolutionCheckpoint_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ResolutionWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
