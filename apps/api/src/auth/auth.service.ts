import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { AuthTokenPurpose } from "@prisma/client";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma.service";
import { safeAuthReturnTo } from "./auth-return-to";
import { authSessionTtlSeconds } from "./auth-session-options";

export type AuthMethod = "PASSWORD" | "GOOGLE";

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException({ code: "INVALID_EMAIL", message: "A valid email is required" });
  return email;
}

function hashPassword(password: string) {
  if (password.length < 8) throw new BadRequestException({ code: "INVALID_PASSWORD", message: "Password must be at least 8 characters" });
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function verifyPassword(password: string, stored: string) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function hashAuthSecret(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const accessTokenSecret = () => {
  const value = process.env.AUTH_TOKEN_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_TOKEN_SECRET must be configured in production");
  return "many-worlds-local-development-token-secret";
};

/** Kept only for old callers; authentication secrets are never returned in API responses. */
export function allowsBrowserAuthTokens() {
  return false;
}

export type AccessTokenClaims = {
  sub: string;
  openid: string;
  authMethod: AuthMethod;
  authIdentityId?: string;
};

export function issueAccessToken(user: { id: string; openid: string }, options: { authMethod?: AuthMethod; authIdentityId?: string } = {}) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    openid: user.openid,
    aud: "many-worlds-v4",
    authMethod: options.authMethod || "PASSWORD",
    ...(options.authIdentityId ? { authIdentityId: options.authIdentityId } : {}),
    exp: Math.floor(Date.now() / 1000) + authSessionTtlSeconds()
  })).toString("base64url");
  const signature = createHmac("sha256", accessTokenSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  const [payload, suppliedSignature, ...rest] = token.split(".");
  if (!payload || !suppliedSignature || rest.length) return null;
  const expectedSignature = createHmac("sha256", accessTokenSecret()).update(payload).digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const authMethod: AuthMethod = parsed?.authMethod === "GOOGLE" ? "GOOGLE" : "PASSWORD";
    if (parsed?.aud !== "many-worlds-v4" || typeof parsed?.sub !== "string" || typeof parsed?.openid !== "string" || Number(parsed?.exp) <= Math.floor(Date.now() / 1000)) return null;
    if (authMethod === "GOOGLE" && typeof parsed?.authIdentityId !== "string") return null;
    return { sub: parsed.sub, openid: parsed.openid, authMethod, ...(typeof parsed?.authIdentityId === "string" ? { authIdentityId: parsed.authIdentityId } : {}) };
  } catch { return null; }
}

type RateLimit = { count: number; startedAt: number };
type OneTimeToken = { id: string; raw: string; expiresAt: Date };

@Injectable()
export class AuthService {
  private readonly rateLimits = new Map<string, RateLimit>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailService) private readonly email: EmailService
  ) {}

  async register(input: { email?: string; password?: string; nickname?: string; referralCode?: string; returnTo?: string; clientIp?: string }) {
    const email = normalizeEmail(input.email);
    this.enforceRateLimit("register", email, input.clientIp, 5, 15 * 60_000);
    const passwordHash = hashPassword(String(input.password || ""));
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.emailVerifiedAt) throw new ConflictException({ code: "EMAIL_ALREADY_REGISTERED", message: "Email is already registered" });
    if (existing && (!existing.passwordHash || existing.status !== "active")) throw new ConflictException({ code: "EMAIL_ALREADY_REGISTERED", message: "Email is already registered" });

    const user = existing || await this.prisma.user.create({
      data: {
        openid: `local_${randomUUID()}`,
        email,
        passwordHash,
        nickname: String(input.nickname || email.split("@")[0]).slice(0, 80),
        avatarUrl: "",
        policyAgreedAt: new Date()
      }
    });
    const token = await this.createOneTimeToken(user.id, AuthTokenPurpose.EMAIL_VERIFICATION);
    await this.sendOneTimeToken(user.email || email, token, AuthTokenPurpose.EMAIL_VERIFICATION, input.returnTo);
    return { accepted: true, verificationRequired: true, referralCode: input.referralCode?.trim().toUpperCase() || null };
  }

  async resendVerification(input: { email?: string; returnTo?: string; clientIp?: string }) {
    const email = normalizeEmail(input.email);
    this.enforceRateLimit("verification-resend", email, input.clientIp, 3, 60 * 60_000);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt || user.status !== "active") return { accepted: true };
    const token = await this.createOneTimeToken(user.id, AuthTokenPurpose.EMAIL_VERIFICATION);
    await this.sendOneTimeToken(email, token, AuthTokenPurpose.EMAIL_VERIFICATION, input.returnTo);
    return { accepted: true };
  }

  async verify(input: { token?: string; verificationToken?: string; clientIp?: string }) {
    const rawToken = String(input.token || input.verificationToken || "");
    this.enforceRateLimit("verify", hashAuthSecret(rawToken || "missing"), input.clientIp, 10, 15 * 60_000);
    const record = await this.prisma.authOneTimeToken.findUnique({ where: { tokenHash: hashAuthSecret(rawToken) }, include: { user: true } });
    if (!record || record.purpose !== AuthTokenPurpose.EMAIL_VERIFICATION || record.expiresAt <= new Date() || record.consumedAt || record.invalidatedAt || record.user.status !== "active") {
      throw new UnauthorizedException({ code: "INVALID_VERIFICATION", message: "This verification link is invalid or expired" });
    }
    const verified = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authOneTimeToken.updateMany({
        where: { id: record.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1) throw new UnauthorizedException({ code: "INVALID_VERIFICATION", message: "This verification link is invalid or expired" });
      return tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date(), verificationTokenHash: null } });
    });
    const token = issueAccessToken(verified);
    return { verified: true, user: this.safeUser(verified), token, accessToken: token };
  }

  async login(input: { email?: string; password?: string; clientIp?: string }) {
    const email = normalizeEmail(input.email);
    this.enforceRateLimit("login", email, input.clientIp, 10, 15 * 60_000);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !verifyPassword(String(input.password || ""), user.passwordHash)) {
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    }
    if (user.status !== "active") throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    if (!user.emailVerifiedAt) throw new UnauthorizedException({ code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before logging in" });
    const token = issueAccessToken(user);
    return { token, accessToken: token, user: this.safeUser(user) };
  }

  async requestPasswordReset(input: { email?: string; clientIp?: string }) {
    const email = normalizeEmail(input.email);
    this.enforceRateLimit("password-reset-request", email, input.clientIp, 3, 60 * 60_000);
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Deliberately identical external response to prevent account enumeration.
    if (!user || !user.emailVerifiedAt || !user.passwordHash || user.status !== "active") return { accepted: true };
    const token = await this.createOneTimeToken(user.id, AuthTokenPurpose.PASSWORD_RESET);
    await this.sendOneTimeToken(email, token, AuthTokenPurpose.PASSWORD_RESET);
    return { accepted: true };
  }

  async resetPassword(input: { token?: string; resetToken?: string; password?: string; email?: string; clientIp?: string }) {
    const rawToken = String(input.token || input.resetToken || "");
    this.enforceRateLimit("password-reset-confirm", hashAuthSecret(rawToken || "missing"), input.clientIp, 10, 15 * 60_000);
    const record = await this.prisma.authOneTimeToken.findUnique({ where: { tokenHash: hashAuthSecret(rawToken) }, include: { user: true } });
    const requestedEmail = input.email ? normalizeEmail(input.email) : null;
    if (!record || record.purpose !== AuthTokenPurpose.PASSWORD_RESET || record.expiresAt <= new Date() || record.consumedAt || record.invalidatedAt || !record.user.emailVerifiedAt || record.user.status !== "active" || (requestedEmail && record.user.email !== requestedEmail)) {
      throw new UnauthorizedException({ code: "INVALID_RESET_TOKEN", message: "The password reset link is invalid or expired" });
    }
    const passwordHash = hashPassword(String(input.password || ""));
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authOneTimeToken.updateMany({
        where: { id: record.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1) throw new UnauthorizedException({ code: "INVALID_RESET_TOKEN", message: "The password reset link is invalid or expired" });
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash, verificationTokenHash: null } });
    });
    return { reset: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.safeUser(user);
  }

  private async createOneTimeToken(userId: string, purpose: AuthTokenPurpose): Promise<OneTimeToken> {
    const raw = randomBytes(32).toString("base64url");
    const now = new Date();
    const ttlMinutes = purpose === AuthTokenPurpose.EMAIL_VERIFICATION
      ? positiveInteger(process.env.EMAIL_VERIFY_TTL_MINUTES, 30)
      : positiveInteger(process.env.PASSWORD_RESET_TTL_MINUTES, 15);
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.authOneTimeToken.updateMany({
        where: { userId, purpose, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now }
      });
      return tx.authOneTimeToken.create({ data: { userId, purpose, tokenHash: hashAuthSecret(raw), expiresAt } });
    });
    return { id: record.id, raw, expiresAt };
  }

  private async sendOneTimeToken(email: string, token: OneTimeToken, purpose: AuthTokenPurpose, returnTo?: string) {
    const delivery = purpose === AuthTokenPurpose.EMAIL_VERIFICATION
      ? await this.email.sendVerification({ email, token: token.raw, returnTo: safeAuthReturnTo(returnTo), idempotencyKey: `auth-token:${token.id}` })
      : await this.email.sendPasswordReset({ email, token: token.raw, idempotencyKey: `auth-token:${token.id}` });
    await this.prisma.authOneTimeToken.update({
      where: { id: token.id },
      data: { sentAt: new Date(), deliveryProvider: delivery.provider, deliveryProviderId: delivery.providerId }
    });
  }

  private enforceRateLimit(action: string, subject: string, clientIp: string | undefined, maximum: number, windowMs: number) {
    const now = Date.now();
    for (const key of [`${action}:subject:${subject}`, `${action}:ip:${clientIp || "unknown"}`]) {
      const previous = this.rateLimits.get(key);
      const bucket = previous && now - previous.startedAt < windowMs ? previous : { count: 0, startedAt: now };
      bucket.count += 1;
      this.rateLimits.set(key, bucket);
      if (bucket.count > maximum) throw new HttpException({ code: "AUTH_RATE_LIMITED", message: "Too many authentication attempts; retry later" }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private safeUser(user: { id: string; email: string | null; emailVerifiedAt: Date | null; nickname: string | null; openid: string }) {
    return { id: user.id, email: user.email, emailVerified: Boolean(user.emailVerifiedAt), nickname: user.nickname };
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
