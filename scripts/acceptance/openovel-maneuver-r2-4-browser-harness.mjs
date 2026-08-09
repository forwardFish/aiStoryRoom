import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertConfirmAppliedOnce,
  assertPreviewZeroSideEffects,
  classifyManeuverRequest,
  projectionSnapshot,
  stableClone,
} from "./openovel-maneuver-preview-confirm-contract.mjs";
import {
  click,
  doubleClick,
  evaluate,
  screenshot,
  waitForManeuverRequestDelta,
  waitSelector,
  waitUntil,
} from "./openovel-maneuver-r2-4-browser-cdp.mjs";

export function createManeuverAcceptanceHarness({
  cdp,
  prisma,
  getRunId,
  apiBase,
  sessionCookie,
  evidenceRoot,
  browserEvidence,
  providerSnapshot,
}) {
  const checkpoints = [];
  const maneuverAudits = [];

  async function projection() {
    const runId = requiredRunId(getRunId());
    const response = await fetch(`${apiBase}/v4/rooms/${encodeURIComponent(runId)}/game`, {
      headers: { accept: "application/json", cookie: sessionCookie },
    });
    const payload = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload;
  }

  async function databaseSnapshot() {
    const runId = requiredRunId(getRunId());
    const [run, events, tasks] = await Promise.all([
      prisma.storyRun.findUniqueOrThrow({
        where: { id: runId },
        select: { version: true, stateJson: true, worldSequence: true },
      }),
      prisma.storyEvent.findMany({
        where: { runId, type: "openovel_maneuver_result" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, visibility: true, payloadJson: true },
      }),
      prisma.aiTask.findMany({
        where: { runId, taskType: "resolve_maneuver_narrative" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, status: true, provider: true, inputTokens: true, outputTokens: true, errorMessage: true },
      }),
    ]);
    return {
      run: {
        version: run.version,
        worldSequence: run.worldSequence,
        stateJson: stableClone(run.stateJson),
      },
      events: events.map((event) => ({
        id: event.id,
        maneuverType: event.payloadJson?.maneuverType || null,
        visibility: event.visibility,
        versionBefore: event.payloadJson?.versionBefore ?? null,
        versionAfter: event.payloadJson?.versionAfter ?? null,
        requestFingerprint: event.payloadJson?.requestFingerprint || null,
      })),
      tasks: tasks.map((task) => ({
        id: task.id,
        status: task.status,
        provider: task.provider,
        inputTokens: task.inputTokens,
        outputTokens: task.outputTokens,
        errorMessage: task.errorMessage,
      })),
    };
  }

  async function databaseEvidence() {
    const snapshot = await databaseSnapshot();
    return {
      run: { version: snapshot.run.version, worldSequence: snapshot.run.worldSequence },
      events: snapshot.events,
      tasks: snapshot.tasks,
    };
  }

  async function authoritativeState() {
    const [game, database] = await Promise.all([projection(), databaseSnapshot()]);
    return {
      projection: projectionSnapshot(game),
      database,
      providerCalls: providerSnapshot(),
    };
  }

  async function exerciseManeuver(config) {
    await config.prepare();
    await config.assertDraft();

    const first = await previewPass(config, 1);
    await click(cdp, "#maneuverPreviewCancel");
    await waitSelector(cdp, config.workbenchSelector, 30_000);
    assert.equal(await evaluate(cdp, "Boolean(document.querySelector('[data-testid=\"maneuver-preview-card\"]'))"), false);
    await config.assertDraft();
    if (config.afterCancel) await config.afterCancel();
    if (config.assertEditedDraft) await config.assertEditedDraft();
    else await config.assertDraft();

    const second = await previewPass(config, 2);
    const beforeConfirm = second.authoritativeAfter;
    const requestStart = browserEvidence.maneuverRequests().length;
    await doubleClick(cdp, "#maneuverConfirm");
    await waitSelector(cdp, "#continueStoryBtn", 120_000);
    await waitSelector(cdp, '[data-testid="result-narrative"]', 120_000);
    const confirmRequests = await waitForManeuverRequestDelta(browserEvidence, requestStart, { preview: 0, confirm: 1 });
    const confirmRequest = confirmRequests.find((item) => classifyManeuverRequest(item.url) === "confirm");
    assert.ok(confirmRequest?.requestBody?.previewToken, `${config.label}: Confirm request is missing previewToken`);
    assert.deepEqual(Object.keys(confirmRequest.requestBody || {}).sort(), ["previewToken"]);

    const authoritativeAfter = await authoritativeState();
    const expectedProviderCallDelta = beforeConfirm.providerCalls == null
      ? null
      : config.expectedProviderCallDelta;
    const formalDelta = assertConfirmAppliedOnce({
      label: config.label,
      maneuverType: config.maneuverType,
      beforeProjection: beforeConfirm.projection,
      afterProjection: authoritativeAfter.projection,
      beforeDatabase: beforeConfirm.database,
      afterDatabase: authoritativeAfter.database,
      expectedAiTaskDelta: config.expectedAiTaskDelta,
      beforeProviderCalls: beforeConfirm.providerCalls,
      afterProviderCalls: authoritativeAfter.providerCalls,
      expectedProviderCallDelta,
    });

    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-testid=\"maneuver-preview-card\"]').length"), 0);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-testid=\"result-narrative\"]').length"), 1);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('#continueStoryBtn').length"), 1);
    await config.assertConfirmed(await projection());

    const audit = {
      label: config.label,
      maneuverType: config.maneuverType,
      firstPreviewRequest: first.request,
      secondPreviewRequest: second.request,
      confirmRequest,
      previewZeroSideEffect: true,
      formalEventIds: formalDelta.newEvents.map((item) => item.id),
      aiTaskIds: formalDelta.newTasks.map((item) => item.id),
      quotaBefore: beforeConfirm.projection.quota?.remaining,
      quotaAfter: authoritativeAfter.projection.quota?.remaining,
      maneuverVersionBefore: beforeConfirm.projection.maneuverVersion,
      maneuverVersionAfter: authoritativeAfter.projection.maneuverVersion,
      worldSequenceBefore: beforeConfirm.projection.worldSequence,
      worldSequenceAfter: authoritativeAfter.projection.worldSequence,
    };
    maneuverAudits.push(audit);
    await checkpoint(`${checkpointOrdinal()}-${config.label}-confirmed`, await projection(), audit);
    await continueResult();
    assert.equal(await evaluate(cdp, "Boolean(document.querySelector('#submitDecision'))"), true);

    const beforeReload = await authoritativeState();
    const maneuverRequestCount = browserEvidence.maneuverRequests().length;
    await cdp.send("Page.reload", { ignoreCache: true });
    await enterScene();
    const afterReload = await authoritativeState();
    assertPreviewZeroSideEffects({
      label: `${config.label} refresh persistence`,
      beforeProjection: beforeReload.projection,
      afterProjection: afterReload.projection,
      beforeDatabase: beforeReload.database,
      afterDatabase: afterReload.database,
      beforeProviderCalls: beforeReload.providerCalls,
      afterProviderCalls: afterReload.providerCalls,
    });
    assert.equal(
      browserEvidence.maneuverRequests().length,
      maneuverRequestCount,
      `${config.label}: refresh replayed Preview or Confirm`,
    );
    const persistedGame = await projection();
    if (config.assertPersisted) await config.assertPersisted(persistedGame);
    else await config.assertConfirmed(persistedGame);
    await checkpoint(`${checkpointOrdinal()}-${config.label}-refresh-persisted`, persistedGame, {
      formalEventIds: audit.formalEventIds,
      aiTaskIds: audit.aiTaskIds,
    });
    return afterReload;
  }

  async function previewPass(config, pass) {
    const authoritativeBefore = await authoritativeState();
    const requestStart = browserEvidence.maneuverRequests().length;
    await doubleClick(cdp, "#maneuverSubmit");
    await waitSelector(cdp, '[data-testid="maneuver-preview-card"]', 60_000);
    const requests = await waitForManeuverRequestDelta(browserEvidence, requestStart, { preview: 1, confirm: 0 });
    const previewRequest = requests.find((item) => classifyManeuverRequest(item.url) === "preview");
    assert.ok(previewRequest, `${config.label}: Preview request was not observed`);
    config.assertPreviewRequest(previewRequest, pass);

    const pattern = pass === 1 ? config.firstPreviewPattern : config.secondPreviewPattern;
    const previewSurface = await evaluate(cdp, `({
      count: document.querySelectorAll('[data-testid="maneuver-preview-card"]').length,
      cancel: document.querySelectorAll('#maneuverPreviewCancel').length,
      confirm: document.querySelectorAll('#maneuverConfirm').length,
      result: document.querySelectorAll('[data-testid="result-narrative"]').length,
      continueButtons: document.querySelectorAll('#continueStoryBtn').length,
      text: document.querySelector('[data-testid="maneuver-preview-card"]')?.innerText || ''
    })`);
    assert.deepEqual(
      { count: previewSurface.count, cancel: previewSurface.cancel, confirm: previewSurface.confirm },
      { count: 1, cancel: 1, confirm: 1 },
      `${config.label}: Preview surface duplicated or omitted controls`,
    );
    assert.equal(previewSurface.result, 0, `${config.label}: Preview rendered a formal result`);
    assert.equal(previewSurface.continueButtons, 0, `${config.label}: Preview rendered Continue before Confirm`);
    assert.match(previewSurface.text, /不包含结果预测|确认后才会写入世界|确认后/);
    if (pattern) assert.match(previewSurface.text, pattern);

    const authoritativeAfter = await authoritativeState();
    assertPreviewZeroSideEffects({
      label: `${config.label} Preview pass ${pass}`,
      beforeProjection: authoritativeBefore.projection,
      afterProjection: authoritativeAfter.projection,
      beforeDatabase: authoritativeBefore.database,
      afterDatabase: authoritativeAfter.database,
      beforeProviderCalls: authoritativeBefore.providerCalls,
      afterProviderCalls: authoritativeAfter.providerCalls,
    });
    await checkpoint(`${checkpointOrdinal()}-${config.label}-preview-${pass}-zero-write`, await projection(), {
      request: previewRequest,
      previewText: previewSurface.text,
      authoritativeBefore,
      authoritativeAfter,
    });
    return { request: previewRequest, authoritativeBefore, authoritativeAfter };
  }

  async function submitMainTurn(ordinal) {
    await waitSelector(cdp, "#submitDecision", 60_000);
    const before = await projection();
    await evaluate(cdp, `(() => {
      const option = document.querySelector('input[name="decision"]');
      if (option) option.click();
      const submit = document.querySelector('#submitDecision');
      if (!submit) throw new Error('submitDecision missing');
      submit.click();
      return true;
    })()`);
    await waitUntil(
      async () => Number((await projection()).worldSequence) === Number(before.worldSequence) + 1,
      120_000,
      `main turn ${ordinal} did not commit`,
    );
    await waitSelector(cdp, "#continueStoryBtn", 120_000);
    await continueResult();
  }

  async function continueResult() {
    await click(cdp, "#continueStoryBtn");
    const state = await waitUntil(async () => {
      const value = await evaluate(cdp, `({
        submit: Boolean(document.querySelector('#submitDecision')),
        begin: Boolean(document.querySelector('#beginStoryBtn')),
        fatal: document.querySelector('[data-testid="fatal-error"]')?.innerText || ''
      })`);
      if (value.fatal) throw new Error(value.fatal);
      return value.submit || value.begin ? value : false;
    }, 60_000, "Continue did not restore the main-story decision surface");
    if (state.begin) await click(cdp, "#beginStoryBtn");
    await waitSelector(cdp, "#submitDecision", 60_000);
  }

  async function enterScene() {
    await waitUntil(async () => {
      const state = await evaluate(cdp, `({
        ready: document.readyState,
        begin: Boolean(document.querySelector('#beginStoryBtn')),
        buttons: document.querySelectorAll('[data-maneuver-type]').length,
        fatal: document.querySelector('[data-testid="fatal-error"]')?.innerText || ''
      })`);
      if (state.fatal) throw new Error(state.fatal);
      return state.ready === "complete" && (state.begin || state.buttons === 4) ? state : false;
    }, 60_000, "game page did not become actionable");
    if (await evaluate(cdp, "Boolean(document.querySelector('#beginStoryBtn'))")) await click(cdp, "#beginStoryBtn");
    await waitSelector(cdp, '[data-maneuver-type="contact"]', 60_000);
  }

  async function checkpoint(name, gameProjection = null, extra = {}) {
    const file = path.join(evidenceRoot, `${name}.png`);
    await screenshot(cdp, file);
    const item = {
      name,
      screenshot: file,
      projection: gameProjection ? projectionSnapshot(gameProjection) : null,
      ...extra,
    };
    checkpoints.push(item);
    await writeFile(path.join(evidenceRoot, `${name}.json`), `${JSON.stringify(item, null, 2)}\n`, "utf8");
  }

  function checkpointOrdinal() {
    return String(checkpoints.length + 1).padStart(2, "0");
  }

  return {
    checkpoints,
    maneuverAudits,
    projection,
    databaseSnapshot,
    databaseEvidence,
    authoritativeState,
    exerciseManeuver,
    submitMainTurn,
    continueResult,
    enterScene,
    checkpoint,
  };
}

function requiredRunId(value) {
  const runId = String(value || "").trim();
  if (!runId) throw new Error("runId is required for maneuver acceptance");
  return runId;
}
