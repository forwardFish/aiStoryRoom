import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  A_EMOTION_E2E_GENERATION_POLL_DEADLINE_MS,
  A_EMOTION_E2E_MODEL_REQUEST_TIMEOUT_MS,
  A_EMOTION_E2E_RUNTIME_MARKERS,
  A_EMOTION_E2E_SHORT_REQUEST_TIMEOUT_MS,
  buildAEmotionE2ESimplePromiseCommand,
  findForbiddenNetworkPaths,
  generationTimeoutDiagnostic,
  hashIdentifier,
  isStoryGenerationInProgress,
  redactDynamicApiPath,
  sanitizeEvidence
} from "./a-emotion-m6-e2e-contract.mts";

const baseUrl = required("A_EMOTION_M6_BASE_URL").replace(/\/$/u, "");
const apiBase = required("A_EMOTION_M6_API_BASE").replace(/\/$/u, "");
const roomId = required("A_EMOTION_M6_ROOM_ID");
const stateFile = required("A_EMOTION_M6_PLAYER_STATES_JSON");
const evidenceDir = resolve(required("A_EMOTION_M6_EVIDENCE_DIR"));
const states = JSON.parse(await readFile(stateFile, "utf8")) as PlayerState[];
const prisma = new PrismaClient({ datasources: { db: { url: required("DATABASE_URL") } } });
const requiredRoles: RoleKey[] = ["zhejiang_governor", "xunfu", "county_magistrate"];
assert.deepEqual([...states.map((entry) => entry.roleKey)].sort(), [...requiredRoles].sort(), "M6 E2E requires governor/xunfu/county_magistrate exactly once");
assert.equal(process.env.A_EMOTION_M6_REQUIRE_REAL_MODEL, "true", "the browser acceptance gate must explicitly require the real model");
await mkdir(resolve(evidenceDir, "screenshots"), { recursive: true });

const forbiddenKeys = new Set(["sourceRoleId", "sourceRoleKey", "sourceRoleName", "sourceActionId", "playerActionId", "rawAction", "rawAudience", "audienceRoleIds", "audienceUserIds", "dedupeKey", "internalDedupeKey", "canonicalPayload", "privatePayload"]);
const checkpoints: Checkpoint[] = [];
const network: NetworkRecord[] = [];
const consoleRecords: ConsoleRecord[] = [];
const severeBrowserErrors: ConsoleRecord[] = [];
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all(states.map((entry) => browser.newContext({ storageState: entry.storageState, viewport: { width: 1440, height: 900 }, recordVideo: undefined })));
const windows = await Promise.all(contexts.map(async (context) => ({ primary: await context.newPage(), secondary: await context.newPage() })));
const windowRecords = states.flatMap((state, index) => ([
  { roleKey: state.roleKey, windowKey: "primary" as const, page: windows[index].primary },
  { roleKey: state.roleKey, windowKey: "secondary" as const, page: windows[index].secondary }
]));
const pages = windowRecords.map((entry) => entry.page);

try {
  await prisma.$connect();
  for (const record of windowRecords) installObservers(record.page, record.roleKey, record.windowKey);
  await Promise.all(pages.map((page) => page.goto(`${baseUrl}/game?runId=${encodeURIComponent(roomId)}`, { waitUntil: "networkidle" })));
  await Promise.all(pages.map((page) => page.locator('[data-testid="story-shell"], [data-testid="continuous-story-v2-shell"]').first().waitFor({ state: "attached", timeout: 60_000 })));
  for (const record of windowRecords) await assertApprovedUiBoundary(record.page);

  await checkpoint("E2E-01", "three roles see distinct private information", async () => {
    const projections = await Promise.all(requiredRoles.map((role) => game(role)));
    assert.equal(new Set(projections.map((projection) => projection.player.roleKey)).size, 3);
    const privateFingerprints = projections.map((projection) => sha256(JSON.stringify({ narrative: projection.currentTurn?.narrative, facts: projection.currentTurn?.visibleFacts, goal: projection.player.personalGoal })));
    assert.equal(new Set(privateFingerprints).size, 3, "each role must receive a distinct private projection");
    await screenshotAll("e2e-01-private-info");
  });

  await checkpoint("E2E-02", "formal promise is private from county magistrate", async () => {
    await submitFormalPromise("xunfu", "zhejiang_governor", "DELIVER_ORIGINAL_LEDGER");
    const [governor, xunfu, county] = await Promise.all(requiredRoles.map((role) => game(role)));
    assert.ok(governor.commitments.some((item: any) => item.promiseCode === "DELIVER_ORIGINAL_LEDGER"));
    assert.ok(xunfu.commitments.some((item: any) => item.promiseCode === "DELIVER_ORIGINAL_LEDGER"));
    assert.equal(county.commitments.some((item: any) => item.promiseCode === "DELIVER_ORIGINAL_LEDGER"), false);
    const db = await prisma.commitmentV2.findFirstOrThrow({ where: { runId: roomId, promiseCode: "DELIVER_ORIGINAL_LEDGER" } });
    assert.equal(db.status, "ACTIVE");
  });

  await checkpoint("E2E-03", "hidden catalog action persists the authoritative metric and viewer-safe delivery split", async () => {
    await advanceUntilCatalogAction("xunfu", "main_s2_xunfu_seize_drafts");
    const beforeProjection = await game("zhejiang_governor");
    const beforeTrust = metricValue(beforeProjection, "imperial_trust");
    const [beforeCounty, beforeXunfu] = await Promise.all([events("county_magistrate"), events("xunfu")]);
    const beforeCountyIds = new Set((beforeCounty.interactionFeed?.items || []).map((item: any) => item.eventId));
    const beforeXunfuIds = new Set((beforeXunfu.interactionFeed?.items || []).map((item: any) => item.eventId));

    await submitCatalogAction("xunfu", "main_s2_xunfu_seize_drafts", "hidden-seize");
    const related = await waitForInteraction("zhejiang_governor", (item) => item.category === "RELATED" && item.disclosure === "HIDDEN");
    assert.equal(related.statusLabel, "来源未知");
    assert.equal("visibleSourceRoleId" in related, false);
    assert.deepEqual(findForbiddenPaths(related), []);
    const trustTransition = (related.metricTransitions || []).find((item: any) => item.key === "imperial_trust");
    assert.ok(trustTransition, "HIDDEN impact must expose the viewer-safe authoritative metric before/after");
    assert.equal(trustTransition.from, beforeTrust);
    assert.equal(trustTransition.to, beforeTrust + trustTransition.delta);
    const afterProjection = await waitForDb(async () => {
      const projection = await game("zhejiang_governor");
      return metricValue(projection, "imperial_trust") === trustTransition.to ? projection : null;
    }, 120_000, "governor authoritative metric transition");
    assert.equal(metricValue(afterProjection, "imperial_trust"), trustTransition.to);

    const [countyPage, xunfuPage] = await Promise.all([events("county_magistrate"), events("xunfu")]);
    const countyNew = (countyPage.interactionFeed?.items || []).filter((item: any) => !beforeCountyIds.has(item.eventId));
    assert.ok(countyNew.length >= 1, "county magistrate must receive the allowed observable trace");
    assert.ok(countyNew.every((item: any) => item.category === "SUSPICIOUS" && item.disclosure !== "CONFIRMED"));
    assert.ok(countyNew.every((item: any) => !("visibleSourceRoleId" in item)));
    const xunfuNew = (xunfuPage.interactionFeed?.items || []).filter((item: any) => !beforeXunfuIds.has(item.eventId));
    assert.equal(xunfuNew.length, 0, "unrelated/source viewer must receive no extra delivery for the target-only impact");
    assert.doesNotMatch(JSON.stringify(await events("zhejiang_governor")), /sourceRoleId|sourceRoleKey|rawAction|rawAudience|dedupeKey/u);
    await refreshRole("zhejiang_governor");
    await screenshotRole("zhejiang_governor", "e2e-03-hidden-feed");
  });

  await checkpoint("E2E-04", "feed detail opens and investigation prefill submits through normal product API", async () => {
    const page = pageFor("zhejiang_governor");
    const feed = page.locator('[data-testid="aemotion-m1-feed"]');
    await feed.waitFor({ state: "visible", timeout: 60_000 });
    const item = feed.locator("[data-aemotion-open]").first();
    await item.click();
    await page.locator('[data-testid="aemotion-m1-cross-impact"]').waitFor({ state: "visible", timeout: 30_000 });
    const investigate = page.locator('[data-aemotion-response="INVESTIGATE_LEDGER_ANOMALY"]').first();
    await investigate.click();
    const custom = page.locator("#maneuverCustomText").first();
    await custom.waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await custom.inputValue(), /.+/u);
    const before = await game("zhejiang_governor");
    const beforeTurnId = String(before.currentTurn?.id || "");
    assert.ok(beforeTurnId, "investigation submission requires the current authoritative turn");
    const submitted = page.waitForResponse((response: any) => response.url().includes(`/api/v4/rooms/${roomId}/game/turns/`) && response.request().method() === "POST", { timeout: A_EMOTION_E2E_MODEL_REQUEST_TIMEOUT_MS });
    await page.locator("#maneuverSubmit").click();
    const response = await submitted;
    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok()) {
      assert.equal(response.status(), 503);
      assert.equal(responsePayload.code, "STORY_GENERATION_IN_PROGRESS");
    }
    await waitForAuthoritativeDecisionCompletion("zhejiang_governor", beforeTurnId, Number(before.currentTurn?.revision || 0), Number(before.worldSequence || 0), {
      status: response.status(),
      code: String(responsePayload.code || (response.ok() ? "DECISION_ACCEPTED" : "UNKNOWN"))
    });
  });

  await checkpoint("E2E-05", "authoritative investigation upgrades HIDDEN to SUSPECTED in the same aggregate", async () => {
    await advanceUntilCatalogAction("zhejiang_governor", "main_s2_governor_dual_verification");
    const before = await latestRelated("zhejiang_governor");
    await submitCatalogAction("zhejiang_governor", "main_s2_governor_dual_verification", "suspected-upgrade");
    const after = await waitForInteraction("zhejiang_governor", (item) => item.disclosure === "SUSPECTED" && item.aggregateId === before.aggregateId);
    assert.equal(after.aggregateId, before.aggregateId);
    assert.ok(after.projectionVersion > before.projectionVersion);
    assert.equal("visibleSourceRoleId" in after, false);
    assert.deepEqual(findForbiddenPaths(after), []);
  });

  await checkpoint("E2E-06", "confirmed original aggregate reveals PromiseBroken once and persists in 世界局势", async () => {
    const originalAggregate = await latestRelated("zhejiang_governor");
    await advanceUntilCatalogAction("zhejiang_governor", "main_s4_governor_seal_evidence");
    await submitCatalogAction("zhejiang_governor", "main_s4_governor_seal_evidence", "confirmed-reveal");
    const confirmed = await waitForInteraction("zhejiang_governor", (item) => item.disclosure === "CONFIRMED" && item.centerCardType === "PROMISE_BROKEN");
    assert.equal(confirmed.aggregateId, originalAggregate.aggregateId, "CONFIRMED must upgrade the original aggregate instead of creating a duplicate row");
    assert.ok(confirmed.visibleSourceRoleId);
    assert.ok(Array.isArray(confirmed.evidenceRefs) && confirmed.evidenceRefs.length > 0);
    const primary = pageFor("zhejiang_governor");
    const secondary = pageFor("zhejiang_governor", "secondary");
    await refreshRole("zhejiang_governor");
    const modal = primary.locator('[data-testid="aemotion-promise-broken-modal"]');
    await modal.waitFor({ state: "visible", timeout: 60_000 });
    assert.equal(await modal.count(), 1);
    await primary.locator('[data-testid="aemotion-promise-broken-modal"] button').first().click();
    const situation = primary.locator('[data-aemotion-world-situation="true"]');
    await situation.waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await situation.textContent() || "", new RegExp(escapeRegExp(confirmed.title), "u"));
    await primary.reload({ waitUntil: "networkidle" });
    await secondary.reload({ waitUntil: "networkidle" });
    await primary.waitForTimeout(1_500);
    assert.equal(await primary.locator('[data-testid="aemotion-promise-broken-modal"]').count(), 0, "acknowledged PromiseBroken modal must not replay after refresh");
    assert.equal(await secondary.locator('[data-testid="aemotion-promise-broken-modal"]').count(), 0, "second window must not replay the durable modal");
    assert.match(await primary.locator('[data-aemotion-world-situation="true"]').textContent() || "", new RegExp(escapeRegExp(confirmed.title), "u"));
    const promise = await prisma.commitmentV2.findFirstOrThrow({ where: { runId: roomId, promiseCode: "DELIVER_ORIGINAL_LEDGER" } });
    assert.equal(promise.status, "REVEALED");
  });

  await checkpoint("E2E-07", "CRISIS UI exposes 23→18 before one modal and 18→16 does not replay", async () => {
    const page = pageFor("zhejiang_governor");
    await waitForUiText(page, /23\s*(?:→|->)\s*18/u, 120_000, "visible 23→18 trust transition");
    const crisis = await waitForModal("zhejiang_governor", "CRISIS", 120_000);
    const modal = page.locator('[data-testid="aemotion-crisis-modal"]');
    await modal.waitFor({ state: "visible", timeout: 60_000 });
    assert.equal(await modal.count(), 1);
    assert.match(`${crisis.title} ${crisis.summary} ${(crisis.facts || []).join(" ")}`, /18/u);
    const transitions = await prisma.aEmotionMetricTransition.findMany({ where: { runId: roomId, metricKey: "imperial_trust" }, orderBy: { createdAt: "asc" } });
    const entering = transitions.find((entry: any) => entry.previousValue === 23 && entry.currentValue === 18);
    assert.ok(entering, "real run must persist the frozen 23→18 CRISIS transition");
    const dangerContinuation = transitions.find((entry: any) => entry.previousValue === 18 && entry.currentValue === 16);
    assert.ok(dangerContinuation, "real run must persist the 18→16 continuation transition");
    assert.equal(dangerContinuation.triggerVersion, entering.triggerVersion, "remaining in danger must not create a new trigger version");
    await acknowledgeModal("zhejiang_governor", crisis);
    await refreshRole("zhejiang_governor");
    assert.equal(await page.locator('[data-testid="aemotion-crisis-modal"]').count(), 0);
    await page.waitForTimeout(1_000);
    assert.equal(await page.locator('[data-testid="aemotion-crisis-modal"]').count(), 0, "18→16 must not produce a second CRISIS modal");
  });

  await checkpoint("E2E-08", "StageVictory exposes full 0→12 transition once and persists in 世界局势", async () => {
    const page = pageFor("zhejiang_governor");
    await waitForUiText(page, /0\s*%?\s*(?:→|->)\s*12\s*%?/u, 120_000, "visible 0→12 reform transition");
    const victory = await waitForModal("zhejiang_governor", "STAGE_VICTORY", 120_000);
    const modal = page.locator('[data-testid="aemotion-stage-victory-modal"]');
    await modal.waitFor({ state: "visible", timeout: 60_000 });
    assert.equal(await modal.count(), 1);
    const milestone = await prisma.aEmotionStageMilestone.findFirstOrThrow({ where: { runId: roomId, milestoneCode: "CONTROL_ORIGINAL_LEDGER", status: "ACHIEVED" } });
    const reward = milestone.rewardJson as Record<string, unknown>;
    assert.equal(reward.metricBefore, 0);
    assert.equal(reward.metricAfter, 12);
    const projection = await game("zhejiang_governor");
    const reform = projection.world?.presentation?.statusMetrics?.find((metric: any) => metric.key === "reform_progress");
    assert.equal(reform?.value, 12);
    await acknowledgeModal("zhejiang_governor", victory);
    await refreshRole("zhejiang_governor");
    assert.equal(await page.locator('[data-testid="aemotion-stage-victory-modal"]').count(), 0);
    const situationText = await page.locator('[data-aemotion-world-situation="true"]').textContent() || "";
    assert.match(situationText, /12/u, "closed StageVictory must remain visible in 世界局势");
  });

  await checkpoint("E2E-09", "six real events render strict 3/6, internal overflow, non-jump and a return-to-top chip", async () => {
    await ensureRealFeedCount("zhejiang_governor", 6);
    const page = pageFor("zhejiang_governor");
    await refreshRole("zhejiang_governor");
    const feed = page.locator('[data-testid="aemotion-m1-feed"]');
    const list = feed.locator("[data-aemotion-feed-list]");
    await setFeedExpanded(page, false);
    assert.equal(await list.locator("[data-aemotion-open]").count(), 3, "collapsed feed must show exactly 3 real events");
    await feed.locator("[data-aemotion-expand]").click();
    assert.equal(await list.locator("[data-aemotion-open]").count(), 6, "expanded feed must show exactly 6 real events");
    const overflow = await list.evaluate((element: HTMLElement) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    assert.ok(overflow.scrollHeight > overflow.clientHeight, "six-item feed must use an internal scrollbar");
    await list.evaluate((element: HTMLElement) => { element.scrollTop = Math.max(20, element.scrollHeight - element.clientHeight); });
    const beforeTop = await list.evaluate((element: HTMLElement) => element.scrollTop);
    await submitRealActionProducingFeed("zhejiang_governor", "feed-new-item");
    const chip = feed.locator("[data-aemotion-new-events]");
    await chip.waitFor({ state: "visible", timeout: 60_000 });
    const afterTop = await list.evaluate((element: HTMLElement) => element.scrollTop);
    assert.ok(afterTop >= Math.max(0, beforeTop - 2), "new feed event must preserve the user's scroll position");
    await chip.click();
    assert.equal(await list.evaluate((element: HTMLElement) => element.scrollTop), 0);
  });

  await checkpoint("E2E-10", "idempotency, second-window reconnect, receipts and durable recovery remain duplicate-free", async () => {
    const governorProjection = await waitForOpenTurn("zhejiang_governor");
    const candidate = governorProjection.currentTurn.decisions.find((entry: any) => typeof entry.actionKey === "string");
    assert.ok(candidate, "E2E-10 must execute a real catalog action; conditional skipping is forbidden");
    const command = decisionCommand(governorProjection, candidate, "idempotent-replay");
    const stableIdempotencyKey = command.idempotencyKey;
    const first = await submitDecisionWithCompletion("zhejiang_governor", governorProjection, command);
    assert.equal(command.idempotencyKey, stableIdempotencyKey, "the accepted action body must keep its original idempotencyKey");
    const replay = await submitDecisionWithCompletion("zhejiang_governor", governorProjection, command);
    assert.equal(command.idempotencyKey, stableIdempotencyKey, "the replay must use the byte-equivalent action command and must not mint a second idempotencyKey");
    if (first.resolution?.id || replay.resolution?.id) assert.equal(replay.resolution?.id, first.resolution?.id);
    const persistedActions = await prisma.playerAction.findMany({
      where: { runId: roomId, idempotencyKey: stableIdempotencyKey },
      select: { id: true, idempotencyKey: true }
    });
    assert.equal(persistedActions.length, 1, "the repeated decision request must persist exactly one PlayerAction");

    const latest = await latestRelated("zhejiang_governor");
    const seen1 = await receipt("zhejiang_governor", latest, "seen");
    const seen2 = await receipt("zhejiang_governor", latest, "seen");
    assert.equal(seen2.seenAt, seen1.seenAt);
    const ack1 = await receipt("zhejiang_governor", latest, "ack");
    const ack2 = await receipt("zhejiang_governor", latest, "ack");
    assert.equal(ack2.acknowledgedAt, ack1.acknowledgedAt);

    const beforeReconnect = await duplicateProof();
    const reconnectPage = await replaceSecondaryWindow("zhejiang_governor");
    await reconnectPage.goto(`${baseUrl}/game?runId=${encodeURIComponent(roomId)}`, { waitUntil: "networkidle" });
    await reconnectPage.locator('[data-testid="story-shell"], [data-testid="continuous-story-v2-shell"]').first().waitFor({ state: "attached", timeout: 60_000 });
    await assertApprovedUiBoundary(reconnectPage);
    const reconnectFeed = await events("zhejiang_governor");
    assert.deepEqual(findForbiddenPaths(reconnectFeed), []);
    const afterReconnect = await duplicateProof();
    assert.deepEqual(afterReconnect, beforeReconnect, "second-window reconnect must not duplicate event/delivery/modal rows");

    const status = await requestJson("zhejiang_governor", "GET", `/v4/rooms/${roomId}/a-emotion/recovery/status`);
    const paused = await requestJson("zhejiang_governor", "POST", `/v4/rooms/${roomId}/a-emotion/recovery/pause`, { expectedVersion: status.runVersion, reason: "M6_E2E_RECOVERY_CHECK" });
    assert.equal(paused.paused, true);
    const resumed = await requestJson("zhejiang_governor", "POST", `/v4/rooms/${roomId}/a-emotion/recovery/resume`, { expectedVersion: paused.runVersion, reason: "M6_E2E_RECOVERY_CHECK" });
    assert.equal(resumed.paused, false);

    const now = new Date();
    const runForRecovery = await prisma.storyRun.findUniqueOrThrow({ where: { id: roomId }, select: { currentNodeId: true } });
    assert.ok(runForRecovery.currentNodeId, "recovery fixture requires the current real scene node");
    const retryMarker = `e2e-expired-${Date.now()}`;
    const deadMarker = `e2e-dead-${Date.now()}`;
    const retryTask = await prisma.storyTaskOutbox.create({ data: { runId: roomId, nodeId: runForRecovery.currentNodeId, roleId: stateFor("zhejiang_governor").roleId, taskType: "INTERACTION_COMPILE_REQUESTED", status: "RUNNING", inputRefId: retryMarker, dedupeKey: retryMarker, leaseOwner: "crashed-worker", leaseExpiresAt: new Date(now.getTime() - 5_000), leaseVersion: 1, attempt: 1, maxAttempts: 5, nextRetryAt: now } });
    const deadTask = await prisma.storyTaskOutbox.create({ data: { runId: roomId, nodeId: runForRecovery.currentNodeId, roleId: stateFor("zhejiang_governor").roleId, taskType: "INTERACTION_COMPILE_REQUESTED", status: "RUNNING", inputRefId: deadMarker, dedupeKey: deadMarker, leaseOwner: "crashed-worker", leaseExpiresAt: new Date(now.getTime() - 5_000), leaseVersion: 1, attempt: 5, maxAttempts: 5, nextRetryAt: now } });
    await waitForDb(async () => {
      const [retry, dead] = await Promise.all([prisma.storyTaskOutbox.findUnique({ where: { id: retryTask.id } }), prisma.storyTaskOutbox.findUnique({ where: { id: deadTask.id } })]);
      const retryRecovered = Boolean(retry && retry.leaseVersion > 1 && retry.leaseOwner !== "crashed-worker" && retry.lastError === "A_EMOTION_M6_EXPIRED_LEASE_RECOVERED");
      const deadLettered = dead?.status === "FAILED" && dead.outcome === "DEAD_LETTER";
      return retryRecovered && deadLettered ? { retry, dead } : null;
    }, 60_000, "worker lease/dead-letter recovery");
    const duplicateCounts = await duplicateProof();
    assert.equal(duplicateCounts.duplicateEvents, 0);
    assert.equal(duplicateCounts.duplicateDeliveries, 0);
    assert.equal(duplicateCounts.duplicateModals, 0);
    await refreshRole("zhejiang_governor");
    assert.deepEqual(findForbiddenPaths(await events("zhejiang_governor")), []);
  });

  assert.deepEqual(network.flatMap((entry) => entry.forbiddenPaths), [], `network JSON leaked forbidden fields: ${JSON.stringify(network.filter((entry) => entry.forbiddenPaths.length))}`);
  for (const record of windowRecords) await assertApprovedUiBoundary(record.page);
  await captureMobileEvidence();
  await writeJson(resolve(evidenceDir, "network-summary.json"), network);
  await writeJson(resolve(evidenceDir, "console-summary.json"), consoleRecords);
  assertNoBrowserErrors();
  const runtimeProof = await collectRuntimePerformanceProof();
  await writeJson(resolve(evidenceDir, "runtime-performance-proof.json"), runtimeProof);
  await writeJson(resolve(evidenceDir, "checkpoint.json"), { schemaVersion: "a_emotion_m6_e2e_checkpoints_v2", status: "PASS", roomIdHash: hashIdentifier(roomId, 24), checkpoints });
  console.log(JSON.stringify({ status: "PASS", roomIdHash: hashIdentifier(roomId, 24), checkpoints: checkpoints.length, networkResponses: network.length, consoleEvents: consoleRecords.length }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  checkpoints.push({ id: "FAILURE", status: "FAIL", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), details: { message } });
  await Promise.all(windowRecords.map((record) => record.page.screenshot({ path: resolve(evidenceDir, "screenshots", `failure-${record.roleKey}-${record.windowKey}.png`), fullPage: true }).catch(() => undefined)));
  await writeJson(resolve(evidenceDir, "network-summary.json"), network);
  await writeJson(resolve(evidenceDir, "console-summary.json"), consoleRecords);
  await writeJson(resolve(evidenceDir, "checkpoint.json"), { schemaVersion: "a_emotion_m6_e2e_checkpoints_v2", status: "FAIL", roomIdHash: hashIdentifier(roomId, 24), checkpoints, error: sanitizeEvidence(message) });
  throw error;
} finally {
  await prisma.$disconnect();
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}

type RoleKey = "zhejiang_governor" | "xunfu" | "county_magistrate";
type PlayerState = { roleKey: RoleKey; roleId: string; userId: string; storageState: string };
type Checkpoint = { id: string; status: "PASS" | "FAIL"; startedAt: string; completedAt: string; details: Record<string, unknown> };
type NetworkRecord = { roleKey: RoleKey; windowKey: "primary" | "secondary"; method: string; route: string; status: number; contentType: string; bodySha256: string | null; forbiddenPaths: string[] };
type ConsoleRecord = { roleKey: RoleKey; windowKey: "primary" | "secondary"; type: string; text: string };

const EXACT_ACTIONS = {
  zhejiang_governor: { stage1: "main_s1_governor_joint_review", suspect: "main_s2_governor_dual_verification", confirm: "main_s4_governor_seal_evidence" },
  xunfu: { stage1: "main_s1_xunfu_accelerate_orders", hidden: "main_s2_xunfu_seize_drafts" },
  county_magistrate: { stage1: "main_s1_magistrate_retain_original_register", stage2: "main_s2_magistrate_send_copy" }
} as const;

async function checkpoint(id: string, title: string, operation: () => Promise<void>) {
  const startedAt = new Date().toISOString();
  try {
    await operation();
    checkpoints.push({ id, status: "PASS", startedAt, completedAt: new Date().toISOString(), details: { title } });
  } catch (error) {
    checkpoints.push({ id, status: "FAIL", startedAt, completedAt: new Date().toISOString(), details: { title, message: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

function installObservers(page: any, roleKey: RoleKey, windowKey: "primary" | "secondary") {
  page.on("console", (message: any) => { const record = { roleKey, windowKey, type: message.type(), text: sanitize(message.text()).slice(0, 1_000) }; consoleRecords.push(record); if (isSevereBrowserRecord(record)) severeBrowserErrors.push(record); });
  page.on("pageerror", (error: Error) => { const record = { roleKey, windowKey, type: "pageerror", text: sanitize(error.message).slice(0, 1_000) }; consoleRecords.push(record); severeBrowserErrors.push(record); });
  page.on("response", async (response: any) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith(`/api/v4/rooms/${roomId}`)) return;
    const contentType = response.headers()["content-type"] || "";
    let body: unknown = null;
    if (contentType.includes("application/json")) body = await response.json().catch(() => null);
    network.push({ roleKey, windowKey, method: response.request().method(), route: redactDynamicApiPath(`${url.pathname}${url.search}`), status: response.status(), contentType, bodySha256: body === null ? null : sha256(JSON.stringify(body)), forbiddenPaths: findForbiddenPaths(body) });
  });
}

async function game(roleKey: RoleKey) { return requestJson(roleKey, "GET", `/v4/rooms/${roomId}/game`); }
async function events(roleKey: RoleKey) { return requestJson(roleKey, "GET", `/v4/rooms/${roomId}/events?interactionLimit=10`); }

type RequestJsonOptions = { timeoutMs?: number };

class E2ERequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(method: string, path: string, status: number, code: string, message: string) {
    super(`${method} ${redactDynamicApiPath(path)} -> ${status} ${code}: ${sanitize(message)}`);
    this.name = "E2ERequestError";
    this.status = status;
    this.code = code;
  }
}

class E2ETransportTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(method: string, path: string, timeoutMs: number) {
    super(`${method} ${redactDynamicApiPath(path)} transport timed out after ${timeoutMs}ms`);
    this.name = "E2ETransportTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

async function requestJson(roleKey: RoleKey, method: string, path: string, body?: unknown, options: RequestJsonOptions = {}) {
  const timeoutMs = options.timeoutMs ?? A_EMOTION_E2E_SHORT_REQUEST_TIMEOUT_MS;
  let response: any;
  try {
    response = await contextFor(roleKey).request.fetch(`${apiBase}${path}`, {
      method,
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      data: body,
      timeout: timeoutMs
    });
  } catch (error) {
    if (/timeout/iu.test(error instanceof Error ? error.message : String(error))) throw new E2ETransportTimeoutError(method, path, timeoutMs);
    throw error;
  }
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok()) throw new E2ERequestError(method, path, response.status(), String(payload.code || "UNKNOWN"), String(payload.message || "request failed"));
  return payload;
}

async function submitFormalPromise(issuer: RoleKey, receiver: RoleKey, promiseCode: "DELIVER_ORIGINAL_LEDGER") {
  const projection = await game(issuer);
  assert.ok(projection.currentTurn && projection.control.canHumanAct);
  const target = stateFor(receiver);
  const idempotencyKey = `e2e-promise:${issuer}:${receiver}:${projection.currentTurn.id}`;
  const command = {
    idempotencyKey,
    turnRevision: projection.currentTurn.revision,
    controlEpoch: projection.control.epoch,
    customAction: "Record the formal promise using the selected deterministic promise contract.",
    decisionForm: "CONVERSATION",
    simplePromise: buildAEmotionE2ESimplePromiseCommand({
      idempotencyKey: `${idempotencyKey}:formal`,
      promiseCode,
      targetRoleKey: receiver,
      expectedStage: projection.currentTurn.stageIndex
    }),
    intent: { objective: "Create the formal ledger-delivery promise", target: { type: "ROLE", id: target.roleId, label: receiver }, method: "State and record the formal promise", leverageKeys: [], visibility: "LIMITED", riskTolerance: "MEDIUM", fallback: null, condition: null }
  };
  const result = await submitDecisionWithCompletion(issuer, projection, command);
  assert.equal(result.accepted, true);
  return result;
}

async function advanceUntilCatalogAction(roleKey: RoleKey, actionKey: string) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const projection = await waitForOpenTurn(roleKey);
    const candidate = projection.currentTurn.decisions.find((entry: any) => entry.actionKey === actionKey);
    if (candidate) return projection;
    const preferred = preferredProgressAction(roleKey, projection.currentTurn.stageIndex, projection.currentTurn.decisions);
    assert.ok(preferred, `no real catalog action available while advancing ${roleKey} toward ${actionKey}`);
    await submitCandidate(roleKey, projection, preferred, `advance-${actionKey}-${attempt}`);
  }
  throw new Error(`${roleKey} never received real catalog action ${actionKey}`);
}

function preferredProgressAction(roleKey: RoleKey, stageIndex: number, candidates: any[]) {
  const preferred = roleKey === "zhejiang_governor" && stageIndex === 1 ? EXACT_ACTIONS.zhejiang_governor.stage1
    : roleKey === "xunfu" && stageIndex === 1 ? EXACT_ACTIONS.xunfu.stage1
    : roleKey === "county_magistrate" && stageIndex === 1 ? EXACT_ACTIONS.county_magistrate.stage1
    : roleKey === "county_magistrate" && stageIndex === 2 ? EXACT_ACTIONS.county_magistrate.stage2
    : null;
  return candidates.find((entry) => entry.actionKey === preferred) || candidates.find((entry) => typeof entry.actionKey === "string") || null;
}

async function submitCatalogAction(roleKey: RoleKey, actionKey: string, marker: string) {
  const projection = await waitForOpenTurn(roleKey);
  const candidate = projection.currentTurn.decisions.find((entry: any) => entry.actionKey === actionKey);
  assert.ok(candidate, `current real decision candidates for ${roleKey} do not contain ${actionKey}`);
  return submitCandidate(roleKey, projection, candidate, marker);
}

async function submitFirstAvailableCatalogAction(roleKey: RoleKey, marker: string) {
  const projection = await waitForOpenTurn(roleKey);
  const candidate = projection.currentTurn.decisions.find((entry: any) => typeof entry.actionKey === "string");
  assert.ok(candidate, `${roleKey} has no real catalog action to submit`);
  return submitCandidate(roleKey, projection, candidate, marker);
}

async function submitCandidate(roleKey: RoleKey, projection: any, candidate: any, marker: string) {
  assert.equal(typeof candidate.actionKey, "string", "E2E must select a typed catalog action rather than text matching");
  const command = decisionCommand(projection, candidate, marker);
  const result = await submitDecisionWithCompletion(roleKey, projection, command);
  assert.equal(result.accepted, true);
  return result;
}

async function submitDecisionWithCompletion(roleKey: RoleKey, projection: any, command: any) {
  const turnId = String(projection.currentTurn?.id || "");
  assert.ok(turnId, "decision submission requires the current authoritative turn");
  const baseWorldSequence = Number(projection.worldSequence || 0);
  const turnRevision = Number(projection.currentTurn?.revision || 0);
  const path = `/v4/rooms/${roomId}/game/turns/${turnId}/decision`;
  try {
    return await requestJson(roleKey, "POST", path, command, { timeoutMs: A_EMOTION_E2E_MODEL_REQUEST_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof E2ERequestError && isStoryGenerationInProgress(error.status, error.code)) {
      const completed = await waitForAuthoritativeDecisionCompletion(roleKey, turnId, turnRevision, baseWorldSequence, { status: error.status, code: error.code });
      return { accepted: true, pendingGenerationRecovered: true, gameProjection: completed, resolution: null };
    }
    if (error instanceof E2ETransportTimeoutError) {
      const completed = await waitForAuthoritativeDecisionCompletion(roleKey, turnId, turnRevision, baseWorldSequence, { status: "TRANSPORT_TIMEOUT", code: "MODEL_REQUEST_TIMEOUT" });
      return { accepted: true, pendingGenerationRecovered: true, gameProjection: completed, resolution: null };
    }
    throw error;
  }
}

async function waitForAuthoritativeDecisionCompletion(
  roleKey: RoleKey,
  turnId: string,
  turnRevision: number,
  baseWorldSequence: number,
  initial: { status: number | "TRANSPORT_TIMEOUT"; code: string }
) {
  const deadline = Date.now() + A_EMOTION_E2E_GENERATION_POLL_DEADLINE_MS;
  let polls = 0;
  let lastState: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    polls += 1;
    const projection = await game(roleKey);
    const currentTurn = projection.currentTurn || null;
    const currentTurnChanged = !currentTurn || String(currentTurn.id || "") !== turnId;
    const currentTurnRevision = currentTurn ? Number(currentTurn.revision || 0) : null;
    const worldSequenceAdvanced = Number(projection.worldSequence || 0) > baseWorldSequence;
    const resultPublished = Array.isArray(projection.timeline)
      && projection.timeline.some((entry: any) => entry?.kind === "RESULT" && Number(entry.worldSequence || 0) > baseWorldSequence);
    lastState = {
      worldSequence: Number(projection.worldSequence || 0),
      worldSequenceAdvanced,
      resultPublished,
      currentTurnChanged,
      currentTurnStatus: currentTurn ? String(currentTurn.status || "UNKNOWN") : "NONE",
      currentTurnRevision,
      completed: projection.completed === true,
      canHumanAct: projection.control?.canHumanAct === true
    };
    const sameTurnReopened = !currentTurnChanged
      && currentTurn?.status === "OPEN"
      && Number(currentTurnRevision || 0) > turnRevision
      && resultPublished;
    const authoritativeTerminal = projection.completed === true
      || (currentTurnChanged && (worldSequenceAdvanced || resultPublished))
      || sameTurnReopened;
    if (authoritativeTerminal) return projection;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  const diagnostic = generationTimeoutDiagnostic({ ...initial, roomId, turnId, polls, lastState });
  throw new Error(`decision generation deadline exceeded ${JSON.stringify(diagnostic)}`);
}

function decisionCommand(projection: any, candidate: any, marker: string) {
  return { idempotencyKey: `aemotion-e2e-${marker}-${projection.currentTurn.id}`, turnRevision: projection.currentTurn.revision, controlEpoch: projection.control.epoch, candidateId: candidate.id, decisionForm: "STORY_CHOICE", intent: candidate.intentDraft };
}

async function waitForOpenTurn(roleKey: RoleKey) {
  return waitForDb(async () => {
    const projection = await game(roleKey);
    return projection.currentTurn?.status === "OPEN" && projection.control?.canHumanAct ? projection : null;
  }, 180_000, `${roleKey} open turn`);
}

async function waitForWorldSequence(roleKey: RoleKey, minimum: number) {
  return waitForDb(async () => { const projection = await game(roleKey); return Number(projection.worldSequence) >= minimum ? projection : null; }, 180_000, `${roleKey} world sequence ${minimum}`);
}

async function waitForInteraction(roleKey: RoleKey, predicate: (item: any) => boolean) {
  return waitForDb(async () => {
    const page = await events(roleKey);
    return page.interactionFeed?.items?.find(predicate) || null;
  }, 120_000, `${roleKey} interaction`);
}

async function latestRelated(roleKey: RoleKey) {
  const page = await events(roleKey);
  const item = page.interactionFeed?.items?.find((entry: any) => entry.category === "RELATED");
  assert.ok(item, `${roleKey} has no RELATED interaction`);
  return item;
}

async function waitForModal(roleKey: RoleKey, modalType: string, timeout: number) {
  return waitForDb(async () => {
    const page = await events(roleKey);
    return page.keyModals?.find((modal: any) => modal.modalType === modalType) || null;
  }, timeout, `${roleKey} ${modalType} modal`);
}

async function acknowledgeModal(roleKey: RoleKey, modal: any) {
  const shown = await requestJson(roleKey, "POST", `/v4/rooms/${roomId}/a-emotion/modals/${modal.modalId}/shown`, { projectionVersion: modal.projectionVersion, triggerVersion: modal.triggerVersion });
  const shownReplay = await requestJson(roleKey, "POST", `/v4/rooms/${roomId}/a-emotion/modals/${modal.modalId}/shown`, { projectionVersion: modal.projectionVersion, triggerVersion: modal.triggerVersion });
  assert.equal(shownReplay.shownAt, shown.shownAt);
  const ack = await requestJson(roleKey, "POST", `/v4/rooms/${roomId}/a-emotion/modals/${modal.modalId}/ack`, { projectionVersion: modal.projectionVersion, triggerVersion: modal.triggerVersion });
  const replay = await requestJson(roleKey, "POST", `/v4/rooms/${roomId}/a-emotion/modals/${modal.modalId}/ack`, { projectionVersion: modal.projectionVersion, triggerVersion: modal.triggerVersion });
  assert.equal(replay.acknowledgedAt, ack.acknowledgedAt);
}

async function receipt(roleKey: RoleKey, item: any, kind: "seen" | "ack" | "resolved") {
  return requestJson(roleKey, "POST", `/v4/rooms/${roomId}/events/${item.eventId}/${kind}`, { projectionVersion: item.projectionVersion });
}

async function duplicateProof() {
  const [eventDup, deliveryDup, modalDup] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM (SELECT "dedupeKey" FROM "StoryEvent" WHERE "runId"=${roomId} AND "dedupeKey" IS NOT NULL GROUP BY "dedupeKey" HAVING count(*) > 1) duplicates`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM (SELECT "eventId", "userId" FROM "EventDelivery" WHERE "roomId"=${roomId} GROUP BY "eventId", "userId" HAVING count(*) > 1) duplicates`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM (SELECT "modalType", "triggerId", "viewerRoleId" FROM "AEmotionKeyModal" WHERE "runId"=${roomId} GROUP BY "modalType", "triggerId", "viewerRoleId" HAVING count(*) > 1) duplicates`
  ]);
  return { duplicateEvents: Number(eventDup[0]?.count || 0), duplicateDeliveries: Number(deliveryDup[0]?.count || 0), duplicateModals: Number(modalDup[0]?.count || 0) };
}

async function refreshRole(roleKey: RoleKey) { const page = pageFor(roleKey); await page.reload({ waitUntil: "networkidle" }); await page.locator('[data-testid="story-shell"], [data-testid="continuous-story-v2-shell"]').first().waitFor({ state: "attached", timeout: 60_000 }); await assertApprovedUiBoundary(page); }
async function screenshotRole(roleKey: RoleKey, name: string) { await pageFor(roleKey).screenshot({ path: resolve(evidenceDir, "screenshots", `${name}-${roleKey}.png`), fullPage: true }); }
async function screenshotAll(name: string) { await Promise.all(requiredRoles.map((role) => screenshotRole(role, name))); }

async function captureMobileEvidence() {
  const state = stateFor("zhejiang_governor");
  const mobile = await browser.newContext({ storageState: state.storageState, viewport: { width: 390, height: 844 } });
  try {
    const page = await mobile.newPage();
    await page.goto(`${baseUrl}/game?runId=${encodeURIComponent(roomId)}`, { waitUntil: "networkidle" });
    await assertApprovedUiBoundary(page);
    await page.screenshot({ path: resolve(evidenceDir, "screenshots", "viewport-390-evidence-only.png"), fullPage: true });
  } finally { await mobile.close(); }
}

async function assertApprovedUiBoundary(page: any) {
  assert.equal(await page.locator(".causal-center").count(), 1);
  assert.equal(await page.locator("[data-aemotion-m1-metric-hint]").count(), 0);
  assert.equal(await page.locator("[data-aemotion-m1-card]").count(), 0);
  assert.equal(await page.locator('[data-aemotion-world-situation="true"]').count() <= 1, true);
  const surface = page.locator('[data-aemotion-world-situation="true"]').first();
  if (await surface.count()) assert.match(await surface.textContent() || "", /世界局势/u);
}

function pageFor(roleKey: RoleKey, windowKey: "primary" | "secondary" = "primary") { const index = states.findIndex((entry) => entry.roleKey === roleKey); assert.ok(index >= 0); return windows[index][windowKey]; }
function contextFor(roleKey: RoleKey) { return contexts[states.findIndex((entry) => entry.roleKey === roleKey)]; }
function stateFor(roleKey: RoleKey) { const state = states.find((entry) => entry.roleKey === roleKey); assert.ok(state); return state; }

function findForbiddenPaths(value: unknown): string[] { return [...new Set([...findForbiddenNetworkPaths(value), ...legacyForbiddenPaths(value)])]; }
function legacyForbiddenPaths(value: unknown, path = "$", output: string[] = []): string[] {
  if (Array.isArray(value)) { value.forEach((item, index) => legacyForbiddenPaths(item, `${path}[${index}]`, output)); return output; }
  if (!value || typeof value !== "object") return output;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) { const next = `${path}.${key}`; if (forbiddenKeys.has(key)) output.push(next); legacyForbiddenPaths(nested, next, output); }
  return output;
}


function metricValue(projection: any, key: string) {
  const metric = projection.world?.presentation?.statusMetrics?.find((entry: any) => entry.key === key);
  const value = Number(metric?.value);
  assert.ok(Number.isFinite(value), `metric ${key} must be visible in the production projection`);
  return value;
}

async function waitForUiText(page: any, pattern: RegExp, timeout: number, label: string) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await page.locator("body").textContent().catch(() => "") || "";
    if (pattern.test(text)) return text;
    await page.waitForTimeout(250);
  }
  throw new Error(`${label} was not visible before timeout`);
}

async function setFeedExpanded(page: any, expanded: boolean) {
  const feed = page.locator('[data-testid="aemotion-m1-feed"]');
  const list = feed.locator("[data-aemotion-feed-list]");
  const count = await list.locator("[data-aemotion-open]").count();
  if ((expanded && count <= 3) || (!expanded && count > 3)) await feed.locator("[data-aemotion-expand]").click();
  await page.waitForTimeout(100);
}

async function ensureRealFeedCount(roleKey: RoleKey, target: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await events(roleKey);
    if ((current.interactionFeed?.items || []).length >= target) return current;
    await submitRealActionProducingFeed(roleKey, `ensure-feed-${target}-${attempt}`);
  }
  throw new Error(`real catalog actions did not produce ${target} viewer-safe feed items`);
}

async function submitRealActionProducingFeed(viewerRole: RoleKey, marker: string) {
  const before = await events(viewerRole);
  const beforeCursor = Number(before.interactionFeed?.nextCursor || 0);
  const roles: RoleKey[] = ["xunfu", "county_magistrate", "zhejiang_governor"];
  let lastError = "";
  for (const role of roles) {
    try {
      await submitFirstAvailableCatalogAction(role, `${marker}-${role}`);
      return await waitForDb(async () => {
        const current = await events(viewerRole);
        return Number(current.interactionFeed?.nextCursor || 0) > beforeCursor ? current : null;
      }, 120_000, `${viewerRole} real feed growth`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`no remaining real catalog action produced a viewer feed update; last=${sanitize(lastError)}`);
}

async function replaceSecondaryWindow(roleKey: RoleKey, disableEventSource = false) {
  const index = states.findIndex((entry) => entry.roleKey === roleKey);
  assert.ok(index >= 0);
  await windows[index].secondary.close().catch(() => undefined);
  const page = await contexts[index].newPage();
  if (disableEventSource) await page.addInitScript(() => { Object.defineProperty(globalThis, "EventSource", { configurable: true, value: undefined }); });
  windows[index].secondary = page;
  const record = windowRecords.find((entry) => entry.roleKey === roleKey && entry.windowKey === "secondary");
  assert.ok(record);
  record.page = page;
  installObservers(page, roleKey, "secondary");
  return page;
}

function isSevereBrowserRecord(record: ConsoleRecord) {
  if (record.type === "pageerror") return true;
  if (!["error", "assert"].includes(record.type)) return false;
  return !/(favicon\.ico|ResizeObserver loop (?:limit exceeded|completed with undelivered notifications))/iu.test(record.text);
}

function assertNoBrowserErrors() {
  assert.deepEqual(severeBrowserErrors, [], `unhandled pageerror or severe console errors: ${JSON.stringify(severeBrowserErrors)}`);
}

async function collectRuntimePerformanceProof() {
  const primary = pageFor("zhejiang_governor");
  await primary.evaluate(({ targetRoomId }: { targetRoomId: string }) => {
    const state = globalThis as any;
    state.__aemotionE2eSseMessages = [];
    state.__aemotionE2eSse?.close?.();
    const source = new EventSource(`/api/v4/rooms/${encodeURIComponent(targetRoomId)}/events/stream?afterDeliverySequence=0`);
    source.onmessage = (event) => state.__aemotionE2eSseMessages.push({ at: performance.now(), bytes: String(event.data || "").length });
    state.__aemotionE2eSse = source;
  }, { targetRoomId: roomId });
  for (let index = 0; index < 5; index += 1) await submitRealActionProducingFeed("zhejiang_governor", `sse-burst-${index}`);
  await primary.waitForFunction(() => ((globalThis as any).__aemotionE2eSseMessages || []).length >= 5, undefined, { timeout: 120_000 });
  const sseMessages = await primary.evaluate(() => { const state = globalThis as any; const values = [...(state.__aemotionE2eSseMessages || [])]; state.__aemotionE2eSse?.close?.(); return values; });
  assert.ok(sseMessages.length >= 5, "SSE runtime proof requires at least five observed messages");

  const feedPage = await ensureRealFeedCount("zhejiang_governor", 10);
  assert.equal((feedPage.interactionFeed?.items || []).length, 10, "runtime feed proof must expose exactly the server maximum of 10 items");
  const governor = stateFor("zhejiang_governor");
  const run = await prisma.storyRun.findUniqueOrThrow({ where: { id: roomId }, select: { worldSequence: true } });
  await prisma.narrativeEntry.createMany({
    skipDuplicates: true,
    data: Array.from({ length: 100 }, (_, index) => ({
      runId: roomId,
      roleId: governor.roleId,
      nodeId: null,
      resolutionId: null,
      entryType: "M6_E2E_PERFORMANCE_HISTORY",
      visibility: "private",
      content: `M6 isolated-schema performance history ${index + 1}`,
      factKeysJson: [],
      threadKeysJson: [],
      sourceEventIdsJson: [],
      worldSequence: run.worldSequence,
      dedupeKey: `M6_E2E_PERF_HISTORY:${roomId}:${index + 1}`
    }))
  });
  const projectionWithHistory = await game("zhejiang_governor");
  const historyCount = (projectionWithHistory.timeline || []).filter((entry: any) => entry.kind || entry.content).length;
  assert.ok(historyCount >= 100, `runtime history proof requires 100 entries, got ${historyCount}`);

  await refreshRole("zhejiang_governor");
  await setFeedExpanded(primary, true);
  const feedDomCount = await primary.locator('[data-testid="aemotion-m1-feed"] [data-aemotion-open]').count();
  assert.equal(feedDomCount, 6, "aggregated feed DOM must remain bounded to six expanded rows");
  const historyDomCount = await primary.locator(".v2-timeline article, .history-item, [data-history-entry]").count();
  assert.ok(historyDomCount <= 30, `100 history records must not create unbounded DOM, got ${historyDomCount}`);

  const pollPage = await replaceSecondaryWindow("zhejiang_governor", true);
  const pollTimes: number[] = [];
  pollPage.on("request", (request: any) => {
    const url = new URL(request.url());
    if (url.pathname.includes(`/api/v4/rooms/${roomId}/events`) || (url.pathname.endsWith(`/api/v4/rooms/${roomId}/game`) && url.searchParams.has("projectionTs"))) pollTimes.push(Date.now());
  });
  await pollPage.goto(`${baseUrl}/game?runId=${encodeURIComponent(roomId)}`, { waitUntil: "networkidle" });
  const input = activeInput(pollPage);
  await input.waitFor({ state: "visible", timeout: 60_000 });
  const marker = `poll-input-${Date.now()}`;
  await input.fill(marker);
  await input.focus();
  const latencyMs = await input.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => {
    const started = performance.now();
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: "x", inputType: "insertText" }));
    return performance.now() - started;
  });
  await waitForDb(async () => {
    if (pollTimes.length < 2) return null;
    const intervals = pollTimes.slice(1).map((value, index) => value - pollTimes[index]);
    return intervals.some((value) => value >= 5_000 && value <= 10_000) ? intervals : null;
  }, 25_000, "7-second poll fallback runtime proof");
  assert.equal(await input.inputValue(), marker, "poll fallback must preserve active input");
  assert.equal(await input.evaluate((element: Element) => document.activeElement === element), true, "poll fallback must preserve input focus");
  assert.ok(latencyMs < 100, `active input dispatch must remain responsive, got ${latencyMs}ms`);

  const pollIntervals = pollTimes.slice(1).map((value, index) => value - pollTimes[index]);
  const markers = Object.fromEntries(A_EMOTION_E2E_RUNTIME_MARKERS.map((runtimeMarker) => [runtimeMarker, true]));
  return {
    schemaVersion: "a_emotion_m6_runtime_performance_proof_v1",
    roomIdHash: hashIdentifier(roomId, 24),
    markers,
    feedItems: (feedPage.interactionFeed?.items || []).length,
    historyEntries: historyCount,
    pollIntervalsMs: pollIntervals,
    sseMessages: sseMessages.length,
    aggregatedFeedDomRows: feedDomCount,
    aggregatedHistoryDomRows: historyDomCount,
    activeInputPreserved: true,
    activeInputLatencyMs: latencyMs
  };
}

function activeInput(page: any) {
  const candidates = page.locator("#maneuverCustomText:visible, #customDecision:visible, [data-v2-custom]:visible");
  return candidates.first();
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

async function waitForDb<T>(read: () => Promise<T | null>, timeout: number, label: string): Promise<T> {
  const deadline = Date.now() + timeout; let lastError = "";
  while (Date.now() < deadline) { try { const value = await read(); if (value !== null) return value; } catch (error) { lastError = error instanceof Error ? error.message : String(error); } await new Promise((resolvePromise) => setTimeout(resolvePromise, 500)); }
  throw new Error(`${label} timed out${lastError ? `; last=${lastError}` : ""}`);
}

async function writeJson(path: string, value: unknown) { await writeFile(path, `${JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2)}\n`, "utf8"); }
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function sanitize(value: string) { return String(sanitizeEvidence(value)).replace(/Bearer\s+[A-Za-z0-9._-]+/giu, "Bearer [REDACTED]").replace(/many_worlds_session=[^;\s]+/giu, "many_worlds_session=[REDACTED]").replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "postgresql://[REDACTED]"); }
