import assert from "node:assert/strict";
import { AuthTokenPurpose } from "@prisma/client";
import { allowsBrowserAuthTokens, AuthService, hashAuthSecret } from "./auth.service";

const emails: Array<{ kind: "verify" | "reset"; email: string; token: string }> = [];
const mailer = {
  async sendVerification(input: { email: string; token: string }) { emails.push({ kind: "verify", email: input.email, token: input.token }); return { provider: "file-sink", providerId: "verify-1" }; },
  async sendPasswordReset(input: { email: string; token: string }) { emails.push({ kind: "reset", email: input.email, token: input.token }); return { provider: "file-sink", providerId: "reset-1" }; }
};

async function run() {
  const prisma = new MemoryPrisma();
  const auth = new AuthService(prisma as any, mailer as any);
  assert.equal(allowsBrowserAuthTokens(), false, "verification or reset tokens must never be returned by the API");

  const registered = await auth.register({ email: "alice@example.test", password: "password-123", nickname: "Alice", clientIp: "127.0.0.1" });
  assert.deepEqual(registered, { accepted: true, verificationRequired: true, referralCode: null });
  assert.equal("verificationToken" in registered, false);
  assert.equal(emails.length, 1);
  const storedVerification = prisma.tokens[0];
  assert.equal(storedVerification.tokenHash, hashAuthSecret(emails[0].token));
  assert.notEqual(storedVerification.tokenHash, emails[0].token);

  await assert.rejects(() => auth.login({ email: "alice@example.test", password: "password-123", clientIp: "127.0.0.2" }), hasCode("EMAIL_VERIFICATION_REQUIRED"));
  const firstVerificationToken = emails[0].token;
  assert.deepEqual(await auth.resendVerification({ email: "alice@example.test", clientIp: "127.0.0.3" }), { accepted: true });
  const replacementVerificationToken = emails.at(-1)!.token;
  assert.notEqual(replacementVerificationToken, firstVerificationToken);
  await assert.rejects(() => auth.verify({ token: firstVerificationToken, clientIp: "127.0.0.4" }), hasCode("INVALID_VERIFICATION"));
  const verified = await auth.verify({ token: replacementVerificationToken, clientIp: "127.0.0.5" });
  assert.equal(verified.verified, true);
  assert.ok(verified.accessToken);
  assert.equal(prisma.tokens.at(-1)?.consumedAt instanceof Date, true);
  await assert.rejects(() => auth.verify({ token: replacementVerificationToken, clientIp: "127.0.0.6" }), hasCode("INVALID_VERIFICATION"));

  const session = await auth.login({ email: "alice@example.test", password: "password-123", clientIp: "127.0.0.7" });
  assert.ok(session.accessToken);
  const missingResetRequest = await auth.requestPasswordReset({ email: "missing@example.test", clientIp: "127.0.0.8" });
  assert.deepEqual(missingResetRequest, { accepted: true });
  const resetRequest = await auth.requestPasswordReset({ email: "alice@example.test", clientIp: "127.0.0.9" });
  assert.deepEqual(resetRequest, { accepted: true });
  assert.equal("resetToken" in resetRequest, false);
  const resetMail = emails.at(-1);
  assert.equal(resetMail?.kind, "reset");
  const resetRecord = prisma.tokens.find((item) => item.purpose === AuthTokenPurpose.PASSWORD_RESET);
  assert.equal(resetRecord?.tokenHash, hashAuthSecret(resetMail!.token));
  await auth.resetPassword({ token: resetMail!.token, password: "new-password-123", clientIp: "127.0.0.10" });
  await assert.rejects(() => auth.login({ email: "alice@example.test", password: "password-123", clientIp: "127.0.0.11" }), hasCode("INVALID_CREDENTIALS"));
  assert.ok((await auth.login({ email: "alice@example.test", password: "new-password-123", clientIp: "127.0.0.12" })).accessToken);
  await assert.rejects(() => auth.resetPassword({ token: resetMail!.token, password: "another-password-123", clientIp: "127.0.0.13" }), hasCode("INVALID_RESET_TOKEN"));
  await auth.requestPasswordReset({ email: "alice@example.test", clientIp: "127.0.0.14" });
  const expiredResetMail = emails.at(-1)!;
  prisma.tokens.find((item) => item.tokenHash === hashAuthSecret(expiredResetMail.token))!.expiresAt = new Date(Date.now() - 1_000);
  await assert.rejects(() => auth.resetPassword({ token: expiredResetMail.token, password: "another-password-123", clientIp: "127.0.0.15" }), hasCode("INVALID_RESET_TOKEN"));

  const rateLimited = new AuthService(new MemoryPrisma() as any, mailer as any);
  for (let index = 0; index < 5; index += 1) await rateLimited.register({ email: "limited@example.test", password: "password-123", clientIp: `127.0.1.${index}` });
  await assert.rejects(() => rateLimited.register({ email: "limited@example.test", password: "password-123", clientIp: "127.0.1.9" }), hasCode("AUTH_RATE_LIMITED"));

  const loginPrisma = new MemoryPrisma();
  const loginLimited = new AuthService(loginPrisma as any, mailer as any);
  await loginLimited.register({ email: "login-limited@example.test", password: "password-123", clientIp: "127.0.3.1" });
  await loginLimited.verify({ token: emails.at(-1)!.token, clientIp: "127.0.3.2" });
  for (let index = 0; index < 10; index += 1) {
    await assert.rejects(() => loginLimited.login({ email: "login-limited@example.test", password: "wrong-password", clientIp: "127.0.3.3" }), hasCode("INVALID_CREDENTIALS"));
  }
  await assert.rejects(() => loginLimited.login({ email: "login-limited@example.test", password: "wrong-password", clientIp: "127.0.3.3" }), hasCode("AUTH_RATE_LIMITED"));

  const resendLimited = new AuthService(new MemoryPrisma() as any, mailer as any);
  await resendLimited.register({ email: "resend-limited@example.test", password: "password-123", clientIp: "127.0.4.1" });
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await resendLimited.resendVerification({ email: "resend-limited@example.test", clientIp: "127.0.4.2" }), { accepted: true });
  }
  await assert.rejects(() => resendLimited.resendVerification({ email: "resend-limited@example.test", clientIp: "127.0.4.2" }), hasCode("AUTH_RATE_LIMITED"));

  const resetPrisma = new MemoryPrisma();
  const resetLimited = new AuthService(resetPrisma as any, mailer as any);
  await resetLimited.register({ email: "reset-limited@example.test", password: "password-123", clientIp: "127.0.5.1" });
  await resetLimited.verify({ token: emails.at(-1)!.token, clientIp: "127.0.5.2" });
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await resetLimited.requestPasswordReset({ email: "reset-limited@example.test", clientIp: "127.0.5.3" }), { accepted: true });
  }
  await assert.rejects(() => resetLimited.requestPasswordReset({ email: "reset-limited@example.test", clientIp: "127.0.5.3" }), hasCode("AUTH_RATE_LIMITED"));

  const confirmLimited = new AuthService(new MemoryPrisma() as any, mailer as any);
  for (let index = 0; index < 10; index += 1) {
    await assert.rejects(() => confirmLimited.resetPassword({ token: `invalid-${index}`, password: "password-123", clientIp: "127.0.6.1" }), hasCode("INVALID_RESET_TOKEN"));
  }
  await assert.rejects(() => confirmLimited.resetPassword({ token: "invalid-final", password: "password-123", clientIp: "127.0.6.1" }), hasCode("AUTH_RATE_LIMITED"));

  const expiredPrisma = new MemoryPrisma();
  const expiring = new AuthService(expiredPrisma as any, mailer as any);
  await expiring.register({ email: "expired@example.test", password: "password-123", clientIp: "127.0.2.1" });
  const expiredToken = emails.at(-1)!.token;
  expiredPrisma.tokens[0].expiresAt = new Date(Date.now() - 1_000);
  await assert.rejects(() => expiring.verify({ token: expiredToken, clientIp: "127.0.2.2" }), hasCode("INVALID_VERIFICATION"));

  console.log("production email-auth token, verification, login, reset, and replay assertions passed");
}

function resetFixture() {
  emails.length = 0;
}

function hasCode(code: string) {
  return (error: any) => error?.response?.code === code || error?.getResponse?.()?.code === code;
}

class MemoryPrisma {
  users: any[] = [];
  tokens: any[] = [];
  private nextUser = 0;
  private nextToken = 0;

  user = {
    create: async ({ data }: any) => {
      const user = { id: `user_${++this.nextUser}`, emailVerifiedAt: null, verificationTokenHash: null, status: "active", ...structuredClone(data) };
      this.users.push(user);
      return structuredClone(user);
    },
    findUnique: async ({ where }: any) => this.copyUser(this.users.find((user) => where.id ? user.id === where.id : user.email === where.email)),
    findUniqueOrThrow: async ({ where }: any) => {
      const user = this.users.find((item) => item.id === where.id);
      if (!user) throw new Error("not found");
      return structuredClone(user);
    },
    update: async ({ where, data }: any) => {
      const user = this.users.find((item) => item.id === where.id);
      if (!user) throw new Error("not found");
      Object.assign(user, structuredClone(data));
      return structuredClone(user);
    }
  };

  authOneTimeToken = {
    create: async ({ data }: any) => {
      const token = { id: `token_${++this.nextToken}`, consumedAt: null, invalidatedAt: null, failedAttempts: 0, sentAt: null, deliveryProvider: null, deliveryProviderId: null, createdAt: new Date(), ...structuredClone(data) };
      this.tokens.push(token);
      return structuredClone(token);
    },
    findUnique: async ({ where, include }: any) => {
      const token = this.tokens.find((item) => item.tokenHash === where.tokenHash || item.id === where.id);
      if (!token) return null;
      const copy = structuredClone(token);
      if (include?.user) copy.user = this.copyUser(this.users.find((user) => user.id === token.userId));
      return copy;
    },
    updateMany: async ({ where, data }: any) => {
      const found = this.tokens.filter((token) => this.tokenMatches(token, where));
      found.forEach((token) => Object.assign(token, structuredClone(data)));
      return { count: found.length };
    },
    update: async ({ where, data }: any) => {
      const token = this.tokens.find((item) => item.id === where.id);
      if (!token) throw new Error("not found");
      Object.assign(token, structuredClone(data));
      return structuredClone(token);
    }
  };

  async $transaction<T>(callback: (transaction: this) => Promise<T>) {
    return callback(this);
  }

  private copyUser(user: any) { return user ? structuredClone(user) : null; }

  private tokenMatches(token: any, where: any) {
    if (where.id && token.id !== where.id) return false;
    if (where.userId && token.userId !== where.userId) return false;
    if (where.purpose && token.purpose !== where.purpose) return false;
    if (where.consumedAt === null && token.consumedAt !== null) return false;
    if (where.invalidatedAt === null && token.invalidatedAt !== null) return false;
    if (where.expiresAt?.gt && !(token.expiresAt > where.expiresAt.gt)) return false;
    return true;
  }
}

run().finally(resetFixture).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
