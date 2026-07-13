import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import type { AuthenticatedUser } from "./current-user.decorator";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authorization = String(request.headers.authorization || "");
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) throw new UnauthorizedException({ code: "AUTHENTICATION_REQUIRED", message: "Bearer token required" });

    const user = await this.prisma.user.findUnique({ where: { openid: token } });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException({ code: "INVALID_TOKEN", message: "Invalid or inactive token" });
    }

    request.user = {
      id: user.id,
      openid: user.openid,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      nickname: user.nickname
    } satisfies AuthenticatedUser;
    return true;
  }
}
