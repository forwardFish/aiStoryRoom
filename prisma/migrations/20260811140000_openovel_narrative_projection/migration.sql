ALTER TABLE "NarrativeEntry"
  ADD COLUMN "sourceCommitHash" TEXT,
  ADD COLUMN "presentationHash" TEXT,
  ADD COLUMN "projectionStatus" TEXT,
  ADD COLUMN "projectionAttempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "NarrativeEntry_sourceCommitHash_roleId_idx"
  ON "NarrativeEntry"("sourceCommitHash", "roleId");

CREATE INDEX "NarrativeEntry_projectionStatus_createdAt_idx"
  ON "NarrativeEntry"("projectionStatus", "createdAt");
