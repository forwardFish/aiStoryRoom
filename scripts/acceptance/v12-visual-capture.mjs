import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = Number(process.env.V12_CDP_PORT || 9224);
const root = resolve(process.env.PROJECT_ROOT || ".");
const out = join(root, "docs", "auto-execute", "screenshots");
const apiBase = process.env.V12_API_BASE || "http://localhost:3001/api";
const webBase = process.env.V12_WEB_BASE || "http://127.0.0.1:5177";
const profile = resolve(root, ".runtime", "chrome-v12-visual");

if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
await mkdir(out, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForJson(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${url}`);
    } catch (error) { lastError = error; }
    await sleep(250);
  }
  throw lastError || new Error(`timeout: ${url}`);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    const cdp = new Cdp(ws);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    ws.addEventListener("message", (message) => {
      const data = JSON.parse(message.data.toString());
      const pending = cdp.pending.get(data.id);
      if (!pending) return;
      cdp.pending.delete(data.id);
      if (data.error) pending.reject(new Error(JSON.stringify(data.error)));
      else pending.resolve(data.result);
    });
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.ws.close(); }
}

async function screenshot(cdp, path) {
  const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path, Buffer.from(image.data, "base64"));
}

let chrome;
let cdp;
try {
  chrome = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore" });
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  let pages = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`);
  let page = pages.find((item) => item.type === "page") || pages[0];
  if (!page?.webSocketDebuggerUrl) {
    page = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  }
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const setViewport = (width, height) => cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const navigate = async (url) => { await cdp.send("Page.navigate", { url }); await sleep(2200); };

  await setViewport(910, 1729);
  await navigate(`${webBase}/?v=v12-capture-home`);
  await evaluate(`document.fonts?.ready || Promise.resolve()`);
  await evaluate(`(async () => {
    const urls = [...document.querySelectorAll('*')].flatMap((element) => {
      const value = getComputedStyle(element).backgroundImage || '';
      return [...value.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)].map((match) => match[1]);
    });
    const images = [...document.images].map((image) => image.currentSrc || image.src).filter(Boolean);
    await Promise.all([...new Set([...urls, ...images])].map((src) => new Promise((resolve) => {
      const image = new Image(); image.onload = resolve; image.onerror = resolve; image.src = src;
    })));
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 250));
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 900));
    return true;
  })()`);
  const homeLayout = await evaluate(`(() => ({ scrollHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight, sections: Object.fromEntries([".mw-hero", ".hero-copy", ".world-carousel", ".world-featured", ".world-peek", ".worlds-section", ".principles", ".entry-grid", ".entry-card.solo", ".entry-card.invite", ".role-stack", ".avatar-orbit", ".flow-section", ".build-world", ".build-world > div:first-child", ".build-world .overview-card", ".build-world .tensions", ".build-world .build-art", ".ending-section", ".ending-grid", ".ending-list", ".impact-card", ".faq", ".pricing", ".price-grid", ".mw-footer"].map((selector) => { const element = document.querySelector(selector); const rect = element?.getBoundingClientRect(); return [selector, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: getComputedStyle(element).display } : null]; })) }))()`);
  await screenshot(cdp, join(out, "v12-homepage-910x1729.png"));
  const homepageEntry = await evaluate("(()=>{const button=document.querySelector('.home-reference-hitbox.explore')||document.querySelector('[data-start-solo]');if(!button)return{ok:false,reason:'homepage entry control missing'};setTimeout(()=>button.click(),0);return{scheduled:true};})()");
  await sleep(1200);
  const homepageEntryResult = await evaluate("({ok:window.location.pathname==='/role-select',path:window.location.pathname})");
  if (!homepageEntry?.scheduled || !homepageEntryResult?.ok) throw new Error("homepage entry failed: " + JSON.stringify({ homepageEntry, homepageEntryResult }));
  await navigate(webBase + "/?v=v12-capture-home-return");

  await setViewport(1448, 1086);
  await navigate(`${webBase}/role-select?story=sangtian&apiBase=${encodeURIComponent(apiBase)}&v=v12-capture-role-select`);
  await evaluate(`(async () => { const end = Date.now() + 15000; while (!document.querySelector('.role-shell')) { if (Date.now() > end) throw new Error('role select shell timeout'); await new Promise(r => setTimeout(r, 100)); } return true; })()`);
  await sleep(500);
  await screenshot(cdp, join(out, "current-role-select-1448x1086.png"));

  const created = await evaluate(`fetch(${JSON.stringify(`${apiBase}/v4/story-runs`)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storyId: "sangtian" }) }).then((r) => r.json())`);
  if (!created?.run?.id) throw new Error(`run creation failed: ${JSON.stringify(created)}`);
  await setViewport(1672, 941);
  await navigate(`${webBase}/game?runId=${encodeURIComponent(created.run.id)}&apiBase=${encodeURIComponent(apiBase)}&v=v12-capture-game`);
  await evaluate(`(async () => { const end = Date.now() + 15000; while (!document.querySelector('[data-testid="story-shell"]')) { if (Date.now() > end) throw new Error('game shell timeout'); await new Promise(r => setTimeout(r, 100)); } return true; })()`);
  const openingState = await evaluate(`(async () => { const end = Date.now() + 15000; while (!document.querySelector('#beginStoryBtn')) { if (Date.now() > end) return { ready: false, text: document.body.innerText.slice(0, 1200), retry: Boolean(document.querySelector('#retryBtn')), error: document.querySelector('[data-testid=error-banner]')?.innerText || '' }; await new Promise(r => setTimeout(r, 100)); } return { ready: true }; })()`);
  if (!openingState?.ready) throw new Error(`opening continue control timeout: ${JSON.stringify(openingState)}`);
  await sleep(900);
  await screenshot(cdp, join(out, "current-UI01-opening-1672x941.png"));
  await evaluate(`(() => { const button = document.querySelector('#beginStoryBtn'); if (!button) throw new Error('opening continue control missing'); button.click(); return true; })()`);
  await sleep(500);
  await screenshot(cdp, join(out, "current-UI02-decision-1672x941.png"));
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 1200, downloadThroughput: -1, uploadThroughput: -1 });
  await evaluate(`(() => { const option = document.querySelector('input[name="decision"]'); const submit = document.querySelector('#submitDecision'); if (!option || !submit) throw new Error('decision controls missing during visual capture'); option.click(); submit.click(); return true; })()`);
  await evaluate(`new Promise((resolve) => requestAnimationFrame(() => resolve(true)))`);
  await screenshot(cdp, join(out, "current-UI03-simulating-1672x941.png"));
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(1400);
  await screenshot(cdp, join(out, "current-UI04-result-1672x941.png"));
  await evaluate(`(() => { const button = document.querySelector('#historyBtn'); if (!button) throw new Error('history control missing during visual capture'); button.click(); return true; })()`);
  await sleep(150);
  await screenshot(cdp, join(out, "current-UI05-ledger-1672x941.png"));
  await evaluate(`(() => { const button = document.querySelector('#closeHistoryBtn'); if (button) button.click(); return true; })()`);
  await sleep(100);
  await screenshot(cdp, join(out, "current-UI08-maneuver-1672x941.png"));
  await evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let step = 0; step < 28; step += 1) {
      if (document.body.innerText.includes("第 3 天 · 午后")) return { reachedReferenceDay: true, step };
      const option = document.querySelector('input[name="decision"]');
      const submit = document.querySelector('#submitDecision');
      if (option && submit) { option.click(); submit.click(); await wait(1800); continue; }
      const advance = document.querySelector('#advanceBtn') || document.querySelector('#maneuverAdvanceBtn');
      if (advance) { advance.click(); await wait(1800); continue; }
      await wait(500);
    }
    return { reachedReferenceDay: document.body.innerText.includes("第 3 天 · 午后"), step: 28 };
  })()`);
  await sleep(900);
  await screenshot(cdp, join(out, "current-day3-regression-1672x941.png"));
  await evaluate(`(() => { const select = document.querySelector('#maneuverType'); if (!select) throw new Error('maneuver type missing at day-three checkpoint'); select.value = 'investigate'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaluate(`(() => { const button = document.querySelector('#maneuverSubmit'); if (!button) throw new Error('maneuver submit missing at day-three checkpoint'); button.click(); return true; })()`);
  await evaluate(`(async () => { const end = Date.now() + 8000; while (!document.querySelector('#criticalRespondBtn')) { if (Date.now() > end) throw new Error('critical event modal timeout at day-three checkpoint'); await new Promise((resolve) => setTimeout(resolve, 100)); } return true; })()`);
  await screenshot(cdp, join(out, "current-UI06-critical-1672x941.png"));
  await evaluate(`(() => { const button = document.querySelector('#criticalRespondBtn'); if (!button) throw new Error('critical response control missing'); button.click(); return true; })()`);
  await evaluate(`(async () => { const end = Date.now() + 5000; while (!document.querySelector('.critical-response-narrative')) { if (Date.now() > end) throw new Error('critical response narrative timeout'); await new Promise((resolve) => setTimeout(resolve, 100)); } return true; })()`);
  await screenshot(cdp, join(out, "current-UI07-other-impact-1672x941.png"));
  await writeFile(join(root, "docs", "auto-execute", "results", "v12-visual-capture.json"), `${JSON.stringify({ status: "NEEDS_REPAIR", actuals: {
    HOME: "docs/auto-execute/screenshots/v12-homepage-910x1729.png",
    ROLE_SELECT: "docs/auto-execute/screenshots/current-role-select-1448x1086.png",
    UI01: "docs/auto-execute/screenshots/current-UI01-opening-1672x941.png",
    UI02: "docs/auto-execute/screenshots/current-UI02-decision-1672x941.png",
    UI03: "docs/auto-execute/screenshots/current-UI03-simulating-1672x941.png",
    UI04: "docs/auto-execute/screenshots/current-UI04-result-1672x941.png",
    UI05: "docs/auto-execute/screenshots/current-UI05-ledger-1672x941.png",
    UI06: "docs/auto-execute/screenshots/current-UI06-critical-1672x941.png",
    UI07: "docs/auto-execute/screenshots/current-UI07-other-impact-1672x941.png",
    UI08: "docs/auto-execute/screenshots/current-UI08-maneuver-1672x941.png"
  }, viewport: { homepage: "910x1729", game: "1672x941" }, homeLayout, runId: created.run.id, capturedAt: new Date().toISOString(), note: "Actual browser evidence only. Pixel-perfect completion requires a per-reference diff and review." }, null, 2)}\n`);
  console.log(JSON.stringify({ status: "NEEDS_REPAIR", runId: created.run.id }));
} finally {
  cdp?.close();
  chrome?.kill();
}
