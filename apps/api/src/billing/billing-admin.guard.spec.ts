import assert from "node:assert/strict";
import test from "node:test";
import { BillingAdminGuard, configuredAdminEmails } from "./billing-admin.guard";

function context(email: string | null) {
  return { switchToHttp: () => ({ getRequest: () => ({ user: { email } }) }) } as any;
}

test("admin allowlist is normalized and fails closed when empty", () => {
  assert.deepEqual([...configuredAdminEmails({ ADMIN_EMAILS:" Admin@Example.com, support@example.com " } as any)], ["admin@example.com", "support@example.com"]);
  const previous = process.env.ADMIN_EMAILS;
  try {
    delete process.env.ADMIN_EMAILS;
    assert.throws(() => new BillingAdminGuard().canActivate(context("admin@example.com")), (error: any) => error?.response?.code === "ADMIN_REQUIRED");
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = previous;
  }
});

test("admin guard authorizes only an exact configured login email", () => {
  const previous = process.env.ADMIN_EMAILS;
  try {
    process.env.ADMIN_EMAILS = "admin@example.com";
    assert.equal(new BillingAdminGuard().canActivate(context("ADMIN@example.com")), true);
    assert.throws(() => new BillingAdminGuard().canActivate(context("other@example.com")), (error: any) => error?.response?.code === "ADMIN_REQUIRED");
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = previous;
  }
});
