import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const webBase = String(process.env.ACCOUNT_WEB_BASE || "http://127.0.0.1:5281").replace(/\/$/, "");
const email = String(process.env.ACCOUNT_ACCEPTANCE_EMAIL || "").trim().toLowerCase();
const password = String(process.env.ACCOUNT_ACCEPTANCE_PASSWORD || "");
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "apps/api/.auth-mail-sink.ndjson");
const cdpPort = Number(process.env.ACCOUNT_CDP_PORT || 9342);
const outDir = resolve(process.env.ACCOUNT_EVIDENCE_DIR || "docs/auto-execute/evidence/account-page");
const reference = resolve(process.env.ACCOUNT_REFERENCE || "D:/lyh/agent/agent-frame/aiStoryRoom/docs/UI/web/My_Account.png");
const profile = await mkdtemp(join(tmpdir(), "many-worlds-account-live-"));

if (!email.endsWith("@example.test") || password.length < 12) throw new Error("A non-personal @example.test acceptance account and a temporary password are required");
if (!existsSync(chromePath) || !existsSync(reference)) throw new Error("Chrome and the approved My Account reference are required");
await mkdir(outDir, { recursive:true });

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function jsonRequest(path, options = {}) {
  const response = await fetch(`${webBase}/api${path}`, { ...options, headers:{ "content-type":"application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${data.message || data.code || ""}`);
  return data;
}
function latestResetToken() {
  const rows = readFileSync(mailSink, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const message = rows.reverse().find((row) => String(row.to || "").toLowerCase() === email && String(row.subject || "").toLowerCase().includes("reset"));
  const match = String(message?.text || message?.html || "").match(/reset-password\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("The local reset email was not written to the configured file sink");
  return match[1];
}
async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { const response = await fetch(url); if (response.ok) return response.json(); } catch {} await sleep(150); }
  throw new Error(`Timed out waiting for ${url}`);
}
class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) {
    const socket = new WebSocket(url); const cdp = new Cdp(socket);
    await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once:true }); socket.addEventListener("error", reject, { once:true }); });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params?.exceptionDetails?.exception?.description || data.params?.exceptionDetails?.text || "Runtime exception");
      const pending = cdp.pending.get(data.id); if (!pending) return;
      cdp.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return cdp;
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveSend, reject) => this.pending.set(id, { resolve:resolveSend, reject })); }
  close() { this.socket.close(); }
}

await jsonRequest("/v4/auth/password-reset/request", { method:"POST", body:JSON.stringify({ email }) });
await sleep(250);
await jsonRequest("/v4/auth/password-reset/confirm", { method:"POST", body:JSON.stringify({ token:latestResetToken(), password }) });

const chrome = spawn(chromePath, [`--remote-debugging-port=${cdpPort}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "about:blank"], { stdio:"ignore" });
let cdp;
try {
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const page = (await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`)).find((entry) => entry.type === "page");
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable");
  const evaluate = async (expression) => { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise:true, returnByValue:true, userGesture:true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; };
  const wait = async (expression, label, timeout = 30_000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timed out waiting for ${label}`); };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width:1484, height:1060, deviceScaleFactor:1, mobile:false });
  await cdp.send("Page.navigate", { url:`${webBase}/auth?mode=login&reauth=1&returnTo=%2Faccount` });
  await wait("Boolean(document.querySelector('[data-auth-form]'))", "login form");
  await evaluate(`(() => { const set=(name,value)=>{const input=document.querySelector('[name="'+name+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};set('email',${JSON.stringify(email)});set('password',${JSON.stringify(password)});document.querySelector('[data-auth-form]').requestSubmit();return true; })()`);
  await wait("location.pathname === '/account' && Boolean(document.querySelector('.account-avatar')) && !document.body.innerText.includes('Loading purchase records')", "database-backed account page");
  await evaluate("document.fonts?.ready || Promise.resolve()");
  const desktop = await evaluate(`(() => ({
    viewport:{ width:innerWidth, height:innerHeight }, document:{ width:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight }, overflowX:document.documentElement.scrollWidth > innerWidth,
    avatarText:document.querySelector('.account-avatar')?.textContent?.trim(), displayedEmail:document.querySelector('.account-profile-copy p')?.textContent?.trim(), purchaseRows:document.querySelectorAll('.account-purchase-table tbody tr').length,
    orders:[...document.querySelectorAll('.account-purchase-table tbody tr td:first-child')].map((node)=>node.textContent.trim()), hasGlobalHeader:Boolean(document.querySelector('.mw-header'))
  }))()`);
  const liveReadback = await evaluate("Promise.all([fetch('/api/v4/auth/me',{credentials:'include'}).then(r=>r.json()),fetch('/api/v4/billing/purchases',{credentials:'include'}).then(r=>r.json())]).then(([me,billing])=>({email:me.email,purchaseCount:billing.purchases.length,orders:billing.purchases.map(item=>item.orderDisplayCode)}))");
  const desktopShot = await cdp.send("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:false });
  await writeFile(join(outDir, "my-account-desktop.png"), Buffer.from(desktopShot.data, "base64"));
  await cdp.send("Emulation.setDeviceMetricsOverride", { width:390, height:844, deviceScaleFactor:1, mobile:true });
  await cdp.send("Page.reload", { ignoreCache:true });
  await wait("location.pathname === '/account' && Boolean(document.querySelector('.account-avatar')) && !document.body.innerText.includes('Loading purchase records')", "mobile account page");
  const mobile = await evaluate("({ viewport:{width:innerWidth,height:innerHeight}, documentWidth:document.documentElement.scrollWidth, overflowX:document.documentElement.scrollWidth>innerWidth, avatarText:document.querySelector('.account-avatar')?.textContent?.trim() })");
  const mobileShot = await cdp.send("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:false });
  await writeFile(join(outDir, "my-account-mobile.png"), Buffer.from(mobileShot.data, "base64"));
  const checks = { usesRealApiData:desktop.displayedEmail === liveReadback.email && desktop.purchaseRows === liveReadback.purchaseCount && JSON.stringify(desktop.orders) === JSON.stringify(liveReadback.orders), avatarUsesEmailInitial:desktop.avatarText === email.charAt(0).toUpperCase(), noGlobalHeader:!desktop.hasGlobalHeader, desktopNoHorizontalOverflow:!desktop.overflowX, mobileNoHorizontalOverflow:!mobile.overflowX, cookieSessionPersistsOnReload:mobile.avatarText === desktop.avatarText, noRuntimeExceptions:cdp.exceptions.length === 0 };
  const report = { status:Object.values(checks).every(Boolean) ? "PASS" : "REPAIR_REQUIRED", scope:"My Account page rendered from the live Supabase-backed API", reference, route:`${webBase}/account`, fixtureOnly:false, accountType:"non-personal example.test acceptance account", dataSource:{ profile:"GET /api/v4/auth/me", purchases:"GET /api/v4/billing/purchases" }, desktop:{ ...desktop, displayedEmail:"[redacted acceptance email]" }, mobile, readback:{ purchaseCount:liveReadback.purchaseCount, orders:liveReadback.orders }, checks, runtimeExceptions:cdp.exceptions, capturedAt:new Date().toISOString() };
  await writeFile(join(outDir, "my-account-live-browser.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
} finally {
  try { await cdp?.send("Browser.close"); } catch {}
  cdp?.close(); if (chrome.exitCode === null) chrome.kill(); await rm(profile, { recursive:true, force:true }).catch(() => {});
}
