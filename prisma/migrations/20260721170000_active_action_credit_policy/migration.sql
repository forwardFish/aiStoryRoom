-- Active-action World Credits is additive. Existing runs stay on the legacy
-- world-unlock policy; only newly created runs can opt into active_action_v1.
ALTER TYPE "CreditLedgerReason" ADD VALUE IF NOT EXISTS 'RUN_CREATE';
ALTER TYPE "CreditLedgerReason" ADD VALUE IF NOT EXISTS 'PLAYER_ACTION';
ALTER TYPE "CreditLedgerReason" ADD VALUE IF NOT EXISTS 'RUN_SPONSORSHIP';

CREATE TYPE "CreditChargeType" AS ENUM ('RUN_CREATE', 'PLAYER_ACTION');
CREATE TYPE "CreditChargeStatus" AS ENUM ('SHADOW', 'RESERVED', 'COMMITTED', 'RELEASED');
CREATE TYPE "CreditChargeAllocationSource" AS ENUM ('RUN_ALLOWANCE', 'PERSONAL_WALLET');
CREATE TYPE "RunCreditAllowanceStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED');
CREATE TYPE "SponsorshipRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED');
CREATE TYPE "SponsorshipRequestOrigin" AS ENUM ('FIRST_INSUFFICIENT', 'MANUAL');

ALTER TABLE "StoryRun"
  ADD COLUMN "billingPolicyVersion" TEXT NOT NULL DEFAULT 'world_unlock_v1',
  ADD COLUMN "billingPriceJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "reservedWorldSequence" INTEGER NOT NULL DEFAULT 0;

UPDATE "StoryRun" SET "reservedWorldSequence" = "worldSequence";

DROP INDEX IF EXISTS "ActorTurn_threadId_turnIndex_key";
CREATE UNIQUE INDEX "ActorTurn_threadId_turnIndex_revision_key" ON "ActorTurn"("threadId", "turnIndex", "revision");

CREATE TABLE "CreditCharge" (
  "id" TEXT NOT NULL,
  "runId" TEXT,
  "beneficiaryUserId" TEXT NOT NULL,
  "playerActionId" TEXT,
  "chargeType" "CreditChargeType" NOT NULL,
  "actionClass" TEXT NOT NULL,
  "status" "CreditChargeStatus" NOT NULL DEFAULT 'RESERVED',
  "amount" INTEGER NOT NULL,
  "allowanceAmount" INTEGER NOT NULL DEFAULT 0,
  "walletAmount" INTEGER NOT NULL DEFAULT 0,
  "personalDebitLedgerId" TEXT,
  "personalRefundLedgerId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "failureCode" TEXT,
  "expiresAt" TIMESTAMP(3),
  "committedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditCharge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditChargeAllocation" (
  "id" TEXT NOT NULL,
  "allocationKey" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "source" "CreditChargeAllocationSource" NOT NULL,
  "allowanceId" TEXT,
  "ledgerId" TEXT,
  "amount" INTEGER NOT NULL,
  "status" "CreditChargeStatus" NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditChargeAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunCreditAllowance" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sponsorUserId" TEXT NOT NULL,
  "beneficiaryUserId" TEXT NOT NULL,
  "fundedAmount" INTEGER NOT NULL,
  "remainingAmount" INTEGER NOT NULL,
  "status" "RunCreditAllowanceStatus" NOT NULL DEFAULT 'ACTIVE',
  "fundingLedgerId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RunCreditAllowance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SponsorshipRequest" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "hostUserId" TEXT NOT NULL,
  "beneficiaryUserId" TEXT NOT NULL,
  "status" "SponsorshipRequestStatus" NOT NULL DEFAULT 'PENDING',
  "origin" "SponsorshipRequestOrigin" NOT NULL,
  "automaticPromptKey" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "allowanceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SponsorshipRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditCharge_playerActionId_key" ON "CreditCharge"("playerActionId");
CREATE UNIQUE INDEX "CreditCharge_personalDebitLedgerId_key" ON "CreditCharge"("personalDebitLedgerId");
CREATE UNIQUE INDEX "CreditCharge_personalRefundLedgerId_key" ON "CreditCharge"("personalRefundLedgerId");
CREATE UNIQUE INDEX "CreditCharge_idempotencyKey_key" ON "CreditCharge"("idempotencyKey");
CREATE INDEX "CreditCharge_runId_status_createdAt_idx" ON "CreditCharge"("runId", "status", "createdAt");
CREATE INDEX "CreditCharge_beneficiaryUserId_createdAt_idx" ON "CreditCharge"("beneficiaryUserId", "createdAt");
CREATE INDEX "CreditCharge_status_expiresAt_idx" ON "CreditCharge"("status", "expiresAt");

CREATE UNIQUE INDEX "CreditChargeAllocation_allocationKey_key" ON "CreditChargeAllocation"("allocationKey");
CREATE INDEX "CreditChargeAllocation_allowanceId_status_idx" ON "CreditChargeAllocation"("allowanceId", "status");

CREATE UNIQUE INDEX "RunCreditAllowance_fundingLedgerId_key" ON "RunCreditAllowance"("fundingLedgerId");
CREATE UNIQUE INDEX "RunCreditAllowance_idempotencyKey_key" ON "RunCreditAllowance"("idempotencyKey");
CREATE INDEX "RunCreditAllowance_runId_beneficiaryUserId_status_createdAt_idx" ON "RunCreditAllowance"("runId", "beneficiaryUserId", "status", "createdAt");
CREATE INDEX "RunCreditAllowance_sponsorUserId_createdAt_idx" ON "RunCreditAllowance"("sponsorUserId", "createdAt");

CREATE UNIQUE INDEX "SponsorshipRequest_automaticPromptKey_key" ON "SponsorshipRequest"("automaticPromptKey");
CREATE UNIQUE INDEX "SponsorshipRequest_idempotencyKey_key" ON "SponsorshipRequest"("idempotencyKey");
CREATE UNIQUE INDEX "SponsorshipRequest_allowanceId_key" ON "SponsorshipRequest"("allowanceId");
CREATE INDEX "SponsorshipRequest_runId_hostUserId_status_createdAt_idx" ON "SponsorshipRequest"("runId", "hostUserId", "status", "createdAt");
CREATE INDEX "SponsorshipRequest_runId_beneficiaryUserId_createdAt_idx" ON "SponsorshipRequest"("runId", "beneficiaryUserId", "createdAt");

ALTER TABLE "CreditChargeAllocation"
  ADD CONSTRAINT "CreditChargeAllocation_chargeId_fkey"
  FOREIGN KEY ("chargeId") REFERENCES "CreditCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
