-- Independent Solo story generation attempts. This migration is additive: it
-- does not alter or delete any legacy/V2 story data.
CREATE TABLE "SoloGenerationAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "actorTurnId" TEXT,
    "submissionId" TEXT,
    "supersedesAttemptId" TEXT,
    "triggerType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTION_RESERVED',
    "contextSnapshotId" TEXT,
    "contextSnapshotHash" TEXT,
    "promptContractVersion" TEXT NOT NULL,
    "storyPackageVersion" TEXT NOT NULL,
    "storyPackageHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "providerCallCount" INTEGER NOT NULL DEFAULT 0,
    "providerRequestId" TEXT,
    "confirmedResolutionJson" JSONB,
    "contextReportJson" JSONB,
    "rawOutput" TEXT,
    "parsedOutput" JSONB,
    "issueCodesJson" JSONB NOT NULL,
    "failureReason" TEXT,
    "timingsJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoloGenerationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SoloGenerationAttempt_idempotencyKey_key"
ON "SoloGenerationAttempt"("idempotencyKey");

CREATE INDEX "SoloGenerationAttempt_runId_status_createdAt_idx"
ON "SoloGenerationAttempt"("runId", "status", "createdAt");

CREATE INDEX "SoloGenerationAttempt_runId_actorTurnId_createdAt_idx"
ON "SoloGenerationAttempt"("runId", "actorTurnId", "createdAt");

CREATE INDEX "SoloGenerationAttempt_runId_submissionId_idx"
ON "SoloGenerationAttempt"("runId", "submissionId");

CREATE INDEX "SoloGenerationAttempt_supersedesAttemptId_idx"
ON "SoloGenerationAttempt"("supersedesAttemptId");

CREATE INDEX "SoloGenerationAttempt_leaseExpiresAt_idx"
ON "SoloGenerationAttempt"("leaseExpiresAt");

ALTER TABLE "SoloGenerationAttempt"
ADD CONSTRAINT "SoloGenerationAttempt_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "StoryRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
