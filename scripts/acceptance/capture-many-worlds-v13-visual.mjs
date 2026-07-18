import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(process.cwd());
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5178").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = Number(process.env.MANY_WORLDS_VISUAL_CDP_PORT || 9331);
const outRoot = resolve(process.env.MANY_WORLDS_VISUAL_OUT_DIR || "docs/auto-execute/evidence/many-worlds-v13/visual");
// Use the exact native dimensions of the five supplied reference PNG files.
// Resizing the reference would invalidate a one-to-one visual comparison.
const viewport = { width: 1586, height: 992, deviceScaleFactor: 1, mobile: false };
const pages = [
  ["VT-NEW-001", "/auth?returnTo=/worlds/caesar"],
  ["VT-NEW-002", "/worlds/caesar"],
  ["VT-NEW-003", "/rooms?worldId=caesar"],
  ["VT-NEW-004", "/rooms/fixture-caesar-waiting"],
  ["VT-NEW-005", "/game/result?runId=fixture-caesar-finished"]
];

if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status}: ${url}`);
    } catch (error) { lastError = error; }
    await sleep(200);
  }
  throw lastError || new Error(`Timed out: ${url}`);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    const cdp = new Cdp(ws);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    ws.addEventListener("message", (message) => {
      const data = JSON.parse(message.data.toString());
      if (data.id && cdp.pending.has(data.id)) {
        const pending = cdp.pending.get(data.id);
        cdp.pending.delete(data.id);
        if (data.error) pending.reject(new Error(JSON.stringify(data.error))); else pending.resolve(data.result);
      } else if (data.method) cdp.events.push(data);
    });
    return cdp;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.ws.close(); }
}

let chrome;
let cdp;
try {
  const profile = resolve(projectRoot, ".runtime", "chrome-many-worlds-v13-visual");
  chrome = spawn(chromePath, [`--remote-debugging-port=${cdpPort}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const targets = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`);
  let page = targets.find((target) => target.type === "page") || targets[0];
  if (!page?.webSocketDebuggerUrl) page = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", viewport);
  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const captures = [];
  for (const [visualId, route] of pages) {
    const eventsStart = cdp.events.length;
    const url = `${webBase}${route}`;
    await cdp.send("Page.navigate", { url });
    await sleep(700);
    await evaluate(`(async () => { await (document.fonts?.ready || Promise.resolve()); const deadline = Date.now() + 10000; while (!document.querySelector('#platform-app') || !document.querySelector('#platform-app').children.length) { if (Date.now() > deadline) throw new Error('platform shell did not render'); await new Promise(r => setTimeout(r, 100)); } await new Promise(r => setTimeout(r, 300)); return true; })()`);
    const [screenshot, geometry] = await Promise.all([
      cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }),
      evaluate(`(() => ({ title: document.title, url: location.href, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, elements: [...document.querySelectorAll('.mw-header,.page-frame,.auth-card,.world-hero,.world-image,.role-preview,.mode-grid,.rooms-layout,.room-top,.room-main,.room-footer,.result-run,.summary-grid,.lower-grid,.result-actions')].map((element) => { const r = element.getBoundingClientRect(); const style = getComputedStyle(element); return { selector: element.className, x:r.x, y:r.y, width:r.width, height:r.height, display:style.display, font:style.font, color:style.color, background:style.backgroundColor, borderRadius:style.borderRadius }; }), textLength: document.body.innerText.length }))()`)
    ]);
    const pageEvents = cdp.events.slice(eventsStart);
    const consoleEvents = pageEvents.filter((event) => event.method === "Runtime.consoleAPICalled").map((event) => ({ type:event.params.type, text:(event.params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ") }));
    const runtimeErrors = pageEvents.filter((event) => event.method === "Runtime.exceptionThrown").map((event) => event.params.exceptionDetails?.text || event.params.exceptionDetails?.exception?.description || "runtime exception");
    const failedNetwork = pageEvents.filter((event) => event.method === "Network.loadingFailed").map((event) => ({ errorText:event.params.errorText, type:event.params.type }));
    const outDir = join(outRoot, visualId);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "actual.png"), Buffer.from(screenshot.data, "base64"));
    await writeFile(join(outDir, "geometry.json"), `${JSON.stringify(geometry, null, 2)}\n`);
    await writeFile(join(outDir, "browser.json"), `${JSON.stringify({ url, consoleEvents, runtimeErrors, failedNetwork }, null, 2)}\n`);
    await writeFile(join(outDir, "metrics.json"), `${JSON.stringify({ visualId, status: "REPAIR_REQUIRED", reason: "Initial actual capture; diff metrics are generated by compare-many-worlds-v13-visual.", viewport, actual: "actual.png", reference: "reference.png", runtimeErrorCount: runtimeErrors.length, failedNetworkCount: failedNetwork.length, capturedAt: new Date().toISOString() }, null, 2)}\n`);
    captures.push({ visualId, url, geometry, runtimeErrorCount: runtimeErrors.length, failedNetworkCount: failedNetwork.length });
  }
  await writeFile(join(outRoot, "capture-summary.json"), `${JSON.stringify({ status:"REPAIR_REQUIRED", webBase, viewport, captures, capturedAt:new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify({ status: "REPAIR_REQUIRED", captures: captures.map((capture) => capture.visualId) }));
} finally {
  cdp?.close();
  chrome?.kill();
}
