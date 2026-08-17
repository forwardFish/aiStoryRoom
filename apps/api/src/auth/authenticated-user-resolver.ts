import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { verifyAccessToken, type AccessTokenClaims } from "./auth.service";
import type { AuthenticatedUser } from "./current-user.decorator";

export interface AuthenticatedUserResolution {
  readonly user: AuthenticatedUser;
  readonly claims: AccessTokenClaims;
}

@Injectable()
export class AuthenticatedUserResolver {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async resolveAccessToken(
    tokenValue: string | null | undefined,
  ): Promise<AuthenticatedUserResolution> {
    const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
    if (!token) {
      throw new UnauthorizedException({
        code: "AUTHENTICATION_REQUIRED",
        message: "Login required",
      });
    }

    const claims = verifyAccessToken(token);
    if (!claims) {
      throw new UnauthorizedException({
        code: "INVALID_TOKEN",
        message: "Invalid, expired, or malformed access token",
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        openid: true,
        email: true,
        emailVerifiedAt: true,
        nickname: true,
        status: true,
      },
    });
    if (
      !user
      || user.openid !== claims.openid
      || user.status !== "active"
    ) {
      throw invalidToken();
    }

    if (claims.authMethod === "PASSWORD" && !user.emailVerifiedAt) {
      throw new UnauthorizedException({
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify your email before accessing this resource",
      });
    }

    if (claims.authMethod === "GOOGLE") {
      const authIdentityId = claims.authIdentityId;
      if (!authIdentityId) throw invalidToken();
      const identity = await this.prisma.authIdentity.findUnique({
        where: { id: authIdentityId },
        select: { userId: true, provider: true },
      });
      if (
        !identity
        || identity.userId !== user.id
        || identity.provider !== "GOOGLE"
      ) {
        throw invalidToken();
      }
    }

    return Object.freeze({
      user: Object.freeze({
        id: user.id,
        openid: user.openid,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        nickname: user.nickname,
        authMethod: claims.authMethod,
        authIdentityId: claims.authIdentityId ?? null,
      }),
      claims: Object.freeze({ ...claims }),
    });
  }
}

function invalidToken(): UnauthorizedException {
  return new UnauthorizedException({
    code: "INVALID_TOKEN",
    message: "Invalid or inactive token",
  });
}
