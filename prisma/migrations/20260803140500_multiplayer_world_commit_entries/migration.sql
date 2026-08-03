-- Multiplayer commands are sealed before provider work without claiming a
-- formal worldSequence. ActionResolution remains the committed world ledger.
CREATE TABLE "MultiplayerWorldCommitEntry" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "playerActionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "observedWorldSequence" INTEGER NOT NULL,
  "outcomeJson" JSONB NOT NULL,
  "mutationJson" JSONB NOT NULL,
  "generationArtifactJson" JSONB,
  "state" TEXT NOT NULL DEFAULT 'RESERVED',
  "committedResolutionId" TEXT,
  "failureCode" TEXT,
  "readyAt" TIMESTAMP(3),
  "committedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MultiplayerWorldCommitEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MultiplayerWorldCommitEntry_state_check"
    CHECK ("state" IN ('RESERVED', 'READY', 'COMMITTED', 'PUBLISHED', 'FAILED'))
);

CREATE UNIQUE INDEX "MultiplayerWorldCommitEntry_turnId_key"
  ON "MultiplayerWorldCommitEntry"("turnId");
CREATE UNIQUE INDEX "MultiplayerWorldCommitEntry_submissionId_key"
  ON "MultiplayerWorldCommitEntry"("submissionId");
CREATE UNIQUE INDEX "MultiplayerWorldCommitEntry_playerActionId_key"
  ON "MultiplayerWorldCommitEntry"("playerActionId");
CREATE UNIQUE INDEX "MultiplayerWorldCommitEntry_committedResolutionId_key"
  ON "MultiplayerWorldCommitEntry"("committedResolutionId");
CREATE UNIQUE INDEX "MultiplayerWorldCommitEntry_runId_roleId_idempotencyKey_key"
  ON "MultiplayerWorldCommitEntry"("runId", "roleId", "idempotencyKey");
CREATE INDEX "MultiplayerWorldCommitEntry_runId_state_createdAt_idx"
  ON "MultiplayerWorldCommitEntry"("runId", "state", "createdAt");
CREATE INDEX "MultiplayerWorldCommitEntry_roleId_state_createdAt_idx"
  ON "MultiplayerWorldCommitEntry"("roleId", "state", "createdAt");

ALTER TABLE "MultiplayerWorldCommitEntry"
  ADD CONSTRAINT "MultiplayerWorldCommitEntry_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MultiplayerWorldCommitEntry"
  ADD CONSTRAINT "MultiplayerWorldCommitEntry_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MultiplayerWorldCommitEntry"
  ADD CONSTRAINT "MultiplayerWorldCommitEntry_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "ActorThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MultiplayerWorldCommitEntry"
  ADD CONSTRAINT "MultiplayerWorldCommitEntry_turnId_fkey"
  FOREIGN KEY ("turnId") REFERENCES "ActorTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MultiplayerWorldCommitEntry"
  ADD CONSTRAINT "MultiplayerWorldCommitEntry_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MultiplayerWorldCommitEntry"
  ADD CONSTRAINT "MultiplayerWorldCommitEntry_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "DecisionSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MultiplayerWorldCommitEntry"
  ADD CONSTRAINT "MultiplayerWorldCommitEntry_playerActionId_fkey"
  FOREIGN KEY ("playerActionId") REFERENCES "PlayerAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MultiplayerWorldCommitEntry"
  ADD CONSTRAINT "MultiplayerWorldCommitEntry_committedResolutionId_fkey"
  FOREIGN KEY ("committedResolutionId") REFERENCES "ActionResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
