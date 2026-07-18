import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(resolve(root, ".env")); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const apiPort = Number(process.env.AUTH_E2E_API_PORT || 3118);
const webPort = Number(process.env.AUTH_E2E_WEB_PORT || 3000);
const webBase = `http://localhost:${webPort}`;
const artifactDir = resolve(root, "docs/auto-execute/evidence/auth-local-closure");
const mailSink = resolve(artifactDir, "mail-sink.ndjson");
const resultFile = resolve(artifactDir, "local-email-cookie.json");
const googleClientId = String(process.env.GOOGLE_WEB_CLIENT_ID || "local-auth-closure.apps.googleusercontent.com").trim();
const syntheticEmail = `auth-local-${Date.now()}@example.test`;
const originalPassword = "Local-auth-12345";
const replacementPassword = "Local-reset-67890";
const children = [];
const steps = [];

await mkdir(artifactDir, { recursive: true });
await rm(mailSink, { force: true });

try {
  children.push(start("api", process.execPath, ["../../node_modules/tsx/dist/cli.mjs", "src/main.ts"], {
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    NODE_ENV: "development",
    EMAIL_PROVIDER: "file-sink",
    AUTH_MAIL_SINK_FILE: mailSink,
    PUBLIC_WEB_URL: webBase,
    STORY_WORKER_ENABLED: "false",
    GOOGLE_AUTH_ENABLED: "true",
    GOOGLE_WEB_CLIENT_ID: googleClientId
  }, resolve(root, "apps/api")));
  children.push(start("web", process.execPath, ["apps/web/src/server.mjs"], {
    PORT: String(webPort),
    API_PORT: String(apiPort),
    PUBLIC_GOOGLE_WEB_CLIENT_ID: googleClientId
  }));

  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`, 45_000);
  await waitForHttp(`${webBase}/auth?mode=login&reauth=1`, 20_000);
  pass("local_servers", { apiPort, webPort });

  const authHtml = await fetchText(`${webBase}/auth?mode=login&reauth=1`);
  const platformSource = await fetchText(`${webBase}/platform.js`);
  const runtimeSource = await fetchText(`${webBase}/runtime-config.js`);
  assert(authHtml.includes("/runtime-config.js"), "auth page must load runtime config");
  assert(platformSource.includes("data-google-signin"), "auth renderer must expose the Google sign-in mount");
  assert(runtimeSource.includes(googleClientId), "local runtime must expose the configured public Google client id");
  pass("auth_surface", { googleMount: true, runtimeConfigured: true });

  const registered = await api("/api/v4/auth/register", {
    method: "POST",
    body: { email: syntheticEmail, password: originalPassword, nickname: "Local Auth Closure", returnTo: "/rooms" }
  });
  expectStatus(registered, 201, "register");
  assert(registered.body.accepted === true && registered.body.verificationRequired === true, "registration must require verification");
  assert(!("verificationToken" in registered.body), "registration must not expose a verification token");
  pass("register", { status: registered.status, verificationRequired: true });

  const loginBeforeVerification = await api("/api/v4/auth/login", {
    method: "POST",
    body: { email: syntheticEmail, password: originalPassword }
  });
  expectStatus(loginBeforeVerification, 401, "login before verification");
  assert(loginBeforeVerification.body.code === "EMAIL_VERIFICATION_REQUIRED", "unverified login must be rejected");
  pass("unverified_login_rejected", { status: loginBeforeVerification.status, code: loginBeforeVerification.body.code });

  const verificationMail = await waitForMail("Verify your Many Worlds email");
  const verificationUrl = extractUrl(verificationMail.text);
  assert(verificationUrl.origin === webBase, "verification mail must target the local Web origin");
  assert(verificationUrl.pathname === "/auth", "verification mail must target the auth page");
  const verificationToken = verificationUrl.searchParams.get("token");
  assert(verificationToken, "verification mail must contain a token");
  pass("verification_mail", { provider: verificationMail.provider, localOrigin: true, tokenExposedByApi: false });

  const verified = await api("/api/v4/auth/verify", {
    method: "POST",
    body: { token: verificationToken }
  });
  expectStatus(verified, 201, "verify email");
  const verifiedCookie = cookieHeader(verified.setCookies);
  assertSessionCookieContract(verified.setCookies, "verification");
  pass("verify", { status: verified.status, sessionCookie: "HttpOnly", hintCookie: true });

  const verifiedMe = await api("/api/v4/auth/me", { cookie: verifiedCookie });
  expectStatus(verifiedMe, 200, "verified session /me");
  assert(verifiedMe.body.email === syntheticEmail, "verified session must belong to the new user");
  pass("verification_session", { status: verifiedMe.status });

  const logout = await api("/api/v4/auth/logout", { method: "POST", cookie: verifiedCookie, body: {} });
  expectStatus(logout, 201, "logout");
  assertClearedCookies(logout.setCookies, "logout");
  pass("logout", { status: logout.status, cookiesCleared: true });

  const loggedIn = await api("/api/v4/auth/login", {
    method: "POST",
    body: { email: syntheticEmail, password: originalPassword }
  });
  expectStatus(loggedIn, 201, "login after verification");
  const loginCookie = cookieHeader(loggedIn.setCookies);
  assertSessionCookieContract(loggedIn.setCookies, "login");
  pass("login", { status: loggedIn.status, sessionCookie: "HttpOnly", maxAgeDays: 30 });

  const firstRefresh = await api("/api/v4/auth/me", { cookie: loginCookie });
  const reopenedSession = await api("/api/v4/auth/me", { cookie: loginCookie });
  expectStatus(firstRefresh, 200, "session refresh");
  expectStatus(reopenedSession, 200, "session reopen");
  assert(firstRefresh.body.id === reopenedSession.body.id, "the same cookie must restore the same account");
  pass("cookie_persistence", { refresh: true, reopen: true, sameUser: true });

  const resetRequested = await api("/api/v4/auth/password-reset/request", {
    method: "POST",
    body: { email: syntheticEmail }
  });
  expectStatus(resetRequested, 201, "request password reset");
  assert(resetRequested.body.accepted === true && !("resetToken" in resetRequested.body), "reset request must not expose a token");
  const resetMail = await waitForMail("Reset your Many Worlds password");
  const resetUrl = extractUrl(resetMail.text);
  assert(resetUrl.origin === webBase && resetUrl.pathname === "/reset-password", "reset mail must target the local reset page");
  const resetToken = resetUrl.searchParams.get("token");
  assert(resetToken, "reset mail must contain a token");
  pass("reset_mail", { provider: resetMail.provider, localOrigin: true, tokenExposedByApi: false });

  const resetConfirmed = await api("/api/v4/auth/password-reset/confirm", {
    method: "POST",
    cookie: loginCookie,
    body: { token: resetToken, password: replacementPassword }
  });
  expectStatus(resetConfirmed, 201, "confirm password reset");
  assert(resetConfirmed.body.reset === true, "reset confirmation must succeed");
  assertClearedCookies(resetConfirmed.setCookies, "password reset");
  pass("reset_confirm", { status: resetConfirmed.status, currentBrowserCookiesCleared: true });

  const oldPasswordRejected = await api("/api/v4/auth/login", {
    method: "POST",
    body: { email: syntheticEmail, password: originalPassword }
  });
  expectStatus(oldPasswordRejected, 401, "old password after reset");
  assert(oldPasswordRejected.body.code === "INVALID_CREDENTIALS", "the old password must stop working");
  pass("old_password_rejected", { status: oldPasswordRejected.status });

  const resetReplay = await api("/api/v4/auth/password-reset/confirm", {
    method: "POST",
    body: { token: resetToken, password: "Replay-password-123" }
  });
  expectStatus(resetReplay, 401, "reset token replay");
  assert(resetReplay.body.code === "INVALID_RESET_TOKEN", "a reset token must be one-time use");
  pass("reset_replay_rejected", { status: resetReplay.status });

  const newPasswordLogin = await api("/api/v4/auth/login", {
    method: "POST",
    body: { email: syntheticEmail, password: replacementPassword }
  });
  expectStatus(newPasswordLogin, 201, "new password login");
  const replacementCookie = cookieHeader(newPasswordLogin.setCookies);
  assertSessionCookieContract(newPasswordLogin.setCookies, "new-password login");
  const finalMe = await api("/api/v4/auth/me", { cookie: replacementCookie });
  expectStatus(finalMe, 200, "new password session");
  pass("new_password_login", { status: newPasswordLogin.status, sessionRestored: true });

  const challenge = await api("/api/v4/auth/google/challenge", {
    method: "POST",
    headers: { "x-requested-with": "many-worlds-web" },
    body: {}
  });
  expectStatus(challenge, 201, "Google challenge");
  assert(typeof challenge.body.challengeId === "string" && typeof challenge.body.nonce === "string", "Google challenge must be nonce-bound");
  assert(!challenge.body.challengeId.includes(challenge.body.nonce), "challenge id and nonce must be distinct");
  pass("google_challenge", { status: challenge.status, nonceBound: true });

  await api("/api/v4/auth/logout", { method: "POST", cookie: replacementCookie, body: {} });

  const result = {
    status: "PASS",
    scope: "local email authentication, password reset, cookie session, and Google challenge",
    webBase,
    apiBase: `http://127.0.0.1:${apiPort}/api`,
    syntheticEmail,
    steps,
    secretsRecorded: false,
    completedAt: new Date().toISOString()
  };
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: result.status, evidence: resultFile, stepCount: steps.length, syntheticEmail }, null, 2));
} catch (error) {
  const failure = {
    status: "FAIL",
    syntheticEmail,
    steps,
    error: error instanceof Error ? error.message : String(error),
    childLogs: Object.fromEntries(children.map((child) => [child.name, child.logs.slice(-12)])),
    completedAt: new Date().toISOString()
  };
  await writeFile(resultFile, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  await Promise.all(children.map(stop));
  await rm(mailSink, { force: true });
}

function start(name, command, args, overrides, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...overrides },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const record = { name, child, logs: [] };
  child.stdout.on("data", (chunk) => record.logs.push(...String(chunk).split(/\r?\n/).filter(Boolean)));
  child.stderr.on("data", (chunk) => record.logs.push(...String(chunk).split(/\r?\n/).filter(Boolean)));
  child.on("error", (error) => record.logs.push(`process error: ${error.message}`));
  return record;
}

async function stop(record) {
  if (!record?.child || record.child.exitCode !== null) return;
  record.child.kill();
  await delay(250);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response.text();
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(`${webBase}${path}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual"
  });
  const body = await response.json().catch(() => ({}));
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return { status: response.status, body, setCookies };
}

async function waitForMail(subject) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(mailSink, "utf8");
      const messages = content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const message = messages.find((item) => item.to === syntheticEmail && item.subject === subject);
      if (message) return message;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for local mail: ${subject}`);
}

function extractUrl(text) {
  const match = String(text || "").match(/https?:\/\/\S+/);
  if (!match) throw new Error("Local mail did not contain a URL");
  return new URL(match[0]);
}

function cookieHeader(setCookies) {
  const values = new Map();
  for (const line of setCookies) {
    for (const name of ["many_worlds_session", "many_worlds_session_hint"]) {
      const match = String(line).match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
      if (match && match[1]) values.set(name, match[1]);
    }
  }
  assert(values.has("many_worlds_session"), "response must issue the HttpOnly session cookie");
  assert(values.has("many_worlds_session_hint"), "response must issue the non-sensitive session hint cookie");
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

function assertSessionCookieContract(setCookies, stage) {
  const session = setCookies.find((line) => String(line).startsWith("many_worlds_session="));
  const hint = setCookies.find((line) => String(line).startsWith("many_worlds_session_hint="));
  assert(session, `${stage} must set many_worlds_session`);
  assert(/HttpOnly/i.test(session), `${stage} session cookie must be HttpOnly`);
  assert(/SameSite=Lax/i.test(session), `${stage} session cookie must use SameSite=Lax`);
  assert(/Path=\//i.test(session), `${stage} session cookie must use Path=/`);
  assert(!/Secure/i.test(session), `${stage} local HTTP cookie must not be Secure`);
  assert(hint && !/HttpOnly/i.test(hint), `${stage} hint cookie must stay readable by the UI`);
  assert(/Max-Age=2592000/i.test(session), `${stage} session cookie must persist for 30 days`);
}

function assertClearedCookies(setCookies, stage) {
  const combined = setCookies.join("\n");
  for (const name of ["many_worlds_session", "many_worlds_session_hint"]) {
    assert(combined.includes(`${name}=`), `${stage} must clear ${name}`);
  }
  const clearedCount = setCookies.filter((line) => /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(String(line))).length;
  assert(clearedCount >= 2, `${stage} must expire both browser cookies`);
}

function expectStatus(response, expected, stage) {
  if (response.status !== expected) {
    throw new Error(`${stage} expected HTTP ${expected}, received ${response.status} (${response.body.code || response.body.message || "unknown"})`);
  }
}

function pass(name, evidence) {
  steps.push({ name, status: "PASS", evidence });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
