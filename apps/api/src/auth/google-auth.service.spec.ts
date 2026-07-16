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
  async $transaction<T>(work: (transaction: this) => Promise<T>) {
    const snapshot = structuredClone({ users: this.users, challenges: this.challenges, identities: this.identities, events: this.events });
    try { return await work(this); }
    catch (error) {
      this.users = snapshot.users;
      this.challenges = snapshot.challenges;
      this.identities = snapshot.identities;
      this.events = snapshot.events;
      throw error;
    }
  }
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
    assert.deepEqual(prisma.events[1], { userId: first.user.id, eventName: "google_login_succeeded", source: "auth-google", payload: { identityId: prisma.identities[0].id, loginKind: "first", destination: "ROOM" } });
    assert.equal(first.returnTo, "/rooms/room-1");
    const claims = verifyAccessToken(first.accessToken);
    assert.ok(claims);
    assert.equal(claims.authMethod, "GOOGLE");
    assert.equal(claims.authIdentityId, prisma.identities[0].id);
    await assert.rejects(() => service.login({ credential: "google-id-token", challengeId: challenge.challengeId, clientIp: "127.0.0.1" }), (error: any) => error?.getResponse?.()?.code === "INVALID_GOOGLE_CHALLENGE");
    const nextChallenge = await service.createChallenge({ clientIp: "127.0.0.1" });
    verifier.candidate = googleIdentity({ nonce: nextChallenge.nonce });
    const inviteReturnTo = "/join?room=ROOM1&ref=REF1&channel=LINK";
    const second = await service.login({ credential: "google-id-token", challengeId: nextChallenge.challengeId, returnTo: inviteReturnTo, clientIp: "127.0.0.1" });
    assert.equal(second.user.id, first.user.id);
    assert.equal(second.returnTo, inviteReturnTo);
    assert.equal(prisma.users.length, 1);
    assert.equal(prisma.identities.length, 1);
    assert.deepEqual(prisma.events.at(-1), {
      userId: first.user.id,
      eventName: "google_login_succeeded",
      source: "auth-google",
      payload: { identityId: prisma.identities[0].id, loginKind: "repeat", destination: "ROOM_INVITE", hasRoom: true, hasReferral: true, hasChannel: true }
    });
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

test("Google safely auto-links authoritative Gmail and Workspace identities", async () => {
  await withGoogleEnabled(async () => {
    for (const candidate of [
      googleIdentity({ email: "person@gmail.com", hostedDomain: null }),
      googleIdentity({ email: "person@workspace.example", hostedDomain: "workspace.example" })
    ]) {
      const prisma = new MemoryGooglePrisma();
      const local = await prisma.user.create({ data: { openid: "password_local", email: candidate.email, emailVerifiedAt: new Date(), passwordHash: "hash", nickname: "Local account" } });
      const verifier = new FakeVerifier();
      const service = new GoogleAuthService(prisma as any, verifier as any);
      const challenge = await service.createChallenge({ clientIp: `127.0.1.${prisma.users.length}` });
      verifier.candidate = { ...candidate, nonce: challenge.nonce };
      const session = await service.login({ credential: "credential", challengeId: challenge.challengeId, clientIp: "127.0.1.20" });
      assert.equal(session.user.id, local.id);
      assert.equal(prisma.users.length, 1);
      assert.equal(prisma.identities.length, 1);
      assert.equal((prisma.events[0].payload as any).method, "authoritative-email");
    }
  });
});

test("Google rejects wrong, expired, and replayed challenges without creating an account", async () => {
  await withGoogleEnabled(async () => {
    const prisma = new MemoryGooglePrisma();
    const verifier = new FakeVerifier();
    const service = new GoogleAuthService(prisma as any, verifier as any);
    const wrong = await service.createChallenge({ clientIp: "127.0.2.1" });
    verifier.candidate = googleIdentity({ nonce: "different-nonce" });
    await assert.rejects(() => service.login({ credential: "credential", challengeId: wrong.challengeId, clientIp: "127.0.2.2" }), hasCode("INVALID_GOOGLE_CHALLENGE"));
    assert.equal(prisma.users.length, 0);
    assert.equal(prisma.identities.length, 0);
    assert.equal(prisma.challenges[0].consumedAt, null);

    const expired = await service.createChallenge({ clientIp: "127.0.2.3" });
    prisma.challenges.find((item) => item.id === expired.challengeId)!.expiresAt = new Date(Date.now() - 1_000);
    verifier.candidate = googleIdentity({ nonce: expired.nonce });
    await assert.rejects(() => service.login({ credential: "credential", challengeId: expired.challengeId, clientIp: "127.0.2.4" }), hasCode("INVALID_GOOGLE_CHALLENGE"));
    assert.equal(prisma.users.length, 0);
    assert.equal(prisma.identities.length, 0);
  });
});

test("Google rejects inactive users and preserves the existing identity mapping", async () => {
  await withGoogleEnabled(async () => {
    const prisma = new MemoryGooglePrisma();
    const user = await prisma.user.create({ data: { openid: "disabled", email: "disabled@gmail.com", emailVerifiedAt: new Date(), status: "disabled" } });
    await prisma.authIdentity.create({ data: { userId: user.id, provider: AuthProvider.GOOGLE, providerSubject: "disabled-subject", providerEmail: user.email, providerEmailVerifiedAt: new Date(), hostedDomain: null, profileJson: {} } });
    const verifier = new FakeVerifier();
    const service = new GoogleAuthService(prisma as any, verifier as any);
    const challenge = await service.createChallenge({ clientIp: "127.0.3.1" });
    verifier.candidate = googleIdentity({ subject: "disabled-subject", email: user.email!, nonce: challenge.nonce });
    await assert.rejects(() => service.login({ credential: "credential", challengeId: challenge.challengeId, clientIp: "127.0.3.2" }), hasCode("INVALID_GOOGLE_CREDENTIAL"));
    assert.equal(prisma.users.length, 1);
    assert.equal(prisma.identities.length, 1);
    assert.equal(prisma.challenges[0].consumedAt, null);
    assert.equal(prisma.events.length, 0);
  });
});

test("explicit Google linking is audited, rejects email ownership conflicts, and cannot remove the last login method", async () => {
  await withGoogleEnabled(async () => {
    const prisma = new MemoryGooglePrisma();
    const local = await prisma.user.create({ data: { openid: "password_local", email: "local@example.test", emailVerifiedAt: new Date(), passwordHash: "hash", nickname: "Local" } });
    const verifier = new FakeVerifier();
    const service = new GoogleAuthService(prisma as any, verifier as any);
    let challenge = await service.createChallenge({ clientIp: "127.0.4.1" });
    verifier.candidate = googleIdentity({ email: "google@gmail.com", nonce: challenge.nonce });
    const linked = await service.link(authenticated(local), { credential: "credential", challengeId: challenge.challengeId, clientIp: "127.0.4.2" });
    assert.equal(linked.linked, true);
    assert.equal(prisma.identities.length, 1);
    assert.equal((prisma.events[0].payload as any).method, "explicit");
    assert.deepEqual(await service.unlink(authenticated(local)), { unlinked: true });
    assert.equal(prisma.identities.length, 0);
    assert.equal(prisma.events.at(-1)?.eventName, "google_identity_unlinked");

    const other = await prisma.user.create({ data: { openid: "other", email: "owned@gmail.com", emailVerifiedAt: new Date(), passwordHash: "hash" } });
    challenge = await service.createChallenge({ clientIp: "127.0.4.3" });
    verifier.candidate = googleIdentity({ subject: "owned-subject", email: other.email!, nonce: challenge.nonce });
    await assert.rejects(() => service.link(authenticated(local), { credential: "credential", challengeId: challenge.challengeId, clientIp: "127.0.4.4" }), hasCode("GOOGLE_EMAIL_ALREADY_IN_USE"));

    const googleOnly = await prisma.user.create({ data: { openid: "google_only", email: "only@gmail.com", emailVerifiedAt: new Date(), passwordHash: null } });
    await prisma.authIdentity.create({ data: { userId: googleOnly.id, provider: AuthProvider.GOOGLE, providerSubject: "only-subject", providerEmail: googleOnly.email, providerEmailVerifiedAt: new Date(), hostedDomain: null, profileJson: {} } });
    await assert.rejects(() => service.unlink(authenticated(googleOnly)), hasCode("LAST_LOGIN_METHOD"));
  });
});

test("Google challenge creation is rate limited per IP", async () => {
  await withGoogleEnabled(async () => {
    const service = new GoogleAuthService(new MemoryGooglePrisma() as any, new FakeVerifier() as any);
    for (let index = 0; index < 20; index += 1) await service.createChallenge({ clientIp: "127.0.5.1" });
    await assert.rejects(() => service.createChallenge({ clientIp: "127.0.5.1" }), hasCode("AUTH_RATE_LIMITED"));
  });
});

test("a unique-constraint race resolves to the identity committed by the concurrent winner", async () => {
  await withGoogleEnabled(async () => {
    const winner = { id: "winner-user", openid: "google_winner", email: "race@gmail.com", emailVerifiedAt: new Date(), passwordHash: null, nickname: "Winner", avatarUrl: null, policyAgreedAt: new Date(), status: "active" };
    const identity = { id: "winner-identity", userId: winner.id, provider: AuthProvider.GOOGLE, providerSubject: "race-subject", providerEmail: winner.email, providerEmailVerifiedAt: new Date(), hostedDomain: null, profileJson: {}, user: winner };
    let identityLookup = 0;
    const raceEvents: any[] = [];
    const prisma: any = {
      authLoginChallenge: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => ({ id: "race-challenge", consumedAt: null, ...data }),
        updateMany: async () => ({ count: 1 })
      },
      authIdentity: {
        findUnique: async () => (++identityLookup === 1 ? null : identity),
        create: async () => { throw Object.assign(new Error("unique conflict"), { code: "P2002" }); }
      },
      user: {
        findUnique: async () => null,
        create: async () => ({ ...winner, id: "rolled-back-user" })
      },
      eventLog: { create: async ({ data }: any) => { raceEvents.push(data); return data; } },
      $transaction: async (work: (tx: any) => Promise<any>) => work(prisma)
    };
    const verifier = new FakeVerifier();
    const service = new GoogleAuthService(prisma, verifier as any);
    const challenge = await service.createChallenge({ clientIp: "127.0.6.1" });
    verifier.candidate = googleIdentity({ subject: "race-subject", email: winner.email!, nonce: challenge.nonce });
    const session = await service.login({ credential: "credential", challengeId: challenge.challengeId, clientIp: "127.0.6.2" });
    assert.equal(session.user.id, winner.id);
    assert.equal(verifyAccessToken(session.accessToken)?.authIdentityId, identity.id);
    assert.deepEqual(raceEvents, [{ userId: winner.id, eventName: "google_login_succeeded", source: "auth-google", payload: { identityId: identity.id, loginKind: "repeat", destination: "HOME" } }]);
  });
});

async function withGoogleEnabled(run: () => Promise<void>) {
  const priorEnabled = process.env.GOOGLE_AUTH_ENABLED;
  const priorClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  process.env.GOOGLE_AUTH_ENABLED = "true";
  process.env.GOOGLE_WEB_CLIENT_ID = "google-client-id.test";
  try { await run(); }
  finally {
    if (priorEnabled === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = priorEnabled;
    if (priorClientId === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID; else process.env.GOOGLE_WEB_CLIENT_ID = priorClientId;
  }
}

function authenticated(user: UserRecord) {
  return { id: user.id, openid: user.openid, email: user.email, emailVerifiedAt: user.emailVerifiedAt, nickname: user.nickname, authMethod: "PASSWORD" as const, authIdentityId: null };
}

function hasCode(code: string) {
  return (error: any) => error?.getResponse?.()?.code === code;
}
