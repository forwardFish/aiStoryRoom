import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(process.cwd());
const webBase = (process.env.WORLDS_LOBBY_WEB_BASE || "http://127.0.0.1:5199").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = Number(process.env.WORLDS_LOBBY_CDP_PORT || 9342);
const outRoot = resolve(process.env.WORLDS_LOBBY_OUT_DIR || ".omx/artifacts/visual-ralph/worlds-lobby");
const viewport = { width: 1586, height: 992, deviceScaleFactor: 1, mobile: false };

if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
await mkdir(outRoot, { recursive: true });

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status}: ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw lastError || new Error(`Timed out: ${url}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    const cdp = new Cdp(socket);
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener("open", resolvePromise, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.addEventListener("message", (message) => {
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
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePromise, reject) => this.pending.set(id, { resolve: resolvePromise, reject }));
  }

  close() {
    this.socket.close();
  }
}

let chrome;
let cdp;
try {
  const profile = resolve(projectRoot, ".runtime", "chrome-worlds-lobby-visual");
  chrome = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: "ignore" });

  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const targets = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`);
  let page = targets.find((target) => target.type === "page") || targets[0];
  if (!page?.webSocketDebuggerUrl) {
    page = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  }

  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", viewport);

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const navigate = async (route) => {
    await cdp.send("Page.navigate", { url: `${webBase}${route}` });
    await sleep(700);
    await evaluate("document.fonts?.ready || Promise.resolve()");
  };

  await navigate("/");
  const homepageEntry = await evaluate(`(() => {
    const entry = document.querySelector('[data-open-world]');
    if (!entry) return { ok: false, reason: 'homepage entry missing' };
    entry.click();
    return { ok: true };
  })()`);
  await sleep(500);
  const homepagePath = await evaluate("location.pathname");
  if (!homepageEntry?.ok || homepagePath !== "/worlds") throw new Error(`Homepage entry failed: ${JSON.stringify({ homepageEntry, homepagePath })}`);

  const lobby = await evaluate(`(() => ({
    path: location.pathname,
    cards: document.querySelectorAll('.world-card').length,
    playable: document.querySelectorAll('a.world-card.is-playable').length,
    comingSoon: document.querySelectorAll('article.world-card.is-coming').length,
    links: [...document.querySelectorAll('a.world-card.is-playable')].map((node) => node.getAttribute('href')),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }
  }))()`);
  if (lobby.cards !== 6 || lobby.playable !== 2 || lobby.comingSoon !== 4) throw new Error(`Lobby structure failed: ${JSON.stringify(lobby)}`);

  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(resolve(outRoot, "actual-final.png"), Buffer.from(screenshot.data, "base64"));

  const destinations = [];
  for (const [worldId, expectedPath] of [["sangtian", "/worlds/sangtian"], ["caesar", "/worlds/caesar"]]) {
    await navigate("/worlds");
    const clicked = await evaluate(`(() => {
      const card = document.querySelector('[data-world-id="${worldId}"]');
      if (!card) return false;
      card.click();
      return true;
    })()`);
    await sleep(500);
    const actualPath = await evaluate("location.pathname");
    if (!clicked || actualPath !== expectedPath) throw new Error(`World navigation failed: ${JSON.stringify({ worldId, expectedPath, actualPath })}`);
    destinations.push({ worldId, expectedPath, actualPath });
  }

  const result = {
    status: "PASS",
    webBase,
    viewport,
    homepageEntry: { expectedPath: "/worlds", actualPath: homepagePath },
    lobby,
    destinations,
    screenshot: ".omx/artifacts/visual-ralph/worlds-lobby/actual-final.png",
    capturedAt: new Date().toISOString()
  };
  await writeFile(resolve(outRoot, "browser-smoke.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  cdp?.close();
  chrome?.kill();
}
