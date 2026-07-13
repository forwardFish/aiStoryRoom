-- World Credits, referral rewards, Creem purchases and StoryRun unlocks.
CREATE TYPE "RunAccessLevel" AS ENUM ('FREE_TRIAL', 'UNLOCKED');
CREATE TYPE "CreditGrantKind" AS ENUM ('PURCHASED', 'BONUS');
CREATE TYPE "CreditGrantSource" AS ENUM ('SIGNUP', 'REFERRAL', 'PURCHASE', 'SYSTEM_REFUND', 'ADMIN');
CREATE TYPE "CreditLedgerReason" AS ENUM ('SIGNUP_BONUS', 'REFERRAL_REWARD', 'PURCHASE', 'WORLD_UNLOCK', 'SYSTEM_REFUND', 'BONUS_EXPIRED', 'PURCHASE_REFUND', 'DISPUTE', 'ADMIN_ADJUSTMENT');
CREATE TYPE "CreemPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED', 'FAILED');
CREATE TYPE "WebhookProcessStatus" AS ENUM ('PROCESSED', 'IGNORED');
CREATE TYPE "ReferralStatus" AS ENUM ('REGISTERED', 'QUALIFIED', 'REWARDED', 'QUALIFIED_NO_REWARD');
CREATE TYPE "ReferralChannel" AS ENUM ('UNKNOWN', 'LINK', 'X', 'FACEBOOK', 'NATIVE');
CREATE TYPE "WorldUnlockStatus" AS ENUM ('COMMITTED', 'REFUNDED');

ALTER TABLE "StoryRun" ADD COLUMN "accessLevel" "RunAccessLevel" NOT NULL DEFAULT 'FREE_TRIAL';
ALTER TABLE "StoryRun" ADD COLUMN "freeDecisionsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoryRun" ADD COLUMN "paywallReachedAt" TIMESTAMP(3);
ALTER TABLE "StoryRun" ADD COLUMN "unlockedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "verificationTokenHash" TEXT;

CREATE TABLE "CreditWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchasedBalance" INTEGER NOT NULL DEFAULT 0,
    "bonusBalance" INTEGER NOT NULL DEFAULT 0,
    "debtBalance" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreditGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CreditGrantKind" NOT NULL,
    "source" "CreditGrantSource" NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "remainingAmount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "externalRef" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditGrant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "CreditLedgerReason" NOT NULL,
    "purchasedDelta" INTEGER NOT NULL DEFAULT 0,
    "bonusDelta" INTEGER NOT NULL DEFAULT 0,
    "debtDelta" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "externalRef" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreditSpendAllocation" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditSpendAllocation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreemPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packKey" TEXT NOT NULL,
    "creemProductId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "expectedAmountCents" INTEGER NOT NULL,
    "expectedCurrency" TEXT NOT NULL DEFAULT 'USD',
    "status" "CreemPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutId" TEXT,
    "orderId" TEXT,
    "transactionId" TEXT,
    "customerId" TEXT,
    "customerEmail" TEXT,
    "paidAmountCents" INTEGER,
    "paidCurrency" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreemPurchase_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PaymentWebhookEvent" (
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookProcessStatus" NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("eventId")
);
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "channel" "ReferralChannel" NOT NULL DEFAULT 'UNKNOWN',
    "status" "ReferralStatus" NOT NULL DEFAULT 'REGISTERED',
    "qualifiedRunId" TEXT,
    "rewardLedgerId" TEXT,
    "rejectionReason" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReferralShareEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "ReferralChannel" NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralShareEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorldUnlock" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "paidByUserId" TEXT NOT NULL,
    "creditsCharged" INTEGER NOT NULL,
    "debitLedgerId" TEXT NOT NULL,
    "status" "WorldUnlockStatus" NOT NULL DEFAULT 'COMMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),
    CONSTRAINT "WorldUnlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditWallet_userId_key" ON "CreditWallet"("userId");
CREATE INDEX "CreditWallet_userId_idx" ON "CreditWallet"("userId");
CREATE UNIQUE INDEX "CreditGrant_idempotencyKey_key" ON "CreditGrant"("idempotencyKey");
CREATE INDEX "CreditGrant_userId_kind_expiresAt_idx" ON "CreditGrant"("userId", "kind", "expiresAt");
CREATE INDEX "CreditGrant_externalRef_idx" ON "CreditGrant"("externalRef");
CREATE UNIQUE INDEX "CreditLedger_idempotencyKey_key" ON "CreditLedger"("idempotencyKey");
CREATE INDEX "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt");
CREATE INDEX "CreditLedger_externalRef_idx" ON "CreditLedger"("externalRef");
CREATE INDEX "CreditSpendAllocation_grantId_idx" ON "CreditSpendAllocation"("grantId");
CREATE UNIQUE INDEX "CreditSpendAllocation_ledgerId_grantId_key" ON "CreditSpendAllocation"("ledgerId", "grantId");
CREATE UNIQUE INDEX "CreemPurchase_checkoutId_key" ON "CreemPurchase"("checkoutId");
CREATE UNIQUE INDEX "CreemPurchase_orderId_key" ON "CreemPurchase"("orderId");
CREATE UNIQUE INDEX "CreemPurchase_transactionId_key" ON "CreemPurchase"("transactionId");
CREATE INDEX "CreemPurchase_userId_createdAt_idx" ON "CreemPurchase"("userId", "createdAt");
CREATE INDEX "CreemPurchase_creemProductId_idx" ON "CreemPurchase"("creemProductId");
CREATE UNIQUE INDEX "ReferralCode_userId_key" ON "ReferralCode"("userId");
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");
CREATE UNIQUE INDEX "Referral_referredUserId_key" ON "Referral"("referredUserId");
CREATE INDEX "Referral_inviterUserId_status_idx" ON "Referral"("inviterUserId", "status");
CREATE INDEX "Referral_referralCodeId_idx" ON "Referral"("referralCodeId");
CREATE INDEX "ReferralShareEvent_userId_createdAt_idx" ON "ReferralShareEvent"("userId", "createdAt");
CREATE UNIQUE INDEX "WorldUnlock_runId_key" ON "WorldUnlock"("runId");
CREATE UNIQUE INDEX "WorldUnlock_debitLedgerId_key" ON "WorldUnlock"("debitLedgerId");
CREATE INDEX "WorldUnlock_paidByUserId_createdAt_idx" ON "WorldUnlock"("paidByUserId", "createdAt");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

ALTER TABLE "CreditSpendAllocation" ADD CONSTRAINT "CreditSpendAllocation_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "CreditLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditSpendAllocation" ADD CONSTRAINT "CreditSpendAllocation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "CreditGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorldUnlock" ADD CONSTRAINT "WorldUnlock_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
