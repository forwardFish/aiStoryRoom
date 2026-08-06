import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EVIDENCE_ROOT = path.resolve(process.env.OPENOVEL_MANEUVER_EVIDENCE_ROOT || path.join(ROOT, "artifacts", "openovel-maneuver-live"));
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const STAMP = Date.now();
const EMAIL = `openovel-maneuver-${STAMP}@example.test`;
const PASSWORD = "OpenNovelManeuverLive2026!";
const AUTH_SECRET = "openovel-maneuver-live-session-secret";
const INTERNAL_TOKEN = "openovel-maneuver-live-runtime-token";

class CdpClient {
  static async connect(url) {
    if (typeof WebSocket !== "function") throw new Error("Node WebSocket support is required");
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
    this.socket.addEventListener("close", () => {
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error(`CDP closed while waiting for ${waiting.method}`));
      }
      this.pending.clear();
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

  async close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function main() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for live browser acceptance");
  const dirs = {
    logs: path.join(EVIDENCE_ROOT, "process-logs"),
    shots: path.join(EVIDENCE_ROOT, "screenshots"),
    workspaces: path.join(EVIDENCE_ROOT, "openovel-workspaces"),
  };
  for (const dir of [EVIDENCE_ROOT, ...Object.values(dirs)]) await mkdir(dir, { recursive: true });
  const mailSink = path.join(EVIDENCE_ROOT, "auth-mail.ndjson");
  await writeFile(mailSink, "", "utf8");

  const provider = scriptedProvider();
  const providerPort = await listen(provider.server);
  const runtimePort = await reservePort();
  const apiPort = await reservePort();
  const webPort = await reservePort();
  const runtimeBase = `http://127.0.0.1:${runtimePort}`;
  const apiBase = `http://127.0.0.1:${apiPort}/api`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const roleSelectUrl = `${webBase}/role-select?story=sangtian&start=new`;
  const processes = [];
  const checkpoints = [];
  const startedAt = new Date().toISOString();
  let browser = null;
  let cdp = null;
  let evidence = null;
  let runId = "";
  let sessionToken = "";

  const context = {
    apiBase,
    webBase,
    roleSelectUrl,
    checkpoints,
    dirs,
    get runId() { return runId; },
    get sessionToken() { return sessionToken; },
  };

  try {
    processes.push(startProcess("openovel-runtime", process.execPath, [path.join(ROOT, "apps/openovel-runtime/dist/server.js")], dirs.logs, {
      NODE_ENV: "test",
      PORT: String(runtimePort),
      OPENOVEL_RUNTIME_HOST: "127.0.0.1",
      OPENOVEL_WORKSPACE_ROOT: dirs.workspaces,
      OPENOVEL_INTERNAL_TOKEN: INTERNAL_TOKEN,
      OPENOVEL_PROVIDER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      OPENOVEL_API_KEY: "openovel-live-browser-fixture-key",
      OPENOVEL_MODEL: "mock-narrator",
      OPENOVEL_NARRATOR_MODEL: "mock-narrator",
      OPENOVEL_OPTIONS_MODEL: "mock-options",
      OPENOVEL_STORYKEEPER_MODEL: "mock-storykeeper",
      OPENOVEL_PROVIDER_TIMEOUT_MS: "10000",
      OPENOVEL_MIRROR_URL: "",
    }));
    await waitJson(`${runtimeBase}/health`, (value) => value?.ok === true, 60_000);

    processes.push(startProcess("api", process.execPath, [path.join(ROOT, "apps/api/dist/main.js")], dirs.logs, {
      NODE_ENV: "test",
      PORT: String(apiPort),
      API_PORT: String(apiPort),
      DATABASE_URL,
      SUPABASE_DATABASE_URL: "",
      MVP_STORY_STORAGE: "prisma",
      AUTH_TOKEN_SECRET: AUTH_SECRET,
      AUTH_COOKIE_SECURE: "false",
      STORY_WORKER_ENABLED: "false",
      AI_CAUSAL_PROVIDER: "rules",
      EMAIL_PROVIDER: "file",
      AUTH_MAIL_SINK_FILE: mailSink,
      PUBLIC_WEB_ORIGIN: webBase,
      PAYMENT_RETURN_ORIGIN: webBase,
      OPENOVEL_RUNTIME_URL: runtimeBase,
      OPENOVEL_INTERNAL_TOKEN: INTERNAL_TOKEN,
      CREDIT_ACTION_METERING_MODE: "OFF",
      CREEM_ENV: "test",
      CREEM_API_KEY: "creem_test_placeholder",
      CREEM_WEBHOOK_SECRET: "creem_webhook_placeholder",
    }));
    await waitJson(`${apiBase}/health`, (value) => value?.ok === true, 60_000);

    processes.push(startProcess("web", process.execPath, [path.join(ROOT, "apps/web/src/server.mjs")], dirs.logs, {
      NODE_ENV: "test",
      PORT: String(webPort),
      API_PORT: String(apiPort),
    }));
    await waitHttp(roleSelectUrl, 60_000);

    sessionToken = await createAccount(apiBase, mailSink);
    browser = await launchChrome(dirs.logs);
    cdp = await connectPage(browser.debugPort);
    evidence = captureBrowserEvidence(cdp, webBase, apiBase);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `Object.defineProperty(window, "__STORY_STREAM_DELAY_MULTIPLIER__", { value: 0, configurable: true });`,
    });
    const cookie = await cdp.send("Network.setCookie", {
      name: "many_worlds_session",
      value: sessionToken,
      url: webBase,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    assert.equal(cookie.success, true);

    await navigate(cdp, roleSelectUrl);
    await waitSelector(cdp, "#enterRole", 60_000);
    await saveCheckpoint(context, cdp, "01-role-select", null, async () => {
      assert.ok(await evalBrowser(cdp, "document.querySelectorAll('[data-room-role-key]').length") >= 1);
      assert.match(await evalBrowser(cdp, "document.body.innerText"), /桑田诏|Sangtian/i);
    });

    await click(cdp, "#enterRole");
    const gameUrl = await waitUntil(async () => {
      const href = await evalBrowser(cdp, "location.href");
      return /\/game\?runId=/.test(href) ? href : false;
    }, 120_000, "role-select did not create and open a real Solo run");
    runId = new URL(gameUrl).searchParams.get("runId") || "";
    assert.match(runId, /^solo_ovl_[a-f0-9]{32}$/);
    await enterScene(cdp);

    const opening = await gameProjection(context);
    assert.equal(opening.worldSequence, 0);
    assert.equal(opening.maneuverPanel.sceneKey, "d1_1");
    assert.equal(opening.maneuverPanel.quota.remaining, 2);
    await saveCheckpoint(context, cdp, "02-opening-maneuvers-enabled", opening, async () => {
      await assertButtons(cdp, { contact: true, investigate: true, leverage: false, custom: true });
    });

    const contactStart = evidence.maneuverRequests().length;
    await click(cdp, '[data-maneuver-type="contact"]');
    await waitSelector(cdp, '[data-testid="maneuver-contact-workbench"]');
    await click(cdp, '[data-contact-role="county_magistrate"]');
    await fill(cdp, "#contactMessageText", "原始名册为何早于诏令形成？");
    await doubleClick(cdp, "#maneuverSubmit");
    await waitSelector(cdp, "#continueStoryBtn", 60_000);
    const contact = await gameProjection(context);
    assert.equal(contact.worldSequence, 0);
    assert.equal(contact.maneuverPanel.quota.remaining, 1);
    assert.equal(contact.timeline.filter((item) => item.decisionForm === "CONVERSATION").length, 1);
    const contactRequests = evidence.maneuverRequests().slice(contactStart);
    assert.equal(contactRequests.length, 1, "double click must create one maneuver HTTP request");
    assert.equal(contactRequests[0].body?.messageText, "原始名册为何早于诏令形成？");
    assert.equal(contactRequests[0].status, 201);
    await saveCheckpoint(context, cdp, "03-contact-result", contact, null, { contactRequests });
    await continueStory(cdp);

    const investigationStart = evidence.maneuverRequests().length;
    await click(cdp, '[data-maneuver-type="investigate"]');
    await waitSelector(cdp, '[data-testid="maneuver-investigate-workbench"]');
    assert.equal(await evalBrowser(cdp, "Boolean(document.querySelector('#contactMessageText, #customManeuverText'))"), false);
    await click(cdp, "#maneuverSubmit");
    await waitSelector(cdp, "#continueStoryBtn", 60_000);
    const investigation = await gameProjection(context);
    assert.equal(investigation.worldSequence, 0);
    assert.equal(investigation.maneuverPanel.quota.remaining, 0);
    assert.deepEqual([...investigation.maneuverState.usedTypesToday].sort(), ["contact", "investigate"]);
    assert.ok(investigation.maneuverState.discoveredFactKeys.includes("first_registers_prepared_early"));
    const investigationRequests = evidence.maneuverRequests().slice(investigationStart);
    assert.equal(investigationRequests.length, 1);
    assert.equal("messageText" in (investigationRequests[0].body || {}), false);
    assert.equal("customText" in (investigationRequests[0].body || {}), false);
    assert.equal(investigationRequests[0].status, 201);
    await saveCheckpoint(context, cdp, "04-day-one-quota-exhausted", investigation, async () => {
      await assertButtons(cdp, { contact: false, investigate: false, leverage: false, custom: false });
    }, { investigationRequests });
    await continueStory(cdp);

    for (let turn = 1; turn <= 4; turn += 1) await submitMainTurn(context, cdp, turn);
    const dayTwo = await gameProjection(context);
    assert.equal(dayTwo.worldSequence, 4);
    assert.equal(dayTwo.maneuverPanel.sceneKey, "d2_1");
    assert.equal(dayTwo.maneuverPanel.quota.remaining, 2);
    assert.deepEqual(dayTwo.maneuverState.usedTypesToday, []);
    await saveCheckpoint(context, cdp, "05-day-two-leverage-available", dayTwo, async () => {
      await assertButtons(cdp, { contact: true, investigate: true, leverage: true, custom: true });
    });

    const leverageStart = evidence.maneuverRequests().length;
    await click(cdp, '[data-maneuver-type="leverage"]');
    await waitSelector(cdp, '[data-testid="maneuver-leverage-workbench"]');
    assert.equal(await evalBrowser(cdp, "Boolean(document.querySelector('#contactMessageText, #customManeuverText'))"), false);
    await click(cdp, '[data-leverage-key="county_letter"]');
    await click(cdp, '[data-leverage-target="xunfu"]');
    await click(cdp, "#maneuverSubmit");
    await waitSelector(cdp, "#continueStoryBtn", 60_000);
    const leverage = await gameProjection(context);
    assert.equal(leverage.worldSequence, 4);
    assert.equal(leverage.maneuverPanel.quota.remaining, 1);
    assert.ok(leverage.maneuverState.usedLeverageKeys.includes("county_letter"));
    assert.equal(leverage.leverageHand.items.some((item) => item.leverageKey === "county_letter"), false);
    const leverageRequests = evidence.maneuverRequests().slice(leverageStart);
    assert.equal(leverageRequests.length, 1);
    assert.equal(leverageRequests[0].body?.leverageKey, "county_letter");
    assert.equal(leverageRequests[0].body?.targetRoleKey, "xunfu");
    assert.equal("customText" in (leverageRequests[0].body || {}), false);
    assert.equal(leverageRequests[0].status, 201);
    await saveCheckpoint(context, cdp, "06-leverage-result", leverage, null, { leverageRequests });
    await continueStory(cdp);

    await cdp.send("Page.reload", { ignoreCache: true });
    await waitUntil(async () => {
      const state = await evalBrowser(cdp, `({ ready: document.readyState, begin: Boolean(document.querySelector('#beginStoryBtn')), buttons: document.querySelectorAll('[data-maneuver-type]').length })`);
      return state.ready === "complete" && (state.begin || state.buttons === 4) ? state : false;
    }, 60_000, "refreshed game did not restore");
    if (await evalBrowser(cdp, "Boolean(document.querySelector('#beginStoryBtn'))")) await click(cdp, "#beginStoryBtn");
    await waitSelector(cdp, '[data-maneuver-type="custom"]');
    const refreshed = await gameProjection(context);
    assert.ok(refreshed.maneuverState.usedLeverageKeys.includes("county_letter"));
    assert.equal(refreshed.leverageHand.items.some((item) => item.leverageKey === "county_letter"), false);
    const handText = await evalBrowser(cdp, "document.querySelector('.leverage-panel')?.innerText || ''");
    assert.doesNotMatch(handText, /清流县令密信/);
    await saveCheckpoint(context, cdp, "07-refresh-consumed-leverage", refreshed, null, { handText });

    const customStart = evidence.maneuverRequests().length;
    await click(cdp, '[data-maneuver-type="custom"]');
    await waitSelector(cdp, '[data-testid="maneuver-custom-workbench"]');
    await fill(cdp, "#customManeuverText", "派遣幕僚核对田亩账册。");
    await click(cdp, "#maneuverSubmit");
    await waitUntil(async () => {
      const result = await evalBrowser(cdp, "Boolean(document.querySelector('#continueStoryBtn'))");
      const guard = await evalBrowser(cdp, "document.querySelector('[data-testid=\"maneuver-guard\"]')?.innerText || ''");
      if (guard) throw new Error(`custom maneuver blocked: ${guard}`);
      return result;
    }, 60_000, "custom maneuver did not settle");
    const custom = await gameProjection(context);
    assert.equal(custom.worldSequence, 4);
    assert.equal(custom.maneuverPanel.quota.remaining, 0);
    assert.deepEqual([...custom.maneuverState.usedTypesToday].sort(), ["custom", "leverage"]);
    const customRequests = evidence.maneuverRequests().slice(customStart);
    assert.equal(customRequests.length, 1);
    assert.equal(customRequests[0].body?.customText, "派遣幕僚核对田亩账册。");
    assert.equal(customRequests[0].status, 201);
    await saveCheckpoint(context, cdp, "08-custom-result", custom, null, { customRequests });
    await continueStory(cdp);

    await submitMainTurn(context, cdp, 5);
    const finalProjection = await gameProjection(context);
    assert.equal(finalProjection.worldSequence, 5, "main story must remain playable after four maneuver forms");
    assert.ok(finalProjection.currentTurn);
    await saveCheckpoint(context, cdp, "09-main-story-still-open", finalProjection);

    const database = await databaseEvidence(runId);
    assert.equal(database.run.engineVersion, "openovel_v1");
    assert.equal(database.events.length, 4);
    assert.deepEqual(database.events.map((item) => item.maneuverType).sort(), ["contact", "custom", "investigate", "leverage"]);
    assert.equal(database.aiTasks.length, 2);
    assert.equal(database.aiTasks.filter((item) => item.status === "fallback").length, 2);

    const network = evidence.networkReport();
    const consoleItems = evidence.consoleReport();
    const apiFailures = network.filter((item) => item.url.includes("/api/") && (item.failed || Number(item.status || 0) >= 400));
    const consoleErrors = consoleItems.filter((item) => item.kind === "exception" || item.type === "error");
    assert.deepEqual(apiFailures, []);
    assert.deepEqual(consoleErrors, []);
    await writeFile(path.join(EVIDENCE_ROOT, "browser-network.json"), `${JSON.stringify(network, null, 2)}\n`, "utf8");
    await writeFile(path.join(EVIDENCE_ROOT, "browser-console.json"), `${JSON.stringify(consoleItems, null, 2)}\n`, "utf8");

    const report = {
      schemaVersion: "openovel_four_maneuver_live_browser_v1",
      verdict: "PASS",
      repository: "forwardFish/aiStoryRoom",
      branch: "feat/mvp-four-maneuver-actions",
      commitSha: process.env.GITHUB_SHA || null,
      database: "PostgreSQL",
      runtime: "apps/openovel-runtime/dist/server.js",
      providerMode: "scripted OpenAI-compatible acceptance provider",
      roleSelectUrl,
      gameUrl,
      runId,
      finalWorldSequence: finalProjection.worldSequence,
      finalStoryRunVersion: database.run.version,
      providerCalls: provider.calls,
      databaseEvidence: database,
      checkpoints,
      browser: { apiFailures, consoleErrors },
      startedAt,
      completedAt: new Date().toISOString(),
    };
    await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`OPENOVEL_MANEUVER_LIVE_BROWSER_PASS ${path.join(EVIDENCE_ROOT, "report.json")}`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (cdp) await screenshot(cdp, path.join(dirs.shots, "failure.png")).catch(() => undefined);
    await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify({
      schemaVersion: "openovel_four_maneuver_live_browser_v1",
      verdict: "FAIL",
      runId: runId || null,
      roleSelectUrl,
      error: serializeError(error),
      checkpoints,
      startedAt,
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8").catch(() => undefined);
    throw error;
  } finally {
    if (cdp) await cdp.close().catch(() => undefined);
    if (browser) await browser.stop().catch(() => undefined);
    for (const processInfo of [...processes].reverse()) await stopProcess(processInfo).catch(() => undefined);
    await closeServer(provider.server).catch(() => undefined);
  }
}

async function createAccount(apiBase, mailSink) {
  const registration = await jsonRequest(apiBase, "/v4/auth/register", { method: "POST", body: { email: EMAIL, password: PASSWORD, nickname: "OpenNovel Maneuver Live Browser" } });
  assert.equal(registration.payload.accepted, true);
  const verification = await verificationToken(mailSink, EMAIL);
  const verified = await jsonRequest(apiBase, "/v4/auth/verify", { method: "POST", body: { token: verification } });
  assert.equal(verified.payload.verified, true);
  const login = await jsonRequest(apiBase, "/v4/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  const sessionToken = cookieValue(login.response);
  const cookie = `many_worlds_session=${sessionToken}`;
  const me = await jsonRequest(apiBase, "/v4/auth/me", { credential: cookie });
  assert.equal(me.payload.email, EMAIL);
  await jsonRequest(apiBase, "/v4/credits/onboarding", { method: "POST", credential: cookie, body: {} });
  return sessionToken;
}

async function verificationToken(mailSink, email) {
  return waitUntil(async () => {
    const content = await readFile(mailSink, "utf8").catch(() => "");
    for (const line of content.trim().split(/\r?\n/).filter(Boolean).reverse()) {
      const message = JSON.parse(line);
      if (String(message.to || "").toLowerCase() !== email.toLowerCase()) continue;
      const link = String(message.text || message.html || "").match(/https?:\/\/[^\s<]+/)?.[0];
      if (!link) continue;
      const token = new URL(link.replace(/&amp;/g, "&")).searchParams.get("token");
      if (token) return token;
    }
    return false;
  }, 15_000, "verification mail was not written");
}

async function gameProjection(context) {
  return (await jsonRequest(context.apiBase, `/v4/rooms/${encodeURIComponent(context.runId)}/game`, {
    credential: `many_worlds_session=${context.sessionToken}`,
  })).payload;
}

async function databaseEvidence(runId) {
  const prisma = new PrismaClient();
  try {
    const [run, events, aiTasks] = await Promise.all([
      prisma.storyRun.findUniqueOrThrow({ where: { id: runId } }),
      prisma.storyEvent.findMany({ where: { runId, type: "openovel_maneuver_result" }, orderBy: { createdAt: "asc" } }),
      prisma.aiTask.findMany({ where: { runId, taskType: "resolve_maneuver_narrative" }, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      run: { id: run.id, engineVersion: run.engineVersion, version: run.version, currentDay: run.currentDay, worldSequence: run.worldSequence },
      events: events.map((event) => ({ id: event.id, maneuverType: event.payloadJson?.maneuverType, versionBefore: event.payloadJson?.versionBefore, versionAfter: event.payloadJson?.versionAfter })),
      aiTasks: aiTasks.map((task) => ({ id: task.id, status: task.status, provider: task.provider, inputTokens: task.inputTokens, outputTokens: task.outputTokens, errorMessage: task.errorMessage })),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function submitMainTurn(context, cdp, ordinal) {
  await waitSelector(cdp, "#submitDecision", 60_000);
  const before = await gameProjection(context);
  const sequence = Number(before.worldSequence || 0);
  await evalBrowser(cdp, `(() => { const option = document.querySelector('input[name="decision"]'); if (option) option.click(); const submit = document.querySelector('#submitDecision'); if (!submit) throw new Error('submitDecision missing'); submit.click(); return true; })()`);
  await waitUntil(async () => {
    const current = await gameProjection(context).catch(() => null);
    return Number(current?.worldSequence || 0) === sequence + 1 ? current : false;
  }, 120_000, `main turn ${ordinal} did not commit`);
  await waitSelector(cdp, "#continueStoryBtn", 120_000);
  await continueStory(cdp);
}

async function continueStory(cdp) {
  await click(cdp, "#continueStoryBtn");
  await waitSelector(cdp, "#submitDecision", 60_000);
}

async function enterScene(cdp) {
  await waitUntil(async () => {
    const state = await evalBrowser(cdp, `({ ready: document.readyState, begin: Boolean(document.querySelector('#beginStoryBtn')), buttons: document.querySelectorAll('[data-maneuver-type]').length, fatal: document.querySelector('[data-testid="fatal-error"]')?.innerText || '' })`);
    if (state.fatal) throw new Error(state.fatal);
    return state.ready === "complete" && (state.begin || state.buttons === 4) ? state : false;
  }, 60_000, "game page did not reach an actionable scene");
  if (await evalBrowser(cdp, "Boolean(document.querySelector('#beginStoryBtn'))")) await click(cdp, "#beginStoryBtn");
  await waitSelector(cdp, '[data-maneuver-type="contact"]', 60_000);
}

async function assertButtons(cdp, expected) {
  const surface = await evalBrowser(cdp, `({ loading: document.body.innerText.includes('主动谋划配置正在加载'), buttons: [...document.querySelectorAll('[data-maneuver-type]')].map((button) => ({ type: button.dataset.maneuverType, disabled: button.disabled, text: button.innerText })) })`);
  assert.equal(surface.loading, false);
  assert.equal(surface.buttons.length, 4);
  for (const [type, enabled] of Object.entries(expected)) {
    const button = surface.buttons.find((item) => item.type === type);
    assert.ok(button, `missing ${type} maneuver button`);
    assert.equal(button.disabled, !enabled, `${type} state mismatch: ${button.text}`);
  }
}

async function saveCheckpoint(context, cdp, name, projection = null, assertion = null, extra = null) {
  if (assertion) await assertion();
  const dom = await evalBrowser(cdp, `({ url: location.href, buttons: [...document.querySelectorAll('[data-maneuver-type]')].map((button) => ({ type: button.dataset.maneuverType, disabled: button.disabled, text: button.innerText })), quota: document.querySelector('.maneuver-usage')?.innerText || '', decisionOpen: Boolean(document.querySelector('#submitDecision')), resultOpen: Boolean(document.querySelector('[data-testid="result-narrative"]')), guard: document.querySelector('[data-testid="maneuver-guard"]')?.innerText || '', hand: document.querySelector('.leverage-panel')?.innerText || '' })`);
  const image = path.join(context.dirs.shots, `${name}.png`);
  await screenshot(cdp, image);
  const item = { name, url: dom.url, screenshot: image, dom, projection: projection ? compactProjection(projection) : null, extra, recordedAt: new Date().toISOString() };
  context.checkpoints.push(item);
  await writeFile(path.join(EVIDENCE_ROOT, "checkpoints.json"), `${JSON.stringify(context.checkpoints, null, 2)}\n`, "utf8");
}

function compactProjection(value) {
  return {
    worldSequence: value.worldSequence,
    maneuverVersion: value.maneuverVersion,
    currentTurnId: value.currentTurn?.id || null,
    maneuverState: value.maneuverState,
    maneuverPanel: {
      sceneKey: value.maneuverPanel?.sceneKey,
      quota: value.maneuverPanel?.quota,
      contact: compactSection(value.maneuverPanel?.contact),
      investigate: compactSection(value.maneuverPanel?.investigate),
      leverage: compactSection(value.maneuverPanel?.leverage),
      custom: compactSection(value.maneuverPanel?.custom),
    },
    leverageHand: value.leverageHand,
    latestTimelineEntry: value.timeline?.at(-1) || null,
  };
}

function compactSection(value) {
  return value ? { enabled: value.enabled, usedToday: value.usedToday, count: value.count, disabledReason: value.disabledReason, optionKeys: (value.options || []).map((item) => item.roleKey || item.intentKey || item.leverageKey) } : null;
}

function captureBrowserEvidence(cdp, webBase, apiBase) {
  const requests = new Map();
  const consoleItems = [];
  cdp.on("Network.requestWillBeSent", (event) => requests.set(event.requestId, { requestId: event.requestId, method: event.request?.method, url: event.request?.url, body: safeBody(event.request?.postData), status: null, failed: false, errorText: null }));
  cdp.on("Network.responseReceived", (event) => { const item = requests.get(event.requestId); if (item) item.status = event.response?.status; });
  cdp.on("Network.loadingFailed", (event) => { const item = requests.get(event.requestId); if (item) { item.failed = true; item.errorText = event.errorText; } });
  cdp.on("Runtime.consoleAPICalled", (event) => consoleItems.push({ kind: "console", type: event.type, values: (event.args || []).map((item) => item.value ?? item.description ?? "") }));
  cdp.on("Runtime.exceptionThrown", (event) => consoleItems.push({ kind: "exception", type: "error", text: event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || "runtime exception" }));
  cdp.on("Log.entryAdded", (event) => consoleItems.push({ kind: "log", type: event.entry?.level, text: event.entry?.text, url: event.entry?.url }));
  const networkReport = () => [...requests.values()].filter((item) => item.url?.startsWith(webBase) || item.url?.startsWith(apiBase));
  return {
    networkReport,
    consoleReport: () => consoleItems,
    maneuverRequests: () => networkReport().filter((item) => item.method === "POST" && /\/api\/v4\/rooms\/[^/]+\/game\/maneuvers$/.test(new URL(item.url).pathname)),
  };
}

function safeBody(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed.password) parsed.password = "[REDACTED]";
    if (parsed.token) parsed.token = "[REDACTED]";
    return parsed;
  } catch { return String(value).slice(0, 2000); }
}

async function launchChrome(logRoot) {
  const binary = findChrome();
  const profile = await mkdtemp(path.join(os.tmpdir(), "omw-openovel-maneuver-chrome-"));
  const log = createWriteStream(path.join(logRoot, "chrome.log"), { flags: "w" });
  const child = spawn(binary, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--window-size=1440,1050", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const activePort = path.join(profile, "DevToolsActivePort");
  await waitUntil(() => existsSync(activePort), 30_000, "Chrome did not publish DevToolsActivePort");
  const debugPort = Number((await readFile(activePort, "utf8")).trim().split(/\r?\n/)[0]);
  assert.ok(debugPort > 0);
  return { debugPort, async stop() { await stopChild(child); await endStream(log); await rm(profile, { recursive: true, force: true }); } };
}

function findChrome() {
  for (const candidate of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    try { const located = execFileSync("which", [candidate], { encoding: "utf8" }).trim(); if (located) return located; } catch {}
  }
  throw new Error("A real Chrome/Chromium binary is required");
}

async function connectPage(debugPort) {
  const target = await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
    if (!response?.ok) return false;
    return (await response.json()).find((item) => item.type === "page" && item.webSocketDebuggerUrl) || false;
  }, 30_000, "Chrome page target unavailable");
  return CdpClient.connect(target.webSocketDebuggerUrl);
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitUntil(async () => { const state = await evalBrowser(cdp, "({ href: location.href, ready: document.readyState })"); return state.href.startsWith(url.split("?")[0]) && state.ready === "complete" ? state : false; }, 60_000, `navigation failed: ${url}`);
}

async function evalBrowser(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "browser evaluation failed");
  return response.result?.value;
}

async function waitSelector(cdp, selector, timeout = 30_000) {
  return waitUntil(() => evalBrowser(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`), timeout, `missing selector ${selector}`);
}

async function click(cdp, selector) {
  return evalBrowser(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error(${JSON.stringify(`missing ${selector}`)}); if (element.disabled) throw new Error(${JSON.stringify(`disabled ${selector}`)}); element.click(); return true; })()`);
}

async function doubleClick(cdp, selector) {
  return evalBrowser(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error(${JSON.stringify(`missing ${selector}`)}); element.click(); element.click(); return true; })()`);
}

async function fill(cdp, selector, value) {
  return evalBrowser(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error(${JSON.stringify(`missing ${selector}`)}); element.focus(); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return element.value; })()`);
}

async function screenshot(cdp, file) {
  const image = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true }, 60_000);
  await writeFile(file, Buffer.from(image.data, "base64"));
}

function startProcess(name, command, args, logRoot, extraEnv) {
  const log = createWriteStream(path.join(logRoot, `${name}.log`), { flags: "w" });
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code, signal) => log.write(`\n[process-exit] code=${code} signal=${signal}\n`));
  return { child, log };
}

async function stopProcess(value) { await stopChild(value.child); await endStream(value.log); }
async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([new Promise((resolve) => child.once("exit", () => resolve(true))), delay(5000).then(() => false)]);
  if (!exited && child.exitCode === null) { child.kill("SIGKILL"); await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]); }
}
async function endStream(stream) { if (!stream || stream.closed) return; await new Promise((resolve) => stream.end(resolve)); }

async function jsonRequest(base, route, options = {}) {
  const headers = new Headers({ accept: "application/json", ...(options.headers || {}) });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.credential) headers.set("cookie", options.credential);
  const response = await fetch(`${base}${route}`, { method: options.method || "GET", headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || "GET"} ${route} -> ${response.status}: ${JSON.stringify(payload)}`);
  return { response, payload };
}

function cookieValue(response) {
  for (const value of response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""]) {
    const match = String(value).match(/(?:^|,\s*)many_worlds_session=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  throw new Error("login did not issue a session cookie");
}

async function waitJson(url, predicate, timeout) { return waitUntil(async () => { const response = await fetch(url).catch(() => null); if (!response?.ok) return false; const value = await response.json().catch(() => null); return predicate(value) ? value : false; }, timeout, `JSON endpoint unavailable: ${url}`); }
async function waitHttp(url, timeout) { return waitUntil(async () => (await fetch(url).catch(() => null))?.ok || false, timeout, `HTTP endpoint unavailable: ${url}`); }
async function waitUntil(action, timeout = 30_000, message = "condition not met") {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message || lastError}` : ""}`);
}

function scriptedProvider() {
  let narratorIndex = 0;
  const calls = { narrator: 0, options: 0, storykeeper: 0 };
  const narrations = [
    "巡抚书吏听见总督的选择，捧匣的手略沉了一沉。他没有替中丞多说，只把催办时限与当前卷册一并陈明。县令亲随则守在案侧，提醒清流原册仍待正式命令。",
    "书吏把目光收回公文末页，答得比先前更慢：浙江不能没有章程，总督若暂缓，也必须给出何时、由谁查清的准话。",
    "总督府的命令一经落笔，内厅里的争执便从口头变成了可追查的路径。双方都没有替对方承担尚未承认的责任。",
    "次日的消息陆续回到总督府。原册、催办文书与商会说辞并未自然吻合，反而留下了几处需要继续核对的空隙。",
    "新的回报没有替总督作出结论，只把人物立场和可核验事实进一步分开。主线选择仍然掌握在总督手中。",
    "局势继续向前推进。此前的人物回应、调查记录与已消耗筹码都被保留在同一故事线上。",
  ];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw || "{}");
    if (body.model === "mock-narrator") {
      calls.narrator += 1;
      const text = narrations[narratorIndex++] || narrations.at(-1);
      if (body.stream === false) return completion(response, text, "mock-narrator");
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "x-request-id": `fixture-narrator-${calls.narrator}` });
      for (const part of chunks(text, 32)) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 120, completion_tokens: 90 } })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }
    if (body.model === "mock-options") {
      calls.options += 1;
      return completion(response, JSON.stringify({ framing: "", options: [{ label: "让两边各自写下一句可核对的话。" }, { label: "先定下明早查验原册的人选。" }, { label: "暂缓落印，要求补齐经手记录。" }], tension: "期限正在收紧", storyComplete: false }), "mock-options");
    }
    if (body.model === "mock-storykeeper") {
      calls.storykeeper += 1;
      return completion(response, JSON.stringify({ summary: "已将本轮变化写入下一轮工作集。", sections: { "scene.md": "## Scene\n\n- 总督府内厅，人物立场与卷册事实继续分开核验。", "open-threads.md": "## Open Threads\n\n- 巡抚需要答复；清流原册与商会说辞仍待核验。" }, contextCards: [], qualityNotes: "" }), "mock-storykeeper");
    }
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `unknown mock model ${body.model}` } }));
  });
  return { server, calls };
}

function completion(response, content, model) { response.writeHead(200, { "content-type": "application/json", "x-request-id": `fixture-${model}-${Date.now()}` }); response.end(JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 90 } })); }
function chunks(value, size) { const out = []; for (let index = 0; index < value.length; index += size) out.push(value.slice(index, index + size)); return out; }
async function reservePort() { const server = createServer(); const port = await listen(server); await closeServer(server); return port; }
async function listen(server) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("server did not expose a port"); return address.port; }
async function closeServer(server) { if (server.listening) await new Promise((resolve) => server.close(resolve)); }
function serializeError(error) { return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { value: String(error) }; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
