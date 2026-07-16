import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/current-user.decorator";

export function configuredAdminEmails(environment: NodeJS.ProcessEnv = process.env) {
  return new Set(String(environment.ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

@Injectable()
export class BillingAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    const admins = configuredAdminEmails();
    if (!user?.email || admins.size === 0 || !admins.has(user.email.toLowerCase())) {
      throw new ForbiddenException({ code: "ADMIN_REQUIRED", message: "An authorized administrator account is required" });
    }
    return true;
  }
}
