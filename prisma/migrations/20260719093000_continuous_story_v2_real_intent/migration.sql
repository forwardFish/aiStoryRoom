-- Preserve the complete player-authored decision contract. Columns stay
-- nullable so historical V2 test rows remain readable; every new V2 submit
-- writes all five fields and acceptance verifies their presence.
ALTER TABLE "DecisionSubmission"
  ADD COLUMN "rawIntentJson" JSONB,
  ADD COLUMN "normalizedIntentJson" JSONB,
  ADD COLUMN "immutableIntentHash" TEXT,
  ADD COLUMN "guardDecisionJson" JSONB,
  ADD COLUMN "selectedLeverageKeysJson" JSONB;

CREATE TABLE "InteractionRequestV2" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceResolutionId" TEXT NOT NULL,
  "sourceRoleId" TEXT NOT NULL,
  "targetRoleId" TEXT NOT NULL,
  "requestKind" TEXT NOT NULL,
  "pressureJson" JSONB NOT NULL,
  "observableTraceJson" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "responseTurnId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InteractionRequestV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConditionalActionV2" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "ownerThreadId" TEXT NOT NULL,
  "sourceSubmissionId" TEXT NOT NULL,
  "rawConditionJson" JSONB NOT NULL,
  "normalizedCommandJson" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ARMED',
  "triggerEventKey" TEXT,
  "triggeredResolutionId" TEXT,
  "expiresAtStage" INTEGER,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "triggeredAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConditionalActionV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommitmentV2" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceResolutionId" TEXT NOT NULL,
  "issuerRoleId" TEXT NOT NULL,
  "receiverRoleId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'LIMITED',
  "expiresAtStage" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfilledAt" TIMESTAMP(3),
  "breachedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommitmentV2_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InteractionRequestV2_responseTurnId_key" ON "InteractionRequestV2"("responseTurnId");
CREATE UNIQUE INDEX "InteractionRequestV2_dedupeKey_key" ON "InteractionRequestV2"("dedupeKey");
CREATE UNIQUE INDEX "InteractionRequestV2_sourceResolutionId_targetRoleId_key" ON "InteractionRequestV2"("sourceResolutionId", "targetRoleId");
CREATE INDEX "InteractionRequestV2_runId_targetRoleId_status_idx" ON "InteractionRequestV2"("runId", "targetRoleId", "status");
CREATE INDEX "InteractionRequestV2_sourceRoleId_status_idx" ON "InteractionRequestV2"("sourceRoleId", "status");

CREATE UNIQUE INDEX "ConditionalActionV2_sourceSubmissionId_key" ON "ConditionalActionV2"("sourceSubmissionId");
CREATE UNIQUE INDEX "ConditionalActionV2_triggeredResolutionId_key" ON "ConditionalActionV2"("triggeredResolutionId");
CREATE UNIQUE INDEX "ConditionalActionV2_dedupeKey_key" ON "ConditionalActionV2"("dedupeKey");
CREATE INDEX "ConditionalActionV2_runId_status_expiresAtStage_idx" ON "ConditionalActionV2"("runId", "status", "expiresAtStage");
CREATE INDEX "ConditionalActionV2_ownerThreadId_status_idx" ON "ConditionalActionV2"("ownerThreadId", "status");

CREATE UNIQUE INDEX "CommitmentV2_dedupeKey_key" ON "CommitmentV2"("dedupeKey");
CREATE INDEX "CommitmentV2_runId_status_expiresAtStage_idx" ON "CommitmentV2"("runId", "status", "expiresAtStage");
CREATE INDEX "CommitmentV2_issuerRoleId_status_idx" ON "CommitmentV2"("issuerRoleId", "status");
CREATE INDEX "CommitmentV2_receiverRoleId_status_idx" ON "CommitmentV2"("receiverRoleId", "status");

ALTER TABLE "InteractionRequestV2" ADD CONSTRAINT "InteractionRequestV2_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractionRequestV2" ADD CONSTRAINT "InteractionRequestV2_sourceResolutionId_fkey" FOREIGN KEY ("sourceResolutionId") REFERENCES "ActionResolution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractionRequestV2" ADD CONSTRAINT "InteractionRequestV2_sourceRoleId_fkey" FOREIGN KEY ("sourceRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractionRequestV2" ADD CONSTRAINT "InteractionRequestV2_targetRoleId_fkey" FOREIGN KEY ("targetRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InteractionRequestV2" ADD CONSTRAINT "InteractionRequestV2_responseTurnId_fkey" FOREIGN KEY ("responseTurnId") REFERENCES "ActorTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConditionalActionV2" ADD CONSTRAINT "ConditionalActionV2_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConditionalActionV2" ADD CONSTRAINT "ConditionalActionV2_ownerThreadId_fkey" FOREIGN KEY ("ownerThreadId") REFERENCES "ActorThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConditionalActionV2" ADD CONSTRAINT "ConditionalActionV2_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "DecisionSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConditionalActionV2" ADD CONSTRAINT "ConditionalActionV2_triggeredResolutionId_fkey" FOREIGN KEY ("triggeredResolutionId") REFERENCES "ActionResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommitmentV2" ADD CONSTRAINT "CommitmentV2_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentV2" ADD CONSTRAINT "CommitmentV2_sourceResolutionId_fkey" FOREIGN KEY ("sourceResolutionId") REFERENCES "ActionResolution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentV2" ADD CONSTRAINT "CommitmentV2_issuerRoleId_fkey" FOREIGN KEY ("issuerRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentV2" ADD CONSTRAINT "CommitmentV2_receiverRoleId_fkey" FOREIGN KEY ("receiverRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
