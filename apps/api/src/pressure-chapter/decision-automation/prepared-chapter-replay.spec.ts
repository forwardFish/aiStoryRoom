import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import { SangtianAuthoredChapterContentAdapterV1 } from "../integration/content.adapters";
import { planChapterOpeningV1 } from "../orchestrator/chapter-orchestrator.service";
import {
  appendFormalActionEventsToWorkingLedgerProjection,
  buildWorkingLedgerEventsFromProjection,
} from "../working-ledger/working-ledger";
import type { FormalActionAcceptedPayloadV1 } from "../working-ledger/contracts";
import { computeWorkingActionInputFingerprintV1 } from "../working-ledger/fingerprint";
import { planPreparedChapterReplayV1 } from "./prepared-chapter-replay";

const NOW = 1_900_000_000_000;
const HUMAN: SeatIdV1 = "zhejiang_governor";

test("whole completed chapter prefix is folded in memory into one replay batch", async () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  const route = withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: "run-prepared-chapter-replay",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "matrix-v1",
    testMatrixSha256: digest("matrix"),
    runSeed: "replay-seed",
    narrativeProfileVersion: "narrative-v1",
    featureSetVersion: "feature-v1",
    resultContractRegistryVersion: "result-v1",
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [HUMAN],
    controlTopologyVersion: "control-v1",
    initialRoleControlSnapshotHash: digest("control"),
  });
  const descriptor = await new SangtianAuthoredChapterContentAdapterV1().load({
    routeSnapshot: route,
    chapterId: "N1",
  });
  const seed = createChapterWorkingState({
    runId: route.runId,
    chapterId: "N1",
    facts: loadPublishedSangtianActionReleaseV1().compileChapterActionEffects({
      chapterId: "N1",
      confirmedActions: [],
      defaultEvents: [],
    }).settlementFacts,
  });
  const opening = planChapterOpeningV1({
    routeSnapshot: route,
    chapter: descriptor,
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: digest("world"),
      previousFrozenHash: digest("genesis"),
    },
    expected: null,
    seed,
    nowMs: NOW,
  });
  const payloads: FormalActionAcceptedPayloadV1[] = descriptor.decisions.map((decision, index) => {
    const actionId = `human-action-${index}`;
    const actionType = decision.execution.allowedActionTypes[0]!;
    const actionBase = {
      schemaVersion: "sangtian_decision_action_v1" as const,
      actionId,
      runId: route.runId,
      chapterRuntimeId: opening.chapterRuntimeId,
      chapterId: "N1" as const,
      decisionPointId: decision.decisionPointId,
      seatId: HUMAN,
      actionOrdinal: 1,
      actionRevision: 1,
      controlEpoch: 1,
      expectedWorkingRevision: 0,
      status: "SEALED" as const,
      actionType,
      payload: {},
      payloadHash: sha256Canonical({}),
      idempotencyKey: `${actionId}:idempotency`,
    };
    const withRequest = {
      ...actionBase,
      requestFingerprint: computeDecisionActionRequestFingerprint(actionBase),
    };
    const action = { ...withRequest, sealedHash: sha256Canonical(withRequest) };
    const intent = {
      visibility: "PRIVATE" as const,
      targetSeatIds: [],
      evidenceRefs: [],
      resourceReservations: [],
      commitmentMutations: [],
      knowledgeGrants: [],
      seatArcProgress: [],
    };
    return {
      eventType: "FORMAL_ACTION_ACCEPTED",
      routeHash: route.routeHash,
      inputFingerprint: computeWorkingActionInputFingerprintV1({
        routeHash: route.routeHash,
        action,
        intent,
      }),
      action,
      intent,
      audienceSeatIds: [HUMAN],
      decisionAuthorityMode: "MULTIPLAYER_SEAT",
    };
  });
  const actionEvents = buildWorkingLedgerEventsFromProjection({
    projection: opening.projection,
    payloads,
  });
  const projection = appendFormalActionEventsToWorkingLedgerProjection(
    opening.projection,
    actionEvents,
  );
  const batch = planPreparedChapterReplayV1({
    batchId: "chapter-replay-batch",
    snapshot: {
      routeSnapshot: route,
      chapter: opening.state,
      projection,
      snapshotHash: digest("snapshot"),
    },
    chapterDescriptor: descriptor,
    nowMs: NOW,
  });

  assert.ok(batch);
  assert.equal(batch.beats.length, descriptor.decisions.length - 1);
  assert.equal(batch.finalOrchestratorState.phase, "ACTIVE");
  assert.equal(
    batch.finalOrchestratorState.activeDecision?.decisionPointId,
    descriptor.decisions.at(-1)?.decisionPointId,
  );
  assert.equal(batch.finalLedgerHeadHash, batch.beats.at(-1)?.event.eventHash);
  assert.equal(batch.batchHash, sha256Canonical((({ batchHash: _ignored, ...body }) => body)(batch)));
  assert.equal(
    batch.beats.every((beat) => beat.actionIds.length === 1),
    true,
  );
});

function digest(value: string): string {
  return sha256Canonical({ value });
}
