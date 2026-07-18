import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "./current-user.decorator";

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    const userIds = splitAllowlist(process.env.ADMIN_USER_IDS);
    const emails = splitAllowlist(process.env.ADMIN_EMAILS).map((value) => value.toLowerCase());
    const allowed = Boolean(user && (userIds.includes(user.id) || (user.email && emails.includes(user.email.toLowerCase()))));
    if (!allowed) throw new ForbiddenException({ code: "ADMIN_FORBIDDEN", message: "Administrator access required" });
    return true;
  }
}

function splitAllowlist(value: string | undefined): string[] {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
