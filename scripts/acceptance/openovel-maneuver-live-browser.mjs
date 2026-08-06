import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createWriteStream, existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EVIDENCE_ROOT = path.resolve(
  process.env.OPENOVEL_MANEUVER_EVIDENCE_ROOT
  || path.join(ROOT, "artifacts", "openovel-maneuver-live"),
);
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const MAIL_SINK = path.join(EVIDENCE_ROOT, "auth-mail.ndjson");
const PROCESS_LOG_ROOT = path.join(EVIDENCE_ROOT, "process-logs");
const SCREENSHOT_ROOT = path.join(EVIDENCE_ROOT, "screenshots");
const WORKSPACE_ROOT = path.join(EVIDENCE_ROOT, "openovel-workspaces");
const AUTH_SECRET = "openovel-maneuver-live-session-secret";
const INTERNAL_TOKEN = "openovel-maneuver-live-runtime-token";
const STAMP = Date.now();
const EMAIL = `openovel-maneuver-${STAMP}@example.test`;
const PASSWORD = "OpenNovelManeuverLive2026!";

if (!DATABASE_URL) throw new Error("DATABASE_URL is required for live browser acceptance");

await mkdir(EVIDENCE_ROOT, { recursive: true });
await mkdir(PROCESS_LOG_ROOT, { recursive: true });
await mkdir(SCREENSHOT_ROOT, { recursive: true });
await mkdir(WORKSPACE_ROOT, { recursive: true });
await writeFile(MAIL_SINK, "", "utf8");

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
let browser = null;
let cdp = null;
let sessionCookieValue = "";
let runId = "";
let fatalError = null;
const startedAt = new Date().toISOString();

try {
  processes.push(startLoggedProcess("openovel-runtime", process.execPath, [
    path.join(ROOT, "apps", "openovel-runtime", "dist", "server.js"),
  ], {
    NODE_ENV: "test",
    PORT: String(runtimePort),
    OPENOVEL_RUNTIME_HOST: "127.0.0.1",
    OPENOVEL_WORKSPACE_ROOT: WORKSPACE_ROOT,
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
  await waitForJson(`${runtimeBase}/health`, (payload) => payload?.ok === true, 60_000);

  processes.push(startLoggedProcess("api", process.execPath, [
    path.join(ROOT, "apps", "api", "dist", "main.js"),
  ], {
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
    AUTH_MAIL_SINK_FILE: MAIL_SINK,
    PUBLIC_WEB_ORIGIN: webBase,
    PAYMENT_RETURN_ORIGIN: webBase,
    OPENOVEL_RUNTIME_URL: runtimeBase,
    OPENOVEL_INTERNAL_TOKEN: INTERNAL_TOKEN,
    CREDIT_ACTION_METERING_MODE: "OFF",
    CREEM_ENV: "test",
    CREEM_API_KEY: "creem_test_placeholder",
    CREEM_WEBHOOK_SECRET: "creem_webhook_placeholder",
  }));
  await waitForJson(`${apiBase}/health`, (payload) => payload?.ok === true, 60_000);

  processes.push(startLoggedProcess("web", process.execPath, [
    path.join(ROOT, "apps", "web", "src", "server.mjs"),
  ], {
    NODE_ENV: "test",
    PORT: String(webPort),
    API_PORT: String(apiPort),
  }));
  await waitForHttp(roleSelectUrl, 60_000);

  const auth = await createAuthenticatedAccount();
  sessionCookieValue = auth.sessionToken;

  browser = await launchBrowser();
  cdp = await connectToPage(browser.debugPort);
  const evidence = installBrowserEvidence(cdp);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      Object.defineProperty(window, "__STORY_STREAM_DELAY_MULTIPLIER__", { value: 0, configurable: true });
      Object.defineProperty(window, "__AI_STORY_DEBUG_BUILD__", { value: false, configurable: true });
    `,
  });
  const cookieSet = await cdp.send("Network.setCookie", {
    name: "many_worlds_session",
    value: sessionCookieValue,
    url: webBase,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  });
  assert.equal(cookieSet.success, true, "browser session cookie must be installed");

  await navigate(cdp, roleSelectUrl);
  await waitForSelector(cdp, "#enterRole", 60_000);
  await checkpoint(cdp, "01-role-select", {
    expectedPath: "/role-select",
    assertion: async () => {
      const roleCount = await evaluate(cdp, "document.querySelectorAll('[data-room-role-key]').length");
      assert.ok(roleCount >= 1, "role-select must show the real Sangtian roster");
      const text = await evaluate(cdp, "document.body.innerText");
      assert.match(text, /桑田诏|Sangtian/i);
      return { roleCount };
    },
  });

  await click(cdp, "#enterRole");
  await waitFor(cdp, async () => {
    const location = await evaluate(cdp, "location.href");
    return /\/game\?runId=/.test(location) ? location : false;
  }, 120_000, "role-select did not navigate to the real game page");
  const gameUrl = await evaluate(cdp, "location.href");
  runId = new URL(gameUrl).searchParams.get("runId") || "";
  assert.match(runId, /^solo_ovl_[a-f0-9]{32}$/);

  await enterDecisionScene(cdp);
  const openingProjection = await readGameProjection();
  assert.equal(openingProjection.room?.mode, "solo");
  assert.equal(openingProjection.worldSequence, 0);
  assert.equal(openingProjection.maneuverPanel?.sceneKey, "d1_1");
  assert.equal(openingProjection.maneuverPanel?.quota?.remaining, 2);
  assert.equal(openingProjection.maneuverPanel?.contact?.enabled, true);
  assert.equal(openingProjection.maneuverPanel?.investigate?.enabled, true);
  assert.equal(openingProjection.maneuverPanel?.custom?.enabled, true);
  assert.equal(openingProjection.maneuverPanel?.leverage?.enabled, false);
  await checkpoint(cdp, "02-opening-maneuvers-enabled", {
    expectedPath: "/game",
    projection: openingProjection,
    assertion: async () => assertFourButtonSurface(cdp, {
      contact: true,
      investigate: true,
      leverage: false,
      custom: true,
    }),
  });

  const contactNetworkStart = evidence.maneuverRequests().length;
  await click(cdp, '[data-maneuver-type="contact"]');
  await waitForSelector(cdp, '[data-testid="maneuver-contact-workbench"]');
  await click(cdp, '[data-contact-role="county_magistrate"]');
  await fill(cdp, "#contactMessageText", "原始名册为何早于诏令形成？");
  await doubleClickSameElement(cdp, "#maneuverSubmit");
  await waitForSelector(cdp, "#continueStoryBtn", 60_000);
  const afterContact = await readGameProjection();
  assert.equal(afterContact.worldSequence, 0, "contact must not advance the OpenNovel main turn");
  assert.equal(afterContact.maneuverPanel.quota.remaining, 1);
  assert.equal(afterContact.maneuverPanel.contact.enabled, false);
  assert.equal(afterContact.timeline.filter((entry) => entry.decisionForm === "CONVERSATION").length, 1);
  const contactRequests = evidence.maneuverRequests().slice(contactNetworkStart);
  assert.equal(contactRequests.length, 1, "double click must create exactly one HTTP maneuver request");
  assert.equal(contactRequests[0].body?.messageText, "原始名册为何早于诏令形成？");
  assert.equal(contactRequests[0].status, 201);
  await checkpoint(cdp, "03-contact-result", {
    projection: afterContact,
    extra: { contactRequests },
  });
  await click(cdp, "#continueStoryBtn");
  await waitForSelector(cdp, "#submitDecision");

  const investigationNetworkStart = evidence.maneuverRequests().length;
  await click(cdp, '[data-maneuver-type="investigate"]');
  await waitForSelector(cdp, '[data-testid="maneuver-investigate-workbench"]');
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('#customManeuverText, #contactMessageText'))"), false, "investigation must not expose free text");
  await click(cdp, "#maneuverSubmit");
  await waitForSelector(cdp, "#continueStoryBtn", 60_000);
  const afterInvestigation = await readGameProjection();
  assert.equal(afterInvestigation.worldSequence, 0);
  assert.equal(afterInvestigation.maneuverPanel.quota.remaining, 0);
  assert.deepEqual(
    [...afterInvestigation.maneuverState.usedTypesToday].sort(),
    ["contact", "investigate"],
  );
  assert.ok(afterInvestigation.maneuverState.discoveredFactKeys.includes("first_registers_prepared_early"));
  const investigationRequests = evidence.maneuverRequests().slice(investigationNetworkStart);
  assert.equal(investigationRequests.length, 1);
  assert.equal("messageText" in (investigationRequests[0].body || {}), false);
  assert.equal("customText" in (investigationRequests[0].body || {}), false);
  assert.equal(investigationRequests[0].status, 201);
  await checkpoint(cdp, "04-day-one-quota-exhausted", {
    projection: afterInvestigation,
    extra: { investigationRequests },
    assertion: async () => assertFourButtonSurface(cdp, {
      contact: false,
      investigate: false,
      leverage: false,
      custom: false,
    }),
  });
  await click(cdp, "#continueStoryBtn");

  for (let index = 1; index <= 4; index += 1) {
    await submitMainDecision(cdp, index);
  }
  const dayTwoProjection = await readGameProjection();
  assert.equal(dayTwoProjection.worldSequence, 4);
  assert.equal(dayTwoProjection.maneuverPanel.sceneKey, "d2_1");
  assert.equal(dayTwoProjection.maneuverPanel.quota.remaining, 2);
  assert.deepEqual(dayTwoProjection.maneuverState.usedTypesToday, []);
  assert.equal(dayTwoProjection.maneuverPanel.leverage.enabled, true);
  assert.equal(dayTwoProjection.maneuverPanel.custom.enabled, true);
  await checkpoint(cdp, "05-day-two-leverage-available", {
    projection: dayTwoProjection,
    assertion: async () => assertFourButtonSurface(cdp, {
      contact: true,
      investigate: true,
      leverage: true,
      custom: true,
    }),
  });

  const leverageNetworkStart = evidence.maneuverRequests().length;
  await click(cdp, '[data-maneuver-type="leverage"]');
  await waitForSelector(cdp, '[data-testid="maneuver-leverage-workbench"]');
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('#customManeuverText, #contactMessageText'))"), false, "leverage must not expose free text");
  await click(cdp, '[data-leverage-key="county_letter"]');
  await click(cdp, '[data-leverage-target="xunfu"]');
  await click(cdp, "#maneuverSubmit");
  await waitForSelector(cdp, "#continueStoryBtn", 60_000);
  const afterLeverage = await readGameProjection();
  assert.equal(afterLeverage.worldSequence, 4);
  assert.equal(afterLeverage.maneuverPanel.quota.remaining, 1);
  assert.ok(afterLeverage.maneuverState.usedLeverageKeys.includes("county_letter"));
  assert.equal(afterLeverage.leverageHand.items.some((item) => item.leverageKey === "county_letter"), false);
  const leverageRequests = evidence.maneuverRequests().slice(leverageNetworkStart);
  assert.equal(leverageRequests.length, 1);
  assert.equal(leverageRequests[0].body?.leverageKey, "county_letter");
  assert.equal(leverageRequests[0].body?.targetRoleKey, "xunfu");
  assert.equal("customText" in (leverageRequests[0].body || {}), false);
  assert.equal(leverageRequests[0].status, 201);
  await checkpoint(cdp, "06-leverage-result", {
    projection: afterLeverage,
    extra: { leverageRequests },
  });
  await click(cdp, "#continueStoryBtn");
  await waitForSelector(cdp, "#submitDecision");

  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, async () => {
    const state = await evaluate(cdp, `(() => ({
      ready: document.readyState,
      buttons: document.querySelectorAll('[data-maneuver-type]').length,
      begin: Boolean(document.querySelector('#beginStoryBtn')),
    }))()`);
    return state.ready === "complete" && (state.buttons === 4 || state.begin) ? state : false;
  }, 60_000, "refreshed OpenNovel game did not restore");
  if (await evaluate(cdp, "Boolean(document.querySelector('#beginStoryBtn'))")) {
    await click(cdp, "#beginStoryBtn");
  }
  await waitForSelector(cdp, '[data-maneuver-type="custom"]');
  const afterRefresh = await readGameProjection();
  assert.ok(afterRefresh.maneuverState.usedLeverageKeys.includes("county_letter"));
  assert.equal(afterRefresh.leverageHand.items.some((item) => item.leverageKey === "county_letter"), false);
  const handText = await evaluate(cdp, "document.querySelector('.leverage-panel')?.innerText || ''");
  assert.doesNotMatch(handText, /清流县令密信/);
  await checkpoint(cdp, "07-refresh-consumed-leverage", {
    projection: afterRefresh,
    extra: { handText },
  });

  const customNetworkStart = evidence.maneuverRequests().length;
  await click(cdp, '[data-maneuver-type="custom"]');
  await waitForSelector(cdp, '[data-testid="maneuver-custom-workbench"]');
  await fill(cdp, "#customManeuverText", "派遣幕僚核对田亩账册。");
  await click(cdp, "#maneuverSubmit");
  await waitFor(cdp, async () => {
    if (await evaluate(cdp, "Boolean(document.querySelector('#continueStoryBtn'))")) return "result";
    const guard = await evaluate(cdp, "document.querySelector('[data-testid=\"maneuver-guard\"]')?.innerText || ''");
    return guard ? { guard } : false;
  }, 60_000, "custom maneuver did not settle");
  const guardText = await evaluate(cdp, "document.querySelector('[data-testid=\"maneuver-guard\"]')?.innerText || ''");
  assert.equal(guardText, "", `custom maneuver was unexpectedly blocked: ${guardText}`);
  const afterCustom = await readGameProjection();
  assert.equal(afterCustom.worldSequence, 4);
  assert.equal(afterCustom.maneuverPanel.quota.remaining, 0);
  assert.deepEqual(
    [...afterCustom.maneuverState.usedTypesToday].sort(),
    ["custom", "leverage"],
  );
  const customRequests = evidence.maneuverRequests().slice(customNetworkStart);
  assert.equal(customRequests.length, 1);
  assert.equal(customRequests[0].body?.customText, "派遣幕僚核对田亩账册。");
  assert.equal(customRequests[0].status, 201);
  await checkpoint(cdp, "08-custom-result", {
    projection: afterCustom,
    extra: { customRequests },
  });
  await click(cdp, "#continueStoryBtn");

  await submitMainDecision(cdp, 5);
  const finalProjection = await readGameProjection();
  assert.equal(finalProjection.worldSequence, 5, "main story must remain playable after all four maneuver forms");
  assert.ok(finalProjection.currentTurn, "a new OpenNovel main turn must remain open");
  await checkpoint(cdp, "09-main-story-still-open", {
    projection: finalProjection,
  });

  const prisma = new PrismaClient();
  let stored;
  let maneuverEvents;
  let aiTasks;
  try {
    [stored, maneuverEvents, aiTasks] = await Promise.all([
      prisma.storyRun.findUnique({ where: { id: runId } }),
      prisma.storyEvent.findMany({
        where: { runId, type: "openovel_maneuver_result" },
        orderBy: { createdAt: "asc" },
      }),
      prisma.aiTask.findMany({
        where: { runId, taskType: "resolve_maneuver_narrative" },
        orderBy: { createdAt: "asc" },
      }),
    ]);
  } finally {
    await prisma.$disconnect();
  }
  assert.ok(stored, "StoryRun must remain persisted in PostgreSQL");
  assert.equal(stored.engineVersion, "openovel_v1");
  assert.equal(maneuverEvents.length, 4);
  assert.deepEqual(
    maneuverEvents.map((event) => event.payloadJson?.maneuverType).sort(),
    ["contact", "custom", "investigate", "leverage"],
  );
  assert.equal(aiTasks.length, 2, "only contact and AI_REACTION leverage should create AiTask records");
  assert.equal(aiTasks.filter((task) => task.status === "fallback").length, 2);

  const browserNetwork = evidence.networkReport();
  const apiFailures = browserNetwork.filter((item) =>
    item.url.includes("/api/") && (item.failed || Number(item.status || 0) >= 400),
  );
  const browserErrors = evidence.errorReport();
  assert.deepEqual(apiFailures, [], `unexpected browser API failures: ${JSON.stringify(apiFailures)}`);
  assert.deepEqual(browserErrors, [], `unexpected browser console errors: ${JSON.stringify(browserErrors)}`);

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
    engineVersion: stored.engineVersion,
    finalWorldSequence: finalProjection.worldSequence,
    finalStoryRunVersion: stored.version,
    maneuverEvents: maneuverEvents.map((event) => ({
      id: event.id,
      type: event.payloadJson?.maneuverType,
      versionBefore: event.payloadJson?.versionBefore,
      versionAfter: event.payloadJson?.versionAfter,
      fallbackUsed: event.payloadJson?.fallbackUsed,
    })),
    aiTasks: aiTasks.map((task) => ({
      id: task.id,
      status: task.status,
      provider: task.provider,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      errorMessage: task.errorMessage,
    })),
    providerCalls: provider.calls,
    checkpoints,
    browser: {
      screenshots: checkpoints.map((item) => item.screenshot),
      networkFile: path.join(EVIDENCE_ROOT, "browser-network.json"),
      consoleFile: path.join(EVIDENCE_ROOT, "browser-console.json"),
      apiFailures,
      consoleErrors: browserErrors,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(EVIDENCE_ROOT, "browser-network.json"), `${JSON.stringify(browserNetwork, null, 2)}\n`, "utf8");
  await writeFile(path.join(EVIDENCE_ROOT, "browser-console.json"), `${JSON.stringify(evidence.consoleReport(), null, 2)}\n`, "utf8");
  process.stdout.write(`OPENOVEL_MANEUVER_LIVE_BROWSER_PASS ${path.join(EVIDENCE_ROOT, "report.json")}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  fatalError = error;
  if (cdp) {
    await captureScreenshot(cdp, path.join(SCREENSHOT_ROOT, "failure.png")).catch(() => undefined);
  }
  const failure = {
    schemaVersion: "openovel_four_maneuver_live_browser_v1",
    verdict: "FAIL",
    runId: runId || null,
    roleSelectUrl,
    error: serializeError(error),
    checkpoints,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(failure, null, 2)}\n`, "utf8").catch(() => undefined);
  console.error(error instanceof Error ? error.stack || error.message : error);
} finally {
  await cdp?.close().catch(() => undefined);
  await browser?.stop().catch(() => undefined);
  for (const process of [...processes].reverse()) await stopProcess(process).catch(() => undefined);
  await closeServer(provider.server).catch(() => undefined);
}

if (fatalError) process.exitCode = 1;

async function createAuthenticatedAccount() {
  const registration = await requestJson(apiBase, "/v4/auth/register", {
    method: "POST",
    body: {
      email: EMAIL,
      password: PASSWORD,
      nickname: "OpenNovel Maneuver Live Browser",
    },
  });
  assert.equal(registration.payload.accepted, true);
  const token = await verificationToken(EMAIL);
  const verification = await requestJson(apiBase, "/v4/auth/verify", {
    method: "POST",
    body: { token },
  });
  assert.equal(verification.payload.verified, true);
  const login = await requestJson(apiBase, "/v4/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  const sessionToken = sessionTokenFromResponse(login.response);
  const cookie = `many_worlds_session=${sessionToken}`;
  const me = await requestJson(apiBase, "/v4/auth/me", { credential: cookie });
  assert.equal(me.payload.email, EMAIL);
  const onboarding = await requestJson(apiBase, "/v4/credits/onboarding", {
    method: "POST",
    credential: cookie,
    body: {},
  });
  return {
    userId: me.payload.id,
    sessionToken,
    onboardingCredits: Number(onboarding.payload.balance?.available || 0),
  };
}

async function readGameProjection() {
  return (await requestJson(apiBase, `/v4/rooms/${encodeURIComponent(runId)}/game`, {
    credential: `many_worlds_session=${sessionCookieValue}`,
  })).payload;
}

async function submitMainDecision(client, index) {
  await waitForSelector(client, "#submitDecision", 60_000);
  const before = await readGameProjection();
  const beforeSequence = Number(before.worldSequence || 0);
  await evaluate(client, `(() => {
    const choice = document.querySelector('input[name="decision"]');
    if (choice) choice.click();
    const button = document.querySelector('#submitDecision');
    if (!button) throw new Error('submitDecision button missing');
    button.click();
    return true;
  })()`);
  await waitFor(client, async () => {
    const latest = await readGameProjection().catch(() => null);
    return Number(latest?.worldSequence || 0) === beforeSequence + 1 ? latest : false;
  }, 120_000, `main OpenNovel turn ${index} did not commit`);
  await waitForSelector(client, "#continueStoryBtn", 120_000);
  await click(client, "#continueStoryBtn");
  await waitForSelector(client, "#submitDecision", 60_000);
}

async function enterDecisionScene(client) {
  await waitFor(client, async () => {
    const state = await evaluate(client, `(() => ({
      ready: document.readyState,
      begin: Boolean(document.querySelector('#beginStoryBtn')),
      buttons: document.querySelectorAll('[data-maneuver-type]').length,
      fatal: document.querySelector('[data-testid="fatal-error"]')?.innerText || '',
    }))()`);
    if (state.fatal) throw new Error(state.fatal);
    return state.ready === "complete" && (state.begin || state.buttons === 4) ? state : false;
  }, 60_000, "game page did not reach the opening or decision scene");
  if (await evaluate(client, "Boolean(document.querySelector('#beginStoryBtn'))")) {
    await click(client, "#beginStoryBtn");
  }
  await waitForSelector(client, '[data-maneuver-type="contact"]', 60_000);
}

async function assertFourButtonSurface(client, expected) {
  const surface = await evaluate(client, `(() => ({
    loadingText: document.body.innerText.includes('主动谋划配置正在加载'),
    buttons: [...document.querySelectorAll('[data-maneuver-type]')].map((button) => ({
      type: button.dataset.maneuverType,
      disabled: button.disabled,
      text: button.innerText,
    })),
  }))()`);
  assert.equal(surface.loadingText, false, "real OpenNovel page must not show the loading fallback");
  assert.equal(surface.buttons.length, 4);
  for (const [type, enabled] of Object.entries(expected)) {
    const button = surface.buttons.find((item) => item.type === type);
    assert.ok(button, `missing ${type} maneuver card`);
    assert.equal(button.disabled, !enabled, `${type} enabled state mismatch: ${button.text}`);
  }
  return surface;
}

async function checkpoint(client, name, options = {}) {
  if (options.expectedPath) {
    const pathname = await evaluate(client, "location.pathname");
    assert.equal(pathname, options.expectedPath);
  }
  const assertionResult = options.assertion ? await options.assertion() : null;
  const dom = await domSnapshot(client);
  const screenshot = path.join(SCREENSHOT_ROOT, `${name}.png`);
  await captureScreenshot(client, screenshot);
  const item = {
    name,
    url: dom.url,
    screenshot,
    dom,
    projection: options.projection ? compactProjection(options.projection) : null,
    assertionResult,
    extra: options.extra || null,
    recordedAt: new Date().toISOString(),
  };
  checkpoints.push(item);
  await writeFile(
    path.join(EVIDENCE_ROOT, "checkpoints.json"),
    `${JSON.stringify(checkpoints, null, 2)}\n`,
    "utf8",
  );
  return item;
}

function compactProjection(projection) {
  return {
    worldSequence: projection.worldSequence,
    maneuverVersion: projection.maneuverVersion,
    currentTurnId: projection.currentTurn?.id || null,
    currentTurnStatus: projection.currentTurn?.status || null,
    maneuverState: projection.maneuverState,
    maneuverPanel: {
      sceneKey: projection.maneuverPanel?.sceneKey,
      enabled: projection.maneuverPanel?.enabled,
      disabledReason: projection.maneuverPanel?.disabledReason,
      quota: projection.maneuverPanel?.quota,
      contact: section(projection.maneuverPanel?.contact),
      investigate: section(projection.maneuverPanel?.investigate),
      leverage: section(projection.maneuverPanel?.leverage),
      custom: section(projection.maneuverPanel?.custom),
    },
    leverageHand: projection.leverageHand,
    latestTimelineEntry: projection.timeline?.at(-1) || null,
  };
}

function section(value) {
  return value ? {
    enabled: value.enabled,
    usedToday: value.usedToday,
    count: value.count,
    disabledReason: value.disabledReason,
    optionKeys: Array.isArray(value.options)
      ? value.options.map((item) => item.roleKey || item.intentKey || item.leverageKey)
      : [],
  } : null;
}

async function domSnapshot(client) {
  return evaluate(client, `(() => ({
    url: location.href,
    title: document.title,
    buttons: [...document.querySelectorAll('[data-maneuver-type]')].map((button) => ({
      type: button.dataset.maneuverType,
      disabled: button.disabled,
      pressed: button.getAttribute('aria-pressed'),
      text: button.innerText,
    })),
    quotaText: document.querySelector('.maneuver-usage')?.innerText || '',
    decisionOpen: Boolean(document.querySelector('#submitDecision')),
    resultOpen: Boolean(document.querySelector('[data-testid="result-narrative"]')),
    guardText: document.querySelector('[data-testid="maneuver-guard"]')?.innerText || '',
    leverageHandText: document.querySelector('.leverage-panel')?.innerText || '',
  }))()`);
}

function installBrowserEvidence(client) {
  const requests = new Map();
  const consoleItems = [];
  client.on("Network.requestWillBeSent", (params) => {
    const url = String(params.request?.url || "");
    requests.set(params.requestId, {
      requestId: params.requestId,
      method: params.request?.method,
      url,
      body: safePostData(params.request?.postData),
      status: null,
      failed: false,
      errorText: null,
      startedAt: new Date().toISOString(),
    });
  });
  client.on("Network.responseReceived", (params) => {
    const record = requests.get(params.requestId);
    if (record) record.status = params.response?.status;
  });
  client.on("Network.loadingFailed", (params) => {
    const record = requests.get(params.requestId);
    if (record) {
      record.failed = true;
      record.errorText = params.errorText || "loading failed";
    }
  });
  client.on("Runtime.consoleAPICalled", (params) => {
    consoleItems.push({
      kind: "console",
      type: params.type,
      values: (params.args || []).map((item) => item.value ?? item.description ?? ""),
      timestamp: params.timestamp,
    });
  });
  client.on("Runtime.exceptionThrown", (params) => {
    consoleItems.push({
      kind: "exception",
      type: "error",
      text: params.exceptionDetails?.text || params.exceptionDetails?.exception?.description || "runtime exception",
      timestamp: params.timestamp,
    });
  });
  client.on("Log.entryAdded", (params) => {
    consoleItems.push({
      kind: "log",
      type: params.entry?.level,
      text: params.entry?.text,
      url: params.entry?.url,
      timestamp: params.entry?.timestamp,
    });
  });
  const networkReport = () => [...requests.values()].filter((item) =>
    item.url.startsWith(webBase) || item.url.startsWith(apiBase),
  );
  return {
    maneuverRequests: () => networkReport().filter((item) =>
      item.method === "POST" && /\/api\/v4\/rooms\/[^/]+\/game\/maneuvers$/.test(new URL(item.url).pathname),
    ),
    networkReport,
    consoleReport: () => consoleItems,
    errorReport: () => consoleItems.filter((item) =>
      item.kind === "exception" || item.type === "error",
    ),
  };
}

function safePostData(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed.password) parsed.password = "[REDACTED]";
    if (parsed.token) parsed.token = "[REDACTED]";
    return parsed;
  } catch {
    return String(value).slice(0, 2_000);
  }
}

async function launchBrowser() {
  const chromePath = findChrome();
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "omw-openovel-maneuver-chrome-"));
  const logPath = path.join(PROCESS_LOG_ROOT, "chrome.log");
  const log = createWriteStream(logPath, { flags: "w" });
  const child = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--window-size=1440,1050",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileRoot}`,
    "about:blank",
  ], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const activePortPath = path.join(profileRoot, "DevToolsActivePort");
  await waitFor(async () => existsSync(activePortPath), 30_000, "Chrome did not publish DevToolsActivePort");
  const lines = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
  const debugPort = Number(lines[0]);
  assert.ok(Number.isInteger(debugPort) && debugPort > 0);
  return {
    child,
    log,
    profileRoot,
    debugPort,
    async stop() {
      await stopChild(child);
      await endStream(log);
      await rm(profileRoot, { recursive: true, force: true });
    },
  };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const located = execFileSync("which", [candidate], { encoding: "utf8" }).trim();
      if (located) return located;
    } catch {}
  }
  throw new Error("A real Chrome/Chromium binary is required for browser acceptance");
}

async function connectToPage(debugPort) {
  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return false;
    const items = await response.json();
    const page = items.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    return page || false;
  }, 30_000, "Chrome page target unavailable");
  return CdpClient.connect(targets.webSocketDebuggerUrl);
}

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
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        try { listener(message.params || {}); } catch {}
      }
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP connection closed while waiting for ${pending.method}`));
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

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitFor(client, async () => {
    const state = await evaluate(client, "({ href: location.href, ready: document.readyState })");
    return state.href.startsWith(url.split("?", 1)[0]) && state.ready === "complete" ? state : false;
  }, 60_000, `navigation failed: ${url}`);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
  }
  return result.result?.value;
}

async function click(client, selector) {
  await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`Missing element ${selector}`)});
    if (element.disabled) throw new Error(${JSON.stringify(`Disabled element ${selector}`)});
    element.click();
    return true;
  })()`);
}

async function doubleClickSameElement(client, selector) {
  await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`Missing element ${selector}`)});
    element.click();
    element.click();
    return true;
  })()`);
}

async function fill(client, selector, value) {
  await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`Missing input ${selector}`)});
    element.focus();
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return element.value;
  })()`);
}

async function waitForSelector(client, selector, timeoutMs = 30_000) {
  return waitFor(client, async () => evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`), timeoutMs, `Missing selector ${selector}`);
}

async function captureScreenshot(client, filePath) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  }, 60_000);
  await writeFile(filePath, Buffer.from(result.data, "base64"));
}

function startLoggedProcess(name, command, args, extraEnv) {
  const logPath = path.join(PROCESS_LOG_ROOT, `${name}.log`);
  const log = createWriteStream(logPath, { flags: "w" });
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code, signal) => log.write(`\n[process-exit] code=${code} signal=${signal}\n`));
  return { name, child, log, logPath };
}

async function stopProcess(processInfo) {
  await stopChild(processInfo.child);
  await endStream(processInfo.log);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      delay(2_000),
    ]);
  }
}

async function endStream(stream) {
  if (!stream || stream.closed) return;
  await new Promise((resolve) => stream.end(resolve));
}

async function requestJson(base, route, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("accept", "application/json");
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.credential) headers.set("cookie", options.credential);
  const response = await fetch(`${base}${route}`, {
    method: options.method || "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${route} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { response, payload };
}

function sessionTokenFromResponse(response) {
  const values = response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = String(value).match(/(?:^|,\s*)many_worlds_session=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  throw new Error("login did not issue the HttpOnly session cookie");
}

async function verificationToken(email) {
  return waitFor(async () => {
    const content = await readFile(MAIL_SINK, "utf8").catch(() => "");
    const messages = content.trim().split(/\r?\n/).filter(Boolean).reverse();
    for (const line of messages) {
      const message = JSON.parse(line);
      if (String(message.to || "").toLowerCase() !== email.toLowerCase()) continue;
      const match = String(message.text || message.html || "").match(/https?:\/\/[^\s<]+/);
      if (!match) continue;
      const token = new URL(match[0].replace(/&amp;/g, "&")).searchParams.get("token");
      if (token) return token;
    }
    return false;
  }, 15_000, `verification mail not found for ${email}`);
}

async function waitForJson(url, predicate, timeoutMs) {
  return waitFor(async () => {
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) return false;
    const payload = await response.json().catch(() => null);
    return predicate(payload) ? payload : false;
  }, timeoutMs, `JSON endpoint did not become ready: ${url}`);
}

async function waitForHttp(url, timeoutMs) {
  return waitFor(async () => {
    const response = await fetch(url).catch(() => null);
    return response?.ok ? true : false;
  }, timeoutMs, `HTTP endpoint did not become ready: ${url}`);
}

async function waitFor(...args) {
  let client = null;
  let action;
  let timeoutMs;
  let message;
  if (args[0] instanceof CdpClient) {
    [client, action, timeoutMs = 30_000, message = "condition not met"] = args;
  } else {
    [action, timeoutMs = 30_000, message = "condition not met"] = args;
  }
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await action(client);
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message || lastError}` : ""}`);
}

function scriptedProvider() {
  let narratorIndex = 0;
  const calls = { narrator: 0, options: 0, storykeeper: 0 };
  const narrations = [
    "巡抚书吏听见总督的选择，捧匣的手略沉了一沉。他没有替中丞多说，只把催办时限与当前卷册一并陈明。县令亲随则守在案侧，提醒清流原册仍待正式命令。两边各自说清了一层，案上的公文却仍没有落印。",
    "书吏把目光收回公文末页，答得比先前更慢：浙江不能没有章程，总督若暂缓，也必须给出何时、由谁查清的准话。县令亲随在旁听着，低声说明清流路远，今日若发命，明早还能赶在开衙前到县。",
    "总督府的命令一经落笔，内厅里的争执便从口头变成了可追查的路径。巡抚书吏记下措辞，县令亲随也把需要送往清流的事项逐条复述，双方都没有替对方承担尚未承认的责任。",
    "次日的消息陆续回到总督府。原册、催办文书与商会说辞并未自然吻合，反而留下了几处需要继续核对的空隙。幕僚把这些差异排在案上，等待总督决定下一步先问谁、先查什么。",
    "新的回报没有替总督作出结论，只把人物立场和可核验事实进一步分开。巡抚仍催进度，县令仍强调原册，商会则开始计算自己愿意付出的条件。主线选择仍然掌握在总督手中。",
    "局势继续向前推进。此前的人物回应、调查记录与已消耗筹码都被保留在同一故事线上，没有任何一项主动谋划替代当前主线决策。",
  ];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw || "{}");
    if (body.model === "mock-narrator") {
      calls.narrator += 1;
      const text = narrations[narratorIndex++] || narrations.at(-1);
      if (body.stream === false) return completion(response, text, "mock-narrator");
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "x-request-id": `fixture-narrator-${calls.narrator}`,
      });
      for (const piece of splitText(text, 32)) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      response.write(`data: ${JSON.stringify({
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 120, completion_tokens: 90 },
      })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }
    if (body.model === "mock-options") {
      calls.options += 1;
      return completion(response, JSON.stringify({
        framing: "",
        options: [
          { label: "让两边各自写下一句可核对的话。" },
          { label: "先定下明早查验原册的人选。" },
          { label: "暂缓落印，要求补齐经手记录。" },
        ],
        tension: "期限正在收紧",
        storyComplete: false,
      }), "mock-options");
    }
    if (body.model === "mock-storykeeper") {
      calls.storykeeper += 1;
      return completion(response, JSON.stringify({
        summary: "已将本轮变化写入下一轮工作集。",
        sections: {
          "scene.md": "## Scene\n\n- 总督府内厅，人物立场与卷册事实继续分开核验。",
          "open-threads.md": "## Open Threads\n\n- 巡抚需要答复；清流原册与商会说辞仍待核验。",
        },
        contextCards: [],
        qualityNotes: "",
      }), "mock-storykeeper");
    }
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `unknown mock model ${body.model}` } }));
  });
  return { server, calls };
}

function completion(response, content, model) {
  response.writeHead(200, {
    "content-type": "application/json",
    "x-request-id": `fixture-${model}-${Date.now()}`,
  });
  response.end(JSON.stringify({
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 90 },
  }));
}

function splitText(value, size) {
  const pieces = [];
  for (let index = 0; index < value.length; index += size) pieces.push(value.slice(index, index + size));
  return pieces;
}

async function reservePort() {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not expose a TCP port");
  return address.port;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

function serializeError(error) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { value: String(error) };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
