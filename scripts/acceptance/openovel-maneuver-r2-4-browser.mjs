import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { classifyManeuverRequest, stableClone } from "./openovel-maneuver-preview-confirm-contract.mjs";
import {
  captureBrowserEvidence,
  click,
  connectPage,
  evaluate,
  fill,
  isSuccessfulRequest,
  launchChrome,
  navigate,
  screenshot,
  waitSelector,
  waitUntil,
} from "./openovel-maneuver-r2-4-browser-cdp.mjs";
import { createManeuverAcceptanceHarness } from "./openovel-maneuver-r2-4-browser-harness.mjs";

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
let harness = null;

try {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  browser = await launchChrome(EVIDENCE_ROOT);
  cdp = await connectPage(browser.debugPort);
  const browserEvidence = captureBrowserEvidence(cdp);
  harness = createManeuverAcceptanceHarness({
    cdp,
    prisma,
    getRunId: () => runId,
    apiBase: API_BASE,
    sessionCookie: SESSION_COOKIE,
    evidenceRoot: EVIDENCE_ROOT,
    browserEvidence,
    providerSnapshot,
  });
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
  await harness.checkpoint("01-role-select");
  await click(cdp, "#enterRole");
  const gameUrl = await waitUntil(async () => {
    const href = await evaluate(cdp, "location.href");
    return /\/game\?runId=/.test(href) ? href : false;
  }, 120_000, "role-select did not create a real OpenNovel run");
  runId = new URL(gameUrl).searchParams.get("runId") || "";
  assert.match(runId, /^solo_ovl_[a-f0-9]{32}$/);
  await harness.enterScene();

  const opening = await harness.projection();
  assert.equal(opening.worldSequence, 0);
  assert.equal(opening.maneuverPanel.quota.remaining, 2);
  assert.equal(opening.maneuverPanel.contact.enabled, true);
  assert.equal(opening.maneuverPanel.investigate.enabled, true);
  await harness.checkpoint("02-opening", opening);

  const contactMessageInitial = "原始名册是否完整？";
  const contactMessageFinal = "原始名册是否完整？明日之前能否送到总督府？";
  await harness.exerciseManeuver({
    label: "contact",
    maneuverType: "contact",
    workbenchSelector: '[data-testid="maneuver-contact-workbench"]',
    expectedAiTaskDelta: 1,
    expectedProviderCallDelta: null,
    firstPreviewPattern: /原始名册是否完整/,
    secondPreviewPattern: /明日之前|送到总督府/,
    async prepare() {
      await click(cdp, '[data-maneuver-type="contact"]');
      await waitSelector(cdp, '[data-testid="maneuver-contact-workbench"]');
      await click(cdp, '[data-contact-role="county_magistrate"]');
      await fill(cdp, "#contactMessageText", contactMessageInitial);
    },
    async assertDraft(expected = contactMessageInitial) {
      const draft = await evaluate(cdp, `({
        value: document.querySelector('#contactMessageText')?.value || '',
        selected: document.querySelector('[data-contact-role="county_magistrate"]')?.classList.contains('selected') || false
      })`);
      assert.equal(draft.value, expected);
      assert.equal(draft.selected, true);
    },
    async afterCancel() {
      await fill(cdp, "#contactMessageText", contactMessageFinal);
    },
    async assertEditedDraft() {
      await this.assertDraft(contactMessageFinal);
    },
    assertPreviewRequest(request, pass) {
      assert.equal(request.requestBody?.maneuverType, "contact");
      assert.equal(request.requestBody?.targetRoleKey, "county_magistrate");
      assert.equal(request.requestBody?.messageText, pass === 1 ? contactMessageInitial : contactMessageFinal);
      assert.ok(request.requestBody?.idempotencyKey);
    },
    async assertConfirmed(game) {
      assert.equal(game.timeline.filter((item) => item.decisionForm === "CONVERSATION").length, 1);
      assert.ok(game.maneuverState.usedTypesToday.includes("contact"));
    },
  });

  const investigationProjection = await harness.projection();
  const investigationOption = investigationProjection.maneuverPanel.investigate.options[0];
  assert.ok(investigationOption?.intentKey);
  await harness.exerciseManeuver({
    label: "investigate",
    maneuverType: "investigate",
    workbenchSelector: '[data-testid="maneuver-investigate-workbench"]',
    expectedAiTaskDelta: 0,
    expectedProviderCallDelta: 0,
    firstPreviewPattern: new RegExp(escapeRegExp(investigationOption.title || "调查")),
    secondPreviewPattern: new RegExp(escapeRegExp(investigationOption.title || "调查")),
    async prepare() {
      await click(cdp, '[data-maneuver-type="investigate"]');
      await waitSelector(cdp, '[data-testid="maneuver-investigate-workbench"]');
      const selected = await evaluate(cdp, `document.querySelector('[data-investigation-key="${escapeJs(investigationOption.intentKey)}"]')?.classList.contains('selected') || false`);
      if (!selected) await click(cdp, `[data-investigation-key="${cssAttribute(investigationOption.intentKey)}"]`);
    },
    async assertDraft() {
      assert.equal(
        await evaluate(cdp, `document.querySelector('[data-investigation-key="${escapeJs(investigationOption.intentKey)}"]')?.classList.contains('selected') || false`),
        true,
      );
      assert.equal(await evaluate(cdp, "Boolean(document.querySelector('#contactMessageText, #customManeuverText'))"), false);
    },
    assertPreviewRequest(request) {
      assert.equal(request.requestBody?.maneuverType, "investigate");
      assert.equal(request.requestBody?.intentKey, investigationOption.intentKey);
      assert.ok(request.requestBody?.idempotencyKey);
    },
    async assertConfirmed(game) {
      assert.ok(game.maneuverState.usedTypesToday.includes("investigate"));
      assert.ok(game.maneuverState.discoveredFactKeys.includes("first_registers_prepared_early"));
    },
  });

  for (let index = 0; index < 4; index += 1) await harness.submitMainTurn(index + 1);
  const dayTwo = await harness.projection();
  assert.equal(dayTwo.worldSequence, 4);
  assert.equal(dayTwo.maneuverPanel.quota.remaining, 2);
  assert.equal(dayTwo.maneuverPanel.leverage.enabled, true);
  assert.ok(dayTwo.maneuverPanel.leverage.options.some((item) => item.leverageKey === "county_letter"));
  await harness.checkpoint("07-day-two-main-story", dayTwo);

  await harness.exerciseManeuver({
    label: "leverage",
    maneuverType: "leverage",
    workbenchSelector: '[data-testid="maneuver-leverage-workbench"]',
    expectedAiTaskDelta: 1,
    expectedProviderCallDelta: null,
    firstPreviewPattern: /使用并消耗|县令密信/,
    secondPreviewPattern: /使用并消耗|县令密信/,
    async prepare() {
      await click(cdp, '[data-maneuver-type="leverage"]');
      await waitSelector(cdp, '[data-testid="maneuver-leverage-workbench"]');
      await click(cdp, '[data-leverage-key="county_letter"]');
      await click(cdp, '[data-leverage-target="xunfu"]');
    },
    async assertDraft() {
      const draft = await evaluate(cdp, `({
        leverage: document.querySelector('[data-leverage-key="county_letter"]')?.classList.contains('selected') || false,
        target: document.querySelector('[data-leverage-target="xunfu"]')?.classList.contains('selected') || false
      })`);
      assert.equal(draft.leverage, true);
      assert.equal(draft.target, true);
      assert.equal(await evaluate(cdp, "Boolean(document.querySelector('#contactMessageText, #customManeuverText'))"), false);
    },
    assertPreviewRequest(request) {
      assert.equal(request.requestBody?.maneuverType, "leverage");
      assert.equal(request.requestBody?.leverageKey, "county_letter");
      assert.equal(request.requestBody?.targetRoleKey, "xunfu");
      assert.ok(request.requestBody?.idempotencyKey);
    },
    async assertConfirmed(game) {
      assert.ok(game.maneuverState.usedLeverageKeys.includes("county_letter"));
      assert.ok(game.maneuverState.usedTypesToday.includes("leverage"));
      assert.equal(game.leverageHand.items.some((item) => item.leverageKey === "county_letter"), false);
    },
    async assertPersisted(game) {
      await this.assertConfirmed(game);
      assert.doesNotMatch(
        await evaluate(cdp, "document.querySelector('.leverage-panel')?.innerText || ''"),
        /清流县令密信/,
      );
    },
  });

  const customInitial = "派幕僚核验驿站登记。";
  const customFinal = "派幕僚核验驿站登记，并记录经手人。";
  await harness.exerciseManeuver({
    label: "custom",
    maneuverType: "custom",
    workbenchSelector: '[data-testid="maneuver-custom-workbench"]',
    expectedAiTaskDelta: 0,
    expectedProviderCallDelta: 0,
    firstPreviewPattern: /核验驿站登记/,
    secondPreviewPattern: /记录经手人|核验驿站登记/,
    async prepare() {
      await click(cdp, '[data-maneuver-type="custom"]');
      await waitSelector(cdp, '[data-testid="maneuver-custom-workbench"]');
      await fill(cdp, "#customManeuverText", customInitial);
    },
    async assertDraft(expected = customInitial) {
      assert.equal(await evaluate(cdp, "document.querySelector('#customManeuverText')?.value || ''"), expected);
    },
    async afterCancel() {
      await fill(cdp, "#customManeuverText", customFinal);
    },
    async assertEditedDraft() {
      await this.assertDraft(customFinal);
    },
    assertPreviewRequest(request, pass) {
      assert.equal(request.requestBody?.maneuverType, "custom");
      assert.equal(request.requestBody?.customText, pass === 1 ? customInitial : customFinal);
      assert.ok(request.requestBody?.idempotencyKey);
    },
    async assertConfirmed(game) {
      assert.ok(game.maneuverState.usedTypesToday.includes("custom"));
      assert.equal(game.maneuverPanel.quota.remaining, 0);
      assert.deepEqual([...game.maneuverState.usedTypesToday].sort(), ["custom", "leverage"]);
    },
  });

  await harness.submitMainTurn(5);
  const finalProjection = await harness.projection();
  assert.equal(finalProjection.worldSequence, 5);
  assert.ok(finalProjection.currentTurn, "main story must remain playable after all four maneuver forms");
  const database = await harness.databaseEvidence();
  assert.equal(database.events.length, 4);
  assert.deepEqual(database.events.map((item) => item.maneuverType).sort(), ["contact", "custom", "investigate", "leverage"]);
  assert.equal(database.events.every((item) => item.visibility === "player_visible"), true);
  assert.equal(database.tasks.length, 2, "only contact and AI-reaction leverage should create AI tasks");
  await harness.checkpoint("13-main-story-still-open", finalProjection, { database });

  const network = browserEvidence.network();
  const maneuverRequests = browserEvidence.maneuverRequests();
  const previewRequests = maneuverRequests.filter((item) => classifyManeuverRequest(item.url) === "preview");
  const confirmRequests = maneuverRequests.filter((item) => classifyManeuverRequest(item.url) === "confirm");
  const legacyRequests = maneuverRequests.filter((item) => classifyManeuverRequest(item.url) === "legacy");
  assert.equal(previewRequests.length, 8, "each of four maneuvers must Preview, cancel, and Preview again");
  assert.equal(confirmRequests.length, 4, "each maneuver must Confirm exactly once");
  assert.deepEqual(legacyRequests, [], "the obsolete direct-submit endpoint must not be used");
  assert.equal(maneuverRequests.every(isSuccessfulRequest), true, "all Preview and Confirm requests must complete successfully");
  assert.deepEqual(network.filter((item) => item.failed || Number(item.status || 0) >= 400), []);
  assert.deepEqual(browserEvidence.console().filter((item) => item.kind === "exception" || item.type === "error"), []);

  const report = {
    schemaVersion: "openovel_maneuver_r2_4_browser_preview_confirm_v2",
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
    legacyRequestCount: legacyRequests.length,
    providerCalls: providerSnapshot(),
    maneuverAudits: harness.maneuverAudits,
    checkpoints: harness.checkpoints,
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
    schemaVersion: "openovel_maneuver_r2_4_browser_preview_confirm_v2",
    verdict: "FAIL",
    runId: runId || null,
    roleSelectUrl: ROLE_SELECT_URL,
    error: serializeError(error),
    maneuverAudits: harness?.maneuverAudits || [],
    checkpoints: harness?.checkpoints || [],
    startedAt,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8").catch(() => undefined);
  throw error;
} finally {
  await cdp?.close().catch(() => undefined);
  await browser?.stop().catch(() => undefined);
  await prisma.$disconnect();
}

function providerSnapshot() {
  const calls = globalThis.__OPENOVEL_MANEUVER_PROVIDER_CALLS__;
  return calls && typeof calls === "object" ? stableClone(calls) : null;
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

function cssAttribute(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeJs(value) {
  return String(value).replace(/[\\']/g, "\\$&");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  };
}
