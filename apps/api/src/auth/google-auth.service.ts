import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AuthProvider } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { safeAuthReturnTo } from "./auth-return-to";
import type { AuthenticatedUser } from "./current-user.decorator";
import { hashAuthSecret, issueAccessToken } from "./auth.service";
import { GoogleTokenVerifier, type VerifiedGoogleIdentity } from "./google-token-verifier";

type RateLimit = { count: number; startedAt: number };

@Injectable()
export class GoogleAuthService {
  private readonly rateLimits = new Map<string, RateLimit>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(GoogleTokenVerifier) private readonly verifier: GoogleTokenVerifier) {}

  async createChallenge(input: { clientIp?: string }) {
    this.assertEnabled();
    this.enforceRateLimit("challenge", input.clientIp, 20, 15 * 60_000);
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + challengeTtlMilliseconds());
    await this.prisma.authLoginChallenge.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const challenge = await this.prisma.authLoginChallenge.create({ data: { provider: AuthProvider.GOOGLE, nonceHash: hashAuthSecret(nonce), expiresAt } });
    return { challengeId: challenge.id, nonce, expiresAt: challenge.expiresAt.toISOString() };
  }

  async login(input: { credential?: string; challengeId?: string; returnTo?: string; clientIp?: string }) {
    this.assertEnabled();
    this.enforceRateLimit("login", input.clientIp, 10, 15 * 60_000);
    const identity = await this.verifier.verify(String(input.credential || ""));
    const challengeId = String(input.challengeId || "");
    let userAndIdentity: Awaited<ReturnType<GoogleAuthService["consumeAndResolve"]>>;
    try {
      userAndIdentity = await this.consumeAndResolve(identity, challengeId);
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      // Two first-time logins for the same Google subject can race between the
      // initial lookup and the unique AuthIdentity insert. The losing database
      // transaction rolls back its challenge consumption, so consume it once
      // more and resolve the identity committed by the winner.
      userAndIdentity = await this.resolveConcurrentIdentity(identity, challengeId, error);
    }
    if (userAndIdentity.user.status !== "active") throw new UnauthorizedException({ code: "INVALID_GOOGLE_CREDENTIAL", message: "Google sign-in is unavailable for this account" });
    const token = issueAccessToken(userAndIdentity.user, { authMethod: "GOOGLE", authIdentityId: userAndIdentity.identity.id });
    return { token, accessToken: token, user: safeUser(userAndIdentity.user), returnTo: safeAuthReturnTo(input.returnTo) };
  }

  async link(user: AuthenticatedUser, input: { credential?: string; challengeId?: string; clientIp?: string }) {
    this.assertEnabled();
    this.enforceRateLimit("link", input.clientIp, 5, 15 * 60_000);
    const candidate = await this.verifier.verify(String(input.credential || ""));
    const linked = await this.prisma.$transaction(async (tx) => {
      await consumeChallenge(tx, String(input.challengeId || ""), candidate.nonce);
      const account = await tx.user.findUnique({ where: { id: user.id } });
      if (!account || account.status !== "active") throw new UnauthorizedException({ code: "INVALID_TOKEN", message: "Invalid or inactive token" });
      const existing = await tx.authIdentity.findUnique({ where: { provider_providerSubject: { provider: AuthProvider.GOOGLE, providerSubject: candidate.subject } } });
      if (existing && existing.userId !== user.id) throw new ConflictException({ code: "GOOGLE_IDENTITY_ALREADY_LINKED", message: "This Google account is already linked to another user" });
      if (existing) return existing;
      const emailOwner = await tx.user.findUnique({ where: { email: candidate.email } });
      if (emailOwner && emailOwner.id !== user.id) {
        throw new ConflictException({ code: "GOOGLE_EMAIL_ALREADY_IN_USE", message: "This Google email belongs to another account" });
      }
      const identity = await tx.authIdentity.create({ data: identityData(user.id, candidate) });
      await tx.eventLog.create({ data: { userId: user.id, eventName: "google_identity_linked", source: "auth-google", payload: { identityId: identity.id, method: "explicit" } } });
      return identity;
    });
    return { linked: true, identity: publicIdentity(linked) };
  }

  async unlink(user: AuthenticatedUser) {
    const account = await this.prisma.user.findUnique({ where: { id: user.id }, include: { authIdentities: true } });
    if (!account) throw new UnauthorizedException({ code: "INVALID_TOKEN", message: "Invalid or inactive token" });
    const identities = account.authIdentities.filter((identity) => identity.provider === AuthProvider.GOOGLE);
    if (!identities.length) throw new NotFoundException({ code: "GOOGLE_IDENTITY_NOT_FOUND", message: "No Google identity is linked" });
    const hasVerifiedPassword = Boolean(account.passwordHash && account.emailVerifiedAt);
    if (!hasVerifiedPassword && identities.length <= 1) throw new ForbiddenException({ code: "LAST_LOGIN_METHOD", message: "Add and verify another login method before unlinking Google" });
    await this.prisma.authIdentity.delete({ where: { id: identities[0].id } });
    await this.prisma.eventLog.create({ data: { userId: user.id, eventName: "google_identity_unlinked", source: "auth-google", payload: { identityId: identities[0].id } } });
    return { unlinked: true };
  }

  private async consumeAndResolve(candidate: VerifiedGoogleIdentity, challengeId: string) {
    return this.prisma.$transaction(async (tx) => {
      await consumeChallenge(tx, challengeId, candidate.nonce);
      const existing = await tx.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: AuthProvider.GOOGLE, providerSubject: candidate.subject } },
        include: { user: true }
      });
      if (existing) return { user: existing.user, identity: existing };

      const emailMatch = await tx.user.findUnique({ where: { email: candidate.email } });
      if (emailMatch) {
        if (emailMatch.status !== "active") throw new UnauthorizedException({ code: "INVALID_GOOGLE_CREDENTIAL", message: "Google sign-in is unavailable for this account" });
        if (!isGoogleAuthoritativeForEmail(candidate)) {
          throw new ConflictException({ code: "ACCOUNT_LINK_REQUIRED", message: "Sign in to the existing account before linking this Google identity" });
        }
        const identity = await tx.authIdentity.create({ data: identityData(emailMatch.id, candidate) });
        await tx.eventLog.create({ data: { userId: emailMatch.id, eventName: "google_identity_linked", source: "auth-google", payload: { identityId: identity.id, method: "authoritative-email" } } });
        return { user: emailMatch, identity };
      }

      const user = await tx.user.create({
        data: {
          openid: `google_${randomUUID()}`,
          email: candidate.email,
          emailVerifiedAt: isGoogleAuthoritativeForEmail(candidate) ? new Date() : null,
          passwordHash: null,
          nickname: candidate.name || candidate.email.split("@")[0],
          avatarUrl: candidate.picture || null,
          policyAgreedAt: new Date()
        }
      });
      const identity = await tx.authIdentity.create({ data: identityData(user.id, candidate) });
      await tx.eventLog.create({ data: { userId: user.id, eventName: "google_identity_linked", source: "auth-google", payload: { identityId: identity.id, method: "new-account" } } });
      return { user, identity };
    });
  }

  private async resolveConcurrentIdentity(candidate: VerifiedGoogleIdentity, challengeId: string, originalError: unknown) {
    return this.prisma.$transaction(async (tx) => {
      await consumeChallenge(tx, challengeId, candidate.nonce);
      const existing = await tx.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: AuthProvider.GOOGLE, providerSubject: candidate.subject } },
        include: { user: true }
      });
      if (!existing?.user) throw originalError;
      return { user: existing.user, identity: existing };
    });
  }

  private assertEnabled() {
    if (process.env.GOOGLE_AUTH_ENABLED === "false" || !String(process.env.GOOGLE_WEB_CLIENT_ID || "").trim()) {
      throw new HttpException({ code: "GOOGLE_AUTH_NOT_READY", message: "Google sign-in is not configured" }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private enforceRateLimit(action: string, clientIp: string | undefined, maximum: number, windowMs: number) {
    const key = `${action}:${clientIp || "unknown"}`;
    const now = Date.now();
    const prior = this.rateLimits.get(key);
    const bucket = prior && now - prior.startedAt < windowMs ? prior : { count: 0, startedAt: now };
    bucket.count += 1;
    this.rateLimits.set(key, bucket);
    if (bucket.count > maximum) throw new HttpException({ code: "AUTH_RATE_LIMITED", message: "Too many Google sign-in attempts; retry later" }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

async function consumeChallenge(tx: any, challengeId: string, nonce: string) {
  if (!challengeId || !nonce) throw new BadRequestException({ code: "INVALID_GOOGLE_CHALLENGE", message: "Google sign-in challenge is invalid or expired" });
  const consumed = await tx.authLoginChallenge.updateMany({
    where: { id: challengeId, provider: AuthProvider.GOOGLE, nonceHash: hashAuthSecret(nonce), consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() }
  });
  if (consumed.count !== 1) throw new UnauthorizedException({ code: "INVALID_GOOGLE_CHALLENGE", message: "Google sign-in challenge is invalid or expired" });
}

function isGoogleAuthoritativeForEmail(candidate: VerifiedGoogleIdentity) {
  return candidate.emailVerified && (candidate.email.endsWith("@gmail.com") || Boolean(candidate.hostedDomain));
}

function identityData(userId: string, candidate: VerifiedGoogleIdentity) {
  return {
    userId,
    provider: AuthProvider.GOOGLE,
    providerSubject: candidate.subject,
    providerEmail: candidate.email,
    providerEmailVerifiedAt: candidate.emailVerified ? new Date() : null,
    hostedDomain: candidate.hostedDomain,
    profileJson: { ...(candidate.name ? { name: candidate.name } : {}), ...(candidate.picture ? { picture: candidate.picture } : {}) }
  };
}

function safeUser(user: { id: string; email: string | null; emailVerifiedAt: Date | null; nickname: string | null }) {
  return { id: user.id, email: user.email, emailVerified: Boolean(user.emailVerifiedAt), nickname: user.nickname };
}

function publicIdentity(identity: { id: string; provider: AuthProvider; providerEmail: string | null }) {
  return { id: identity.id, provider: identity.provider, email: identity.providerEmail };
}

function challengeTtlMilliseconds() {
  const seconds = Number(process.env.GOOGLE_LOGIN_CHALLENGE_TTL_SECONDS || 300);
  return Math.max(60, Math.min(900, Number.isFinite(seconds) ? Math.floor(seconds) : 300)) * 1_000;
}

function isPrismaUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}
