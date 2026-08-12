-- Pressure MVP schema.
-- This migration was consolidated before its first deployment. It creates
-- exactly twelve Pressure-owned tables and does not mutate legacy game data.

CREATE TYPE "PressureParticipantMode" AS ENUM ('SOLO', 'MULTIPLAYER');
CREATE TYPE "PressureChapterRuntimeState" AS ENUM (
  'CHAPTER_OPENING',
  'CHAPTER_ACTIVE',
  'DECISION_POINT_OPEN',
  'ACTION_DRAFTING',
  'ACTIONS_SEALED',
  'BEAT_RESOLVING',
  'BEAT_RESOLVED',
  'CHAPTER_CLOSING',
  'CHAPTER_SETTLING',
  'CHAPTER_FROZEN'
);
CREATE TYPE "PressureDecisionActionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'SEALED', 'REJECTED');
CREATE TYPE "PressureNarrativeProjectionKind" AS ENUM (
  'GENESIS_NARRATIVE',
  'BEAT_NARRATIVE',
  'CHAPTER_NARRATIVE',
  'FINALE_NARRATIVE'
);
CREATE TYPE "PressureNarrativeSourceAuthority" AS ENUM (
  'GENESIS_FROZEN',
  'CHAPTER_WORKING',
  'CHAPTER_FROZEN',
  'FINALE_FROZEN',
  'LEGACY_TERMINAL_COMMITTED'
);
CREATE TYPE "PressureNarrativeAudienceKind" AS ENUM ('PUBLIC', 'SEAT');
CREATE TYPE "PressureNarrativeStatus" AS ENUM (
  'PENDING',
  'GENERATING',
  'VALIDATING',
  'PUBLISHED',
  'FALLBACK_PUBLISHED',
  'FAILED_RETRYABLE'
);
CREATE TYPE "PressureOutboxTaskType" AS ENUM (
  'OPEN_CHAPTER',
  'PROJECT_GENESIS_NARRATIVE',
  'PROJECT_BEAT_NARRATIVE',
  'PROJECT_CHAPTER_NARRATIVE',
  'COMPUTE_FINALE',
  'PROJECT_FINALE_NARRATIVE',
  'INTERACTION_COMPILE_REQUESTED',
  'PUBLISH_RESULT'
);
CREATE TYPE "PressureOutboxStatus" AS ENUM (
  'PENDING',
  'LEASED',
  'RETRYABLE',
  'COMPLETED',
  'DEAD_LETTER'
);
CREATE TYPE "PressureOutboxCheckpoint" AS ENUM (
  'PERSISTED',
  'LEASED',
  'HANDLER_STARTED',
  'HANDLER_COMMITTED',
  'PUBLISHED',
  'ACKNOWLEDGED',
  'FAILED_RETRYABLE',
  'DEAD_LETTER'
);
CREATE TYPE "PressureReplayLaunchKind" AS ENUM ('CREATE_RUN', 'CREATE_LOBBY', 'NAVIGATE');

CREATE TABLE "PressureRunLifecycle" (
  "runId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "participantMode" "PressureParticipantMode" NOT NULL,
  "lifecycle" TEXT NOT NULL,
  "routeFreeze" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "shellHash" TEXT NOT NULL,
  "shellJson" JSONB NOT NULL,
  "lobbyJson" JSONB NOT NULL,
  "startJson" JSONB NOT NULL,
  "stateHash" TEXT NOT NULL,
  "startRequestFingerprint" TEXT,
  "startIdempotencyKey" TEXT,
  "startRunSeed" TEXT,
  "startMaterialHash" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PressureRunLifecycle_pkey" PRIMARY KEY ("runId")
);

CREATE TABLE "PressureRunRouteSnapshot" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "strategyVersion" TEXT NOT NULL,
  "runtimeProfile" TEXT NOT NULL,
  "endgamePolicyVersion" TEXT NOT NULL,
  "resultSchemaVersion" TEXT NOT NULL,
  "contentPackageVersion" TEXT NOT NULL,
  "contentPackageSha256" TEXT NOT NULL,
  "orchestrationPackageVersion" TEXT NOT NULL,
  "orchestrationPackageSha256" TEXT NOT NULL,
  "runtimeContractVersion" TEXT NOT NULL,
  "runtimeContractSha256" TEXT NOT NULL,
  "testMatrixVersion" TEXT NOT NULL,
  "testMatrixSha256" TEXT NOT NULL,
  "runSeed" TEXT NOT NULL,
  "narrativeProfileVersion" TEXT NOT NULL,
  "featureSetVersion" TEXT NOT NULL,
  "resultContractRegistryVersion" TEXT NOT NULL,
  "participantMode" "PressureParticipantMode" NOT NULL,
  "seatIdsJson" JSONB NOT NULL,
  "humanSeatIdsAtStartJson" JSONB NOT NULL,
  "controlTopologyVersion" TEXT NOT NULL,
  "initialRoleControlSnapshotHash" TEXT NOT NULL,
  "routeJson" JSONB NOT NULL,
  "routeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PressureRunRouteSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureGenesisCommit" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "genesisHash" TEXT NOT NULL,
  "commitManifestJson" JSONB NOT NULL,
  "commitManifestHash" TEXT NOT NULL,
  "rootEventId" TEXT NOT NULL,
  "outboxDedupeKeysJson" JSONB NOT NULL,
  "commitHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PressureGenesisCommit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureChapterRuntime" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "chapterSequence" INTEGER NOT NULL,
  "state" "PressureChapterRuntimeState" NOT NULL DEFAULT 'CHAPTER_OPENING',
  "baseWorldSequence" INTEGER NOT NULL,
  "baseWorldStateHash" TEXT NOT NULL,
  "previousFrozenHash" TEXT NOT NULL,
  "routeHash" TEXT NOT NULL,
  "contentPackageVersion" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "orchestrationPackageVersion" TEXT NOT NULL,
  "orchestrationHash" TEXT NOT NULL,
  "runtimeContractVersion" TEXT NOT NULL,
  "runtimeContractHash" TEXT NOT NULL,
  "workingRevision" INTEGER NOT NULL DEFAULT 0,
  "workingStateJson" JSONB NOT NULL,
  "workingStateHash" TEXT NOT NULL,
  "decisionStateJson" JSONB NOT NULL,
  "ledgerProjectionJson" JSONB NOT NULL,
  "closeInputHash" TEXT,
  "lockVersion" INTEGER NOT NULL DEFAULT 0,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closingAt" TIMESTAMP(3),
  "frozenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PressureChapterRuntime_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureDecisionAction" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "chapterRuntimeId" TEXT NOT NULL,
  "decisionPointId" TEXT NOT NULL,
  "seatId" TEXT NOT NULL,
  "actionOrdinal" INTEGER NOT NULL,
  "actionType" TEXT NOT NULL,
  "status" "PressureDecisionActionStatus" NOT NULL DEFAULT 'DRAFT',
  "controlEpoch" INTEGER NOT NULL,
  "expectedWorkingRevision" INTEGER NOT NULL,
  "currentRevision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "sealedHash" TEXT,
  "authorityEventHash" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "sealedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PressureDecisionAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureChapterSettlement" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "chapterRuntimeId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "chapterSequence" INTEGER NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "baseWorldSequence" INTEGER NOT NULL,
  "committedWorldSequence" INTEGER NOT NULL,
  "baseWorldStateHash" TEXT NOT NULL,
  "committedWorldStateHash" TEXT NOT NULL,
  "inputJson" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "evaluationJson" JSONB NOT NULL,
  "evaluationHash" TEXT NOT NULL,
  "worldDeltaJson" JSONB NOT NULL,
  "worldDeltaHash" TEXT NOT NULL,
  "decisionLedgerHash" TEXT NOT NULL,
  "finalWorkingStateHash" TEXT NOT NULL,
  "reservationLedgerHash" TEXT NOT NULL,
  "frozenBundleHash" TEXT NOT NULL,
  "commitManifestJson" JSONB NOT NULL,
  "commitManifestHash" TEXT NOT NULL,
  "rootEventId" TEXT NOT NULL,
  "outboxDedupeKeysJson" JSONB NOT NULL,
  "commitHash" TEXT NOT NULL,
  "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PressureChapterSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureFinaleDecision" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "runtimeProfile" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "packageSha256" TEXT NOT NULL,
  "routeHash" TEXT NOT NULL,
  "genesisHash" TEXT NOT NULL,
  "frozenChapterBundleHashesJson" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "evaluationHash" TEXT NOT NULL,
  "semanticOutcomeHash" TEXT NOT NULL,
  "executionFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "worldOutcomeJson" JSONB NOT NULL,
  "trackOutcomesJson" JSONB NOT NULL,
  "objectOutcomeRefsJson" JSONB NOT NULL,
  "evidenceResponsibilityRefsJson" JSONB NOT NULL,
  "decisionJson" JSONB NOT NULL,
  "decisionHash" TEXT NOT NULL,
  "commitManifestJson" JSONB NOT NULL,
  "commitManifestHash" TEXT NOT NULL,
  "rootEventId" TEXT NOT NULL,
  "outboxDedupeKeysJson" JSONB NOT NULL,
  "commitHash" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PressureFinaleDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureLegacyTerminalCommit" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "sourceTurn" INTEGER NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "sourceStateHash" TEXT NOT NULL,
  "sourceCanonHash" TEXT NOT NULL,
  "endingHash" TEXT NOT NULL,
  "resultHash" TEXT NOT NULL,
  "terminalState" TEXT NOT NULL,
  "sourceCommitHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "commitManifestJson" JSONB NOT NULL,
  "commitManifestHash" TEXT NOT NULL,
  "rootEventId" TEXT NOT NULL,
  "outboxDedupeKeysJson" JSONB NOT NULL,
  "commitHash" TEXT NOT NULL,
  "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PressureLegacyTerminalCommit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureNarrativeProjection" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "projectionKind" "PressureNarrativeProjectionKind" NOT NULL,
  "sourceAuthority" "PressureNarrativeSourceAuthority" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceCommitHash" TEXT NOT NULL,
  "sourceContentHash" TEXT NOT NULL,
  "narrativeProfileVersion" TEXT NOT NULL,
  "projectorVersion" TEXT NOT NULL,
  "audienceKind" "PressureNarrativeAudienceKind" NOT NULL,
  "audienceSeatId" TEXT,
  "audienceKey" TEXT NOT NULL,
  "status" "PressureNarrativeStatus" NOT NULL DEFAULT 'PENDING',
  "requestFingerprint" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "checkpoint" "PressureOutboxCheckpoint" NOT NULL DEFAULT 'PERSISTED',
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "artifactJson" JSONB,
  "artifactContentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "PressureNarrativeProjection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureOutboxTask" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "taskType" "PressureOutboxTaskType" NOT NULL,
  "status" "PressureOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "checkpoint" "PressureOutboxCheckpoint" NOT NULL DEFAULT 'PERSISTED',
  "dedupeKey" TEXT NOT NULL,
  "sourceAuthority" "PressureNarrativeSourceAuthority" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceCommitHash" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PressureOutboxTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureReplayCommandReceipt" (
  "id" TEXT NOT NULL,
  "sourceRunId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "actionFingerprint" TEXT NOT NULL,
  "launchKind" "PressureReplayLaunchKind" NOT NULL,
  "createdRunId" TEXT,
  "createdLobbyId" TEXT,
  "navigationTarget" TEXT,
  "frozenTargetRouteHash" TEXT,
  "receiptJson" JSONB NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PressureReplayCommandReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PressureSeatControlSnapshot" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "routeHash" TEXT NOT NULL,
  "genesisHash" TEXT NOT NULL,
  "genesisAtomicRecordHash" TEXT NOT NULL,
  "initialTopologyHash" TEXT NOT NULL,
  "controlTopologyVersion" TEXT NOT NULL,
  "participantMode" "PressureParticipantMode" NOT NULL,
  "stateRevision" INTEGER NOT NULL,
  "timelineLength" INTEGER NOT NULL,
  "timelineHeadHash" TEXT NOT NULL,
  "initializationInputHash" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PressureSeatControlSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pc_lifecycle_state_updated_idx" ON "PressureRunLifecycle"("lifecycle", "updatedAt");
CREATE INDEX "pc_lifecycle_request_idx" ON "PressureRunLifecycle"("idempotencyKey", "requestFingerprint");

CREATE UNIQUE INDEX "pc_route_run_key" ON "PressureRunRouteSnapshot"("runId");
CREATE UNIQUE INDEX "pc_route_hash_key" ON "PressureRunRouteSnapshot"("routeHash");
CREATE UNIQUE INDEX "pc_route_hash_run_key" ON "PressureRunRouteSnapshot"("routeHash", "runId");
CREATE INDEX "pc_route_profile_created_idx" ON "PressureRunRouteSnapshot"("runtimeProfile", "createdAt");

CREATE UNIQUE INDEX "pc_genesis_commit_run_key" ON "PressureGenesisCommit"("runId");
CREATE UNIQUE INDEX "pc_genesis_idempotency_key" ON "PressureGenesisCommit"("runId", "idempotencyKey");

CREATE UNIQUE INDEX "pc_chapter_run_sequence_key" ON "PressureChapterRuntime"("runId", "chapterSequence");
CREATE UNIQUE INDEX "pc_chapter_run_id_key" ON "PressureChapterRuntime"("runId", "chapterId");
CREATE UNIQUE INDEX "pc_chapter_id_run_key" ON "PressureChapterRuntime"("id", "runId");
CREATE INDEX "pc_chapter_run_state_idx" ON "PressureChapterRuntime"("runId", "state");

CREATE UNIQUE INDEX "pc_action_authority_event_key" ON "PressureDecisionAction"("authorityEventHash");
CREATE UNIQUE INDEX "pc_action_point_seat_ordinal_key" ON "PressureDecisionAction"("decisionPointId", "seatId", "actionOrdinal");
CREATE UNIQUE INDEX "pc_action_run_idempotency_key" ON "PressureDecisionAction"("runId", "idempotencyKey");
CREATE UNIQUE INDEX "pc_action_id_chapter_key" ON "PressureDecisionAction"("id", "chapterRuntimeId");
CREATE INDEX "pc_action_chapter_seat_status_idx" ON "PressureDecisionAction"("chapterRuntimeId", "seatId", "status");

CREATE UNIQUE INDEX "pc_settlement_chapter_key" ON "PressureChapterSettlement"("chapterRuntimeId");
CREATE UNIQUE INDEX "pc_settlement_bundle_hash_key" ON "PressureChapterSettlement"("frozenBundleHash");
CREATE UNIQUE INDEX "pc_settlement_run_sequence_key" ON "PressureChapterSettlement"("runId", "chapterSequence");
CREATE UNIQUE INDEX "pc_settlement_run_idempotency_key" ON "PressureChapterSettlement"("runId", "idempotencyKey");
CREATE UNIQUE INDEX "pc_settlement_run_world_sequence_key" ON "PressureChapterSettlement"("runId", "committedWorldSequence");
CREATE UNIQUE INDEX "pc_settlement_id_run_chapter_key" ON "PressureChapterSettlement"("id", "runId", "chapterRuntimeId");
CREATE UNIQUE INDEX "pc_settlement_chapter_run_key" ON "PressureChapterSettlement"("chapterRuntimeId", "runId");

CREATE UNIQUE INDEX "pc_finale_run_key" ON "PressureFinaleDecision"("runId");
CREATE UNIQUE INDEX "pc_finale_run_idempotency_key" ON "PressureFinaleDecision"("runId", "idempotencyKey");
CREATE UNIQUE INDEX "pc_finale_id_run_key" ON "PressureFinaleDecision"("id", "runId");

CREATE UNIQUE INDEX "pc_legacy_terminal_run_key" ON "PressureLegacyTerminalCommit"("runId");
CREATE UNIQUE INDEX "pc_legacy_source_commit_key" ON "PressureLegacyTerminalCommit"("sourceCommitHash");
CREATE UNIQUE INDEX "pc_legacy_terminal_idempotency_key" ON "PressureLegacyTerminalCommit"("runId", "idempotencyKey");

CREATE UNIQUE INDEX "pc_narrative_projection_logical_key" ON "PressureNarrativeProjection"(
  "projectionKind",
  "sourceCommitHash",
  "narrativeProfileVersion",
  "projectorVersion",
  "audienceKind",
  "audienceKey"
);
CREATE INDEX "pc_narrative_projection_status_idx" ON "PressureNarrativeProjection"("runId", "status", "createdAt");
CREATE INDEX "pc_narrative_projection_lease_idx" ON "PressureNarrativeProjection"("leaseExpiresAt", "status");

CREATE UNIQUE INDEX "pc_outbox_dedupe_key" ON "PressureOutboxTask"("dedupeKey");
CREATE INDEX "pc_outbox_ready_idx" ON "PressureOutboxTask"("status", "availableAt");
CREATE INDEX "pc_outbox_run_type_status_idx" ON "PressureOutboxTask"("runId", "taskType", "status");
CREATE INDEX "pc_outbox_lease_idx" ON "PressureOutboxTask"("leaseOwner", "leaseExpiresAt", "leaseVersion");

CREATE UNIQUE INDEX "pc_replay_source_idempotency_key" ON "PressureReplayCommandReceipt"("sourceRunId", "idempotencyKey");
CREATE INDEX "pc_replay_created_run_idx" ON "PressureReplayCommandReceipt"("createdRunId");
CREATE INDEX "pc_replay_created_lobby_idx" ON "PressureReplayCommandReceipt"("createdLobbyId");

CREATE UNIQUE INDEX "pc_seat_snapshot_run_key" ON "PressureSeatControlSnapshot"("runId");
CREATE UNIQUE INDEX "pc_seat_snapshot_hash_key" ON "PressureSeatControlSnapshot"("stateHash");
CREATE INDEX "pc_seat_snapshot_run_revision_idx" ON "PressureSeatControlSnapshot"("runId", "stateRevision");

ALTER TABLE "PressureRunLifecycle"
  ADD CONSTRAINT "pc_lifecycle_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PressureRunRouteSnapshot"
  ADD CONSTRAINT "pc_route_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PressureGenesisCommit"
  ADD CONSTRAINT "pc_genesis_commit_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PressureChapterRuntime"
  ADD CONSTRAINT "pc_chapter_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PressureChapterRuntime"
  ADD CONSTRAINT "pc_chapter_route_fkey"
  FOREIGN KEY ("routeHash", "runId") REFERENCES "PressureRunRouteSnapshot"("routeHash", "runId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PressureDecisionAction"
  ADD CONSTRAINT "pc_action_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PressureDecisionAction"
  ADD CONSTRAINT "pc_action_chapter_fkey"
  FOREIGN KEY ("chapterRuntimeId", "runId") REFERENCES "PressureChapterRuntime"("id", "runId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PressureChapterSettlement"
  ADD CONSTRAINT "pc_settlement_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PressureChapterSettlement"
  ADD CONSTRAINT "pc_settlement_chapter_fkey"
  FOREIGN KEY ("chapterRuntimeId", "runId") REFERENCES "PressureChapterRuntime"("id", "runId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PressureFinaleDecision"
  ADD CONSTRAINT "pc_finale_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PressureFinaleDecision"
  ADD CONSTRAINT "pc_finale_route_fkey"
  FOREIGN KEY ("routeHash", "runId") REFERENCES "PressureRunRouteSnapshot"("routeHash", "runId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PressureLegacyTerminalCommit"
  ADD CONSTRAINT "pc_legacy_terminal_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PressureNarrativeProjection"
  ADD CONSTRAINT "pc_narrative_projection_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PressureOutboxTask"
  ADD CONSTRAINT "pc_outbox_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PressureReplayCommandReceipt"
  ADD CONSTRAINT "pc_replay_source_run_fkey"
  FOREIGN KEY ("sourceRunId") REFERENCES "StoryRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PressureSeatControlSnapshot"
  ADD CONSTRAINT "pc_seat_snapshot_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
