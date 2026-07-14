import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(".");
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5178").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = Number(process.env.MANY_WORLDS_BROWSER_CDP_PORT || 9334);
const resultDir = join(root, "docs", "auto-execute", "evidence", "many-worlds-v13", "browser-room-flow");
if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForJson(url) { for (let i = 0; i < 100; i += 1) { try { const response = await fetch(url); if (response.ok) return response.json(); } catch {} await sleep(150); } throw new Error(`CDP not ready: ${url}`); }
class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; this.networkFailures = []; this.requests = []; this.responses = []; }
  static async connect(url) { const socket = new WebSocket(url); const cdp = new Cdp(socket); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }); socket.addEventListener("message", (event) => { const data = JSON.parse(event.data.toString()); if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params.exceptionDetails.text || "runtime exception"); if (data.method === "Network.loadingFailed") cdp.networkFailures.push({ errorText: data.params.errorText, type: data.params.type, canceled: data.params.canceled }); if (data.method === "Network.requestWillBeSent" && data.params.request.url.includes("/api/v4/rooms")) cdp.requests.push({ url: data.params.request.url, method: data.params.request.method }); if (data.method === "Network.responseReceived" && data.params.response.url.includes("/api/v4/rooms")) cdp.responses.push({ url: data.params.response.url, status: data.params.response.status, statusText: data.params.response.statusText }); const pending = cdp.pending.get(data.id); if (!pending) return; cdp.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result); }); return cdp; }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}

let chrome; let cdp; let createButtonState = null;
async function evaluate(expression) { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser expression failed"); return result.result?.value; }
async function waitUntil(expression, name, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(150); } throw new Error(`Timed out waiting for ${name}`); }
async function click(selector, name) { const clicked = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`); if (!clicked) throw new Error(`Unable to click ${name}`); }

try {
  await mkdir(resultDir, { recursive: true });
  chrome = spawn(chromePath, [`--remote-debugging-port=${cdpPort}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(root, ".runtime", "chrome-many-worlds-v13-browser-room")}`, "about:blank"], { stdio: "ignore" });
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  let page = (await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`)).find((item) => item.type === "page");
  if (!page?.webSocketDebuggerUrl) page = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  cdp = await Cdp.connect(page.webSocketDebuggerUrl); await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable"); await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1586, height: 992, deviceScaleFactor: 1, mobile: false });
  const email = `mw-web-${Date.now()}@example.test`;
  await cdp.send("Page.navigate", { url: `${webBase}/auth?returnTo=${encodeURIComponent("/rooms?worldId=sangtian")}` });
  await waitUntil("Boolean(document.querySelector('[data-auth-form]'))", "auth page");
  await click('[data-auth-tab="signup"]', "signup tab");
  await evaluate(`(() => { const set = (name, value) => { const field = document.querySelector('[name=' + name + ']'); field.value = value; field.dispatchEvent(new Event('input', { bubbles:true })); }; set('email', ${JSON.stringify(email)}); set('password', 'MvpWeb2026!'); set('nickname', '浏览器验收玩家'); document.querySelector('[data-auth-form]').requestSubmit(); return true; })()`);
  await waitUntil("location.pathname === '/rooms' && Boolean(localStorage.getItem('many-worlds-token'))", "registration, verification, login and return to rooms");
  await waitUntil("(() => { const node = document.querySelector('[data-action=create-room]'); return Boolean(node && typeof node.onclick === 'function'); })()", "create-room handler binding");
  createButtonState = await evaluate("(() => { const node = document.querySelector('[data-action=create-room]'); return node ? { disabled: node.disabled, action: node.dataset.action, hasOnclick: typeof node.onclick === 'function' } : null; })()");
  if (!createButtonState?.hasOnclick) throw new Error(`Create-room handler is not bound: ${JSON.stringify(createButtonState)}`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const requestCount = cdp.requests.length;
    await click('[data-action="create-room"]', `create room attempt ${attempt}`);
    await sleep(500);
    if (cdp.requests.length > requestCount) break;
    if (attempt === 3) throw new Error("Create-room click did not issue a room request after three bound-handler attempts");
  }
  // A Supabase session-pool checkout may make the first durable room write take
  // longer than the ordinary browser polling window.  The UI keeps the request
  // in-flight and provides its own creating state, so this smoke must wait for
  // the real navigation rather than misclassifying a slow successful write.
  await waitUntil("/^\\/rooms\\/c/.test(location.pathname)", "room route", 60000);
  await waitUntil("Boolean(document.querySelector('[data-role-id]'))", "live role list");
  await click('[data-role-id]', "host role selection");
  await waitUntil("Boolean(document.querySelector('.select-role.selected'))", "host role selection persistence");
  await click('[data-action="ready"]', "ready");
  await waitUntil("document.body.innerText.includes('Ready')", "ready state persistence");
  await click('[data-action="share-invite"]', "share invite");
  await waitUntil("Boolean(document.querySelector('.share-dialog[open] [data-poster-preview][src^=\"blob:\"]'))", "invite dialog and generated poster preview");
  const inviteScreenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(join(resultDir, "invite-modal-real-qr.png"), Buffer.from(inviteScreenshot.data, "base64"));
  await click('[data-share-channel="WHATSAPP"]', "WhatsApp share event");
  await waitUntil("Boolean(document.querySelector('.share-dialog[open]'))", "invite dialog remains open after social share");
  await click('[data-close-share]', "close invite dialog");
  await waitUntil("!document.querySelector('.share-dialog')", "invite dialog cleanup");
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(join(resultDir, "host-created-room.png"), Buffer.from(screenshot.data, "base64"));
  const state = await evaluate("(() => ({ path: location.pathname, text: document.body.innerText.slice(0, 1200), roomId: location.pathname.split('/').pop() }))()");
  if (cdp.exceptions.length) throw new Error(`Runtime exceptions: ${cdp.exceptions.join(" | ")}`);
  const result = { status: "PASS", flow: ["register", "local verification", "login", "redirect to rooms", "create sangtian room", "host role selection and lock", "host ready", "open social invite", "real QR loaded", "WhatsApp share event", "close invite dialog"], state, runtimeExceptions: cdp.exceptions, networkFailures: cdp.networkFailures, roomRequests: cdp.requests, roomResponses: cdp.responses, screenshots: ["host-created-room.png", "invite-modal-real-qr.png"], completedAt: new Date().toISOString() };
  await writeFile(join(resultDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, roomId: state.roomId, report: "docs/auto-execute/evidence/many-worlds-v13/browser-room-flow/result.json" }));
} catch (error) {
  const diagnostic = {
    status: "FAIL",
    error: error instanceof Error ? error.message : String(error),
    runtimeExceptions: cdp?.exceptions || [],
    networkFailures: cdp?.networkFailures || [],
    roomRequests: cdp?.requests || [],
    roomResponses: cdp?.responses || [],
    createButtonState,
    state: cdp ? await evaluate("(() => ({ path: location.pathname, text: document.body.innerText.slice(0, 2000) }))()").catch(() => null) : null,
    capturedAt: new Date().toISOString()
  };
  if (cdp) {
    try {
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(join(resultDir, "failure.png"), Buffer.from(screenshot.data, "base64"));
    } catch {}
  }
  await writeFile(join(resultDir, "failure.json"), JSON.stringify(diagnostic, null, 2) + "\n");
  throw error;
} finally { cdp?.close(); chrome?.kill(); }
