import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(".");
const baseUrl = new URL(process.env.AUTH_PRODUCTION_BASE_URL || "https://ourmanyworlds.com").origin;
const email = String(process.env.AUTH_ACCEPTANCE_EMAIL || "").trim();
const password = String(process.env.AUTH_ACCEPTANCE_PASSWORD || "");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const evidenceDir = join(root, "docs", "auto-execute", "evidence", "auth-production-closure");
const profile = join(root, ".runtime", `chrome-auth-cookie-${Date.now()}`);
const port = Number(process.env.AUTH_ACCEPTANCE_CDP_PORT || 9471);
if (!email.endsWith("@example.test") || !password || !existsSync(chromePath)) throw new Error("A non-personal @example.test account, password, and Chrome are required");

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function cdpJson(path) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}${path}`); if (response.ok) return response.json(); } catch {}
    await sleep(100);
  }
  throw new Error(`CDP did not start on port ${port}`);
}

class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) {
    const socket = new WebSocket(url); const client = new Cdp(socket);
    await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") client.exceptions.push(data.params.exceptionDetails.text || "runtime exception");
      const pending = client.pending.get(data.id); if (!pending) return;
      client.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return client;
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveSend, reject) => this.pending.set(id, { resolve: resolveSend, reject })); }
  close() { this.socket.close(); }
}

class ChromeSession {
  async start() {
    this.process = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    await cdpJson("/json/version");
    const page = (await cdpJson("/json/list")).find((entry) => entry.type === "page");
    this.cdp = await Cdp.connect(page.webSocketDebuggerUrl); await this.cdp.send("Page.enable"); await this.cdp.send("Runtime.enable");
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }
  async evaluate(expression) { const result = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser expression failed"); return result.result?.value; }
  async navigate(path) { await this.cdp.send("Page.navigate", { url: new URL(path, baseUrl).href }); }
  async wait(expression, label, timeout = 45_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await this.evaluate(expression)) return; await sleep(125); } throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await this.evaluate("({href:location.href,text:document.body?.innerText?.slice(0,900)})"))}`); }
  async click(selector, label) { const clicked = await this.evaluate(`(() => {const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled)return false;node.click();return true;})()`); if (!clicked) throw new Error(`Cannot click ${label}`); }
  async screenshot(name) { const shot = await this.cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }); await writeFile(join(evidenceDir, name), Buffer.from(shot.data, "base64")); }
  async close() {
    try { await this.cdp.send("Browser.close"); } catch {}
    this.cdp.close();
    for (let attempt = 0; attempt < 80 && this.process.exitCode === null; attempt += 1) await sleep(100);
    if (this.process.exitCode === null) this.process.kill();
  }
}

await mkdir(evidenceDir, { recursive: true });
const result = { status: "RUNNING", scope: "Production cookie persistence and logout using a non-personal acceptance account", baseUrl, accountType: "example.test acceptance account", startedAt: new Date().toISOString(), sensitiveValuesRecorded: false };
let browser = new ChromeSession();
try {
  await browser.start();
  await browser.navigate(`/auth?mode=login&reauth=1&returnTo=${encodeURIComponent("/account")}`);
  await browser.wait("Boolean(document.querySelector('[data-auth-form]'))", "production login form", 60_000);
  await browser.evaluate(`(() => {const set=(name,value)=>{const field=document.querySelector('[name="'+name+'"]');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));};set('email',${JSON.stringify(email)});set('password',${JSON.stringify(password)});document.querySelector('[data-auth-form]').requestSubmit();return true;})()`);
  await browser.wait("location.pathname === '/account' && document.body.innerText.includes('My Account')", "authenticated account page", 60_000);
  await browser.screenshot("cookie-login-account.png");
  await browser.cdp.send("Page.reload", { ignoreCache: true });
  await browser.wait("location.pathname === '/account' && document.body.innerText.includes('My Account')", "session after refresh", 30_000);
  result.login = "PASS"; result.refreshPersistence = "PASS"; result.runtimeExceptionsBeforeRestart = browser.cdp.exceptions;
  await browser.close();

  browser = new ChromeSession(); await browser.start(); await browser.navigate("/account");
  await browser.wait("location.pathname === '/account' && document.body.innerText.includes('My Account')", "session after browser restart", 45_000);
  await browser.screenshot("cookie-restart-account.png"); result.browserRestartPersistence = "PASS";
  await browser.click('[data-action="account-logout"]', "Log out");
  await browser.wait("location.pathname === '/'", "logout return", 30_000);
  const loggedOutMeStatus = await browser.evaluate("fetch('/api/v4/auth/me',{credentials:'include'}).then(response=>response.status)");
  if (loggedOutMeStatus !== 401) throw new Error(`Logout left the authenticated session active: /auth/me returned ${loggedOutMeStatus}`);
  result.logoutApiStatus = loggedOutMeStatus;
  await browser.navigate(`/account?logoutCheck=${Date.now()}`);
  await browser.wait("location.pathname === '/auth' && new URLSearchParams(location.search).get('returnTo') === '/account'", "protected route after logout", 30_000);
  await browser.screenshot("cookie-logout-auth.png"); result.logout = "PASS"; result.protectedRouteAfterLogout = "PASS";
  result.runtimeExceptionsAfterRestart = browser.cdp.exceptions;
  if (result.runtimeExceptionsBeforeRestart.length || result.runtimeExceptionsAfterRestart.length) throw new Error(`Browser runtime exceptions: ${JSON.stringify({ before: result.runtimeExceptionsBeforeRestart, after: result.runtimeExceptionsAfterRestart })}`);
  result.status = "PASS"; result.completedAt = new Date().toISOString();
  await writeFile(join(evidenceDir, "production-cookie-browser.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, refreshPersistence: result.refreshPersistence, browserRestartPersistence: result.browserRestartPersistence, logout: result.logout, protectedRouteAfterLogout: result.protectedRouteAfterLogout, evidence: join(evidenceDir, "production-cookie-browser.json") }));
} catch (error) {
  result.status = "FAIL"; result.error = error instanceof Error ? error.stack : String(error); result.completedAt = new Date().toISOString(); await writeFile(join(evidenceDir, "production-cookie-browser.json"), `${JSON.stringify(result, null, 2)}\n`); throw error;
} finally { await browser.close(); }
