import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(process.cwd());
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5177").replace(/\/$/, "");
const cdpPort = Number(process.env.MANY_WORLDS_LOGO_CDP_PORT || 9333);
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = resolve(root, "docs/auto-execute/screenshots/logo-audit");
const routes = [
  ["home", "/"],
  ["auth", "/auth?returnTo=%2F"],
  ["world", "/worlds/caesar"],
  ["rooms", "/rooms"],
  ["role-select", "/role-select?story=caesar"],
  ["legal", "/terms"]
];
const logoPath = "/assets/brand/many-worlds-logo.png";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function getJson(url) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status}: ${url}`);
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw lastError || new Error(`Timed out: ${url}`);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    const cdp = new Cdp(ws);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    ws.addEventListener("message", (message) => {
      const data = JSON.parse(message.data.toString());
      if (data.id && cdp.pending.has(data.id)) {
        const pending = cdp.pending.get(data.id);
        cdp.pending.delete(data.id);
        if (data.error) pending.reject(new Error(JSON.stringify(data.error)));
        else pending.resolve(data.result);
      } else if (data.method) cdp.events.push(data);
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

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${cdpPort}`, "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", `--user-data-dir=${resolve(root, ".runtime", "chrome-logo-audit")}`, "about:blank"
], { stdio: "ignore" });
let cdp;
try {
  await getJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const targets = await getJson(`http://127.0.0.1:${cdpPort}/json/list`);
  const target = targets.find((item) => item.type === "page") || targets[0];
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1448, height: 900, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    return result.result?.value;
  };
  const pages = [];
  for (const [name, route] of routes) {
    const start = cdp.events.length;
    const separator = route.includes("?") ? "&" : "?";
    const url = `${webBase}${route}${separator}logo-audit=20260714`;
    await cdp.send("Page.navigate", { url });
    await sleep(1000);
    const snapshot = await evaluate(`(() => ({
      title: document.title,
      url: location.href,
      logoImages: [...document.querySelectorAll('img')].map((node) => node.getAttribute('src')).filter((src) => src && src.includes('many-worlds-logo.png')),
      logoBackgrounds: [...document.querySelectorAll('.brand-mark, .mw-brand, .seal-mark')].map((node) => ({ className: node.className, background: getComputedStyle(node).backgroundImage, before: getComputedStyle(node, '::before').backgroundImage })).filter((item) => item.background.includes('many-worlds-logo.png') || item.before.includes('many-worlds-logo.png')),
      bodyText: document.body.innerText,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    }))()`);
    const events = cdp.events.slice(start);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(resolve(outDir, `${name}.png`), Buffer.from(screenshot.data, "base64"));
    pages.push({
      name,
      route,
      url: snapshot.url,
      title: snapshot.title,
      logoImages: snapshot.logoImages,
      logoBackgrounds: snapshot.logoBackgrounds,
      logoFound: snapshot.logoImages.length > 0 || snapshot.logoBackgrounds.length > 0,
      textLength: snapshot.bodyText.length,
      runtimeErrors: events.filter((event) => event.method === "Runtime.exceptionThrown").map((event) => event.params.exceptionDetails?.text || "runtime exception"),
      failedNetwork: events.filter((event) => event.method === "Network.loadingFailed").map((event) => ({ errorText: event.params.errorText, type: event.params.type })),
      scrollWidth: snapshot.scrollWidth,
      scrollHeight: snapshot.scrollHeight
    });
  }
  const result = { status: pages.every((page) => page.logoFound && page.runtimeErrors.length === 0 && page.failedNetwork.length === 0) ? "PASS" : "REPAIR_REQUIRED", webBase, logoPath, viewport: { width: 1448, height: 900 }, pages, capturedAt: new Date().toISOString() };
  await writeFile(resolve(outDir, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close();
  chrome.kill();
}
