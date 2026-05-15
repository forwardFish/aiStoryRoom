
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
  width: Number(process.env.WEB_CABIN_VIEWPORT_WIDTH || 1610),
  height: Number(process.env.WEB_CABIN_VIEWPORT_HEIGHT || 977),
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
    while (!window.__aiStoryCabin || window.__aiStoryCabin.state.templates.length < 3) {
      if (Date.now() > deadline) throw new Error('templates did not load');
      await new Promise(r => setTimeout(r, 250));
    }
    return true;
  })()`);
  await evaluate(`window.__aiStoryCabin.loginActive()`);
  await evaluate(`window.__aiStoryCabin.createRun(window.__aiStoryCabin.state.templates[0].id)`);
  await evaluate(`window.__aiStoryCabin.simulatePlayers()`);
  await evaluate(`window.__aiStoryCabin.submitAction(false)`);
  await evaluate(`window.__aiStoryCabin.submitAction(true)`);
  await evaluate(`window.__aiStoryCabin.resolveFullChapter()`);
  const summary = await evaluate(`(() => {
    const s = window.__aiStoryCabin.state;
    return {
      title: document.title,
      bodyLength: document.body.innerText.length,
      hasTitle: document.body.innerText.includes('AI\u6545\u4e8b\u5c40\u6d4b\u8bd5\u53f0'),
      templateCount: s.templates.length,
      runId: s.run && s.run.id,
      activeHumanCount: s.run && s.run.activeHumanCount,
      roleCount: s.roles.length,
      currentNodeIndex: s.runState && s.runState.currentNode && s.runState.currentNode.nodeIndex,
      guardStatus: s.guardResult && s.guardResult.guardStatus,
      guardMatchedRules: s.guardResult && s.guardResult.matchedRules,
      chapterTitle: s.chapter && s.chapter.title,
      povCount: s.chapter && s.chapter.povSectionsJson && s.chapter.povSectionsJson.length,
      personalCardCount: s.chapter && s.chapter.personalCardsJson && s.chapter.personalCardsJson.length,
      nextHook: s.chapter && s.chapter.nextHook,
      apiLogCount: s.apiLog.length,
      checklistDone: Array.from(document.querySelectorAll('#checklist .done')).map(li => li.innerText),
      lastError: s.lastError
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
    [summary.templateCount >= 3, "less than 3 templates"],
    [summary.runId, "run not created"],
    [summary.activeHumanCount >= 3, "3 players not joined"],
    [summary.roleCount >= 3, "roles missing"],
    [["blocked", "rewrite_needed"].includes(summary.guardStatus), "ActionGuard not triggered"],
    [summary.povCount >= 3, "POV chapter missing"],
    [summary.personalCardCount >= 3, "personal story cards missing"],
    [summary.nextHook, "next chapter hook missing"],
    [summary.apiLogCount >= 8, "API/debug log too small"],
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
