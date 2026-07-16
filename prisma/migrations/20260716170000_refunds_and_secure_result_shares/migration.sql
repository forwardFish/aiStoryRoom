-- Secure result shares never persist the bearer token itself. Existing legacy
-- links are revoked and erased before the public endpoint is enabled.
ALTER TABLE "ShareToken" ALTER COLUMN "token" DROP NOT NULL;
ALTER TABLE "ShareToken"
  ADD COLUMN "tokenHash" TEXT,
  ADD COLUMN "tokenPrefix" TEXT,
  ADD COLUMN "includeRoleName" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "lastAccessedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ShareToken"
SET
  "tokenPrefix" = left("token", 8),
  "expiresAt" = CURRENT_TIMESTAMP,
  "revokedAt" = CURRENT_TIMESTAMP,
  "token" = NULL
WHERE "token" IS NOT NULL;

CREATE UNIQUE INDEX "ShareToken_tokenHash_key" ON "ShareToken"("tokenHash");
CREATE INDEX "ShareToken_tokenHash_expiresAt_revokedAt_idx" ON "ShareToken"("tokenHash", "expiresAt", "revokedAt");

CREATE TYPE "RefundRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'PROVIDER_ACTION_REQUIRED',
  'SUBMITTED',
  'COMPLETED',
  'REJECTED',
  'FAILED'
);

CREATE TABLE "RefundRequest" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "RefundRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "message" TEXT,
  "requestedAmountCents" INTEGER NOT NULL,
  "reviewerUserId" TEXT,
  "adminNote" TEXT,
  "providerRefundId" TEXT,
  "providerStatus" TEXT,
  "providerResponseJson" JSONB,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundRequest_purchaseId_key" ON "RefundRequest"("purchaseId");
CREATE INDEX "RefundRequest_userId_requestedAt_idx" ON "RefundRequest"("userId", "requestedAt");
CREATE INDEX "RefundRequest_status_requestedAt_idx" ON "RefundRequest"("status", "requestedAt");
CREATE INDEX "RefundRequest_reviewerUserId_idx" ON "RefundRequest"("reviewerUserId");

ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "CreemPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
