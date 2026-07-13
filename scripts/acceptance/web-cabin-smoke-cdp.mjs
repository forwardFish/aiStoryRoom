
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const webUrl = process.env.WEB_CABIN_URL || "http://localhost:5177";
const apiBase = process.env.PREVIEW_API_BASE || "http://localhost:3001/api";
const outDir = resolve(process.env.WEB_CABIN_OUT_DIR || "docs/auto-execute");
const screenshotDir = join(outDir, "screenshots");
const logDir = join(outDir, "logs");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = Number(process.env.CDP_PORT || 9223);
const viewport = {
  width: Number(process.env.WEB_CABIN_VIEWPORT_WIDTH || 1040),
  height: Number(process.env.WEB_CABIN_VIEWPORT_HEIGHT || 1512),
  deviceScaleFactor: 1,
  mobile: false
};

if (!existsSync(chromePath)) {
  console.log(JSON.stringify({ status: "MANUAL_REVIEW_REQUIRED", reason: `Chrome not found at ${chromePath}` }));
  process.exit(2);
}

await mkdir(screenshotDir, { recursive: true });
await mkdir(logDir, { recursive: true });

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${cdpPort}`,
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${resolve(".runtime/chrome-web-cabin")}`,
  "about:blank"
], { stdio: "ignore", detached: false });

async function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitJson(url, timeoutMs = 15000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${url}`);
    } catch (error) { lastError = error; }
    await sleep(300);
  }
  throw lastError || new Error(`Timeout waiting for ${url}`);
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
        const { resolve, reject } = cdp.pending.get(data.id);
        cdp.pending.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      } else if (data.method) {
        cdp.events.push(data);
      }
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

let cdp;
try {
  await waitJson(`http://127.0.0.1:${cdpPort}/json/version`);
  let pages = await waitJson(`http://127.0.0.1:${cdpPort}/json/list`);
  let page = pages.find((item) => item.type === "page") || pages[0];
  if (!page?.webSocketDebuggerUrl) {
    const created = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(webUrl)}`, { method: "PUT" }).then((r) => r.json());
    page = created;
  }
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.clearBrowserCookies");
  await cdp.send("Emulation.setDeviceMetricsOverride", viewport);
  await cdp.send("Page.navigate", { url: webUrl });
  await sleep(1500);

  async function evaluate(expression, awaitPromise = true) {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }

  await evaluate(`(async () => {
    const deadline = Date.now() + 15000;
    while (!document.querySelector('#storySectionsRoot [data-story-enter]')) {
      if (Date.now() > deadline) throw new Error('story catalog did not load');
      await new Promise(r => setTimeout(r, 250));
    }
    return true;
  })()`);
  const roleUrl = new URL(`/role-select?story=sangtian&apiBase=${encodeURIComponent(apiBase)}`, webUrl).href;
  await cdp.send("Page.navigate", { url: roleUrl });
  await sleep(900);
  await evaluate(`(async () => {
    const deadline = Date.now() + 15000;
    while (!location.pathname.includes('/role-select') || document.body.innerText.includes('正在展开角色名册')) {
      if (Date.now() > deadline) throw new Error('role select did not load');
      await new Promise(r => setTimeout(r, 250));
    }
    if (!document.querySelector('#enterRole')) throw new Error('role select rendered an error: ' + document.body.innerText.slice(0, 500));
    return true;
  })()`);
  const createdRun = await evaluate(`fetch(${JSON.stringify(`${apiBase}/v4/stories/sangtian/runs`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storyId: 'sangtian', roleKey: 'zhejiang_governor', mode: 'single' }) }).then(r => r.json())`);
  if (!createdRun?.run?.id) throw new Error(`story run creation failed: ${JSON.stringify(createdRun)}`);
  await evaluate(`localStorage.setItem('ai-story-room:sangtian:run-id', ${JSON.stringify(createdRun.run.id)}); true`);
  const gameUrl = new URL(`/game?runId=${encodeURIComponent(createdRun.run.id)}&apiBase=${encodeURIComponent(apiBase)}`, webUrl).href;
  await cdp.send("Page.navigate", { url: gameUrl });
  await sleep(900);
  await evaluate(`(async () => {
    const deadline = Date.now() + 15000;
    while (!document.querySelector('[data-testid="web-game-root"]')) {
      if (Date.now() > deadline) throw new Error('game page did not load at ' + location.href + ': ' + document.body.innerText.slice(0, 500));
      await new Promise(r => setTimeout(r, 250));
    }
    return true;
  })()`);
  const initialGame = await evaluate(`(() => ({
    text: document.body.innerText,
    hasDecision: Boolean(document.querySelector('#submitDecision')),
    hasRightRail: document.body.innerText.includes('当前局势') || document.body.innerText.includes('世界状态') || document.body.innerText.includes('当前风险'),
    hasMessageStream: Boolean(document.querySelector('#messageStream'))
  }))()`);
  await evaluate(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    async function waitFor(predicate, label) {
      const deadline = Date.now() + 15000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(label);
        await sleep(250);
      }
    }
    async function submitFirstOption() {
      await waitFor(() => Boolean(document.querySelector('input[name="decision"]')) && Boolean(document.querySelector('#submitDecision')), 'decision option did not render');
      const before = document.querySelectorAll('.story-card.decision_result').length;
      document.querySelector('input[name="decision"]')?.click();
      document.querySelector('#submitDecision')?.click();
      await waitFor(() => document.querySelectorAll('.story-card.decision_result').length > before || Boolean(document.querySelector('[data-testid="day-complete"]')) || Boolean(document.querySelector('#submitDecision:not([disabled])')), 'decision result did not render');
    }
    async function advanceDay() {
      await waitFor(() => Boolean(document.querySelector('#advanceBtn')), 'day advance button did not render');
      document.querySelector('#advanceBtn')?.click();
      await waitFor(() => Boolean(document.querySelector('input[name="decision"]')), 'next day decision did not render');
    }
    await submitFirstOption();
    await submitFirstOption();
    await advanceDay();
    await submitFirstOption();
    await submitFirstOption();
    await advanceDay();
    return true;
  })()`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(900);
  await evaluate(`(async () => {
    const deadline = Date.now() + 15000;
    while (!document.querySelector('[data-testid="web-game-root"]') || document.body.innerText.includes('正在读取')) {
      if (Date.now() > deadline) throw new Error('game refresh recovery did not finish');
      await new Promise(r => setTimeout(r, 250));
    }
    return true;
  })()`);
  const summary = await evaluate(`(() => {
    return {
      title: document.title,
      bodyLength: document.body.innerText.length,
      hasTitle: document.title.includes('嘉靖') || document.body.innerText.includes('杭州总督府'),
      hasDecision: Boolean(document.querySelector('#submitDecision')),
    hasRightRail: document.body.innerText.includes('当前局势') || document.body.innerText.includes('世界状态') || document.body.innerText.includes('当前风险'),
      hasMessageStream: Boolean(document.querySelector('#messageStream')),
      hasCausalCard: Boolean(document.querySelector('.story-card.decision_result, .story-card.causal_visible, [data-testid="day-complete"]')),
      hasReferenceState: document.body.innerText.includes('第 3 天') && /今日主线决策\\s*1 \\/ 2/.test(document.body.innerText) && document.body.innerText.includes('巡抚急奏北上'),
      hasRecoveredRun: Boolean(new URLSearchParams(location.search).get('runId') || localStorage.getItem('ai-story-room:sangtian:run-id')),
       initialGame: ${JSON.stringify(initialGame)}
    };
  })()`);

  const exceptions = cdp.events.filter((event) => event.method === "Runtime.exceptionThrown");
  const blockingExceptions = exceptions.filter((event) => !String(event.params?.exceptionDetails?.text || "").includes("ResizeObserver"));
  const html = await evaluate(`document.documentElement.outerHTML`);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const report = {
    status: "PASS",
    webUrl,
    apiBase,
    viewport,
    summary,
    blockingRuntimeErrorCount: blockingExceptions.length,
    runtimeErrors: blockingExceptions.map((event) => event.params?.exceptionDetails?.text || event.params?.exceptionDetails?.exception?.description || "runtime exception")
  };

  const assertions = [
    [summary.hasTitle, "title text missing"],
    [summary.bodyLength > 500, "page appears blank"],
    [summary.initialGame.hasDecision, "decision panel missing"],
    [summary.initialGame.hasRightRail, "right status rail missing"],
    [summary.initialGame.hasMessageStream, "message stream missing"],
    [summary.hasCausalCard || summary.hasReferenceState, "causal result or reference state missing after flow"],
    [summary.hasRecoveredRun, "run was not recovered after refresh"],
    [blockingExceptions.length === 0, "blocking runtime errors present"]
  ];
  const failed = assertions.filter(([ok]) => !ok).map(([, message]) => message);
  if (failed.length) report.status = "HARD_FAIL", report.failed = failed;

  await writeFile(join(screenshotDir, "web-cabin-smoke.png"), Buffer.from(screenshot.data, "base64"));
  await writeFile(join(screenshotDir, "web-cabin-smoke.html"), html, "utf8");
  await writeFile(join(logDir, "web-cabin-browser-summary.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  const report = { status: "HARD_FAIL", webUrl, apiBase, error: error instanceof Error ? error.stack || error.message : String(error) };
  await writeFile(join(logDir, "web-cabin-browser-summary.json"), JSON.stringify(report, null, 2), "utf8").catch(() => undefined);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
} finally {
  if (cdp) cdp.close();
  chrome.kill();
}
