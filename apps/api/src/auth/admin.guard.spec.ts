import assert from "node:assert/strict";
import { AdminGuard } from "./admin.guard";

const guard = new AdminGuard();
const previous = process.env.ADMIN_USER_IDS;
try {
  process.env.ADMIN_USER_IDS = "admin-1";
  assert.equal(guard.canActivate(context("admin-1") as any), true);
  assert.throws(() => guard.canActivate(context("member-1") as any), (error: any) => error?.getResponse?.()?.code === "ADMIN_FORBIDDEN");
  console.log("admin guard allowlist: PASS");
} finally {
  if (previous === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = previous;
}

function context(id: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ user: { id, email: `${id}@example.test` } }) }) };
}
