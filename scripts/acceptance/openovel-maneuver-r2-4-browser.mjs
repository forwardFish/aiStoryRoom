import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const WEB_BASE = String(process.env.OPENOVEL_R2_4_WEB_BASE || "http://127.0.0.1:4173").replace(/\/+$/, "");
const API_BASE = String(process.env.OPENOVEL_R2_4_API_BASE || "http://127.0.0.1:3000/api").replace(/\/+$/, "");
const SESSION_COOKIE = normalizeCookie(requiredEnv("OPENOVEL_R2_4_SESSION_COOKIE"));
const DATABASE_URL = requiredEnv("DATABASE_URL");
const EVIDENCE_ROOT = path.resolve(
  process.env.OPENOVEL_R2_4_EVIDENCE_ROOT
  || path.join(process.cwd(), "artifacts", "openovel-maneuver-r2-4-browser"),
);
const ROLE_SELECT_URL = `${WEB_BASE}/role-select?story=sangtian&start=new`;

process.env.DATABASE_URL = DATABASE_URL;
const prisma = new PrismaClient();
const startedAt = new Date().toISOString();
let browser = null;
let cdp = null;
let runId = "";
const checkpoints = [];

class CdpClient {
  static async connect(url) {
    const client = new CdpClient(url);
    await client.ready;
    return client;
  }

  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", async (event) => {
      const raw = typeof event.data === "string"
        ? event.data
        : typeof event.data?.text === "function"
          ? await event.data.text()
          : Buffer.from(event.data).toString("utf8");
      const message = JSON.parse(raw);
      if (message.id) {
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`));
        else waiting.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        try { listener(message.params || {}); } catch {}
      }
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  async send(method, params = {}, timeoutMs = 30_000) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

try {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  browser = await launchChrome();
  cdp = await connectPage(browser.debugPort);
  const browserEvidence = captureBrowserEvidence(cdp);
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Network.enable"),
    cdp.send("Log.enable"),
  ]);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(window, "__STORY_STREAM_DELAY_MULTIPLIER__", { value: 0, configurable: true });`,
  });
  const cookie = cookieParts(SESSION_COOKIE);
  const cookieResult = await cdp.send("Network.setCookie", {
    name: cookie.name,
    value: cookie.value,
    url: WEB_BASE,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  });
  assert.equal(cookieResult.success, true);

  await navigate(cdp, ROLE_SELECT_URL);
  await waitSelector(cdp, "#enterRole", 60_000);
  await checkpoint("01-role-select");
  await click(cdp, "#enterRole");
  const gameUrl = await waitUntil(async () => {
    const href = await evaluate(cdp, "location.href");
    return /\/game\?runId=/.test(href) ? href : false;
  }, 120_000, "role-select did not create a real OpenNovel run");
  runId = new URL(gameUrl).searchParams.get("runId") || "";
  assert.match(runId, /^solo_ovl_[a-f0-9]{32}$/);
  await enterScene(cdp);

  const opening = await projection();
  assert.equal(opening.worldSequence, 0);
  assert.equal(opening.maneuverPanel.quota.remaining, 2);
  assert.equal(opening.maneuverPanel.contact.enabled, true);
  assert.equal(opening.maneuverPanel.investigate.enabled, true);
  await checkpoint("02-opening", opening);

  await click(cdp, '[data-maneuver-type="contact"]');
  await waitSelector(cdp, '[data-testid="maneuver-contact-workbench"]');
  assert.equal((await projection()).maneuverPanel.quota.remaining, 2, "opening the workbench must not submit");
  await click(cdp, '[data-contact-role="county_magistrate"]');
  await fill(cdp, "#contactMessageText", "原始名册是否完整？");
  const dbBeforePreview = await databaseSnapshot();
  const projectionBeforePreview = await projection();
  await click(cdp, "#maneuverSubmit");
  await waitSelector(cdp, '[data-testid="maneuver-preview-card"]');
  const dbAfterPreview = await databaseSnapshot();
  const projectionAfterPreview = await projection();
  assert.deepEqual(dbAfterPreview, dbBeforePreview, "Preview must not write PostgreSQL");
  assert.equal(projectionAfterPreview.maneuverVersion, projectionBeforePreview.maneuverVersion);
  assert.equal(projectionAfterPreview.worldSequence, projectionBeforePreview.worldSequence);
  assert.equal(projectionAfterPreview.maneuverPanel.quota.remaining, 2);
  const previewText = await evaluate(cdp, "document.querySelector('[data-testid=\"maneuver-preview-card\"]')?.innerText || ''");
  assert.match(previewText, /原始名册是否完整/);
  assert.match(previewText, /预演不会写入世界|确认后/);
  await checkpoint("03-contact-preview-zero-write", projectionAfterPreview, {
    databaseBefore: dbBeforePreview,
    databaseAfter: dbAfterPreview,
    previewText,
  });

  await click(cdp, "#maneuverPreviewCancel");
  await waitSelector(cdp, "#contactMessageText");
  assert.equal(await evaluate(cdp, "document.querySelector('#contactMessageText')?.value"), "原始名册是否完整？");
  await fill(cdp, "#contactMessageText", "原始名册是否完整？明日之前能否送到总督府？");
  await click(cdp, "#maneuverSubmit");
  await waitSelector(cdp, '[data-testid="maneuver-preview-card"]');
  const editedPreview = await evaluate(cdp, "document.querySelector('[data-testid=\"maneuver-preview-card\"]')?.innerText || ''");
  assert.match(editedPreview, /明日之前/);
  await click(cdp, "#maneuverConfirm");
  await waitSelector(cdp, "#continueStoryBtn", 120_000);
  const contact = await projection();
  assert.equal(contact.worldSequence, 0, "maneuver confirm must not advance the main story");
  assert.equal(contact.maneuverPanel.quota.remaining, 1);
  assert.equal(contact.timeline.filter((item) => item.decisionForm === "CONVERSATION").length, 1);
  await checkpoint("04-contact-confirmed", contact);
  await continueResult(cdp);

  await click(cdp, '[data-maneuver-type="investigate"]');
  await waitSelector(cdp, '[data-testid="maneuver-investigate-workbench"]');
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('#contactMessageText, #customManeuverText'))"), false);
  await click(cdp, "#maneuverSubmit");
  await waitSelector(cdp, '[data-testid="maneuver-preview-card"]');
  assert.equal((await projection()).maneuverPanel.quota.remaining, 1);
  await click(cdp, "#maneuverConfirm");
  await waitSelector(cdp, "#continueStoryBtn", 60_000);
  const investigation = await projection();
  assert.equal(investigation.worldSequence, 0);
  assert.equal(investigation.maneuverPanel.quota.remaining, 0);
  assert.ok(investigation.maneuverState.discoveredFactKeys.includes("first_registers_prepared_early"));
  await checkpoint("05-investigation-confirmed", investigation);
  await continueResult(cdp);

  for (let index = 0; index < 4; index += 1) await submitMainTurn(cdp, index + 1);
  const dayTwo = await projection();
  assert.equal(dayTwo.worldSequence, 4);
  assert.equal(dayTwo.maneuverPanel.quota.remaining, 2);
  assert.equal(dayTwo.maneuverPanel.leverage.enabled, true);
  await checkpoint("06-day-two-main-story", dayTwo);

  await click(cdp, '[data-maneuver-type="leverage"]');
  await waitSelector(cdp, '[data-testid="maneuver-leverage-workbench"]');
  await click(cdp, '[data-leverage-key="county_letter"]');
  await click(cdp, '[data-leverage-target="xunfu"]');
  await click(cdp, "#maneuverSubmit");
  await waitSelector(cdp, '[data-testid="maneuver-preview-card"]');
  assert.match(await evaluate(cdp, "document.querySelector('[data-testid=\"maneuver-preview-card\"]')?.innerText || ''"), /使用并消耗|县令密信/);
  await click(cdp, "#maneuverConfirm");
  await waitSelector(cdp, "#continueStoryBtn", 120_000);
  const leverage = await projection();
  assert.equal(leverage.worldSequence, 4);
  assert.ok(leverage.maneuverState.usedLeverageKeys.includes("county_letter"));
  assert.equal(leverage.leverageHand.items.some((item) => item.leverageKey === "county_letter"), false);
  await checkpoint("07-leverage-confirmed", leverage);
  await continueResult(cdp);

  await cdp.send("Page.reload", { ignoreCache: true });
  await enterScene(cdp);
  const refreshed = await projection();
  assert.equal(refreshed.worldSequence, 4);
  assert.ok(refreshed.maneuverState.usedLeverageKeys.includes("county_letter"));
  assert.equal(refreshed.leverageHand.items.some((item) => item.leverageKey === "county_letter"), false);
  assert.doesNotMatch(await evaluate(cdp, "document.querySelector('.leverage-panel')?.innerText || ''"), /清流县令密信/);
  await checkpoint("08-refresh-restored", refreshed);

  await click(cdp, '[data-maneuver-type="custom"]');
  await waitSelector(cdp, '[data-testid="maneuver-custom-workbench"]');
  await fill(cdp, "#customManeuverText", "派幕僚核验驿站登记。");
  await click(cdp, "#maneuverSubmit");
  await waitSelector(cdp, '[data-testid="maneuver-preview-card"]');
  await click(cdp, "#maneuverConfirm");
  await waitSelector(cdp, "#continueStoryBtn", 60_000);
  const custom = await projection();
  assert.equal(custom.worldSequence, 4);
  assert.equal(custom.maneuverPanel.quota.remaining, 0);
  assert.deepEqual([...custom.maneuverState.usedTypesToday].sort(), ["custom", "leverage"]);
  await checkpoint("09-custom-confirmed", custom);
  await continueResult(cdp);

  await submitMainTurn(cdp, 5);
  const finalProjection = await projection();
  assert.equal(finalProjection.worldSequence, 5);
  assert.ok(finalProjection.currentTurn, "main story must remain playable after all four maneuver forms");
  const database = await databaseEvidence();
  assert.equal(database.events.length, 4);
  assert.deepEqual(database.events.map((item) => item.maneuverType).sort(), ["contact", "custom", "investigate", "leverage"]);
  assert.equal(database.events.every((item) => item.visibility === "player_visible"), true);
  await checkpoint("10-main-story-still-open", finalProjection, { database });

  const network = browserEvidence.network();
  const previewRequests = network.filter((item) => item.url.includes("/game/maneuvers/preview"));
  const confirmRequests = network.filter((item) => item.url.includes("/game/maneuvers/confirm"));
  assert.ok(previewRequests.length >= 5, "contact cancellation requires a second preview request");
  assert.equal(confirmRequests.length, 4);
  assert.deepEqual(network.filter((item) => item.url.endsWith("/game/maneuvers")), []);
  assert.deepEqual(network.filter((item) => item.failed || Number(item.status || 0) >= 400), []);
  assert.deepEqual(browserEvidence.console().filter((item) => item.kind === "exception" || item.type === "error"), []);

  const report = {
    schemaVersion: "openovel_maneuver_r2_4_browser_v1",
    verdict: "PASS",
    branch: "feat/mvp-four-maneuver-actions",
    commitSha: process.env.OPENOVEL_R2_4_COMMIT_SHA || null,
    roleSelectUrl: ROLE_SELECT_URL,
    gameUrl,
    runId,
    database: "PostgreSQL via Prisma",
    finalWorldSequence: finalProjection.worldSequence,
    finalManeuverVersion: finalProjection.maneuverVersion,
    previewRequestCount: previewRequests.length,
    confirmRequestCount: confirmRequests.length,
    checkpoints,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.join(EVIDENCE_ROOT, "network.json"), `${JSON.stringify(network, null, 2)}\n`, "utf8");
  await writeFile(path.join(EVIDENCE_ROOT, "console.json"), `${JSON.stringify(browserEvidence.console(), null, 2)}\n`, "utf8");
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`OPENOVEL_MANEUVER_R2_4_BROWSER_PASS ${path.join(EVIDENCE_ROOT, "report.json")}\n`);
} catch (error) {
  if (cdp) await screenshot(cdp, path.join(EVIDENCE_ROOT, "failure.png")).catch(() => undefined);
  await mkdir(EVIDENCE_ROOT, { recursive: true }).catch(() => undefined);
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify({
    schemaVersion: "openovel_maneuver_r2_4_browser_v1",
    verdict: "FAIL",
    runId: runId || null,
    roleSelectUrl: ROLE_SELECT_URL,
    error: serializeError(error),
    checkpoints,
    startedAt,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8").catch(() => undefined);
  throw error;
} finally {
  cdp?.close();
  await browser?.stop().catch(() => undefined);
  await prisma.$disconnect();
}

async function projection() {
  const response = await fetch(`${API_BASE}/v4/rooms/${encodeURIComponent(runId)}/game`, {
    headers: { accept: "application/json", cookie: SESSION_COOKIE },
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

async function databaseSnapshot() {
  const [run, events, tasks] = await Promise.all([
    prisma.storyRun.findUniqueOrThrow({ where: { id: runId }, select: { version: true, stateJson: true, worldSequence: true } }),
    prisma.storyEvent.count({ where: { runId, type: "openovel_maneuver_result" } }),
    prisma.aiTask.count({ where: { runId, taskType: "resolve_maneuver_narrative" } }),
  ]);
  return { version: run.version, worldSequence: run.worldSequence, stateJson: run.stateJson, events, tasks };
}

async function databaseEvidence() {
  const [run, events, tasks] = await Promise.all([
    prisma.storyRun.findUniqueOrThrow({ where: { id: runId }, select: { version: true, worldSequence: true, stateJson: true } }),
    prisma.storyEvent.findMany({ where: { runId, type: "openovel_maneuver_result" }, orderBy: { createdAt: "asc" } }),
    prisma.aiTask.findMany({ where: { runId, taskType: "resolve_maneuver_narrative" }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    run: { version: run.version, worldSequence: run.worldSequence },
    events: events.map((event) => ({
      id: event.id,
      maneuverType: event.payloadJson?.maneuverType,
      visibility: event.visibility,
      versionBefore: event.payloadJson?.versionBefore,
      versionAfter: event.payloadJson?.versionAfter,
    })),
    tasks: tasks.map((task) => ({ id: task.id, status: task.status, provider: task.provider, inputTokens: task.inputTokens, outputTokens: task.outputTokens })),
  };
}

async function submitMainTurn(client, ordinal) {
  await waitSelector(client, "#submitDecision", 60_000);
  const before = await projection();
  await evaluate(client, `(() => { const option = document.querySelector('input[name="decision"]'); if (option) option.click(); document.querySelector('#submitDecision')?.click(); return true; })()`);
  await waitUntil(async () => Number((await projection()).worldSequence) === Number(before.worldSequence) + 1, 120_000, `main turn ${ordinal} did not commit`);
  await waitSelector(client, "#continueStoryBtn", 120_000);
  await continueResult(client);
}

async function continueResult(client) {
  await click(client, "#continueStoryBtn");
  await waitSelector(client, "#submitDecision", 60_000);
}

async function enterScene(client) {
  await waitUntil(async () => {
    const state = await evaluate(client, `({ ready: document.readyState, begin: Boolean(document.querySelector('#beginStoryBtn')), buttons: document.querySelectorAll('[data-maneuver-type]').length, fatal: document.querySelector('[data-testid="fatal-error"]')?.innerText || '' })`);
    if (state.fatal) throw new Error(state.fatal);
    return state.ready === "complete" && (state.begin || state.buttons === 4) ? state : false;
  }, 60_000, "game page did not become actionable");
  if (await evaluate(client, "Boolean(document.querySelector('#beginStoryBtn'))")) await click(client, "#beginStoryBtn");
  await waitSelector(client, '[data-maneuver-type="contact"]', 60_000);
}

async function checkpoint(name, gameProjection = null, extra = {}) {
  const file = path.join(EVIDENCE_ROOT, `${name}.png`);
  await screenshot(cdp, file);
  const item = { name, screenshot: file, projection: gameProjection, ...extra };
  checkpoints.push(item);
  await writeFile(path.join(EVIDENCE_ROOT, `${name}.json`), `${JSON.stringify(item, null, 2)}\n`, "utf8");
}

function captureBrowserEvidence(client) {
  const requests = new Map();
  const consoleItems = [];
  client.on("Network.requestWillBeSent", (event) => {
    if (!event.request?.url?.includes("/api/")) return;
    requests.set(event.requestId, { url: event.request.url, method: event.request.method, requestBody: parseJson(event.request.postData), status: null, failed: false });
  });
  client.on("Network.responseReceived", (event) => {
    const item = requests.get(event.requestId);
    if (item) item.status = event.response?.status;
  });
  client.on("Network.loadingFailed", (event) => {
    const item = requests.get(event.requestId);
    if (item) item.failed = true;
  });
  client.on("Runtime.exceptionThrown", (event) => consoleItems.push({ kind: "exception", text: event.exceptionDetails?.text || "exception" }));
  client.on("Log.entryAdded", (event) => consoleItems.push({ type: event.entry?.level, text: event.entry?.text }));
  return { network: () => [...requests.values()], console: () => consoleItems };
}

async function launchChrome() {
  const executable = chromeExecutable();
  const debugPort = await reservePort();
  const profile = await mkdtemp(path.join(os.tmpdir(), "openovel-r2-4-chrome-"));
  const log = createWriteStream(path.join(EVIDENCE_ROOT, "chrome.log"), { flags: "a" });
  const child = spawn(executable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null);
    return response?.ok ? true : false;
  }, 30_000, "Chrome remote debugger did not start");
  return {
    debugPort,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
      log.end();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function connectPage(debugPort) {
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  const page = pages.find((item) => item.type === "page");
  assert.ok(page?.webSocketDebuggerUrl);
  return CdpClient.connect(page.webSocketDebuggerUrl);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitUntil(async () => (await evaluate(client, "document.readyState")) === "complete", 60_000, `navigation failed: ${url}`);
}

async function waitSelector(client, selector, timeoutMs = 30_000) {
  return waitUntil(async () => evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`), timeoutMs, `selector missing: ${selector}`);
}

async function click(client, selector) {
  return evaluate(client, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('missing selector: ${escapeJs(selector)}'); element.click(); return true; })()`);
}

async function fill(client, selector, value) {
  return evaluate(client, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('missing selector: ${escapeJs(selector)}'); element.focus(); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('input', { bubbles: true })); return element.value; })()`);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser evaluation failed");
  return result.result?.value;
}

async function screenshot(client, file) {
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(file, Buffer.from(result.data, "base64"));
}

async function reservePort() {
  const { createServer } = await import("node:http");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitUntil(fn, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(message);
}

function chromeExecutable() {
  const configured = String(process.env.CHROME_BIN || "").trim();
  if (configured) return configured;
  for (const candidate of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [candidate], { encoding: "utf8" }).trim();
    } catch {}
  }
  throw new Error("Chrome or Chromium is required");
}

function cookieParts(cookie) {
  const [name, ...rest] = cookie.split("=");
  return { name, value: rest.join("=") };
}

function normalizeCookie(value) {
  return value.includes("=") ? value : `many_worlds_session=${value}`;
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return value || null; }
}

function escapeJs(value) {
  return String(value).replace(/[\\']/g, "\\$&");
}

function serializeError(error) {
  return { name: error?.name || "Error", message: error?.message || String(error), stack: error?.stack || null };
}
