ALTER TABLE "StoryRun" ADD COLUMN "worldSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NarrativeEntry" ADD COLUMN "worldSequence" INTEGER;
CREATE INDEX "NarrativeEntry_runId_worldSequence_idx" ON "NarrativeEntry"("runId", "worldSequence");

CREATE TABLE "ActorThread" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "roleId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "currentTurnIndex" INTEGER NOT NULL DEFAULT 1,
  "currentStageIndex" INTEGER NOT NULL DEFAULT 1, "lastAppliedSequence" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ActorThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActorTurn" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "threadId" TEXT NOT NULL, "roleId" TEXT NOT NULL,
  "stageIndex" INTEGER NOT NULL, "turnIndex" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
  "baseWorldSequence" INTEGER NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "situationTitle" TEXT NOT NULL, "situationNarrative" TEXT NOT NULL,
  "visibleFactKeysJson" JSONB NOT NULL, "activeThreadKeysJson" JSONB NOT NULL,
  "contextJson" JSONB NOT NULL, "qualityStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "dedupeKey" TEXT NOT NULL, "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ActorTurn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionSet" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "turnId" TEXT NOT NULL, "roleId" TEXT NOT NULL,
  "contextHash" TEXT NOT NULL, "framing" TEXT NOT NULL, "candidatesJson" JSONB NOT NULL,
  "qualityStatus" TEXT NOT NULL DEFAULT 'PENDING', "qualityJson" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionSubmission" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "threadId" TEXT NOT NULL, "turnId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL, "userId" TEXT, "playerActionId" TEXT, "candidateId" TEXT,
  "customAction" TEXT, "normalizedActionJson" JSONB NOT NULL, "controlEpoch" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "DecisionSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionResolution" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "threadId" TEXT NOT NULL, "turnId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL, "roleId" TEXT NOT NULL, "playerActionId" TEXT NOT NULL,
  "baseWorldSequence" INTEGER NOT NULL, "appliedWorldSequence" INTEGER NOT NULL,
  "outcomeJson" JSONB NOT NULL, "statePatchJson" JSONB NOT NULL, "resultNarrative" TEXT NOT NULL,
  "nextHook" TEXT NOT NULL, "qualityStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActionResolution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentQualityReview" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "roleId" TEXT, "turnId" TEXT,
  "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL, "contentHash" TEXT NOT NULL,
  "status" TEXT NOT NULL, "scoresJson" JSONB NOT NULL, "issuesJson" JSONB NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'rules', "modelName" TEXT NOT NULL DEFAULT 'deterministic-quality-v1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentQualityReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActorThread_roleId_key" ON "ActorThread"("roleId");
CREATE UNIQUE INDEX "ActorThread_runId_roleId_key" ON "ActorThread"("runId", "roleId");
CREATE INDEX "ActorThread_runId_status_idx" ON "ActorThread"("runId", "status");
CREATE INDEX "ActorThread_runId_lastAppliedSequence_idx" ON "ActorThread"("runId", "lastAppliedSequence");
CREATE UNIQUE INDEX "ActorTurn_dedupeKey_key" ON "ActorTurn"("dedupeKey");
CREATE UNIQUE INDEX "ActorTurn_threadId_turnIndex_key" ON "ActorTurn"("threadId", "turnIndex");
CREATE INDEX "ActorTurn_runId_roleId_status_idx" ON "ActorTurn"("runId", "roleId", "status");
CREATE INDEX "ActorTurn_runId_baseWorldSequence_idx" ON "ActorTurn"("runId", "baseWorldSequence");
CREATE UNIQUE INDEX "DecisionSet_turnId_key" ON "DecisionSet"("turnId");
CREATE INDEX "DecisionSet_runId_roleId_generatedAt_idx" ON "DecisionSet"("runId", "roleId", "generatedAt");
CREATE UNIQUE INDEX "DecisionSubmission_turnId_key" ON "DecisionSubmission"("turnId");
CREATE UNIQUE INDEX "DecisionSubmission_playerActionId_key" ON "DecisionSubmission"("playerActionId");
CREATE UNIQUE INDEX "DecisionSubmission_idempotencyKey_key" ON "DecisionSubmission"("idempotencyKey");
CREATE INDEX "DecisionSubmission_runId_roleId_submittedAt_idx" ON "DecisionSubmission"("runId", "roleId", "submittedAt");
CREATE INDEX "DecisionSubmission_threadId_status_idx" ON "DecisionSubmission"("threadId", "status");
CREATE UNIQUE INDEX "ActionResolution_turnId_key" ON "ActionResolution"("turnId");
CREATE UNIQUE INDEX "ActionResolution_submissionId_key" ON "ActionResolution"("submissionId");
CREATE UNIQUE INDEX "ActionResolution_playerActionId_key" ON "ActionResolution"("playerActionId");
CREATE UNIQUE INDEX "ActionResolution_runId_appliedWorldSequence_key" ON "ActionResolution"("runId", "appliedWorldSequence");
CREATE INDEX "ActionResolution_runId_roleId_resolvedAt_idx" ON "ActionResolution"("runId", "roleId", "resolvedAt");
CREATE INDEX "ActionResolution_threadId_appliedWorldSequence_idx" ON "ActionResolution"("threadId", "appliedWorldSequence");
CREATE UNIQUE INDEX "ContentQualityReview_targetType_targetId_contentHash_key" ON "ContentQualityReview"("targetType", "targetId", "contentHash");
CREATE INDEX "ContentQualityReview_runId_status_createdAt_idx" ON "ContentQualityReview"("runId", "status", "createdAt");
CREATE INDEX "ContentQualityReview_turnId_targetType_idx" ON "ContentQualityReview"("turnId", "targetType");

ALTER TABLE "ActorThread" ADD CONSTRAINT "ActorThread_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActorThread" ADD CONSTRAINT "ActorThread_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActorTurn" ADD CONSTRAINT "ActorTurn_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActorTurn" ADD CONSTRAINT "ActorTurn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ActorThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActorTurn" ADD CONSTRAINT "ActorTurn_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionSet" ADD CONSTRAINT "DecisionSet_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionSet" ADD CONSTRAINT "DecisionSet_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "ActorTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionSet" ADD CONSTRAINT "DecisionSet_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionSubmission" ADD CONSTRAINT "DecisionSubmission_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionSubmission" ADD CONSTRAINT "DecisionSubmission_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ActorThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionSubmission" ADD CONSTRAINT "DecisionSubmission_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "ActorTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionSubmission" ADD CONSTRAINT "DecisionSubmission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionSubmission" ADD CONSTRAINT "DecisionSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DecisionSubmission" ADD CONSTRAINT "DecisionSubmission_playerActionId_fkey" FOREIGN KEY ("playerActionId") REFERENCES "PlayerAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActionResolution" ADD CONSTRAINT "ActionResolution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionResolution" ADD CONSTRAINT "ActionResolution_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ActorThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionResolution" ADD CONSTRAINT "ActionResolution_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "ActorTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionResolution" ADD CONSTRAINT "ActionResolution_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "DecisionSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionResolution" ADD CONSTRAINT "ActionResolution_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionResolution" ADD CONSTRAINT "ActionResolution_playerActionId_fkey" FOREIGN KEY ("playerActionId") REFERENCES "PlayerAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentQualityReview" ADD CONSTRAINT "ContentQualityReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentQualityReview" ADD CONSTRAINT "ContentQualityReview_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
