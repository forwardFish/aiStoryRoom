-- A-Emotion M2 durable viewer aggregate/read-receipt state.
-- Apply only in reviewed non-production/production migration workflows.
ALTER TABLE "EventDelivery"
  ADD COLUMN "aggregateKey" TEXT,
  ADD COLUMN "aggregateId" TEXT,
  ADD COLUMN "stageId" TEXT,
  ADD COLUMN "sharedObjectId" TEXT,
  ADD COLUMN "eventFamily" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "disclosure" TEXT,
  ADD COLUMN "projectionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "stateVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "seenAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EventDelivery_roomId_userId_aggregateKey_projectionVersion_key"
  ON "EventDelivery"("roomId", "userId", "aggregateKey", "projectionVersion");
CREATE INDEX "EventDelivery_roomId_userId_roleId_deliverySequence_idx"
  ON "EventDelivery"("roomId", "userId", "roleId", "deliverySequence");
CREATE INDEX "EventDelivery_roomId_userId_aggregateKey_projectionVersion_idx"
  ON "EventDelivery"("roomId", "userId", "aggregateKey", "projectionVersion");
