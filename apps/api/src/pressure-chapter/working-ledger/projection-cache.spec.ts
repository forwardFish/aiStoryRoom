import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  type DecisionActionV1,
} from "@ai-story/shared";
import { createChapterWorkingState } from "@ai-story/templates";
import type { WorkingActionIntentV1 } from "./contracts";
import { computeWorkingActionInputFingerprintV1 } from "./fingerprint";
import {
  decodeWorkingLedgerProjectionCacheV1,
  withWorkingLedgerProjectionCacheHashV1,
  workingLedgerProjectionCacheHashV1,
} from "./projection-cache";
import type { WorkingLedgerProjectionV1 } from "./contracts";
import {
  appendFormalActionEventsToWorkingLedgerProjection,
  buildWorkingLedgerEvents,
  buildWorkingLedgerEventsFromProjection,
  projectWorkingLedger,
  workingStateHash,
} from "./working-ledger";

test("incremental formal-action projection equals full immutable-event replay", () => {
  const runId = "run-projection-cache";
  const chapterRuntimeId = "runtime-projection-cache";
  const routeHash = sha256Canonical("route-projection-cache");
  const state = createChapterWorkingState({ runId, chapterId: "N1" });
  const opened = buildWorkingLedgerEvents({
    key: { runId, chapterRuntimeId },
    chapterId: "N1",
    previousEvents: [],
    payloads: [{
      eventType: "WORKING_LEDGER_OPENED",
      routeHash,
      chapterDefinitionHash: sha256Canonical("chapter-definition"),
      initialState: state,
      initialStateHash: workingStateHash(state),
      nextDecisionPin: {
        schemaVersion: "pressure_decision_pin_v1",
        chapterId: "N1",
        stateRevision: 0,
        stateFingerprint: workingStateHash(state),
        decisionPointId: "decision-1",
        kernelId: "kernel-1",
        optionIds: ["DECIDE"],
      },
    }],
  });
  const base = projectWorkingLedger(opened);
  const payload = { optionId: "DECIDE" };
  const actionBody = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: "action-1",
    runId,
    chapterRuntimeId,
    chapterId: "N1" as const,
    decisionPointId: "decision-1",
    seatId: "cabinet_finance" as const,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: 0,
    status: "SEALED" as const,
    actionType: "DECIDE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: "idem-action-1",
  };
  const withRequest = {
    ...actionBody,
    requestFingerprint: computeDecisionActionRequestFingerprint(actionBody),
  };
  const action: DecisionActionV1 = {
    ...withRequest,
    sealedHash: sha256Canonical(withRequest),
  };
  const intent: WorkingActionIntentV1 = {
    visibility: "PRIVATE",
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
  const inputFingerprint = computeWorkingActionInputFingerprintV1({
    routeHash,
    action,
    intent,
  });
  const events = buildWorkingLedgerEventsFromProjection({
    projection: base,
    payloads: [{
      eventType: "FORMAL_ACTION_ACCEPTED",
      routeHash,
      inputFingerprint,
      action,
      intent,
      audienceSeatIds: [action.seatId],
    }],
  });

  const incremental = appendFormalActionEventsToWorkingLedgerProjection(base, events);
  const replayed = projectWorkingLedger([...opened, ...events]);

  assert.equal(
    workingLedgerProjectionCacheHashV1(incremental),
    workingLedgerProjectionCacheHashV1(replayed),
  );
  assert.equal(incremental.headSequence, base.headSequence + 1);
  assert.equal(incremental.actionsByIdempotencyKey.get(action.idempotencyKey)?.eventHash, events[0]?.eventHash);
});

test("projection cache decoder binds runtime revision, state hash and ledger head", () => {
  const runId = "run-cache-decode";
  const chapterRuntimeId = "runtime-cache-decode";
  const routeHash = sha256Canonical("route-cache-decode");
  const state = createChapterWorkingState({ runId, chapterId: "N1" });
  const events = buildWorkingLedgerEvents({
    key: { runId, chapterRuntimeId },
    chapterId: "N1",
    previousEvents: [],
    payloads: [{
      eventType: "WORKING_LEDGER_OPENED",
      routeHash,
      chapterDefinitionHash: sha256Canonical("definition-cache-decode"),
      initialState: state,
      initialStateHash: workingStateHash(state),
      nextDecisionPin: null,
    }],
  });
  const projection = projectWorkingLedger(events);
  const bindings = {
    runId,
    chapterRuntimeId,
    chapterId: "N1",
    routeHash,
    workingRevision: 0,
    workingState: state,
    workingStateHash: workingStateHash(state),
  };
  const decoded = decodeWorkingLedgerProjectionCacheV1(cacheOf(projection), bindings);
  assert.equal(
    workingLedgerProjectionCacheHashV1(decoded),
    workingLedgerProjectionCacheHashV1(projection),
  );
  const legacyCache = cacheOf(projection);
  delete legacyCache.projectionCacheHash;
  assert.equal(
    decodeWorkingLedgerProjectionCacheV1(legacyCache, bindings).headHash,
    projection.headHash,
  );
  assert.throws(() => decodeWorkingLedgerProjectionCacheV1(
    { ...cacheOf(projection), headHash: sha256Canonical("tampered-head") },
    bindings,
  ), /WORKING_PROJECTION_CACHE_BINDING_MISMATCH/u);
  assert.throws(() => decodeWorkingLedgerProjectionCacheV1(
    cacheOf(projection),
    { ...bindings, workingRevision: 1 },
  ), /WORKING_PROJECTION_CACHE_BINDING_MISMATCH/u);
});

function cacheOf(projection: WorkingLedgerProjectionV1): Record<string, unknown> {
  const entries = <T>(value: ReadonlyMap<string, T>) => [...value.entries()];
  return withWorkingLedgerProjectionCacheHashV1({
    schemaVersion: "pressure_mvp_ledger_projection_v1",
    key: projection.key,
    chapterId: projection.chapterId,
    routeHash: projection.routeHash,
    chapterDefinitionHash: projection.chapterDefinitionHash,
    headHash: projection.headHash,
    headSequence: projection.headSequence,
    stateHash: projection.stateHash,
    nextDecisionPin: projection.nextDecisionPin,
    acceptedActions: entries(projection.acceptedActions),
    actionsByIdempotencyKey: entries(projection.actionsByIdempotencyKey),
    commitmentActionsByIdempotencyKey: entries(
      projection.commitmentActionsByIdempotencyKey ?? new Map(),
    ),
    appliedBeats: entries(projection.appliedBeats),
    pendingReservations: entries(projection.pendingReservations),
    commitments: entries(projection.commitments),
    evidenceRefsByAction: entries(projection.evidenceRefsByAction),
    knowledgeBySeat: entries(projection.knowledgeBySeat),
    seatArcProgressBySeat: entries(projection.seatArcProgressBySeat),
    beatDownstreamManifest: null,
  });
}
