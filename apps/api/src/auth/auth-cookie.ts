import { issueAccessToken, type AccessTokenClaims } from "./auth.service";
import { authCookieSecure, authSessionTtlSeconds } from "./auth-session-options";

export const AUTH_SESSION_COOKIE = "many_worlds_session";
export const AUTH_SESSION_HINT_COOKIE = "many_worlds_session_hint";

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
};

export function issueSessionCookie(response: CookieResponse | undefined, token: string) {
  if (!response) return;
  const maxAge = authSessionTtlSeconds() * 1_000;
  response.cookie(AUTH_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge
  });
  // This value is intentionally non-sensitive. It only lets the UI avoid a
  // needless redirect; every protected request is still authenticated by the
  // HttpOnly session cookie on the server.
  response.cookie(AUTH_SESSION_HINT_COOKIE, "1", {
    httpOnly: false,
    secure: authCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge
  });
}

export function clearSessionCookies(response: CookieResponse | undefined) {
  if (!response) return;
  const options = { secure: authCookieSecure(), sameSite: "lax" as const, path: "/" };
  response.clearCookie(AUTH_SESSION_COOKIE, options);
  response.clearCookie(AUTH_SESSION_HINT_COOKIE, options);
}

export function sessionTokenFromRequest(request: { headers?: Record<string, string | string[] | undefined> }) {
  const header = request.headers?.cookie;
  const source = Array.isArray(header) ? header.join(";") : String(header || "");
  for (const item of source.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === AUTH_SESSION_COOKIE) {
      try { return decodeURIComponent(value.join("=")); } catch { return ""; }
    }
  }
  return "";
}

export function renewSessionCookie(response: CookieResponse | undefined, user: { id: string; openid: string }, claims: AccessTokenClaims) {
  const token = issueAccessToken(user, { authMethod: claims.authMethod, authIdentityId: claims.authIdentityId });
  issueSessionCookie(response, token);
}
