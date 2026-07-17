import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const webBase = String(process.env.AUTH_SESSION_WEB_BASE || "http://127.0.0.1:5281").replace(/\/$/, "");
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "apps/api/.auth-mail-sink.ndjson");
const evidenceFile = resolve(process.env.AUTH_SESSION_EVIDENCE_FILE || "docs/auto-execute/evidence/auth-production-closure/existing-session-reauth-local.json");
const screenshotFile = resolve(process.env.AUTH_SESSION_SCREENSHOT_FILE || "docs/auto-execute/evidence/auth-production-closure/existing-session-reauth-local.png");
const cdpPort = Number(process.env.AUTH_SESSION_CDP_PORT || 9344);
const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `codex-session-${runId}@example.test`;
const password = `Session-${randomBytes(18).toString("base64url")}!`;
const profile = await mkdtemp(join(tmpdir(), "many-worlds-session-live-"));
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function request(path, options = {}, expected = [200, 201]) {
  const response = await fetch(`${webBase}/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) throw new Error(`${path} returned ${response.status}: ${body.code || body.message || "unexpected response"}`);
  return body;
}

async function verificationToken() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = (await readFile(mailSink, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const message = rows.reverse().find((row) => row.to === email && String(row.subject || "").startsWith("Verify your email address"));
    const match = String(message?.text || "").match(/[?&]token=([^&\s]+)/);
    if (match) return decodeURIComponent(match[1]);
    await sleep(100);
  }
  throw new Error("Verification email was not written to the local file sink");
}

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; this.requests = []; }
  static async connect(url) {
    const socket = new WebSocket(url);
    const cdp = new Cdp(socket);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", resolveOpen, { once:true });
      socket.addEventListener("error", reject, { once:true });
    });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params?.exceptionDetails?.exception?.description || data.params?.exceptionDetails?.text || "Runtime exception");
      if (data.method === "Network.requestWillBeSent") cdp.requests.push(data.params?.request?.url || "");
      const pending = cdp.pending.get(data.id);
      if (!pending) return;
      cdp.pending.delete(data.id);
      data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, reject) => this.pending.set(id, { resolve:resolveSend, reject }));
  }
  close() { this.socket.close(); }
}

await request("/v4/auth/register", { method:"POST", body:JSON.stringify({ email, password, nickname:"Session Acceptance" }) });
await request("/v4/auth/verify", { method:"POST", body:JSON.stringify({ token:await verificationToken() }) });

await mkdir(dirname(evidenceFile), { recursive:true });
const chrome = spawn(chromePath, [
  `--remote-debugging-port=${cdpPort}`,
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio:"ignore" });

let cdp;
try {
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const page = (await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`)).find((entry) => entry.type === "page");
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width:1440, height:1000, deviceScaleFactor:1, mobile:false });
  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise:true, returnByValue:true, userGesture:true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = async (expression, label, timeout = 30_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  await cdp.send("Page.navigate", { url:`${webBase}/auth?mode=login&returnTo=%2Faccount` });
  await wait("Boolean(document.querySelector('[data-auth-form]'))", "login form");
  await evaluate(`(() => {
    const fill = (name, value) => { const input = document.querySelector('[name="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles:true })); };
    fill('email', ${JSON.stringify(email)});
    fill('password', ${JSON.stringify(password)});
    document.querySelector('[data-auth-form]').requestSubmit();
    return true;
  })()`);
  await wait("location.pathname === '/account' && Boolean(document.querySelector('.account-profile-copy'))", "signed-in account page");
  const cookieAfterLogin = await evaluate("document.cookie");

  cdp.requests = [];
  const legacyUrl = `${webBase}/auth?mode=login&reauth=1&returnTo=%2Faccount`;
  await cdp.send("Page.navigate", { url:legacyUrl });
  await wait("location.pathname === '/account' && Boolean(document.querySelector('.account-profile-copy'))", "session-first redirect from legacy reauth URL");
  await sleep(300);
  const pageState = await evaluate(`({
    path:location.pathname,
    hasAuthForm:Boolean(document.querySelector('[data-auth-form]')),
    hasGoogleButton:Boolean(document.querySelector('[data-google-signin]')),
    hasAccountProfile:Boolean(document.querySelector('.account-profile-copy')),
    cookie:document.cookie
  })`);
  const shot = await cdp.send("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:false });
  await writeFile(screenshotFile, Buffer.from(shot.data, "base64"));

  const authRequests = cdp.requests.filter((url) => url.includes("/api/v4/auth/"));
  const checks = {
    loginCreatedCookieHint:cookieAfterLogin.includes("many_worlds_session_hint=1"),
    legacyReauthUrlLeavesLoginPage:pageState.path === "/account",
    loginFormIsNotRendered:pageState.hasAuthForm === false,
    googleButtonIsNotRendered:pageState.hasGoogleButton === false,
    accountPageIsRendered:pageState.hasAccountProfile === true,
    existingSessionWasValidated:authRequests.some((url) => url.includes("/api/v4/auth/me")),
    googleChallengeWasNotRequested:authRequests.every((url) => !url.includes("/api/v4/auth/google/challenge")),
    noRuntimeExceptions:cdp.exceptions.length === 0
  };
  const report = {
    status:Object.values(checks).every(Boolean) ? "PASS" : "REPAIR_REQUIRED",
    scope:"Existing Many Worlds Cookie session takes priority over legacy reauth login URLs",
    route:legacyUrl,
    accountType:"disposable example.test acceptance account",
    fixtureOnly:false,
    pageState:{ ...pageState, cookie:"many_worlds_session_hint=1" },
    authRequests:authRequests.map((url) => new URL(url).pathname),
    checks,
    runtimeExceptions:cdp.exceptions,
    screenshot:screenshotFile,
    completedAt:new Date().toISOString()
  };
  await writeFile(evidenceFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
} finally {
  try { await cdp?.send("Browser.close"); } catch {}
  cdp?.close();
  if (chrome.exitCode === null) chrome.kill();
  await rm(profile, { recursive:true, force:true }).catch(() => {});
}
