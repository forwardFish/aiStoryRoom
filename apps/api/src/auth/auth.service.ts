import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { PrismaService } from "../prisma.service";

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

function hashVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const accessTokenSecret = () => {
  const value = process.env.AUTH_TOKEN_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_TOKEN_SECRET must be configured in production");
  return "many-worlds-local-development-token-secret";
};

/**
 * Browser-delivered auth tokens are only for local and hosted sandbox
 * acceptance. A real production environment must deliver these tokens by
 * email instead of exposing them in an API response.
 */
export function allowsBrowserAuthTokens() {
  const override = process.env.AUTH_ALLOW_BROWSER_VERIFICATION;
  if (override !== undefined) return override === "true";
  return process.env.NODE_ENV !== "production" || process.env.CREEM_MODE === "test";
}

export function issueAccessToken(user: { id: string; openid: string }) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, openid: user.openid, aud: "many-worlds-v4", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 })).toString("base64url");
  const signature = createHmac("sha256", accessTokenSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAccessToken(token: string): { sub: string; openid: string } | null {
  const [payload, suppliedSignature, ...rest] = token.split(".");
  if (!payload || !suppliedSignature || rest.length) return null;
  const expectedSignature = createHmac("sha256", accessTokenSecret()).update(payload).digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed?.aud !== "many-worlds-v4" || typeof parsed?.sub !== "string" || typeof parsed?.openid !== "string" || Number(parsed?.exp) <= Math.floor(Date.now() / 1000)) return null;
    return { sub: parsed.sub, openid: parsed.openid };
  } catch { return null; }
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async register(input: { email?: string; password?: string; nickname?: string; referralCode?: string }) {
    const email = normalizeEmail(input.email);
    const passwordHash = hashPassword(String(input.password || ""));
    const token = randomBytes(24).toString("hex");
    try {
      const user = await this.prisma.user.create({
        data: {
          openid: `local_${randomUUID()}`,
          email,
          passwordHash,
          verificationTokenHash: hashVerificationToken(token),
          nickname: String(input.nickname || email.split("@")[0]).slice(0, 80),
          avatarUrl: "",
          policyAgreedAt: new Date()
        }
      });
      return {
        user: this.safeUser(user),
        verificationToken: allowsBrowserAuthTokens() ? token : undefined,
        referralCode: input.referralCode?.trim().toUpperCase() || null
      };
    } catch (error: any) {
      if (error?.code === "P2002") throw new ConflictException({ code: "EMAIL_ALREADY_REGISTERED", message: "Email is already registered" });
      throw error;
    }
  }

  async verify(input: { email?: string; verificationToken?: string }) {
    const email = normalizeEmail(input.email);
    const token = String(input.verificationToken || "");
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException({ code: "INVALID_VERIFICATION", message: "Invalid verification details" });
    if (user.emailVerifiedAt) return { verified: true, alreadyVerified: true, user: this.safeUser(user) };
    if (!token || user.verificationTokenHash !== hashVerificationToken(token)) {
      throw new UnauthorizedException({ code: "INVALID_VERIFICATION", message: "Invalid verification details" });
    }
    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verificationTokenHash: null }
    });
    return { verified: true, alreadyVerified: false, user: this.safeUser(verified) };
  }

  async login(input: { email?: string; password?: string }) {
    const email = normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !verifyPassword(String(input.password || ""), user.passwordHash)) {
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException({ code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before logging in" });
    }
    const token = issueAccessToken(user);
    return { token, accessToken: token, user: this.safeUser(user) };
  }

  async requestPasswordReset(input: { email?: string }) {
    const email = normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Keep the external response identical to avoid account enumeration.
    if (!user || !user.emailVerifiedAt || user.status !== "active") return { accepted: true };
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
    const token = `${expiresAt}.${randomBytes(24).toString("hex")}`;
    await this.prisma.user.update({ where: { id: user.id }, data: { verificationTokenHash: hashVerificationToken(token) } });
    const mailSink = process.env.NODE_ENV !== "production" ? process.env.PASSWORD_RESET_MAIL_SINK_FILE : undefined;
    if (mailSink) await appendFile(mailSink, `${JSON.stringify({ type: "password_reset", email, token, expiresAt, createdAt: new Date().toISOString() })}\n`, "utf8");
    return {
      accepted: true,
      // Local and hosted Creem-test acceptance can complete the reset flow
      // without a transactional-mail provider. Production never receives the
      // token unless an operator explicitly enables the sandbox override.
      ...(allowsBrowserAuthTokens() ? { resetToken: token } : {})
    };
  }

  async resetPassword(input: { email?: string; resetToken?: string; password?: string }) {
    const email = normalizeEmail(input.email);
    const token = String(input.resetToken || "");
    const [expiresAtRaw] = token.split(".");
    const expiresAt = Number(expiresAtRaw);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.emailVerifiedAt || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || user.verificationTokenHash !== hashVerificationToken(token)) {
      throw new UnauthorizedException({ code: "INVALID_RESET_TOKEN", message: "The password reset token is invalid or expired" });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(String(input.password || "")), verificationTokenHash: null } });
    return { reset: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.safeUser(user);
  }

  private safeUser(user: { id: string; email: string | null; emailVerifiedAt: Date | null; nickname: string | null; openid: string }) {
    return {
      id: user.id,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      nickname: user.nickname
    };
  }
}
