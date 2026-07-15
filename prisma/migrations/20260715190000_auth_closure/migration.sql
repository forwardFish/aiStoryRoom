-- Additive production-auth closure schema. Keep User.verificationTokenHash
-- during the rollout so older API instances remain rollback-compatible.
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

CREATE TABLE "AuthOneTimeToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "AuthTokenPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "deliveryProvider" TEXT,
  "deliveryProviderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthOneTimeToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "providerSubject" TEXT NOT NULL,
  "providerEmail" TEXT,
  "providerEmailVerifiedAt" TIMESTAMP(3),
  "hostedDomain" TEXT,
  "profileJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthLoginChallenge" (
  "id" TEXT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthLoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthOneTimeToken_tokenHash_key" ON "AuthOneTimeToken"("tokenHash");
CREATE INDEX "AuthOneTimeToken_userId_purpose_expiresAt_idx" ON "AuthOneTimeToken"("userId", "purpose", "expiresAt");
CREATE UNIQUE INDEX "AuthIdentity_provider_providerSubject_key" ON "AuthIdentity"("provider", "providerSubject");
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");
CREATE INDEX "AuthIdentity_provider_providerEmail_idx" ON "AuthIdentity"("provider", "providerEmail");
CREATE UNIQUE INDEX "AuthLoginChallenge_nonceHash_key" ON "AuthLoginChallenge"("nonceHash");
CREATE INDEX "AuthLoginChallenge_provider_expiresAt_consumedAt_idx" ON "AuthLoginChallenge"("provider", "expiresAt", "consumedAt");

ALTER TABLE "AuthOneTimeToken" ADD CONSTRAINT "AuthOneTimeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
