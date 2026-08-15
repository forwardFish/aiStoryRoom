import assert from "node:assert/strict";
import test from "node:test";
import type { PreparedAutomationActionBatchV1 } from "../decision-automation/contracts";
import { classifyPressureSql7BatchProgressionV1 } from "./progression-gate";

test("SQL7 classifies an intermediate planned Beat without invoking settlement semantics", () => {
  const batch = fixture();
  const result = classifyPressureSql7BatchProgressionV1(batch);
  assert.deepEqual(result, {
    kind: "NEXT_BEAT",
    chapterId: "N1",
    currentDecisionPointId: "N1.weir_crisis",
    nextDecisionPointId: "N1.dispatch_route",
  });
});

test("SQL7 rejects repeated next decisions and partial progression", () => {
  const repeated = fixture();
  repeated.beatPlan.postBeatOrchestratorState.activeDecision!.decisionPointId = repeated.decisionPointId;
  assert.throws(
    () => classifyPressureSql7BatchProgressionV1(repeated),
    /PRESSURE_SQL7_PROGRESSION_INVALID:INTERMEDIATE_BEAT_BINDING/u,
  );

  const partial = fixture();
  partial.beatPlan.postBeatOrchestratorState.phase = "RESOLVING_BEAT";
  assert.throws(
    () => classifyPressureSql7BatchProgressionV1(partial),
    /PRESSURE_SQL7_PROGRESSION_INVALID:INTERMEDIATE_BEAT_BINDING/u,
  );
});

function fixture(): PreparedAutomationActionBatchV1 {
  return {
    schemaVersion: "pressure_prepared_automation_action_batch_v1",
    batchId: "batch-n1-b01",
    snapshotHash: "a".repeat(64),
    runId: "run-n1",
    routeHash: "b".repeat(64),
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1",
    decisionPointId: "N1.weir_crisis",
    expectedOrchestratorRevision: 1,
    expectedOrchestratorHash: "c".repeat(64),
    expectedWorkingRevision: 0,
    expectedWorkingStateHash: "d".repeat(64),
    expectedLedgerHeadHash: "e".repeat(64),
    expectedSeatAuthorityStateHash: "f".repeat(64),
    frozenSeatOrder: [],
    actions: [],
    chapterDescriptor: {} as never,
    nextOrchestratorState: {} as never,
    beatPlan: {
      event: {} as never,
      resolution: {} as never,
      postBeatOrchestratorState: {
        schemaVersion: "pressure_chapter_orchestrator_state_v1",
        runId: "run-n1",
        routeHash: "b".repeat(64),
        revision: 3,
        phase: "ACTIVE",
        currentChapterId: "N1",
        chapterRuntimeId: "runtime-n1",
        descriptorHash: "1".repeat(64),
        authorityBase: {} as never,
        activeDecision: {
          decisionPointId: "N1.dispatch_route",
          policyHash: "2".repeat(64),
          openedAtMs: 2,
          deadlineAtMs: null,
          seats: [],
        },
        chapterSeatSummaries: [],
        settlementInputHash: null,
        frozenBundleHash: null,
        orchestratorHash: "3".repeat(64),
      },
      settlementInput: null,
      narrativeJobs: [],
      aEmotionEmissions: [],
      downstreamManifest: {} as never,
    },
    batchHash: "4".repeat(64),
  };
}
