import assert from "node:assert/strict";
import test from "node:test";
import { authCookieSecure, authSessionTtlSeconds } from "./auth-session-options";

const original = { nodeEnv: process.env.NODE_ENV, publicWebUrl: process.env.PUBLIC_WEB_URL, secure: process.env.AUTH_COOKIE_SECURE, ttl: process.env.AUTH_SESSION_TTL_DAYS };
function restore() {
  for (const [key, value] of Object.entries({ NODE_ENV: original.nodeEnv, PUBLIC_WEB_URL: original.publicWebUrl, AUTH_COOKIE_SECURE: original.secure, AUTH_SESSION_TTL_DAYS: original.ttl })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

test("session cookies are Secure for production or an HTTPS public origin", () => {
  try {
    process.env.NODE_ENV = "development"; delete process.env.AUTH_COOKIE_SECURE;
    process.env.PUBLIC_WEB_URL = "https://ourmanyworlds.com";
    assert.equal(authCookieSecure(), true);
    process.env.PUBLIC_WEB_URL = "http://localhost:3000";
    assert.equal(authCookieSecure(), false);
    process.env.NODE_ENV = "production";
    assert.equal(authCookieSecure(), true);
  } finally { restore(); }
});

test("an explicit cookie-security setting overrides environment inference", () => {
  try {
    process.env.NODE_ENV = "development"; process.env.PUBLIC_WEB_URL = "http://localhost:3000";
    process.env.AUTH_COOKIE_SECURE = "true"; assert.equal(authCookieSecure(), true);
    process.env.AUTH_COOKIE_SECURE = "false"; assert.equal(authCookieSecure(), false);
  } finally { restore(); }
});

test("session lifetime is bounded between one and ninety days", () => {
  try {
    process.env.AUTH_SESSION_TTL_DAYS = "0"; assert.equal(authSessionTtlSeconds(), 86_400);
    process.env.AUTH_SESSION_TTL_DAYS = "120"; assert.equal(authSessionTtlSeconds(), 90 * 86_400);
  } finally { restore(); }
});
