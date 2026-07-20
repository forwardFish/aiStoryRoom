-- Role-scoped context and isolated prompt execution evidence. These are
-- append-only audit tables and do not rewrite existing story data.
CREATE TABLE "StoryContextSnapshotV2" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "actorTurnId" TEXT,
  "purpose" TEXT NOT NULL,
  "baseWorldSequence" INTEGER NOT NULL,
  "turnRevision" INTEGER NOT NULL,
  "controlEpoch" INTEGER NOT NULL,
  "contextVersion" TEXT NOT NULL DEFAULT 'story-context-v2.1',
  "snapshotJson" JSONB,
  "reportJson" JSONB NOT NULL,
  "snapshotHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoryContextSnapshotV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptExecutionRecord" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "actorTurnId" TEXT,
  "actionResolutionId" TEXT,
  "contextSnapshotId" TEXT NOT NULL,
  "pipelineStep" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "systemPromptHash" TEXT NOT NULL,
  "contextSnapshotHash" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "outputHash" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "inputJson" JSONB NOT NULL,
  "outputJson" JSONB,
  "issueCodesJson" JSONB NOT NULL,
  "tokenUsageJson" JSONB,
  "status" TEXT NOT NULL,
  "supersededReason" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3) NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromptExecutionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoryContextSnapshotV2_runId_roleId_baseWorldSequence_idx" ON "StoryContextSnapshotV2"("runId", "roleId", "baseWorldSequence");
CREATE INDEX "StoryContextSnapshotV2_actorTurnId_purpose_createdAt_idx" ON "StoryContextSnapshotV2"("actorTurnId", "purpose", "createdAt");
CREATE INDEX "StoryContextSnapshotV2_snapshotHash_idx" ON "StoryContextSnapshotV2"("snapshotHash");
CREATE INDEX "StoryContextSnapshotV2_status_createdAt_idx" ON "StoryContextSnapshotV2"("status", "createdAt");

CREATE INDEX "PromptExecutionRecord_runId_roleId_startedAt_idx" ON "PromptExecutionRecord"("runId", "roleId", "startedAt");
CREATE INDEX "PromptExecutionRecord_actorTurnId_pipelineStep_status_idx" ON "PromptExecutionRecord"("actorTurnId", "pipelineStep", "status");
CREATE INDEX "PromptExecutionRecord_actionResolutionId_idx" ON "PromptExecutionRecord"("actionResolutionId");
CREATE INDEX "PromptExecutionRecord_contextSnapshotId_pipelineStep_idx" ON "PromptExecutionRecord"("contextSnapshotId", "pipelineStep");

ALTER TABLE "StoryContextSnapshotV2" ADD CONSTRAINT "StoryContextSnapshotV2_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryContextSnapshotV2" ADD CONSTRAINT "StoryContextSnapshotV2_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryContextSnapshotV2" ADD CONSTRAINT "StoryContextSnapshotV2_actorTurnId_fkey" FOREIGN KEY ("actorTurnId") REFERENCES "ActorTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PromptExecutionRecord" ADD CONSTRAINT "PromptExecutionRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptExecutionRecord" ADD CONSTRAINT "PromptExecutionRecord_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptExecutionRecord" ADD CONSTRAINT "PromptExecutionRecord_actorTurnId_fkey" FOREIGN KEY ("actorTurnId") REFERENCES "ActorTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromptExecutionRecord" ADD CONSTRAINT "PromptExecutionRecord_actionResolutionId_fkey" FOREIGN KEY ("actionResolutionId") REFERENCES "ActionResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromptExecutionRecord" ADD CONSTRAINT "PromptExecutionRecord_contextSnapshotId_fkey" FOREIGN KEY ("contextSnapshotId") REFERENCES "StoryContextSnapshotV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
