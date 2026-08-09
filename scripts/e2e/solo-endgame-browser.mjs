import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function verifySoloEndgameInBrowser({
  webBase,
  runId,
  sessionCookie,
  expected,
  outputDir,
}) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("SOLO_ENDGAME_CHROME_REQUIRED");
  await mkdir(outputDir, { recursive: true });
  const cdpPort = await freePort();
  const profile = path.join(outputDir, "chrome-profile");
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  try {
    const version = await waitJson(`http://127.0.0.1:${cdpPort}/json/version`, 30_000);
    let pages = await waitJson(`http://127.0.0.1:${cdpPort}/json/list`, 10_000);
    let page = pages.find((item) => item.type === "page");
    if (!page?.webSocketDebuggerUrl) {
      page = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    }
    cdp = await Cdp.connect(page.webSocketDebuggerUrl || version.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await setSessionCookies(cdp, webBase, sessionCookie);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: `${webBase}/game?runId=${encodeURIComponent(runId)}` });
    await waitUntil(cdp, `Boolean(document.querySelector('[data-testid="final-judgement"][data-endgame-schema="endgame_presentation_v1"]'))`, "authoritative Solo ending", 45_000);
    const state = await evaluate(cdp, `(() => ({
      url: location.href,
      text: document.body.innerText,
      html: document.querySelector('[data-testid="final-judgement"]')?.innerHTML || '',
      hasShell: Boolean(document.querySelector('[data-testid="story-shell"]')),
      hasLeft: Boolean(document.querySelector('.causal-left')),
      hasCenter: Boolean(document.querySelector('.causal-center')),
      hasRight: Boolean(document.querySelector('.causal-right')),
      nextPartDisabled: document.querySelector('[data-replay-action="CONTINUE_NEXT_PART"]')?.disabled === true,
      changeRoleDisabled: document.querySelector('[data-replay-action="CHANGE_ROLE"]')?.disabled === true,
      localResetHidden: document.querySelector('#resetDecisionBtn')?.hidden === true,
      causeCount: document.querySelectorAll('[data-testid="ending-causes"] li').length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    }))()`);
    assert.equal(state.hasShell && state.hasLeft && state.hasCenter && state.hasRight, true, "real /game three-column layout must remain mounted");
    assert.equal(state.horizontalOverflow, false, "ending must not create horizontal overflow");
    assert.match(state.text, /《桑田诏》第一部分结局/);
    assert.match(state.text, new RegExp(escapeRegex(expected.title)));
    assert.match(state.text, /你得到/);
    assert.match(state.text, /你失去/);
    assert.match(state.text, /为什么会这样/);
    assert.match(state.text, /第一部分之后/);
    assert.ok(state.causeCount >= 1 && state.causeCount <= 3, `expected 1-3 causes, got ${state.causeCount}`);
    assert.equal(state.nextPartDisabled, true);
    assert.equal(state.changeRoleDisabled, true);
    assert.equal(state.localResetHidden, true);
    assert.doesNotMatch(state.html, /endingKey|factKey|sourceActionId|score|Prompt|chain-of-thought/i);

    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const screenshotPath = path.join(outputDir, "solo-endgame-main-game.png");
    await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));

    const restarted = await evaluate(cdp, `(() => {
      const link = document.querySelector('[data-replay-action="RESTART_SAME_STORY"]');
      if (!link || link.tagName !== 'A') return false;
      link.click();
      return true;
    })()`);
    assert.equal(restarted, true, "server-projected restart action must be clickable");
    await waitUntil(cdp, "location.pathname === '/role-select'", "role selection after restart", 20_000);
    await waitUntil(cdp, "Boolean(document.querySelector('#enterRole:not([disabled])'))", "supported Solo role", 20_000);
    const visibleRoles = await evaluate(cdp, `document.querySelectorAll('[data-room-role-key]:not([disabled])').length`);
    assert.equal(visibleRoles, 1, "restart flow must display only runtime-supported Solo roles");
    await evaluate(cdp, `document.querySelector('#enterRole').click(); true`);
    await waitUntil(cdp, `location.pathname === '/game' && new URL(location.href).searchParams.get('runId') !== ${JSON.stringify(runId)}`, "fresh Solo run", 45_000);
    const newRunId = await evaluate(cdp, `new URL(location.href).searchParams.get('runId')`);
    assert.ok(newRunId && newRunId !== runId);
    return {
      chromePath,
      screenshotPath,
      visibleUrl: state.url,
      causeCount: state.causeCount,
      layout: { left: state.hasLeft, center: state.hasCenter, right: state.hasRight },
      newRunId,
      runtimeExceptions: cdp.exceptions,
    };
  } finally {
    try { cdp?.close(); } catch {}
    await stopProcess(chrome);
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    const cdp = new Cdp(ws);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params?.exceptionDetails?.text || "runtime exception");
      const pending = cdp.pending.get(data.id);
      if (!pending) return;
      cdp.pending.delete(data.id);
      data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
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

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}

async function waitUntil(cdp, expression, label, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await sleep(150);
  }
  const diagnostic = await evaluate(cdp, `({ url: location.href, text: document.body.innerText.slice(0, 2000) })`).catch(() => null);
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function setSessionCookies(cdp, webBase, source) {
  const pairs = String(source || "").split(/;\s*/).filter((item) => item.includes("="));
  for (const pair of pairs) {
    const [name, ...rest] = pair.split("=");
    if (!["many_worlds_session", "many_worlds_session_hint"].includes(name)) continue;
    const result = await cdp.send("Network.setCookie", {
      name,
      value: rest.join("="),
      url: webBase,
      path: "/",
      secure: false,
      httpOnly: name === "many_worlds_session",
      sameSite: "Lax",
    });
    assert.equal(result.success, true, `could not set ${name}`);
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function waitJson(url, timeout) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      last = new Error(`${response.status} ${url}`);
    } catch (error) { last = error; }
    await sleep(150);
  }
  throw last || new Error(`timeout: ${url}`);
}

async function freePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
