import assert from "node:assert/strict";
import test from "node:test";
import { AuthProvider } from "@prisma/client";
import { verifyAccessToken } from "./auth.service";
import { GoogleAuthService } from "./google-auth.service";
import type { VerifiedGoogleIdentity } from "./google-token-verifier";

type UserRecord = { id: string; openid: string; email: string | null; emailVerifiedAt: Date | null; passwordHash: string | null; nickname: string | null; avatarUrl: string | null; policyAgreedAt: Date | null; status: string };
type ChallengeRecord = { id: string; provider: AuthProvider; nonceHash: string; expiresAt: Date; consumedAt: Date | null };
type IdentityRecord = { id: string; userId: string; provider: AuthProvider; providerSubject: string; providerEmail: string | null; providerEmailVerifiedAt: Date | null; hostedDomain: string | null; profileJson: unknown };

class MemoryGooglePrisma {
  users: UserRecord[] = [];
  challenges: ChallengeRecord[] = [];
  identities: IdentityRecord[] = [];
  events: Array<{ userId: string | null; eventName: string; source: string | null; payload: unknown }> = [];
  private userSequence = 0;
  private challengeSequence = 0;
  private identitySequence = 0;

  authLoginChallenge = {
    deleteMany: async ({ where }: any) => { const prior = this.challenges.length; if (where?.expiresAt?.lte) this.challenges = this.challenges.filter((item) => item.expiresAt > where.expiresAt.lte); return { count: prior - this.challenges.length }; },
    create: async ({ data }: any) => { const record: ChallengeRecord = { id: `challenge_${++this.challengeSequence}`, consumedAt: null, ...data }; this.challenges.push(record); return record; },
    updateMany: async ({ where, data }: any) => { const record = this.challenges.find((item) => item.id === where.id && item.provider === where.provider && item.nonceHash === where.nonceHash && item.consumedAt === where.consumedAt && item.expiresAt > where.expiresAt.gt); if (!record) return { count: 0 }; record.consumedAt = data.consumedAt; return { count: 1 }; }
  };
  user = {
    findUnique: async ({ where, include }: any) => { const record = where.id ? this.users.find((item) => item.id === where.id) : this.users.find((item) => item.email === where.email); if (!record) return null; return include?.authIdentities ? { ...record, authIdentities: this.identities.filter((identity) => identity.userId === record.id) } : record; },
    create: async ({ data }: any) => { const record: UserRecord = { id: `user_${++this.userSequence}`, status: "active", email: null, emailVerifiedAt: null, passwordHash: null, nickname: null, avatarUrl: null, policyAgreedAt: null, ...data }; this.users.push(record); return record; }
  };
  authIdentity = {
    findUnique: async ({ where, include }: any) => { const key = where.provider_providerSubject; const record = key ? this.identities.find((item) => item.provider === key.provider && item.providerSubject === key.providerSubject) : this.identities.find((item) => item.id === where.id); if (!record) return null; return include?.user ? { ...record, user: this.users.find((item) => item.id === record.userId) } : record; },
    create: async ({ data }: any) => { const record: IdentityRecord = { id: `identity_${++this.identitySequence}`, ...data }; this.identities.push(record); return record; },
    delete: async ({ where }: any) => { const index = this.identities.findIndex((item) => item.id === where.id); if (index < 0) throw new Error("identity not found"); return this.identities.splice(index, 1)[0]; }
  };
  eventLog = {
    create: async ({ data }: any) => { const event = { userId: data.userId || null, eventName: data.eventName, source: data.source || null, payload: data.payload || null }; this.events.push(event); return event; }
  };
  async $transaction<T>(work: (transaction: this) => Promise<T>) { return work(this); }
}

class FakeVerifier {
  candidate: VerifiedGoogleIdentity | null = null;
  async verify() { if (!this.candidate) throw new Error("missing test candidate"); return this.candidate; }
}

function googleIdentity(overrides: Partial<VerifiedGoogleIdentity> = {}): VerifiedGoogleIdentity {
  return { subject: "google-subject-1", email: "person@gmail.com", emailVerified: true, hostedDomain: null, nonce: "", name: "Google Person", picture: "https://example.test/avatar.png", ...overrides };
}

test("Google sign-in verifies a nonce-bound one-time challenge and does not duplicate an identity", async () => {
  const priorEnabled = process.env.GOOGLE_AUTH_ENABLED;
  const priorClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  process.env.GOOGLE_AUTH_ENABLED = "true";
  process.env.GOOGLE_WEB_CLIENT_ID = "google-client-id.test";
  try {
    const prisma = new MemoryGooglePrisma();
    const verifier = new FakeVerifier();
    const service = new GoogleAuthService(prisma as any, verifier as any);
    const challenge = await service.createChallenge({ clientIp: "127.0.0.1" });
    verifier.candidate = googleIdentity({ nonce: challenge.nonce });
    const first = await service.login({ credential: "google-id-token", challengeId: challenge.challengeId, returnTo: "/rooms/room-1", clientIp: "127.0.0.1" });
    assert.equal(prisma.users.length, 1);
    assert.equal(prisma.identities.length, 1);
    assert.deepEqual(prisma.events[0], { userId: first.user.id, eventName: "google_identity_linked", source: "auth-google", payload: { identityId: prisma.identities[0].id, method: "new-account" } });
    assert.equal(first.returnTo, "/rooms/room-1");
    const claims = verifyAccessToken(first.accessToken);
    assert.ok(claims);
    assert.equal(claims.authMethod, "GOOGLE");
    assert.equal(claims.authIdentityId, prisma.identities[0].id);
    await assert.rejects(() => service.login({ credential: "google-id-token", challengeId: challenge.challengeId, clientIp: "127.0.0.1" }), (error: any) => error?.getResponse?.()?.code === "INVALID_GOOGLE_CHALLENGE");
    const nextChallenge = await service.createChallenge({ clientIp: "127.0.0.1" });
    verifier.candidate = googleIdentity({ nonce: nextChallenge.nonce });
    const second = await service.login({ credential: "google-id-token", challengeId: nextChallenge.challengeId, clientIp: "127.0.0.1" });
    assert.equal(second.user.id, first.user.id);
    assert.equal(prisma.users.length, 1);
    assert.equal(prisma.identities.length, 1);
  } finally {
    if (priorEnabled === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = priorEnabled;
    if (priorClientId === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID; else process.env.GOOGLE_WEB_CLIENT_ID = priorClientId;
  }
});

test("Google will not silently link an untrusted third-party email to an existing password account", async () => {
  const priorEnabled = process.env.GOOGLE_AUTH_ENABLED;
  const priorClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  process.env.GOOGLE_AUTH_ENABLED = "true";
  process.env.GOOGLE_WEB_CLIENT_ID = "google-client-id.test";
  try {
    const prisma = new MemoryGooglePrisma();
    const local = await prisma.user.create({ data: { openid: "password_local", email: "person@third-party.example", emailVerifiedAt: new Date(), passwordHash: "hash", nickname: "Local account" } });
    const verifier = new FakeVerifier();
    const service = new GoogleAuthService(prisma as any, verifier as any);
    const challenge = await service.createChallenge({ clientIp: "127.0.0.1" });
    verifier.candidate = googleIdentity({ subject: "other-subject", email: local.email!, hostedDomain: null, nonce: challenge.nonce });
    await assert.rejects(() => service.login({ credential: "google-id-token", challengeId: challenge.challengeId, clientIp: "127.0.0.1" }), (error: any) => error?.getResponse?.()?.code === "ACCOUNT_LINK_REQUIRED");
    assert.equal(prisma.identities.length, 0);
  } finally {
    if (priorEnabled === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = priorEnabled;
    if (priorClientId === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID; else process.env.GOOGLE_WEB_CLIENT_ID = priorClientId;
  }
});
