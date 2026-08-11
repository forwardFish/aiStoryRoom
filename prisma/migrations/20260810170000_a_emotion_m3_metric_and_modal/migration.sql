-- A-Emotion M3: world-agnostic metric transitions and viewer-scoped modal-once state.
-- Review and apply only to isolated/non-production schemas.
CREATE TABLE "AEmotionMetricTransition" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "viewerRoleId" TEXT NOT NULL,
  "viewerUserId" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "metricLabel" TEXT NOT NULL,
  "previousValue" INTEGER NOT NULL,
  "currentValue" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "thresholdBefore" TEXT NOT NULL,
  "thresholdAfter" TEXT NOT NULL,
  "triggerCode" TEXT NOT NULL,
  "sourceResolutionId" TEXT NOT NULL,
  "sourceEventId" TEXT,
  "stateVersion" INTEGER NOT NULL,
  "triggerVersion" INTEGER,
  "stageId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AEmotionMetricTransition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AEmotionKeyModal" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "viewerUserId" TEXT NOT NULL,
  "viewerRoleId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "modalType" TEXT NOT NULL,
  "triggerCode" TEXT NOT NULL,
  "triggerVersion" INTEGER NOT NULL,
  "projectionVersion" INTEGER NOT NULL,
  "stateVersion" INTEGER NOT NULL,
  "priority" INTEGER NOT NULL,
  "projectionJson" JSONB NOT NULL,
  "shownAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AEmotionKeyModal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AEmotionMetricTransition_runId_viewerRoleId_metricKey_sourceResolutionId_key"
  ON "AEmotionMetricTransition"("runId", "viewerRoleId", "metricKey", "sourceResolutionId");
CREATE UNIQUE INDEX "AEmotionMetricTransition_runId_viewerRoleId_metricKey_stateVersion_key"
  ON "AEmotionMetricTransition"("runId", "viewerRoleId", "metricKey", "stateVersion");
CREATE UNIQUE INDEX "AEmotionMetricTransition_runId_viewerRoleId_metricKey_triggerCode_triggerVersion_key"
  ON "AEmotionMetricTransition"("runId", "viewerRoleId", "metricKey", "triggerCode", "triggerVersion");
CREATE INDEX "AEmotionMetricTransition_runId_viewerRoleId_metricKey_occurredAt_idx"
  ON "AEmotionMetricTransition"("runId", "viewerRoleId", "metricKey", "occurredAt");
CREATE INDEX "AEmotionMetricTransition_sourceResolutionId_idx" ON "AEmotionMetricTransition"("sourceResolutionId");
CREATE INDEX "AEmotionMetricTransition_sourceEventId_idx" ON "AEmotionMetricTransition"("sourceEventId");
CREATE UNIQUE INDEX "AEmotionKeyModal_eventId_key" ON "AEmotionKeyModal"("eventId");
CREATE UNIQUE INDEX "AEmotionKeyModal_runId_viewerUserId_modalType_triggerCode_triggerVersion_key"
  ON "AEmotionKeyModal"("runId", "viewerUserId", "modalType", "triggerCode", "triggerVersion");
CREATE UNIQUE INDEX "AEmotionKeyModal_eventId_viewerUserId_key" ON "AEmotionKeyModal"("eventId", "viewerUserId");
CREATE INDEX "AEmotionKeyModal_runId_viewerUserId_viewerRoleId_acknowledgedAt_priority_idx"
  ON "AEmotionKeyModal"("runId", "viewerUserId", "viewerRoleId", "acknowledgedAt", "priority");

ALTER TABLE "AEmotionMetricTransition" ADD CONSTRAINT "AEmotionMetricTransition_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AEmotionMetricTransition" ADD CONSTRAINT "AEmotionMetricTransition_viewerRoleId_fkey"
  FOREIGN KEY ("viewerRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AEmotionMetricTransition" ADD CONSTRAINT "AEmotionMetricTransition_viewerUserId_fkey"
  FOREIGN KEY ("viewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AEmotionKeyModal" ADD CONSTRAINT "AEmotionKeyModal_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AEmotionKeyModal" ADD CONSTRAINT "AEmotionKeyModal_viewerRoleId_fkey"
  FOREIGN KEY ("viewerRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AEmotionKeyModal" ADD CONSTRAINT "AEmotionKeyModal_viewerUserId_fkey"
  FOREIGN KEY ("viewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
