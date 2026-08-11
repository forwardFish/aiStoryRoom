-- A-Emotion M4: extend the existing CommitmentV2 authority with structured,
-- deterministic SimplePromise metadata. Apply only to isolated/non-production schemas.
ALTER TABLE "CommitmentV2"
  ADD COLUMN "promiseCode" TEXT,
  ADD COLUMN "relatedObjectId" TEXT,
  ADD COLUMN "sourceActionId" TEXT,
  ADD COLUMN "fulfillmentActionId" TEXT,
  ADD COLUMN "breachActionId" TEXT,
  ADD COLUMN "revealedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceRefsJson" JSONB,
  ADD COLUMN "termsJson" JSONB,
  ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revealVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "simplePromiseSlotKey" TEXT;

CREATE UNIQUE INDEX "CommitmentV2_simplePromiseSlotKey_key"
  ON "CommitmentV2"("simplePromiseSlotKey");
CREATE INDEX "CommitmentV2_runId_promiseCode_status_idx"
  ON "CommitmentV2"("runId", "promiseCode", "status");
CREATE INDEX "CommitmentV2_runId_relatedObjectId_status_idx"
  ON "CommitmentV2"("runId", "relatedObjectId", "status");
