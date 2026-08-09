import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const ROOT = resolve(process.env.B0_PROJECT_ROOT || ".");
const EVIDENCE_ROOT = resolve(process.env.B0_EVIDENCE_ROOT || join(ROOT, "docs/auto-execute/evidence/b0/c9/runtime"));
const RAW_ROOT = join(EVIDENCE_ROOT, "raw");
const LOG_ROOT = join(EVIDENCE_ROOT, "logs");
const SCREENSHOT_ROOT = join(EVIDENCE_ROOT, "screenshots");
const TESTED_CODE_SHA = required("GITHUB_SHA");
const ACCEPTANCE_TIER = required("B0_ACCEPTANCE_TIER");
const ACCEPTANCE_ENVIRONMENT = optional("B0_ACCEPTANCE_ENVIRONMENT");
const DATABASE_SECRET_NAME = optional("B0_DATABASE_SECRET_NAME");
const PROVIDER_SECRET_NAME = optional("B0_PROVIDER_SECRET_NAME");
const DATABASE_URL = required("DATABASE_URL");
const OPENOVEL_PROVIDER_BASE_URL = required("OPENOVEL_PROVIDER_BASE_URL");
const OPENOVEL_API_KEY = required("OPENOVEL_API_KEY");
const OPENOVEL_MODEL = required("OPENOVEL_MODEL");
const DATABASE_PROVENANCE = required("B0_DATABASE_PROVENANCE");
const DATABASE_IMAGE = optional("B0_DATABASE_IMAGE");
const DATABASE_IMAGE_DIGEST = optional("B0_DATABASE_IMAGE_DIGEST");
const PROVIDER_PROVENANCE = required("B0_PROVIDER_PROVENANCE");
const PROVIDER_IMAGE = optional("B0_PROVIDER_IMAGE");
const PROVIDER_IMAGE_DIGEST = optional("B0_PROVIDER_IMAGE_DIGEST");
const PROVIDER_MODEL_DIGEST = required("B0_PROVIDER_MODEL_DIGEST");
const CHROME_PATH = discoverChrome();
const API_PORT = integerEnv("B0_API_PORT", 33102);
const WEB_PORT = integerEnv("B0_WEB_PORT", 35178);
const RUNTIME_PORT = integerEnv("B0_RUNTIME_PORT", 33110);
const API_BASE = `http://127.0.0.1:${API_PORT}/api`;
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const RUNTIME_BASE = `http://127.0.0.1:${RUNTIME_PORT}`;
const STAMP = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const OPENOVEL_RUNTIME_ROOT = join(ROOT, ".runtime", `b0-acceptance-${STAMP}`);
const AUTH_TOKEN_SECRET = randomBytes(48).toString("base64url");
const OPENOVEL_INTERNAL_TOKEN = randomBytes(48).toString("base64url");
const MANEUVER_PREVIEW_SECRET = randomBytes(48).toString("base64url");
const SAFE_SECRET_VALUES = [DATABASE_URL, OPENOVEL_API_KEY, AUTH_TOKEN_SECRET, OPENOVEL_INTERNAL_TOKEN, MANEUVER_PREVIEW_SECRET];
const processes = new Map<string, ManagedProcess>();
const processStartCounts = new Map<string, number>();
const evidence: Record<string, unknown> = {
  schemaVersion: 1,
  testedCodeSha: TESTED_CODE_SHA,
  startedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    chrome: basename(CHROME_PATH),
    apiPort: API_PORT,
    webPort: WEB_PORT,
    runtimePort: RUNTIME_PORT,
    acceptanceTier: ACCEPTANCE_TIER,
    acceptanceEnvironment: ACCEPTANCE_ENVIRONMENT || null,
    databaseKind: safeDatabaseKind(DATABASE_URL),
    databaseProvenance: {
      kind: DATABASE_PROVENANCE,
      environment: ACCEPTANCE_ENVIRONMENT || null,
      secretName: DATABASE_SECRET_NAME || null,
      image: DATABASE_IMAGE || null,
      imageDigest: DATABASE_IMAGE_DIGEST || null,
      selfHostedOfficialSupabase: ACCEPTANCE_TIER === "engineering-selfhosted",
      supabaseCloudUsed: ACCEPTANCE_TIER === "formal-c8",
      publicSchemaUsed: false,
    },
    narrativeProvider: {
      ...safeProviderKind(OPENOVEL_PROVIDER_BASE_URL),
      provenance: PROVIDER_PROVENANCE,
      secretName: PROVIDER_SECRET_NAME || null,
      image: PROVIDER_IMAGE || null,
      imageDigest: PROVIDER_IMAGE_DIGEST || null,
      model: OPENOVEL_MODEL,
      modelDigest: PROVIDER_MODEL_DIGEST,
      mode: "live-provider-only",
      fallbackAllowed: false,
      deterministicProvider: false,
    },
    schema: new URL(DATABASE_URL).searchParams.get("schema"),
  },
  phases: [],
};

process.env.AUTH_TOKEN_SECRET = AUTH_TOKEN_SECRET;

async function main() {
  await Promise.all([RAW_ROOT, LOG_ROOT, SCREENSHOT_ROOT].map((path) => mkdir(path, { recursive: true })));
  assertIsolatedSchema(DATABASE_URL);
  assertAcceptanceProvenance();
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  const browsers: BrowserSession[] = [];
  let terminalError: unknown;
  try {
    await prisma.$connect();
    const users = await createVerifiedUsers(prisma, 4);
    const adminUser = users[0];
    const commonEnv = childEnvironment(adminUser.id);

    await startRuntime(commonEnv);
    await startApi(commonEnv, true);
    await startWeb(commonEnv);

    const mainRun = await createThreeHumanRun(prisma, users.slice(0, 3));
    evidence.mainRun = safeRunIdentity(mainRun);

    browsers.push(
      new BrowserSession("host-desktop", 39411, 1440, 900, false),
      new BrowserSession("player-two-desktop", 39412, 1280, 800, false),
      new BrowserSession("player-three-narrow", 39413, 390, 844, true),
    );
    await Promise.all(browsers.map((browser) => browser.start()));
    for (let index = 0; index < browsers.length; index += 1) {
      await browsers[index].authenticate(users[index].token);
      await browsers[index].navigate(`/game?runId=${encodeURIComponent(mainRun.id)}`);
    }

    await phase("window-1-embedded-real-narrative", async () => {
      const before = await runReadback(prisma, mainRun.id);
      const opened = await openWindow(mainRun.id, users.slice(0, 3));
      await assertBrowserWindowVisible(browsers, opened.windowId, 1);
      await submitCyclicPlans(mainRun.id, users.slice(0, 3), opened.humanRoleIds, { duplicateConfirm: true });
      await waitForWindowComplete(prisma, mainRun.id, opened.windowId, before.worldSequence + 1, 180_000);
      const narrativeBatch = await waitForWindowNarrativesComplete(prisma, mainRun.id, opened.windowId, before.worldSequence + 1);
      const projections = await fetchHumanProjections(mainRun.id, users.slice(0, 3));
      assertRecipientPrivacy(projections);
      assert(projections.every((entry) => entry.structuredResults.some((result: any) => result.resultKind === "CROSS_PLAYER_IMPACT")), "each cyclic target must receive one cross-player impact");
      assert(projections.every((entry) => entry.narrative.status === "AVAILABLE"), "every human role must observe its completed provider-backed narrative before replay begins");
      const after = await runReadback(prisma, mainRun.id);
      assert.equal(after.worldSequence, before.worldSequence + 1, "window 1 advances worldSequence exactly once");
      const runtimeProof = await runtimeNarrativeRepositoryProof();
      assert(runtimeProof.publicationCount >= narrativeBatch.publicationCount, "every completed narrative task requires a provider-backed OpenNovel publication file");
      await captureBrowserEvidence(browsers, "window-1");
      return { windowId: stableLabel(opened.windowId), before, after, narrativeBatch, projections: projections.map(safeProjection), runtimeProof };
    });

    await phase("idempotent-settlement-publication-outbox-replay", async () => {
      const completed = await latestCompletedWindow(prisma, mainRun.id, 1);
      const before = await replayFingerprint(prisma, mainRun.id, completed.id);
      const tasks = await prisma.storyTaskOutbox.findMany({
        where: { windowId: completed.id, taskType: { in: ["B0_SETTLEMENT_REQUESTED", "B0_PUBLISH_STRUCTURED_RESULTS"] } },
        select: { id: true, taskType: true, status: true },
        orderBy: { taskType: "asc" },
      });
      assert.equal(tasks.length, 2, "settlement and publication outbox tasks must exist");
      for (const task of tasks) {
        await prisma.storyTaskOutbox.update({
          where: { id: task.id },
          data: { status: "pending", completedAt: null, outcome: null, resultJson: Prisma.DbNull, nextRetryAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
        });
      }
      await waitFor(async () => {
        const rows = await prisma.storyTaskOutbox.findMany({ where: { id: { in: tasks.map((entry) => entry.id) } }, select: { status: true } });
        return rows.length === 2 && rows.every((entry) => entry.status === "completed");
      }, 90_000, "replayed settlement/publication tasks complete");
      const after = await replayFingerprint(prisma, mainRun.id, completed.id);
      assert.deepEqual(after, before, "replayed settlement/publication/outbox must not alter committed state");
      const replay = await apiJson(adminUser.token, `/v4/admin/b0/windows/${encodeURIComponent(completed.id)}/replay`, { method: "GET" });
      return { windowId: stableLabel(completed.id), taskIds: tasks.map((entry) => stableLabel(entry.id)), before, after, adminReplay: safeAdminReplay(replay) };
    });

    await phase("window-2-narrative-failure-does-not-rollback-and-retry", async () => {
      await stopProcess("runtime");
      const before = await runReadback(prisma, mainRun.id);
      const opened = await openWindow(mainRun.id, users.slice(0, 3));
      await submitCyclicPlans(mainRun.id, users.slice(0, 3), opened.humanRoleIds);
      await waitForWindowComplete(prisma, mainRun.id, opened.windowId, before.worldSequence + 1, 120_000);
      const failedTask = await waitForValue(async () => prisma.storyTaskOutbox.findFirst({
        where: { windowId: opened.windowId, taskType: "B0_NARRATIVE_GENERATION", status: { in: ["failed", "dead_letter", "FAILED_RETRYABLE"] } },
        select: { id: true, status: true, attempt: true, lastError: true, roleId: true },
        orderBy: { updatedAt: "asc" },
      }), 120_000, "narrative task failure while runtime is unavailable");
      const afterFailure = await runReadback(prisma, mainRun.id);
      assert.equal(afterFailure.worldSequence, before.worldSequence + 1, "narrative failure must not roll back worldSequence");
      await startRuntime(commonEnv);
      await apiJson(adminUser.token, `/v4/admin/b0/tasks/${encodeURIComponent(failedTask.id)}/retry`, { method: "POST", body: {} });
      await waitFor(async () => Boolean(await prisma.narrativeEntry.findFirst({ where: { runId: mainRun.id, roleId: failedTask.roleId, entryType: "B0_NARRATIVE", worldSequence: before.worldSequence + 1 } })), 240_000, "retried narrative publication");
      const recoveredTask = await prisma.storyTaskOutbox.findUnique({ where: { id: failedTask.id }, select: { status: true, attempt: true, completedAt: true } });
      assert.equal(recoveredTask?.status, "completed");
      const projections = await fetchHumanProjections(mainRun.id, users.slice(0, 3));
      assert(projections.some((entry) => entry.narrative.status === "AVAILABLE"), "at least one role must observe recovered narrative");
      return {
        windowId: stableLabel(opened.windowId),
        before,
        afterFailure,
        failedTask: { id: stableLabel(failedTask.id), status: failedTask.status, attempt: failedTask.attempt, errorCode: classifyError(failedTask.lastError) },
        recoveredTask,
      };
    });

    await phase("window-3-pause-current-completes-next-does-not-open-resume", async () => {
      await stopProcess("api");
      await startApi(commonEnv, true, { B0_NARRATIVE_ENABLED: "false" });
      const before = await runReadback(prisma, mainRun.id);
      const opened = await openWindow(mainRun.id, users.slice(0, 3));
      await apiJson(adminUser.token, `/v4/admin/b0/runs/${encodeURIComponent(mainRun.id)}/pause`, { method: "POST", body: { paused: true } });
      await submitCyclicPlans(mainRun.id, users.slice(0, 3), opened.humanRoleIds);
      await waitForWindowComplete(prisma, mainRun.id, opened.windowId, before.worldSequence + 1, 120_000);
      const openCountWhilePaused = await prisma.actionWindow.count({ where: { runId: mainRun.id, status: "OPEN", id: { not: opened.windowId } } });
      assert.equal(openCountWhilePaused, 0, "pause prevents a new window but never blocks current commit");
      await apiJson(adminUser.token, `/v4/admin/b0/runs/${encodeURIComponent(mainRun.id)}/pause`, { method: "POST", body: { paused: false } });
      const resumed = await apiJson(users[0].token, `/v4/rooms/${encodeURIComponent(mainRun.id)}/b0/window`, { method: "GET" });
      assert.equal(resumed.window.ordinal, 4);
      return { windowId: stableLabel(opened.windowId), before, after: await runReadback(prisma, mainRun.id), resumedWindowId: stableLabel(resumed.window.id), pausedOpenCount: openCountWhilePaused };
    });

    await phase("window-4-deadline-unconfirmed-human-becomes-hold", async () => {
      const before = await runReadback(prisma, mainRun.id);
      const opened = await currentWindow(mainRun.id, users.slice(0, 3));
      await submitCyclicPlans(mainRun.id, users.slice(0, 2), opened.humanRoleIds.slice(0, 2));
      const expiredDeadline = new Date(Date.now() - 1_000);
      await prisma.actionWindow.update({
        where: { id: opened.windowId },
        data: {
          mainOpenedAt: new Date(expiredDeadline.getTime() - 60_000),
          mainClosesAt: expiredDeadline,
        },
      });
      const recovered = await apiJson(adminUser.token, "/v4/admin/b0/recover", { method: "POST", body: {} });
      assert(array(recovered).some((entry) => object(entry).windowId === opened.windowId), "authoritative deadline recovery must freeze the intended window");
      await waitForWindowComplete(prisma, mainRun.id, opened.windowId, before.worldSequence + 1, 120_000);
      const workflow = await prisma.resolutionWorkflow.findUnique({ where: { windowId: opened.windowId }, select: { rulesOutputJson: true } });
      const envelope = object(workflow?.rulesOutputJson);
      const snapshot = object(envelope.snapshot);
      const missingRole = opened.humanRoleIds[2];
      const action = await prisma.playerAction.findUnique({ where: { nodeId_roleId_actionSlot: { nodeId: await windowNodeId(prisma, opened.windowId), roleId: missingRole, actionSlot: "B0_PRIMARY" } }, select: { normalizedJson: true } });
      const stored = object(action?.normalizedJson);
      const lockedIntent = object(stored.lockedIntent);
      assert.equal(lockedIntent.kind, "HOLD", "unconfirmed human must freeze as HOLD at authoritative deadline");
      const windowRow = await prisma.actionWindow.findUnique({ where: { id: opened.windowId }, select: { closingReason: true, status: true } });
      assert.equal(windowRow?.closingReason, "DEADLINE");
      return { windowId: stableLabel(opened.windowId), before, after: await runReadback(prisma, mainRun.id), missingRoleId: stableLabel(missingRole), lockedKind: lockedIntent.kind, closingReason: windowRow?.closingReason, snapshotHash: hashObject(snapshot), recoveryCount: array(recovered).length };
    });

    await phase("switch-to-independent-worker", async () => {
      await stopProcess("api");
      await startApi(commonEnv, false);
      await Promise.all(browsers.map(async (browser) => { await browser.reload(); await browser.waitForSelector("[data-b0-window-status]", 60_000); }));
      const health = await fetchJson(`${API_BASE}/health/worker`);
      assert.equal(health.enabled, false, "API must report that its embedded worker is disabled");
      return { apiRestartedWithEmbeddedWorker: false, apiWorkerHealth: { enabled: health.enabled, topology: health.topology, leaseMs: health.leaseMs } };
    });

    await phase("window-5-independent-worker", async () => {
      const before = await runReadback(prisma, mainRun.id);
      const opened = await openWindow(mainRun.id, users.slice(0, 3));
      await submitCyclicPlans(mainRun.id, users.slice(0, 3), opened.humanRoleIds);
      await sleep(1_500);
      const participantsBeforeWorker = await prisma.actionWindowParticipant.findMany({
        where: { windowId: opened.windowId },
        select: { roleId: true, mainStatus: true },
        orderBy: { roleId: "asc" },
      });
      const humanRoleIds = new Set(opened.humanRoleIds);
      const humanParticipants = participantsBeforeWorker.filter((entry) => humanRoleIds.has(entry.roleId));
      const aiParticipants = participantsBeforeWorker.filter((entry) => !humanRoleIds.has(entry.roleId));
      assert.equal(humanParticipants.length, opened.humanRoleIds.length, "all human roles must have synchronized window participants");
      assert(humanParticipants.every((entry) => entry.mainStatus === "B0_READY"), "all human roles must remain READY before the standalone worker starts");
      assert(aiParticipants.length >= 1, "the multiplayer run must retain AI-filled vacant roles");
      assert(aiParticipants.every((entry) => entry.mainStatus === "B0_PENDING"), "AI-filled roles must remain pending until a worker prepares their ActionContracts");
      const settlementBeforeWorker = await prisma.storyTaskOutbox.findFirst({
        where: { windowId: opened.windowId, taskType: "B0_SETTLEMENT_REQUESTED" },
        select: { id: true, status: true, attempt: true, leaseVersion: true, leaseOwner: true },
      });
      assert.equal(settlementBeforeWorker, null, "without any worker, AI-filled roles cannot freeze the window or enqueue settlement");
      const preWorkerWindow = await prisma.actionWindow.findUniqueOrThrow({ where: { id: opened.windowId }, select: { status: true } });
      const preWorkerRun = await prisma.storyRun.findUniqueOrThrow({ where: { id: mainRun.id }, select: { worldSequence: true } });
      assert.equal(preWorkerWindow.status, "OPEN", "the synchronized window must remain OPEN while AI-filled roles are unprepared");
      assert.equal(preWorkerRun.worldSequence, before.worldSequence, "without a standalone worker the world cannot advance");
      await startWorker(commonEnv, "worker", { B0_NARRATIVE_ENABLED: "false" });
      const workerPid = requiredValue(processes.get("worker")?.pid, "standalone worker pid");
      await waitForWindowComplete(prisma, mainRun.id, opened.windowId, before.worldSequence + 1, 120_000);
      const tasks = await prisma.storyTaskOutbox.findMany({ where: { windowId: opened.windowId, taskType: { startsWith: "B0_" } }, select: { id: true, windowId: true, roleId: true, taskType: true, status: true, outcome: true, leaseVersion: true, attempt: true, completedAt: true, lastError: true }, orderBy: { createdAt: "asc" } });
      const completedSettlement = tasks.find((entry) => entry.taskType === "B0_SETTLEMENT_REQUESTED");
      assert(completedSettlement?.status === "completed" && completedSettlement.leaseVersion > 0, "standalone worker must prepare AI actions, lease settlement, and complete the window");
      return {
        windowId: stableLabel(opened.windowId),
        before,
        after: await runReadback(prisma, mainRun.id),
        standaloneWorkerPidHash: hashText(String(workerPid)).slice(0, 16),
        beforeWorker: {
          windowStatus: preWorkerWindow.status,
          worldSequence: preWorkerRun.worldSequence,
          humanParticipants: humanParticipants.map((entry) => ({ roleId: stableLabel(entry.roleId), mainStatus: entry.mainStatus })),
          aiParticipants: aiParticipants.map((entry) => ({ roleId: stableLabel(entry.roleId), mainStatus: entry.mainStatus })),
          settlementTask: null,
        },
        tasks: tasks.map(safeTask),
      };
    });

    await phase("window-6-worker-crash-lease-expiry-recovery-and-ending", async () => {
      await stopProcess("worker");
      await startWorker(commonEnv, "worker-delayed", { STORY_TASK_TEST_DELAY_MS: "10000", STORY_TASK_LEASE_MS: "5000", ALLOW_FAULT_INJECTION: "true", B0_NARRATIVE_ENABLED: "false" });
      const before = await runReadback(prisma, mainRun.id);
      const opened = await openWindow(mainRun.id, users.slice(0, 3));
      await submitCyclicPlans(mainRun.id, users.slice(0, 3), opened.humanRoleIds);
      const running = await waitForValue(async () => prisma.storyTaskOutbox.findFirst({
        where: { windowId: opened.windowId, taskType: "B0_SETTLEMENT_REQUESTED", status: "running", leaseOwner: { not: null } },
        select: { id: true, leaseOwner: true, leaseVersion: true, leaseExpiresAt: true, attempt: true },
      }), 60_000, "delayed worker settlement lease");
      await stopProcess("worker-delayed", true);
      const killedAt = new Date();
      const delay = Math.max(0, Number(running.leaseExpiresAt?.getTime() || 0) - Date.now() + 1_500);
      await sleep(delay);
      await startWorker(commonEnv, "worker-recovered", { STORY_TASK_LEASE_MS: "5000", B0_NARRATIVE_ENABLED: "false" });
      await waitForWindowComplete(prisma, mainRun.id, opened.windowId, before.worldSequence + 1, 180_000);
      await waitFor(async () => prisma.storyRun.findUnique({ where: { id: mainRun.id }, select: { status: true } }).then((run) => run?.status === "completed"), 60_000, "B0 final ending");
      const after = await runReadback(prisma, mainRun.id);
      assert.equal(after.worldSequence, before.worldSequence + 1, "crash recovery advances world exactly once");
      assert.equal(after.status, "completed");
      const recovered = await prisma.storyTaskOutbox.findUnique({ where: { id: running.id }, select: { status: true, attempt: true, leaseVersion: true, completedAt: true } });
      assert.equal(recovered?.status, "completed");
      assert((recovered?.leaseVersion || 0) > running.leaseVersion, "recovery worker must own a newer lease epoch");
      const endings = await prisma.narrativeEntry.count({ where: { runId: mainRun.id, entryType: "B0_ENDING" } });
      assert(endings >= 3, "ending projections must be persisted for player roles");
      await captureBrowserEvidence(browsers, "final-ending");
      return { windowId: stableLabel(opened.windowId), before, after, crashedTask: { id: stableLabel(running.id), attempt: running.attempt, leaseVersion: running.leaseVersion, leaseExpiredAt: running.leaseExpiresAt?.toISOString(), killedAt: killedAt.toISOString() }, recoveredTask: recovered, endingCount: endings };
    });

    await phase("single-human-ai-action-contract-and-safe-abort", async () => {
      await stopProcess("worker-recovered");
      await startWorker(commonEnv, "worker", { STORY_TASK_LEASE_MS: "5000", B0_NARRATIVE_ENABLED: "false" });
      const single = await createSingleHumanRun(prisma, users[3]);
      const before = await runReadback(prisma, single.id);
      const opened = await openWindow(single.id, [users[3]]);
      const controls = await prisma.roleControl.findMany({ where: { runId: single.id }, select: { roleId: true, mode: true }, orderBy: { roleId: "asc" } });
      assert(controls.filter((entry) => entry.mode === "AI_ACTIVE").length >= 1, "single-human run must fill vacant roles with AI control");
      const aiActions = await prisma.playerAction.findMany({ where: { runId: single.id, nodeId: await windowNodeId(prisma, opened.windowId), playerType: "ai", actionSlot: "B0_PRIMARY" }, select: { roleId: true, normalizedJson: true } });
      assert(aiActions.length >= 1, "AI roles must submit the same stored ActionContract envelope");
      for (const row of aiActions) {
        const envelope = object(row.normalizedJson);
        assert.equal(object(envelope.latestDraft).schemaVersion, "b0-action-contract-v1");
      }
      const abort = await apiJson(users[0].token, `/v4/admin/b0/windows/${encodeURIComponent(opened.windowId)}/abort`, { method: "POST", body: {} });
      const after = await runReadback(prisma, single.id);
      assert.equal(after.worldSequence, before.worldSequence, "safe abort of uncommitted window cannot advance worldSequence");
      const row = await prisma.actionWindow.findUnique({ where: { id: opened.windowId }, select: { status: true } });
      assert.equal(row?.status, "ABORTED");
      return { run: safeRunIdentity(single), windowId: stableLabel(opened.windowId), before, after, aiRoleCount: aiActions.length, controlModes: controls, abort: safeAdminReplay(abort) };
    });

    await phase("browser-dom-network-privacy-and-readback", async () => {
      const browserReports = await Promise.all(browsers.map((browser) => browser.report()));
      for (const report of browserReports) {
        assert.equal(report.runtimeExceptions.length, 0, `${report.name} must not emit runtime exceptions`);
        assert(report.dom.statusVisible, `${report.name} must show B0 window status`);
        assert(report.dom.resultsVisible, `${report.name} must show B0 results`);
        assert(report.network.some((entry: any) => entry.url.includes("/b0/window") && entry.status >= 200 && entry.status < 300), `${report.name} must observe successful real B0 network traffic`);
      }
      const deliveryRows = await prisma.eventDelivery.findMany({
        where: { roomId: mainRun.id },
        select: { userId: true, roleId: true, deliverySequence: true, payloadJson: true, event: { select: { type: true, audienceRoleIdsJson: true } } },
        orderBy: [{ userId: "asc" }, { deliverySequence: "asc" }],
      });
      assert(deliveryRows.length > 0, "real EventDelivery rows are required");
      const usersById = new Map(users.map((entry) => [entry.id, entry]));
      for (const row of deliveryRows) {
        const payload = JSON.stringify(row.payloadJson);
        assert.doesNotMatch(payload, /resolutionHash|commitHash|snapshotHash|audience|originActorIds|targetActorIds|predicate|actor\.[A-Za-z0-9_-]+/u);
        assert(usersById.has(row.userId), "delivery must belong to a test user");
        const audience = array(row.event.audienceRoleIdsJson);
        assert.deepEqual(audience, [row.roleId], "typed audience must persist one authorized recipient");
      }
      const narratives = await prisma.narrativeEntry.findMany({ where: { runId: mainRun.id, entryType: { in: ["B0_NARRATIVE", "B0_ENDING"] } }, select: { roleId: true, entryType: true, visibility: true, worldSequence: true, content: true }, orderBy: [{ worldSequence: "asc" }, { roleId: "asc" }] });
      assert(narratives.every((entry) => entry.visibility === "private"), "role narratives must remain private");
      return {
        browsers: browserReports,
        eventDeliveries: deliveryRows.map((row) => ({ userId: stableLabel(row.userId), roleId: stableLabel(row.roleId), deliverySequence: row.deliverySequence, eventType: row.event.type, payloadHash: hashObject(row.payloadJson) })),
        narratives: narratives.map((entry) => ({ roleId: stableLabel(entry.roleId), entryType: entry.entryType, visibility: entry.visibility, worldSequence: entry.worldSequence, contentHash: hashText(entry.content), characterCount: entry.content.length })),
      };
    });

    const finalReadback = await comprehensiveReadback(prisma, mainRun.id);
    evidence.finalReadback = finalReadback;
    evidence.status = "PASS";
    evidence.completedAt = new Date().toISOString();
  } catch (error) {
    terminalError = error;
    evidence.status = "FAIL";
    evidence.completedAt = new Date().toISOString();
    evidence.failure = safeError(error);
  } finally {
    await Promise.allSettled(browsers.splice(0).map((browser) => browser.stop()));
    for (const name of [...processes.keys()].reverse()) await stopProcess(name).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await writeEvidenceFiles().catch((error) => {
      console.error(`[b0-acceptance] evidence write failed: ${safeError(error).message}`);
      if (!terminalError) terminalError = error;
    });
  }
  if (terminalError) throw terminalError;
}

async function phase(name: string, operation: () => Promise<Record<string, unknown>>) {
  const startedAt = new Date().toISOString();
  console.log(`[b0-acceptance] ${name}: start`);
  try {
    const result = await operation();
    const entry = { name, status: "PASS", startedAt, completedAt: new Date().toISOString(), result };
    (evidence.phases as any[]).push(entry);
    await writeJson(join(RAW_ROOT, `${String((evidence.phases as any[]).length).padStart(2, "0")}-${name}.json`), entry);
    console.log(`[b0-acceptance] ${name}: PASS`);
    return result;
  } catch (error) {
    const entry = { name, status: "FAIL", startedAt, completedAt: new Date().toISOString(), error: safeError(error) };
    (evidence.phases as any[]).push(entry);
    await writeJson(join(RAW_ROOT, `${String((evidence.phases as any[]).length).padStart(2, "0")}-${name}.json`), entry);
    console.error(`[b0-acceptance] ${name}: FAIL ${safeError(error).message}`);
    throw error;
  }
}

async function createVerifiedUsers(prisma: PrismaClient, count: number) {
  const users = [] as Array<{ id: string; openid: string; email: string; nickname: string; token: string }>;
  for (let index = 0; index < count; index += 1) {
    const created = await prisma.user.create({
      data: {
        openid: `b0_accept_${STAMP}_${index + 1}`,
        email: `b0-accept-${STAMP}-${index + 1}@example.test`,
        emailVerifiedAt: new Date(),
        nickname: `B0 acceptance player ${index + 1}`,
        policyAgreedAt: new Date(),
        status: "active",
      },
    });
    users.push({ ...created, email: created.email!, nickname: created.nickname!, token: issueAcceptanceToken(created) });
  }
  return users;
}

async function createThreeHumanRun(prisma: PrismaClient, users: Array<{ id: string; token: string }>) {
  const created = await apiJson(users[0].token, "/v4/rooms", { method: "POST", body: { worldId: "sangtian", visibility: "private", idempotencyKey: `b0-main-${randomUUID()}` } });
  const runId = String(created.id);
  assert(runId && created.inviteCode, "room create must return id and inviteCode");
  for (const user of users.slice(1)) await apiJson(user.token, "/v4/rooms/join-by-code", { method: "POST", body: { inviteCode: created.inviteCode } });
  const hostView = await apiJson(users[0].token, `/v4/rooms/${encodeURIComponent(runId)}`, { method: "GET" });
  const roles = array(hostView.roles).slice(0, 3);
  assert.equal(roles.length, 3, "Sangtian room must expose at least three player roles");
  for (let index = 0; index < users.length; index += 1) await apiJson(users[index].token, `/v4/rooms/${encodeURIComponent(runId)}/role`, { method: "POST", body: { roleId: object(roles[index]).id } });
  await apiJson(users[0].token, `/v4/rooms/${encodeURIComponent(runId)}/role/lock`, { method: "POST", body: {} });
  for (const user of users) await apiJson(user.token, `/v4/rooms/${encodeURIComponent(runId)}/ready`, { method: "POST", body: { ready: true } });
  await apiJson(users[0].token, `/v4/rooms/${encodeURIComponent(runId)}/start`, { method: "POST", body: {} });
  await enableB0(prisma, runId);
  return prisma.storyRun.findUniqueOrThrow({ where: { id: runId }, include: { players: true, roles: true } });
}

async function createSingleHumanRun(prisma: PrismaClient, user: { id: string; token: string }) {
  const created = await apiJson(user.token, "/v4/rooms", { method: "POST", body: { worldId: "sangtian", visibility: "private", idempotencyKey: `b0-single-${randomUUID()}` } });
  const runId = String(created.id);
  const roleId = object(array(created.roles)[0]).id;
  await apiJson(user.token, `/v4/rooms/${encodeURIComponent(runId)}/role`, { method: "POST", body: { roleId } });
  await apiJson(user.token, `/v4/rooms/${encodeURIComponent(runId)}/role/lock`, { method: "POST", body: {} });
  await apiJson(user.token, `/v4/rooms/${encodeURIComponent(runId)}/ready`, { method: "POST", body: { ready: true } });
  const run = await prisma.storyRun.findUniqueOrThrow({ where: { id: runId } });
  const state = object(run.stateJson);
  const room = object(state.room);
  await prisma.storyRun.update({ where: { id: runId }, data: { stateJson: { ...state, room: { ...room, minPlayers: 1 } } as Prisma.InputJsonValue } });
  await apiJson(user.token, `/v4/rooms/${encodeURIComponent(runId)}/start`, { method: "POST", body: {} });
  await enableB0(prisma, runId);
  return prisma.storyRun.findUniqueOrThrow({ where: { id: runId }, include: { players: true, roles: true } });
}

async function enableB0(prisma: PrismaClient, runId: string) {
  const run = await prisma.storyRun.findUniqueOrThrow({ where: { id: runId } });
  const state = object(run.stateJson);
  await prisma.storyRun.update({
    where: { id: runId },
    data: {
      status: "playing",
      strategyVersion: "b0_windowed_v1",
      stateJson: { ...state, b0: { ...object(state.b0), enabled: true, status: "ACTIVE", acceptanceRun: true } } as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
}

async function openWindow(runId: string, users: Array<{ id: string; token: string }>) {
  const projections = await Promise.all(users.map((user) => apiJson(user.token, `/v4/rooms/${encodeURIComponent(runId)}/b0/window`, { method: "GET" })));
  const ids = new Set(projections.map((entry) => entry.window.id));
  assert.equal(ids.size, 1, "all human sessions must observe one active synchronized window");
  assert(projections.every((entry) => entry.window.status === "OPEN"), "acceptance must begin each planned phase on an OPEN synchronized window");
  assert(projections.every((entry) => entry.actor.ready === false), "a successor window must reset each human participant to not ready");
  const humanRoleIds = await roleIdsForUsers(runId, users.map((entry) => entry.id));
  return { windowId: projections[0].window.id as string, ordinal: projections[0].window.ordinal as number, humanRoleIds, projections };
}

async function currentWindow(runId: string, users: Array<{ id: string; token: string }>) {
  return openWindow(runId, users);
}

async function roleIdsForUsers(runId: string, userIds: string[]) {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    const rows = await prisma.storyPlayer.findMany({ where: { runId, userId: { in: userIds } }, select: { userId: true, roleId: true } });
    const map = new Map(rows.map((entry) => [entry.userId, entry.roleId]));
    return userIds.map((userId) => requiredValue(map.get(userId), `role for ${userId}`));
  } finally { await prisma.$disconnect(); }
}

async function submitCyclicPlans(
  runId: string,
  users: Array<{ id: string; token: string }>,
  roleIds: string[],
  options: { duplicateConfirm?: boolean } = {},
) {
  assert.equal(users.length, roleIds.length);
  for (let index = 0; index < users.length; index += 1) {
    const targetRoleId = roleIds[(index + 1) % roleIds.length] || roleIds[0];
    const maneuver = await apiJson(users[index].token, `/v4/rooms/${encodeURIComponent(runId)}/maneuvers/projection`, { method: "GET" });
    const b0 = await apiJson(users[index].token, `/v4/rooms/${encodeURIComponent(runId)}/b0/window`, { method: "GET" });
    const contact = array(maneuver.contacts).find((entry) => object(entry).id === targetRoleId) || array(maneuver.contacts)[0];
    assert(contact, `role ${roleIds[index]} must have a contact target`);
    const draft = {
      kind: "CONTACT",
      targetId: object(contact).id,
      rawText: `Coordinate a bounded action with ${object(contact).label || "the counterpart"} in window ${b0.window.ordinal}.`,
      expectedTurnRevision: maneuver.turnRevision,
    };
    const preview = await apiJson(users[index].token, `/v4/rooms/${encodeURIComponent(runId)}/b0/window/preview`, {
      method: "POST",
      body: {
        draft,
        expectedStateRevision: maneuver.stateRevision,
        expectedRevision: b0.plan?.revision ?? 0,
        clientRequestId: `b0.accept.${b0.window.ordinal}.${index + 1}.${randomBytes(5).toString("hex")}`,
      },
    });
    assert.equal(preview.decision, "READY", "real maneuver preview must compile to READY");
    const revision = Number(preview.b0PlanRevision ?? preview.window?.plan?.revision);
    assert(Number.isInteger(revision) && revision > 0, "B0 preview must save a positive revision");
    const confirmed = await apiJson(users[index].token, `/v4/rooms/${encodeURIComponent(runId)}/b0/window/confirm`, { method: "POST", body: { expectedRevision: revision } });
    if (options.duplicateConfirm && index === 0) {
      const replayed = await apiJson(users[index].token, `/v4/rooms/${encodeURIComponent(runId)}/b0/window/confirm`, { method: "POST", body: { expectedRevision: revision } });
      assert.equal(replayed.plan?.status, "CONFIRMED", "duplicate confirmation must replay idempotently");
    }
    await apiJson(users[index].token, `/v4/rooms/${encodeURIComponent(runId)}/b0/window/ready`, { method: "POST", body: { expectedReadyRevision: confirmed.actor.readyRevision } });
  }
}

async function fetchHumanProjections(runId: string, users: Array<{ token: string }>) {
  return Promise.all(users.map((user) => apiJson(user.token, `/v4/rooms/${encodeURIComponent(runId)}/b0/window`, { method: "GET" })));
}

function assertRecipientPrivacy(projections: any[]) {
  for (const projection of projections) {
    const serialized = JSON.stringify(projection);
    assert.doesNotMatch(serialized, /inputHash|resolutionHash|commitHash|snapshotHash|audience|originActorIds|targetActorIds|predicate|actor\.[A-Za-z0-9_-]+/u);
    assert(Array.isArray(projection.structuredResults));
  }
}

async function waitForWindowComplete(prisma: PrismaClient, runId: string, windowId: string, worldSequence: number, timeout: number) {
  await waitFor(async () => {
    const [window, run] = await Promise.all([
      prisma.actionWindow.findUnique({ where: { id: windowId }, select: { status: true } }),
      prisma.storyRun.findUnique({ where: { id: runId }, select: { worldSequence: true } }),
    ]);
    return window?.status === "COMPLETED" && run?.worldSequence === worldSequence;
  }, timeout, `window ${windowId} complete at worldSequence ${worldSequence}`);
}

async function latestCompletedWindow(prisma: PrismaClient, runId: string, ordinal: number) {
  const rows = await prisma.actionWindow.findMany({ where: { runId, status: "COMPLETED" }, select: { id: true, configJson: true, nodeId: true, status: true }, orderBy: { createdAt: "asc" } });
  const row = rows.find((entry) => object(entry.configJson).window?.ordinal === ordinal || object(object(entry.configJson).window).ordinal === ordinal) || rows[ordinal - 1];
  return requiredValue(row, `completed window ${ordinal}`);
}

async function windowNodeId(prisma: PrismaClient, windowId: string) {
  return requiredValue((await prisma.actionWindow.findUnique({ where: { id: windowId }, select: { nodeId: true } }))?.nodeId, `node for window ${windowId}`);
}

async function runReadback(prisma: PrismaClient, runId: string) {
  const run = await prisma.storyRun.findUniqueOrThrow({ where: { id: runId }, select: { id: true, status: true, worldSequence: true, reservedWorldSequence: true, currentDay: true, version: true, updatedAt: true } });
  const [windows, events, deliveries, narratives, tasks] = await Promise.all([
    prisma.actionWindow.count({ where: { runId } }),
    prisma.storyEvent.count({ where: { runId, type: { startsWith: "B0_" } } }),
    prisma.eventDelivery.count({ where: { roomId: runId } }),
    prisma.narrativeEntry.count({ where: { runId, entryType: { in: ["B0_NARRATIVE", "B0_ENDING"] } } }),
    prisma.storyTaskOutbox.count({ where: { runId, taskType: { startsWith: "B0_" } } }),
  ]);
  return { ...run, updatedAt: run.updatedAt.toISOString(), windows, events, deliveries, narratives, tasks };
}

async function waitForWindowNarrativesComplete(prisma: PrismaClient, runId: string, windowId: string, worldSequence: number) {
  return waitForValue(async () => {
    const tasks = await prisma.storyTaskOutbox.findMany({
      where: { runId, windowId, taskType: "B0_NARRATIVE_GENERATION" },
      select: { id: true, roleId: true, status: true, dedupeKey: true },
      orderBy: { roleId: "asc" },
    });
    if (tasks.length === 0 || tasks.some((entry) => entry.status !== "completed")) return null;
    const roleIds = tasks.map((entry) => requiredValue(entry.roleId, `narrative role for task ${entry.id}`));
    assert.equal(new Set(roleIds).size, roleIds.length, "window narrative tasks must be unique per role");
    const entries = await prisma.narrativeEntry.findMany({
      where: { runId, entryType: "B0_NARRATIVE", worldSequence, roleId: { in: roleIds } },
      select: { id: true, roleId: true, dedupeKey: true },
      orderBy: { roleId: "asc" },
    });
    if (entries.length !== tasks.length) return null;
    const publishedRoleIds = entries.map((entry) => requiredValue(entry.roleId, `narrative role for entry ${entry.id}`));
    if (publishedRoleIds.some((roleId, index) => roleId !== roleIds[index])) return null;
    return {
      taskCount: tasks.length,
      publicationCount: entries.length,
      roleIds: roleIds.map(stableLabel),
      taskDedupeHashes: tasks.map((entry) => hashText(entry.dedupeKey)),
      entryDedupeHashes: entries.map((entry) => hashText(requiredValue(entry.dedupeKey, `dedupe key for narrative ${entry.id}`))),
    };
  }, 360_000, "all window narrative tasks and role publications complete before replay fingerprint");
}

async function replayFingerprint(prisma: PrismaClient, runId: string, windowId: string) {
  const workflow = await prisma.resolutionWorkflow.findUniqueOrThrow({ where: { windowId }, select: { rulesOutputJson: true } });
  const envelope = object(workflow.rulesOutputJson);
  const manifest = object(envelope.manifest);
  return {
    worldSequence: (await prisma.storyRun.findUniqueOrThrow({ where: { id: runId }, select: { worldSequence: true } })).worldSequence,
    commitHash: manifest.commitHash,
    resolutionHash: object(envelope.resolution).resolutionHash,
    storyEventCount: await prisma.storyEvent.count({ where: { runId, type: { startsWith: "B0_" } } }),
    eventDeliveryCount: await prisma.eventDelivery.count({ where: { roomId: runId } }),
    narrativeCount: await prisma.narrativeEntry.count({ where: { runId, entryType: "B0_NARRATIVE" } }),
  };
}

async function comprehensiveReadback(prisma: PrismaClient, runId: string) {
  const run = await prisma.storyRun.findUniqueOrThrow({ where: { id: runId }, select: { id: true, status: true, worldSequence: true, reservedWorldSequence: true, currentDay: true, summary: true, stateJson: true } });
  const windows = await prisma.actionWindow.findMany({ where: { runId }, include: { participants: true, resolutionWorkflow: true }, orderBy: { createdAt: "asc" } });
  const tasks = await prisma.storyTaskOutbox.findMany({ where: { runId, taskType: { startsWith: "B0_" } }, select: { id: true, windowId: true, roleId: true, taskType: true, status: true, outcome: true, attempt: true, leaseVersion: true, completedAt: true, lastError: true }, orderBy: { createdAt: "asc" } });
  const controls = await prisma.roleControl.findMany({ where: { runId }, select: { roleId: true, mode: true, epoch: true, humanPlayerId: true }, orderBy: { roleId: "asc" } });
  return {
    run: { id: stableLabel(run.id), status: run.status, worldSequence: run.worldSequence, reservedWorldSequence: run.reservedWorldSequence, currentDay: run.currentDay, summary: run.summary, b0: object(object(run.stateJson).b0) },
    windows: windows.map((entry, index) => ({ ordinal: index + 1, id: stableLabel(entry.id), status: entry.status, closingReason: entry.closingReason, participantCount: entry.participants.length, participantStates: entry.participants.map((participant) => ({ roleId: stableLabel(participant.roleId), mainStatus: participant.mainStatus, version: participant.version })), commitHash: object(object(entry.resolutionWorkflow?.rulesOutputJson).manifest).commitHash || null })),
    tasks: tasks.map(safeTask),
    controls: controls.map((entry) => ({ roleId: stableLabel(entry.roleId), mode: entry.mode, epoch: entry.epoch, human: Boolean(entry.humanPlayerId) })),
  };
}

async function runtimeNarrativeRepositoryProof() {
  const root = join(OPENOVEL_RUNTIME_ROOT, "b0-narrative-jobs");
  if (!existsSync(root)) return { jobCount: 0, publicationCount: 0, publicationHashes: [] as string[] };
  const files = await walk(root);
  const publications = files.filter((entry) => basename(entry) === "publication.json").sort();
  const jobs = files.filter((entry) => basename(entry) === "job.json").sort();
  return {
    jobCount: jobs.length,
    publicationCount: publications.length,
    publicationHashes: await Promise.all(publications.map(async (entry) => hashText(await readFile(entry, "utf8")))),
  };
}

async function captureBrowserEvidence(browsers: BrowserSession[], label: string) {
  for (const browser of browsers) await browser.capture(join(SCREENSHOT_ROOT, `${label}-${browser.name}.png`));
}

async function assertBrowserWindowVisible(browsers: BrowserSession[], windowId: string, ordinal: number) {
  for (const browser of browsers) {
    await browser.waitForSelector("[data-b0-window-status]", 60_000);
    const dom = await browser.evaluate(`(() => ({ text: document.querySelector('[data-b0-window-status]')?.innerText || '', ready: document.querySelector('[data-testid="b0-ready-count"]')?.textContent || '', href: location.href }))()`);
    assert(String(dom.text).length > 0, `${browser.name} B0 status is empty`);
    assert(String(dom.href).includes("/game?runId="), `${browser.name} must use the real /game route`);
    await browser.capture(join(SCREENSHOT_ROOT, `window-${ordinal}-open-${browser.name}.png`));
  }
  const dbWindowIds = new Set(await Promise.all(browsers.map((browser) => browser.evaluate(`window.__b0Window?.state?.projection?.window?.id || null`))));
  dbWindowIds.delete(null);
  if (dbWindowIds.size) assert.deepEqual([...dbWindowIds], [windowId]);
}

function childEnvironment(adminUserId: string) {
  return {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL,
    SUPABASE_DATABASE_URL: "",
    AUTH_TOKEN_SECRET,
    AUTH_COOKIE_SECURE: "false",
    OPENOVEL_INTERNAL_TOKEN,
    OPENOVEL_RUNTIME_URL: RUNTIME_BASE,
    OPENOVEL_PROJECT_ROOT: ROOT,
    OPENOVEL_RUNTIME_ROOT,
    OPENOVEL_WORKSPACE_ROOT: OPENOVEL_RUNTIME_ROOT,
    OPENOVEL_PROVIDER_BASE_URL,
    OPENOVEL_API_KEY,
    OPENOVEL_MODEL,
    OPENOVEL_NARRATOR_MODEL: OPENOVEL_MODEL,
    OPENOVEL_REVIEWER_MODEL: OPENOVEL_MODEL,
    OPENOVEL_OPTIONS_MODEL: OPENOVEL_MODEL,
    OPENOVEL_STORYKEEPER_MODEL: OPENOVEL_MODEL,
    OPENOVEL_DEEPSEEK_THINKING: "disabled",
    SOLO_STORY_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    OPENOVEL_PROVIDER_TIMEOUT_MS: "300000",
    MANEUVER_PREVIEW_SECRET,
    MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED: "false",
    ROLE_AGENT_PROVIDER: "rules",
    STORY_WORKER_ENABLED: "true",
    B0_TOTAL_WINDOWS: "6",
    B0_WINDOW_DURATION_SECONDS: "300",
    B0_RECOVERY_POLL_MS: "500",
    B0_NARRATIVE_ENABLED: "true",
    CREDIT_ACTION_METERING_MODE: "OFF",
    ADMIN_USER_IDS: adminUserId,
    ADMIN_EMAILS: "",
    PUBLIC_WEB_ORIGIN: WEB_BASE,
    API_PORT: String(API_PORT),
  } as NodeJS.ProcessEnv;
}

async function startApi(commonEnv: NodeJS.ProcessEnv, embedded: boolean, overrides: NodeJS.ProcessEnv = {}) {
  await stopProcess("api").catch(() => undefined);
  const managed = startProcess("api", globalThis.process.execPath, [join(ROOT, "apps/api/dist/main.js")], { ...commonEnv, PORT: String(API_PORT), STORY_WORKER_EMBEDDED: embedded ? "true" : "false", ...overrides });
  await waitHttp(`${API_BASE}/health`, 60_000, managed);
}

async function startRuntime(commonEnv: NodeJS.ProcessEnv) {
  await stopProcess("runtime").catch(() => undefined);
  const managed = startProcess("runtime", globalThis.process.execPath, [join(ROOT, "apps/openovel-runtime/dist/server.js")], { ...commonEnv, PORT: String(RUNTIME_PORT), OPENOVEL_RUNTIME_HOST: "127.0.0.1" });
  await waitHttp(`${RUNTIME_BASE}/health`, 60_000, managed);
}

async function startWeb(commonEnv: NodeJS.ProcessEnv) {
  const managed = startProcess("web", globalThis.process.execPath, [join(ROOT, "apps/web/src/server.mjs")], { ...commonEnv, PORT: String(WEB_PORT), API_PORT: String(API_PORT) });
  await waitHttp(`${WEB_BASE}/game`, 60_000, managed);
}

async function startWorker(commonEnv: NodeJS.ProcessEnv, name: string, overrides: NodeJS.ProcessEnv) {
  const managed = startProcess(name, globalThis.process.execPath, [join(ROOT, "apps/api/dist/worker.js")], { ...commonEnv, STORY_WORKER_EMBEDDED: "false", STORY_WORKER_PROCESS: "true", ...overrides });
  await sleep(1_000);
  if (managed.exited) throw new Error(`${name} exited before it could poll the outbox (code ${managed.exitCode})`);
}

class ManagedProcess {
  readonly child: ChildProcess;
  readonly logName: string;
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];
  exited = false;
  exitCode: number | null = null;
  constructor(readonly name: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
    const generation = (processStartCounts.get(name) || 0) + 1;
    processStartCounts.set(name, generation);
    this.logName = `${name}-${String(generation).padStart(2, "0")}`;
    this.child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    this.child.stdout?.on("data", (chunk) => this.stdout.push(String(chunk)));
    this.child.stderr?.on("data", (chunk) => this.stderr.push(String(chunk)));
    this.child.on("exit", (code) => { this.exited = true; this.exitCode = code; });
  }
  get pid() { return this.child.pid || null; }
  async stop(force = false) {
    if (!this.exited) {
      this.child.kill(force ? "SIGKILL" : "SIGTERM");
      await Promise.race([new Promise<void>((resolve) => this.child.once("exit", () => resolve())), sleep(5_000)]);
      if (!this.exited) this.child.kill("SIGKILL");
    }
    const stdoutPath = join(LOG_ROOT, `${this.logName}.out.log`);
    const stderrPath = join(LOG_ROOT, `${this.logName}.err.log`);
    await writeFile(stdoutPath, scrub(this.stdout.join("")), "utf8");
    await writeFile(stderrPath, scrub(this.stderr.join("")), "utf8");
  }
}

function startProcess(name: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
  if (processes.has(name)) throw new Error(`process ${name} is already registered`);
  const managed = new ManagedProcess(name, command, args, env);
  processes.set(name, managed);
  return managed;
}

async function stopProcess(name: string, force = false) {
  const managed = processes.get(name);
  if (!managed) return;
  await managed.stop(force);
  processes.delete(name);
}

class CdpClient {
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  readonly exceptions: string[] = [];
  readonly network: Array<{ method: string; url: string; status: number; type: string }> = [];
  private readonly requestMethods = new Map<string, string>();
  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data));
      if (data.method === "Runtime.exceptionThrown") this.exceptions.push(String(data.params?.exceptionDetails?.text || "runtime exception"));
      if (data.method === "Network.requestWillBeSent") this.requestMethods.set(String(data.params?.requestId || ""), String(data.params?.request?.method || "GET"));
      if (data.method === "Network.responseReceived") {
        const response = data.params?.response;
        const url = String(response?.url || "");
        if (url.includes("/api/v4/") || url.includes("/api/health")) this.network.push({ method: this.requestMethods.get(String(data.params?.requestId || "")) || "GET", url: url.replace(/^https?:\/\/[^/]+/, ""), status: Number(response?.status || 0), type: String(data.params?.type || "") });
      }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
  }
  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.sequence;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.socket.close(); }
}

class BrowserSession {
  private chrome: ChildProcess | null = null;
  private cdp: CdpClient | null = null;
  constructor(readonly name: string, readonly port: number, readonly width: number, readonly height: number, readonly mobile: boolean) {}
  async start() {
    const profile = join(ROOT, ".runtime", `chrome-b0-${this.name}-${STAMP}`);
    await rm(profile, { recursive: true, force: true });
    this.chrome = spawn(CHROME_PATH, [
      `--remote-debugging-port=${this.port}`,
      "--remote-debugging-address=127.0.0.1",
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "about:blank",
    ], { cwd: ROOT, stdio: "ignore" });
    const version = await waitForValue(async () => fetch(`http://127.0.0.1:${this.port}/json/version`).then((response) => response.ok ? response.json() : null).catch(() => null), 30_000, `${this.name} CDP version`);
    assert(version.webSocketDebuggerUrl);
    let pages = await fetchJson(`http://127.0.0.1:${this.port}/json/list`);
    let page = array(pages).find((entry) => object(entry).type === "page");
    if (!page) page = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    const socket = new WebSocket(String(object(page).webSocketDebuggerUrl));
    await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", () => reject(new Error(`${this.name} CDP socket failed`)), { once: true }); });
    this.cdp = new CdpClient(socket);
    await this.cdp.send("Page.enable");
    await this.cdp.send("Runtime.enable");
    await this.cdp.send("Network.enable");
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: this.width, height: this.height, deviceScaleFactor: 1, mobile: this.mobile });
  }
  async authenticate(token: string) {
    assert(this.cdp);
    await this.cdp.send("Network.setCookie", { name: "many_worlds_session", value: token, url: WEB_BASE, httpOnly: true, secure: false, sameSite: "Lax" });
    await this.cdp.send("Network.setCookie", { name: "many_worlds_session_hint", value: "1", url: WEB_BASE, httpOnly: false, secure: false, sameSite: "Lax" });
  }
  async navigate(path: string) {
    assert(this.cdp);
    await this.cdp.send("Page.navigate", { url: `${WEB_BASE}${path}` });
    await this.waitFor(() => this.evaluate("document.readyState === 'complete'"), 30_000, `${this.name} document complete`);
  }
  async reload() { assert(this.cdp); await this.cdp.send("Page.reload", { ignoreCache: true }); await sleep(500); }
  async evaluate(expression: string) {
    assert(this.cdp);
    const result = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(`${this.name}: ${result.exceptionDetails.text || "browser evaluation failed"}`);
    return result.result?.value;
  }
  async waitForSelector(selector: string, timeout: number) { await this.waitFor(() => this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), timeout, `${this.name} selector ${selector}`); }
  async waitFor(operation: () => Promise<any>, timeout: number, label: string) { await waitFor(operation, timeout, label); }
  async capture(path: string) { assert(this.cdp); const shot = await this.cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }); await writeFile(path, Buffer.from(shot.data, "base64")); }
  async report() {
    const dom = await this.evaluate(`(() => ({
      href: location.pathname + location.search,
      viewport: { width: innerWidth, height: innerHeight },
      statusVisible: Boolean(document.querySelector('[data-b0-window-status]')),
      resultsVisible: Boolean(document.querySelector('[data-b0-window-results]')),
      statusText: (document.querySelector('[data-b0-window-status]')?.innerText || '').slice(0, 600),
      resultsText: (document.querySelector('[data-b0-window-results]')?.innerText || '').slice(0, 1200),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    }))()`);
    return { name: this.name, mobile: this.mobile, dom, runtimeExceptions: [...(this.cdp?.exceptions || [])], network: dedupeNetwork(this.cdp?.network || []) };
  }
  async stop() { this.cdp?.close(); this.chrome?.kill("SIGKILL"); this.cdp = null; this.chrome = null; }
}

async function apiJson(token: string, path: string, input: { method: string; body?: unknown }) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: input.method,
    headers: { accept: "application/json", ...(input.body !== undefined ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}` },
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
    signal: AbortSignal.timeout(240_000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`HTTP_${response.status}:${String(payload.code || "UNKNOWN")}:${String(payload.message || "request failed")}`);
  return payload;
}

async function waitHttp(url: string, timeout: number, process: ManagedProcess) {
  await waitFor(async () => {
    if (process.exited) throw new Error(`${process.name} exited before readiness with code ${process.exitCode}`);
    return fetch(url, { signal: AbortSignal.timeout(2_000) }).then((response) => response.ok).catch(() => false);
  }, timeout, `${process.name} readiness`);
}

async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP_${response.status}:${url}`);
  return response.json();
}

async function waitFor(operation: () => Promise<any>, timeout: number, label: string) {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { if (await operation()) return; } catch (error) { lastError = error; }
    await sleep(200);
  }
  throw new Error(`TIMEOUT:${label}${lastError ? `:${safeError(lastError).message}` : ""}`);
}

async function waitForValue<T>(operation: () => Promise<T | null | undefined | false>, timeout: number, label: string): Promise<T> {
  let result: T | null | undefined | false;
  await waitFor(async () => { result = await operation(); return Boolean(result); }, timeout, label);
  return result as T;
}

async function writeEvidenceFiles() {
  await writeJson(join(EVIDENCE_ROOT, "acceptance-result.json"), evidence);
  const report = markdownReport(evidence);
  await writeFile(join(EVIDENCE_ROOT, "acceptance-report.md"), report, "utf8");
  const catalog = await artifactCatalog(EVIDENCE_ROOT);
  await writeJson(join(EVIDENCE_ROOT, "artifact-catalog.json"), catalog);
}

async function artifactCatalog(root: string) {
  const files = await walk(root);
  const rows = [] as Array<{ path: string; sizeBytes: number; sha256: string }>;
  for (const path of files.filter((entry) => !entry.endsWith("artifact-catalog.json")).sort()) {
    const bytes = await readFile(path);
    rows.push({ path: relative(ROOT, path).replace(/\\/g, "/"), sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return { schemaVersion: 1, testedCodeSha: TESTED_CODE_SHA, generatedAt: new Date().toISOString(), files: rows };
}

async function walk(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path)); else output.push(path);
  }
  return output;
}

function markdownReport(value: Record<string, unknown>) {
  const phases = array(value.phases);
  const databaseDescription = ACCEPTANCE_TIER === "formal-c8"
    ? `real non-production Supabase project bound through GitHub environment ${ACCEPTANCE_ENVIRONMENT} and random isolated schema`
    : `official self-hosted Supabase PostgreSQL image ${DATABASE_IMAGE} in a random isolated engineering schema`;
  const providerDescription = ACCEPTANCE_TIER === "formal-c8"
    ? `real DeepSeek API model ${OPENOVEL_MODEL}`
    : `real local Ollama model ${OPENOVEL_MODEL} from image ${PROVIDER_IMAGE}`;
  return `# B0 C9 Real Acceptance Report\n\n- Status: **${String(value.status || "UNKNOWN")}**\n- Tested code SHA: \`${TESTED_CODE_SHA}\`\n- Acceptance tier: \`${ACCEPTANCE_TIER}\`\n- Started: ${String(value.startedAt)}\n- Completed: ${String(value.completedAt || "") }\n- Database: ${databaseDescription}; the public schema was not used or modified.\n- Narrative provider: ${providerDescription} over OpenAI-compatible HTTP; deterministic/mock providers and fallback are prohibited.\n- Runtime: real Nest API, static Web server, OpenNovel runtime, embedded and independent worker processes.\n- Browser: three isolated Chromium profiles, including desktop and 390px narrow viewport.\n\n## Phases\n\n${phases.map((phase) => `- ${object(phase).status === "PASS" ? "✅" : "❌"} ${object(phase).name}`).join("\n")}\n\n## Trust boundary\n\nThis report records only sanitized identifiers, hashes, counts, status transitions, DOM summaries, network status metadata, and screenshots. Database URLs, provider keys, session cookies, bearer tokens, and internal shared tokens are excluded and scrubbed from process logs.\n`;
}


function issueAcceptanceToken(user: { id: string; openid: string }) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    openid: user.openid,
    aud: "many-worlds-v4",
    authMethod: "PASSWORD",
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  })).toString("base64url");
  const signature = createHmac("sha256", AUTH_TOKEN_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function safeProjection(entry: any) {
  return {
    schemaVersion: entry.schemaVersion,
    window: entry.window,
    actor: entry.actor,
    readyCount: entry.readyCount,
    expectedCount: entry.expectedCount,
    settlement: entry.settlement,
    structuredResults: array(entry.structuredResults).map((result) => ({ resultId: stableLabel(object(result).resultId), resultKind: object(result).resultKind, visibility: object(result).visibility, summary: object(result).summary, outcomeStatus: object(result).outcomeStatus, changes: object(result).changes, reasons: object(result).reasons })),
    narrative: { status: entry.narrative?.status, contentHash: entry.narrative?.content ? hashText(entry.narrative.content) : null, characterCount: entry.narrative?.content?.length || 0 },
  };
}

function safeTask(task: any) { return { id: stableLabel(task.id), windowId: stableLabel(task.windowId), roleId: stableLabel(task.roleId), taskType: task.taskType, status: task.status, outcome: task.outcome || null, attempt: task.attempt, leaseVersion: task.leaseVersion, completed: Boolean(task.completedAt), errorCode: classifyError(task.lastError) }; }
function safeAdminReplay(value: any) { return JSON.parse(JSON.stringify(value, (key, item) => /hash|token|cookie|secret|url/i.test(key) ? (item ? `[${key.toUpperCase()}_REDACTED]` : item) : item)); }
function safeRunIdentity(run: any) { return { id: stableLabel(run.id), templateKey: run.templateKey, status: run.status, strategyVersion: run.strategyVersion, humanPlayers: array(run.players).filter((entry) => object(entry).playerType === "human").length, roleCount: array(run.roles).length }; }
function safeError(error: unknown) { const message = scrub(error instanceof Error ? error.message : String(error)); return { name: error instanceof Error ? error.name : "Error", message: message.slice(0, 1_000), stackHash: error instanceof Error && error.stack ? hashText(scrub(error.stack)) : null }; }
function classifyError(value: unknown) { const text = String(value || ""); const match = text.match(/[A-Z][A-Z0-9_]{4,}/); return match?.[0] || (text ? "RUNTIME_ERROR" : null); }
function hashObject(value: unknown) { return hashText(JSON.stringify(value)); }
function hashText(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stableLabel(value: unknown) { if (!value) return null; return `id_${hashText(String(value)).slice(0, 16)}`; }
function required(name: string) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required`); return value; }
function optional(name: string) { return String(process.env[name] || "").trim(); }
function integerEnv(name: string, fallback: number) { const value = Number(process.env[name] || fallback); if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`); return value; }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function array(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function requiredValue<T>(value: T | null | undefined, label: string): T { if (value === null || value === undefined || value === "") throw new Error(`Missing ${label}`); return value; }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function scrub(input: string) {
  let output = String(input || "");
  for (const value of SAFE_SECRET_VALUES.filter(Boolean).sort((a, b) => b.length - a.length)) output = output.split(value).join("[REDACTED]");
  output = output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_REDACTED]");
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]");
  output = output.replace(/many_worlds_session=[^;\s]+/gi, "many_worlds_session=[REDACTED]");
  return output;
}
function discoverChrome() {
  const configured = String(process.env.CHROME_PATH || "").trim();
  const candidates = [configured, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  const found = candidates.find((entry) => existsSync(entry));
  if (!found) throw new Error("A Chromium/Chrome binary is required for real /game acceptance");
  return found;
}
function assertIsolatedSchema(urlValue: string) {
  const url = new URL(urlValue);
  const schema = String(url.searchParams.get("schema") || "");
  if (!/^(?:cs_accept_b0_|b0_accept_)[a-z0-9_]{8,}$/i.test(schema)) throw new Error("DATABASE_URL must target a dedicated random B0 acceptance schema");
  if (schema.toLowerCase() === "public") throw new Error("The public schema is forbidden for B0 acceptance");
}
function safeDatabaseKind(urlValue: string) {
  const url = new URL(urlValue);
  return {
    protocol: url.protocol.replace(":", ""),
    provider: DATABASE_PROVENANCE,
    hostHash: hashText(url.hostname).slice(0, 16),
    selfHostedOfficialSupabase: ACCEPTANCE_TIER === "engineering-selfhosted",
    supabaseCloudNonProduction: ACCEPTANCE_TIER === "formal-c8",
  };
}
function safeProviderKind(urlValue: string) {
  const url = new URL(urlValue);
  return {
    protocol: url.protocol.replace(":", ""),
    hostHash: hashText(url.hostname).slice(0, 16),
    local: url.hostname === "127.0.0.1" || url.hostname === "localhost",
  };
}
function assertAcceptanceProvenance() {
  const databaseUrl = new URL(DATABASE_URL);
  const providerUrl = new URL(OPENOVEL_PROVIDER_BASE_URL);
  const databaseHost = databaseUrl.hostname.toLowerCase();
  const providerHost = providerUrl.hostname.toLowerCase();
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

  if (!PROVIDER_MODEL_DIGEST.startsWith("sha256:")) throw new Error("B0_PROVIDER_MODEL_DIGEST must be a sha256 digest");

  if (ACCEPTANCE_TIER === "engineering-selfhosted") {
    if (DATABASE_PROVENANCE !== "official-supabase-postgres-container") throw new Error("Engineering acceptance requires the official self-hosted Supabase PostgreSQL container provenance");
    if (!DATABASE_IMAGE.startsWith("supabase/postgres:")) throw new Error("B0_DATABASE_IMAGE must identify the official supabase/postgres image");
    if (!DATABASE_IMAGE_DIGEST.startsWith("sha256:")) throw new Error("B0_DATABASE_IMAGE_DIGEST must be a sha256 digest");
    if (!localHosts.has(databaseHost)) throw new Error("Engineering database must be isolated on the local runner");
    if (PROVIDER_PROVENANCE !== "ollama-openai-compatible-local") throw new Error("Engineering acceptance requires a real local Ollama provider provenance");
    if (!PROVIDER_IMAGE.startsWith("ollama/ollama:")) throw new Error("B0_PROVIDER_IMAGE must identify the official ollama/ollama image");
    if (!PROVIDER_IMAGE_DIGEST.startsWith("sha256:")) throw new Error("B0_PROVIDER_IMAGE_DIGEST must be a sha256 digest");
    if (!localHosts.has(providerHost)) throw new Error("Engineering provider must be bound to the isolated local runner");
    return;
  }

  if (ACCEPTANCE_TIER === "formal-c8") {
    if (DATABASE_PROVENANCE !== "supabase-cloud-nonproduction-random-schema") throw new Error("Formal C8 requires a real non-production Supabase project with a random isolated schema");
    if (!/(?:^|\.)supabase\.(?:co|com)$/.test(databaseHost)) throw new Error("Formal C8 DATABASE_URL must target a Supabase-managed host");
    if (localHosts.has(databaseHost)) throw new Error("Formal C8 cannot use a local PostgreSQL or Supabase container");
    if (!/(?:test|testing|staging|stage|preview)/i.test(ACCEPTANCE_ENVIRONMENT)) throw new Error("Formal C8 must bind through an explicitly non-production GitHub environment");
    if (!DATABASE_SECRET_NAME) throw new Error("Formal C8 must record the non-production database secret name");
    if (DATABASE_IMAGE || DATABASE_IMAGE_DIGEST) throw new Error("Formal C8 must not claim a container image as its database provenance");
    if (PROVIDER_PROVENANCE !== "deepseek-api-real") throw new Error("Formal C8 requires the real DeepSeek API provider provenance");
    if (providerUrl.protocol !== "https:") throw new Error("Formal C8 provider transport must use HTTPS");
    if (providerHost !== "api.deepseek.com") throw new Error("Formal C8 provider must target the official DeepSeek API host");
    if (!PROVIDER_SECRET_NAME) throw new Error("Formal C8 must record the provider secret name");
    if (PROVIDER_IMAGE || PROVIDER_IMAGE_DIGEST) throw new Error("Formal C8 must not claim a local provider image");
    return;
  }

  throw new Error(`Unsupported B0_ACCEPTANCE_TIER: ${ACCEPTANCE_TIER}`);
}
function dedupeNetwork(rows: Array<{ method: string; url: string; status: number; type: string }>) { const seen = new Set<string>(); return rows.filter((entry) => { const key = `${entry.url}|${entry.status}|${entry.type}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(-80); }
async function writeJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

if (process.env.B0_ACCEPTANCE_SELF_CHECK === "1") {
  assertIsolatedSchema(DATABASE_URL);
  assertAcceptanceProvenance();
  console.log("B0_ACCEPTANCE_SELF_CHECK_OK");
} else {
  main().catch((error) => {
    console.error(scrub(error instanceof Error ? error.stack || error.message : String(error)));
    process.exitCode = 1;
  });
}
