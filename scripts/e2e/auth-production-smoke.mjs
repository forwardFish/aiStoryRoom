import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const configuredBaseUrl = String(process.env.AUTH_PRODUCTION_BASE_URL || "https://ourmanyworlds.com").trim();
const baseUrl = normalizePublicOrigin(configuredBaseUrl);
const artifactFile = resolve(root, "docs/auto-execute/evidence/auth-production-closure/production-smoke.json");
const checks = [];

try {
  const authPage = await request("/auth?mode=login&reauth=1");
  expectStatus(authPage, 200, "auth page");
  assert(authPage.text.includes("/runtime-config.js"), "auth page must load the public runtime configuration");

  const csp = String(authPage.response.headers.get("content-security-policy") || "");
  const coop = String(authPage.response.headers.get("cross-origin-opener-policy") || "");
  assert(csp.includes("https://accounts.google.com/gsi/client"), "CSP must allow the Google Identity Services script");
  assert(csp.includes("frame-src") && csp.includes("https://accounts.google.com/"), "CSP must allow the Google sign-in frame");
  assert(coop.toLowerCase() === "same-origin-allow-popups", "Google popup login requires same-origin-allow-popups");
  pass("auth_surface_and_headers", { status: authPage.response.status, googleCsp: true, popupCoop: true });

  const runtimeConfig = await request("/runtime-config.js");
  expectStatus(runtimeConfig, 200, "runtime config");
  assert(/googleWebClientId\s*:\s*["'][^"']+\.apps\.googleusercontent\.com["']/.test(runtimeConfig.text), "runtime config must contain a public Google Web client ID");
  assert(!/(clientSecret|googleClientSecret|privateKey|apiKey)\s*[:=]/i.test(runtimeConfig.text), "runtime config must not expose a private credential");
  pass("public_google_configuration", { status: runtimeConfig.response.status, clientIdConfigured: true, privateCredentialExposed: false });

  const anonymousMe = await request("/api/v4/auth/me", { expectJson: true });
  expectStatus(anonymousMe, 401, "anonymous auth/me");
  assert(anonymousMe.body?.code === "AUTHENTICATION_REQUIRED", "anonymous auth/me must reject access explicitly");
  assertNoSessionCookie(anonymousMe.response, "anonymous auth/me");
  pass("anonymous_session_rejected", { status: anonymousMe.response.status, code: anonymousMe.body.code, sessionCookieIssued: false });

  const challenge = await request("/api/v4/auth/google/challenge", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "many-worlds-web" },
    body: "{}",
    expectJson: true
  });
  expectStatus(challenge, 201, "Google challenge");
  assert(typeof challenge.body?.challengeId === "string" && challenge.body.challengeId.length >= 16, "Google challenge ID is missing");
  assert(typeof challenge.body?.nonce === "string" && challenge.body.nonce.length >= 32, "Google nonce is missing");
  assert(challenge.body.challengeId !== challenge.body.nonce, "Google challenge ID and nonce must be distinct");
  assert(!Number.isNaN(Date.parse(String(challenge.body?.expiresAt || ""))), "Google challenge expiry is missing");
  assert(!containsForbiddenResponseKey(challenge.body), "Google challenge response contains a forbidden credential field");
  assertNoSessionCookie(challenge.response, "Google challenge");
  pass("google_challenge", {
    status: challenge.response.status,
    challengeIdPresent: true,
    noncePresent: true,
    expiryPresent: true,
    credentialFieldExposed: false,
    valuesRecorded: false
  });

  const syntheticMissingEmail = `auth-production-smoke-${Date.now()}-${randomUUID()}@example.invalid`;
  const resetRequest = await request("/api/v4/auth/password-reset/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: syntheticMissingEmail }),
    expectJson: true
  });
  expectStatus(resetRequest, 201, "missing-account password reset");
  assert(resetRequest.body?.accepted === true, "password reset must use the accepted response for a missing account");
  assert(Object.keys(resetRequest.body || {}).sort().join(",") === "accepted", "password reset response must not enumerate or expose reset data");
  assertNoSessionCookie(resetRequest.response, "password reset request");
  pass("password_reset_non_enumeration", {
    status: resetRequest.response.status,
    accepted: true,
    responseShape: ["accepted"],
    realMailboxUsed: false,
    sessionCookieIssued: false
  });

  const result = {
    status: "PASS",
    scope: "Production authentication public configuration, security headers, anonymous boundary, Google challenge, and password-reset non-enumeration",
    baseUrl,
    checks,
    manualAcceptanceStillRequired: [
      "Real inbox verification and password-reset replay rejection",
      "Google first and repeat login with two real accounts",
      "Cookie persistence and logout in a real browser",
      "Google login from a real room invitation with return context preserved"
    ],
    sensitiveValuesRecorded: false,
    completedAt: new Date().toISOString()
  };
  await persist(result);
  console.log(JSON.stringify({ status: result.status, evidence: artifactFile, checkCount: checks.length, sensitiveValuesRecorded: false }, null, 2));
} catch (error) {
  const failure = {
    status: "FAIL",
    scope: "Production authentication smoke",
    baseUrl,
    checks,
    error: error instanceof Error ? error.message : String(error),
    sensitiveValuesRecorded: false,
    completedAt: new Date().toISOString()
  };
  await persist(failure);
  console.error(JSON.stringify({ status: failure.status, evidence: artifactFile, error: failure.error, sensitiveValuesRecorded: false }, null, 2));
  process.exitCode = 1;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(new URL(path, `${baseUrl}/`), {
      method: options.method || "GET",
      headers: { "user-agent": "Many-Worlds-Auth-Production-Smoke/1.0", ...(options.headers || {}) },
      body: options.body,
      redirect: "follow",
      signal: controller.signal
    });
    const text = await response.text();
    const body = options.expectJson ? parseJson(text, path) : null;
    return { response, text, body };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return JSON`);
  }
}

function normalizePublicOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("AUTH_PRODUCTION_BASE_URL must be an HTTPS origin");
  }
  return url.origin;
}

function containsForbiddenResponseKey(value) {
  const forbidden = new Set(["token", "accesstoken", "refreshtoken", "credential", "password", "authorization", "cookie", "googlesubject", "subject", "sub"]);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => forbidden.has(key.toLowerCase()) || containsForbiddenResponseKey(child));
}

function assertNoSessionCookie(response, stage) {
  const setCookie = String(response.headers.get("set-cookie") || "");
  assert(!/many_worlds_session=/i.test(setCookie), `${stage} must not issue an authenticated session cookie`);
}

function expectStatus(result, expected, stage) {
  if (result.response.status !== expected) throw new Error(`${stage} expected HTTP ${expected}, received ${result.response.status}`);
}

function pass(name, evidence) {
  checks.push({ name, status: "PASS", evidence });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function persist(result) {
  await mkdir(dirname(artifactFile), { recursive: true });
  await writeFile(artifactFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
