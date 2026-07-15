import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface AuthenticatedUser {
  id: string;
  openid: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  nickname: string | null;
  authMethod: "PASSWORD" | "GOOGLE";
  authIdentityId: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => ctx.switchToHttp().getRequest().user
);
