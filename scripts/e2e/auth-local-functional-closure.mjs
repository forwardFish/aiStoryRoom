import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const apiBase = String(process.env.AUTH_LOCAL_API_BASE || "http://127.0.0.1:5281/api").replace(/\/$/, "");
const sinkFile = resolve(process.env.AUTH_LOCAL_MAIL_SINK || "apps/api/.auth-mail-sink.ndjson");
const evidenceFile = resolve(process.env.AUTH_LOCAL_EVIDENCE_FILE || "docs/auto-execute/evidence/auth-production-closure/local-email-auth-closure.json");
const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `codex-auth-${runId}@example.test`;
const oldPassword = `Old-${randomBytes(16).toString("base64url")}!`;
const newPassword = `New-${randomBytes(16).toString("base64url")}!`;

async function request(path, options = {}, expected = [200, 201]) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    throw new Error(`${path} returned ${response.status}: ${body.code || body.message || "unexpected response"}`);
  }
  return { response, body };
}

async function mailFor(subjectPrefix) {
  const lines = (await readFile(sinkFile, "utf8")).split(/\r?\n/).filter(Boolean);
  const messages = lines.map((line) => JSON.parse(line)).filter((message) => message.to === email && String(message.subject || "").startsWith(subjectPrefix));
  const message = messages.at(-1);
  if (!message) throw new Error(`Local ${subjectPrefix} email was not written`);
  return message;
}

function actionToken(message) {
  const match = String(message.text || "").match(/[?&]token=([^&\s]+)/);
  if (!match) throw new Error("Local transactional email did not contain an action token");
  return decodeURIComponent(match[1]);
}

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const match = values.join(",").match(/(?:^|,\s*)(many_worlds_session=[^;,\s]+)/);
  if (!match) throw new Error("Authentication response did not set the HttpOnly session cookie");
  return match[1];
}

const checks = {};

await request("/v4/auth/register", {
  method: "POST",
  body: JSON.stringify({ email, password: oldPassword, nickname: "Local Auth Acceptance" })
});
checks.registrationAccepted = true;

const verificationMail = await mailFor("Verify your email address");
checks.verificationEmailWritten = verificationMail.provider === "file-sink";
await request("/v4/auth/verify", {
  method: "POST",
  body: JSON.stringify({ token: actionToken(verificationMail) })
});
checks.emailVerificationAccepted = true;

const firstLogin = await request("/v4/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password: oldPassword })
});
checks.verifiedPasswordLoginAccepted = true;
checks.loginSetsHttpOnlyCookie = firstLogin.response.headers.get("set-cookie")?.includes("HttpOnly") === true;

await request("/v4/auth/password-reset/request", {
  method: "POST",
  body: JSON.stringify({ email })
});
const resetMail = await mailFor("Reset your password");
checks.passwordResetEmailWritten = resetMail.provider === "file-sink";
const resetToken = actionToken(resetMail);

await request("/v4/auth/password-reset/confirm", {
  method: "POST",
  body: JSON.stringify({ token: resetToken, password: newPassword })
});
checks.passwordResetAccepted = true;

await request("/v4/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password: oldPassword })
}, [401]);
checks.oldPasswordRejected = true;

const newLogin = await request("/v4/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password: newPassword })
});
checks.newPasswordLoginAccepted = true;
const cookie = sessionCookie(newLogin.response);

const me = await request("/v4/auth/me", {
  method: "GET",
  headers: { cookie }
});
checks.cookieAuthenticatesProtectedAccount = Boolean(me.body?.id) && me.body?.emailVerified === true;

await request("/v4/auth/password-reset/confirm", {
  method: "POST",
  body: JSON.stringify({ token: resetToken, password: `${newPassword}x` })
}, [401]);
checks.resetTokenReplayRejected = true;

const logout = await request("/v4/auth/logout", {
  method: "POST",
  headers: { cookie },
  body: "{}"
});
const logoutCookies = typeof logout.response.headers.getSetCookie === "function"
  ? logout.response.headers.getSetCookie().join(",")
  : String(logout.response.headers.get("set-cookie") || "");
const clearedSessionCookie = /many_worlds_session=;[^\r\n]*(?:max-age=0|expires=thu, 01 jan 1970)/i.test(logoutCookies);
const clearedHintCookie = /many_worlds_session_hint=;[^\r\n]*(?:max-age=0|expires=thu, 01 jan 1970)/i.test(logoutCookies);
checks.logoutClearsBrowserCookies = clearedSessionCookie && clearedHintCookie;

const status = Object.values(checks).every(Boolean) ? "PASS" : "REPAIR_REQUIRED";
const evidence = {
  status,
  scope: "Local functional email authentication closure using a disposable example.test account",
  apiBase,
  emailProvider: "file-sink",
  checks,
  piiRecorded: false,
  secretsRecorded: false,
  completedAt: new Date().toISOString()
};

await mkdir(dirname(evidenceFile), { recursive: true });
await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence, null, 2));
if (status !== "PASS") process.exitCode = 1;
