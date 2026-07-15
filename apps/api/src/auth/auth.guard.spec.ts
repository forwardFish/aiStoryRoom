import assert from "node:assert/strict";
import { AuthGuard } from "./auth.guard";
import { issueAccessToken } from "./auth.service";
import { AUTH_SESSION_COOKIE } from "./auth-cookie";

const passwordUser = { id: "password-user", openid: "local_password-user", email: "pending@example.test", emailVerifiedAt: null, nickname: "Pending", status: "active" };
const googleUser = { id: "google-user", openid: "google_google-user", email: "third-party@example.test", emailVerifiedAt: null, nickname: "Google", status: "active" };

async function run() {
  const unverifiedGuard = new AuthGuard({
    user: { findUnique: async () => passwordUser },
    authIdentity: { findUnique: async () => null }
  } as any);
  const pendingToken = issueAccessToken(passwordUser);
  await assert.rejects(() => unverifiedGuard.canActivate(context(pendingToken).context as any), hasCode("EMAIL_VERIFICATION_REQUIRED"));

  const googleGuard = new AuthGuard({
    user: { findUnique: async ({ where }: any) => where.id === googleUser.id ? googleUser : null },
    authIdentity: { findUnique: async ({ where }: any) => where.id === "identity-google" ? { id: "identity-google", userId: googleUser.id, provider: "GOOGLE" } : null }
  } as any);
  const googleToken = issueAccessToken(googleUser, { authMethod: "GOOGLE", authIdentityId: "identity-google" });
  const request = context(googleToken);
  assert.equal(await googleGuard.canActivate(request.context as any), true);
  assert.equal(request.request.user.authMethod, "GOOGLE");

  const cookieResponse: any = { cookies: [], cookie(name: string, value: string, options: any) { this.cookies.push({ name, value, options }); } };
  const cookieRequest = context("", { cookie: `${AUTH_SESSION_COOKIE}=${encodeURIComponent(googleToken)}` }, cookieResponse);
  assert.equal(await googleGuard.canActivate(cookieRequest.context as any), true);
  assert.equal(cookieRequest.request.user.authMethod, "GOOGLE");
  assert.equal(cookieResponse.cookies.some((item: any) => item.name === AUTH_SESSION_COOKIE && item.options.httpOnly === true), true);

  const revokedGuard = new AuthGuard({
    user: { findUnique: async () => googleUser },
    authIdentity: { findUnique: async () => null }
  } as any);
  await assert.rejects(() => revokedGuard.canActivate(context(googleToken).context as any), hasCode("INVALID_TOKEN"));
  console.log("auth guard verification and Google identity assertions passed");
}

function context(token: string, extraHeaders: Record<string, string> = {}, response: any = undefined) {
  const request: any = { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders } };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } };
}

function hasCode(code: string) { return (error: any) => error?.getResponse?.()?.code === code; }

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
