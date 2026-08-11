CREATE TABLE "AEmotionStageMilestone" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "milestoneCode" TEXT NOT NULL,
  "beneficiaryRoleId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INACTIVE',
  "stateVersion" INTEGER NOT NULL DEFAULT 1,
  "evidenceRefsJson" JSONB NOT NULL,
  "rewardJson" JSONB NOT NULL,
  "sourceResolutionId" TEXT,
  "sourceEventId" TEXT,
  "achievedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AEmotionStageMilestone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AEmotionStageMilestone_runId_stageId_milestoneCode_beneficiaryRoleId_key"
  ON "AEmotionStageMilestone"("runId", "stageId", "milestoneCode", "beneficiaryRoleId");
CREATE INDEX "AEmotionStageMilestone_runId_beneficiaryRoleId_status_stageId_idx"
  ON "AEmotionStageMilestone"("runId", "beneficiaryRoleId", "status", "stageId");
CREATE INDEX "AEmotionStageMilestone_sourceResolutionId_idx" ON "AEmotionStageMilestone"("sourceResolutionId");
CREATE INDEX "AEmotionStageMilestone_sourceEventId_idx" ON "AEmotionStageMilestone"("sourceEventId");
ALTER TABLE "AEmotionStageMilestone" ADD CONSTRAINT "AEmotionStageMilestone_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AEmotionStageMilestone" ADD CONSTRAINT "AEmotionStageMilestone_beneficiaryRoleId_fkey"
  FOREIGN KEY ("beneficiaryRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
