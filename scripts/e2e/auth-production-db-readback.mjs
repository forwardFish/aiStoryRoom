import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(resolve(root, ".env")); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
if (process.env.AUTH_DB_READBACK_ACKNOWLEDGE !== "readonly") {
  throw new Error("Set AUTH_DB_READBACK_ACKNOWLEDGE=readonly to run the production authentication aggregate readback");
}
if (process.env.SUPABASE_DATABASE_URL) process.env.DATABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL or SUPABASE_DATABASE_URL is required");

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: singleConnectionUrl(process.env.DATABASE_URL) } } });
const artifactFile = resolve(root, "docs/auto-execute/evidence/auth-production-closure/production-db-readback.json");

try {
  const now = new Date();
  // Keep acceptance readback friendly to Supabase's session pool. These
  // aggregates are deliberately sequential and the client is limited to one
  // connection so a verifier cannot exhaust production database sessions.
  const googleIdentityCount = await prisma.authIdentity.count({ where: { provider: "GOOGLE" } });
  const googleUserCount = await prisma.user.count({ where: { authIdentities: { some: { provider: "GOOGLE" } } } });
  const consumedChallengeCount = await prisma.authLoginChallenge.count({ where: { provider: "GOOGLE", consumedAt: { not: null } } });
  const unconsumedLiveChallengeCount = await prisma.authLoginChallenge.count({ where: { provider: "GOOGLE", consumedAt: null, expiresAt: { gt: now } } });
  const googleLinkEventCount = await prisma.eventLog.count({ where: { eventName: "google_identity_linked", source: "auth-google" } });
  const googleLoginEventCount = await prisma.eventLog.count({ where: { eventName: "google_login_succeeded", source: "auth-google" } });
  const googleFirstLoginEventCount = await prisma.eventLog.count({ where: { eventName: "google_login_succeeded", source: "auth-google", payload: { path: ["loginKind"], equals: "first" } } });
  const googleRepeatLoginEventCount = await prisma.eventLog.count({ where: { eventName: "google_login_succeeded", source: "auth-google", payload: { path: ["loginKind"], equals: "repeat" } } });
  const googleInviteLoginEventCount = await prisma.eventLog.count({ where: { eventName: "google_login_succeeded", source: "auth-google", payload: { path: ["destination"], equals: "ROOM_INVITE" } } });
  const verificationSentCount = await prisma.authOneTimeToken.count({ where: { purpose: "EMAIL_VERIFICATION", sentAt: { not: null } } });
  const verificationConsumedCount = await prisma.authOneTimeToken.count({ where: { purpose: "EMAIL_VERIFICATION", consumedAt: { not: null } } });
  const resetSentCount = await prisma.authOneTimeToken.count({ where: { purpose: "PASSWORD_RESET", sentAt: { not: null } } });
  const resetConsumedCount = await prisma.authOneTimeToken.count({ where: { purpose: "PASSWORD_RESET", consumedAt: { not: null } } });
  const activeVerifiedPasswordUserCount = await prisma.user.count({ where: { status: "active", emailVerifiedAt: { not: null }, passwordHash: { not: null } } });
  const latestGoogleLogin = await prisma.eventLog.aggregate({ where: { eventName: "google_login_succeeded", source: "auth-google" }, _max: { createdAt: true } });
  const latestVerification = await prisma.authOneTimeToken.aggregate({ where: { purpose: "EMAIL_VERIFICATION", consumedAt: { not: null } }, _max: { consumedAt: true } });
  const latestReset = await prisma.authOneTimeToken.aggregate({ where: { purpose: "PASSWORD_RESET", consumedAt: { not: null } }, _max: { consumedAt: true } });

  const acceptance = {
    emailVerificationObserved: verificationConsumedCount > 0,
    passwordResetObserved: resetConsumedCount > 0,
    currentGoogleChallengeLoginObserved: googleLoginEventCount > 0,
    secondGoogleIdentityObserved: googleIdentityCount >= 2 && googleUserCount >= 2,
    repeatGoogleLoginObserved: googleRepeatLoginEventCount > 0,
    invitationGoogleLoginObserved: googleInviteLoginEventCount > 0,
    cookiePersistence: "MANUAL_BROWSER_REQUIRED"
  };
  const automatedAcceptancePassed = Object.entries(acceptance)
    .filter(([key]) => key !== "cookiePersistence")
    .every(([, value]) => value === true);

  const result = {
    status: automatedAcceptancePassed ? "BROWSER_ACCEPTANCE_REQUIRED" : "MANUAL_ACCEPTANCE_REQUIRED",
    scope: "Redacted production authentication aggregate readback",
    google: {
      identityCount: googleIdentityCount,
      distinctUserCount: googleUserCount,
      linkedEventCount: googleLinkEventCount,
      consumedChallengeCount,
      unconsumedLiveChallengeCount,
      successfulLoginEventCount: googleLoginEventCount,
      firstLoginEventCount: googleFirstLoginEventCount,
      repeatLoginEventCount: googleRepeatLoginEventCount,
      invitationLoginEventCount: googleInviteLoginEventCount,
      latestSuccessfulLoginAt: latestGoogleLogin._max.createdAt?.toISOString() || null
    },
    email: {
      verificationSentCount,
      verificationConsumedCount,
      latestVerificationConsumedAt: latestVerification._max.consumedAt?.toISOString() || null,
      resetSentCount,
      resetConsumedCount,
      latestResetConsumedAt: latestReset._max.consumedAt?.toISOString() || null,
      activeVerifiedPasswordUserCount
    },
    acceptance,
    piiRecorded: false,
    secretsRecorded: false,
    checkedAt: new Date().toISOString()
  };
  await mkdir(dirname(artifactFile), { recursive: true });
  await writeFile(artifactFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: result.status, evidence: artifactFile, acceptance, piiRecorded: false, secretsRecorded: false }, null, 2));
} finally {
  await prisma.$disconnect();
}

function singleConnectionUrl(value) {
  const url = new URL(value);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "20");
  return url.toString();
}
