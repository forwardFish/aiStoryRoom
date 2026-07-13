import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma.service";

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException({ code: "INVALID_EMAIL", message: "A valid email is required" });
  return email;
}

function hashPassword(password: string) {
  if (password.length < 6) throw new BadRequestException({ code: "INVALID_PASSWORD", message: "Password must be at least 6 characters" });
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
        token: user.openid,
        verificationToken: process.env.NODE_ENV === "production" ? undefined : token,
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
    return { token: user.openid, user: this.safeUser(user) };
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
