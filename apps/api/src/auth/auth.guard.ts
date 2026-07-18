import { CanActivate, ExecutionContext, Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma.service";
import type { AuthenticatedUser } from "./current-user.decorator";
import { verifyAccessToken } from "./auth.service";
import { renewSessionCookie, sessionTokenFromRequest } from "./auth-cookie";
import { PUBLIC_ROUTE_METADATA } from "./public.decorator";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(Reflector) private readonly reflector?: Reflector
  ) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector?.getAllAndOverride<boolean>(PUBLIC_ROUTE_METADATA, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    const authorization = String(request.headers.authorization || "");
    const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const token = sessionTokenFromRequest(request) || bearerToken;
    if (!token) throw new UnauthorizedException({ code: "AUTHENTICATION_REQUIRED", message: "Login required" });

    const claims = verifyAccessToken(token);
    if (!claims) throw new UnauthorizedException({ code: "INVALID_TOKEN", message: "Invalid, expired, or malformed access token" });
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.openid !== claims.openid || user.status !== "active") {
      throw new UnauthorizedException({ code: "INVALID_TOKEN", message: "Invalid or inactive token" });
    }
    if (claims.authMethod === "PASSWORD" && !user.emailVerifiedAt) {
      throw new UnauthorizedException({ code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before accessing this resource" });
    }
    if (claims.authMethod === "GOOGLE") {
      const identity = await this.prisma.authIdentity.findUnique({ where: { id: claims.authIdentityId } });
      if (!identity || identity.userId !== user.id || identity.provider !== "GOOGLE") {
        throw new UnauthorizedException({ code: "INVALID_TOKEN", message: "Invalid or inactive token" });
      }
    }

    request.user = {
      id: user.id,
      openid: user.openid,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      nickname: user.nickname,
      authMethod: claims.authMethod,
      authIdentityId: claims.authIdentityId || null
    } satisfies AuthenticatedUser;
    const response = context.switchToHttp().getResponse?.();
    renewSessionCookie(response, user, claims);
    return true;
  }
}
