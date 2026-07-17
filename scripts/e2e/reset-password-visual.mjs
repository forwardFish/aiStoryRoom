import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const webBase = String(process.env.RESET_PASSWORD_WEB_BASE || "http://127.0.0.1:5281").replace(/\/$/, "");
const cdpPort = Number(process.env.RESET_PASSWORD_CDP_PORT || 9331);
const outDir = resolve(process.env.RESET_PASSWORD_EVIDENCE_DIR || "docs/auto-execute/evidence/auth-production-closure");
const profile = await mkdtemp(join(tmpdir(), "many-worlds-reset-visual-"));
const route = `${webBase}/reset-password?token=visual-test`;

await mkdir(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }

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
      if (pending) {
        cdp.pending.delete(data.id);
        if (data.error) pending.reject(new Error(JSON.stringify(data.error)));
        else pending.resolve(data.result);
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

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${cdpPort}`,
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore" });

let cdp;
try {
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const pages = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`);
  const page = pages.find((item) => item.type === "page") || pages[0];
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };

  const capture = async (name, viewport) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", viewport);
    await cdp.send("Page.navigate", { url: route });
    await sleep(900);
    await evaluate("document.fonts?.ready || Promise.resolve()");
    const layout = await evaluate(`(() => {
      const shell = document.querySelector('.reset-password-shell')?.getBoundingClientRect();
      const input = document.querySelector('input')?.getBoundingClientRect();
      return {
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        shell: shell && { x: shell.x, y: shell.y, width: shell.width, height: shell.height },
        input: input && { x: input.x, width: input.width, right: input.right },
        hasGlobalHeader: Boolean(document.querySelector('.mw-header')),
        hasLegacyAside: Boolean(document.querySelector('.reset-password-aside')),
        hasRasterLogo: Boolean(document.querySelector('img[src*="many-worlds-logo"]')),
        sharedStylesheetLoaded: [...document.styleSheets].some((sheet) => sheet.href?.includes('/auth-shared.css')),
        backHref: document.querySelector('.reset-password-back')?.getAttribute('href') || null
      };
    })()`);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(join(outDir, `reset-password-redesign-${name}.png`), Buffer.from(screenshot.data, "base64"));
    return layout;
  };

  const desktop = await capture("desktop", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const mobile = await capture("mobile", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  const validation = await evaluate(`(() => {
    const form = document.querySelector('[data-reset-password-form]');
    form.elements.password.value = 'abcdefgh';
    form.elements.confirmPassword.value = 'abcdefghX';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return document.querySelector('[data-reset-notice]')?.textContent || '';
  })()`);

  await cdp.send("Page.navigate", { url: `${webBase}/reset-password?token=visual-test` });
  await sleep(400);
  await evaluate("document.querySelector('.reset-password-back').click()");
  await sleep(700);
  const backNavigation = await evaluate("({ pathname: location.pathname, search: location.search })");

  const runtimeErrors = cdp.events
    .filter((event) => event.method === "Runtime.exceptionThrown")
    .map((event) => event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text || "Runtime exception");
  const failedRequests = cdp.events
    .filter((event) => event.method === "Network.loadingFailed" && !event.params?.canceled)
    .map((event) => ({ url: event.params?.requestId, errorText: event.params?.errorText }));

  const checks = {
    desktopFits: !desktop.horizontalOverflow && desktop.shell?.width <= desktop.viewport.width,
    mobileFits: !mobile.horizontalOverflow && mobile.shell?.width <= mobile.viewport.width && mobile.input?.right <= mobile.viewport.width,
    noGlobalHeader: !desktop.hasGlobalHeader && !mobile.hasGlobalHeader,
    noLegacyAsideOrRasterLogo: !desktop.hasLegacyAside && !desktop.hasRasterLogo,
    sharedAuthStylesLoaded: desktop.sharedStylesheetLoaded && mobile.sharedStylesheetLoaded,
    validationWorks: validation === "The two passwords do not match.",
    backToLoginWorks: backNavigation.pathname === "/auth" && new URLSearchParams(backNavigation.search).get("mode") === "login",
    noRuntimeErrors: runtimeErrors.length === 0,
    noFailedRequests: failedRequests.length === 0
  };
  const status = Object.values(checks).every(Boolean) ? "PASS" : "REPAIR_REQUIRED";
  const report = { status, route, desktop, mobile, validation, backNavigation, runtimeErrors, failedRequests, checks, capturedAt: new Date().toISOString() };
  await writeFile(join(outDir, "reset-password-redesign-browser.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (status !== "PASS") process.exitCode = 1;
} finally {
  cdp?.close();
  chrome.kill();
}
