import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma.service";
import { AuthenticatedUserResolver } from "./authenticated-user-resolver";
import { renewSessionCookie, sessionTokenFromRequest } from "./auth-cookie";
import { PUBLIC_ROUTE_METADATA } from "./public.decorator";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly authenticatedUsers: AuthenticatedUserResolver;

  constructor(
    @Inject(PrismaService)
    authenticatedUsers: AuthenticatedUserResolver | PrismaService,
    @Optional() @Inject(Reflector)
    private readonly reflector?: Reflector,
  ) {
    // AuthGuard is also registered by feature modules that only inherit the
    // global Prisma provider. Constructing the shared resolver here keeps one
    // authentication policy without forcing every feature to import AuthModule.
    this.authenticatedUsers = hasResolver(authenticatedUsers)
      ? authenticatedUsers
      : new AuthenticatedUserResolver(authenticatedUsers);
  }

  async canActivate(context: ExecutionContext) {
    if (
      this.reflector?.getAllAndOverride<boolean>(
        PUBLIC_ROUTE_METADATA,
        [context.getHandler(), context.getClass()],
      )
    ) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const authorization = String(request.headers.authorization || "");
    const bearerToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";
    const token = sessionTokenFromRequest(request) || bearerToken;
    const authenticated = await this.authenticatedUsers.resolveAccessToken(token);

    request.user = authenticated.user;
    const response = http.getResponse?.();
    renewSessionCookie(
      response,
      authenticated.user,
      authenticated.claims,
    );
    return true;
  }
}

function hasResolver(
  value: AuthenticatedUserResolver | PrismaService,
): value is AuthenticatedUserResolver {
  return typeof (value as AuthenticatedUserResolver).resolveAccessToken
    === "function";
}
