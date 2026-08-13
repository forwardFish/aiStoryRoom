import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  sha256Canonical,
  withRunRouteHash,
  type SeatIdV1,
} from "@ai-story/shared";
import { createPreparedAutomationActionBatchV1 } from "./prepared-action-batch";
import type { AppendPreparedAutomationActionCommandV1 } from "./contracts";
import { PrismaPreparedAutomationActionSubmissionV1 } from "../persistence/prepared-automation-action.prisma-adapter";

const route = withRunRouteHash({
  schemaVersion: "pressure_run_route_snapshot_v1",
  runId: "run-batch-test",
  route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
  contentPackageVersion: "test-content-v1",
  contentPackageSha256: sha256Canonical("content"),
  orchestrationPackageVersion: "test-orchestration-v1",
  orchestrationPackageSha256: sha256Canonical("orchestration"),
  runtimeContractVersion: "test-runtime-v1",
  runtimeContractSha256: sha256Canonical("runtime"),
  testMatrixVersion: "test-matrix-v1",
  testMatrixSha256: sha256Canonical("matrix"),
  runSeed: "seed-1",
  narrativeProfileVersion: "narrative-v1",
  featureSetVersion: "features-v1",
  resultContractRegistryVersion: "results-v1",
  participantMode: "SOLO",
  seatIds: [
    "cabinet_finance",
    "jiangnan_merchant",
    "qingliu_law",
    "sili_weaving",
    "zhejiang_administration",
    "zhejiang_governor",
  ],
  humanSeatIdsAtStart: ["cabinet_finance"],
  controlTopologyVersion: "control-v1",
  initialRoleControlSnapshotHash: sha256Canonical("topology"),
});

function action(seatId: SeatIdV1, hash: string): AppendPreparedAutomationActionCommandV1 {
  return {
    command: {
      routeSnapshot: route,
      subjectId: `controller-${seatId}`,
      action: {
        actionId: `action-${seatId}`,
        runId: route.runId,
        chapterRuntimeId: "runtime-1",
        chapterId: "N1",
        decisionPointId: "decision-1",
        seatId,
      } as never,
      intent: { visibility: "PUBLIC" } as never,
      inputFingerprint: hash,
      nowMs: 1_900_000_000_000,
    },
    authority: {
      actorKind: "AI",
      snapshotHash: hash,
      expectedOrchestratorRevision: 3,
      expectedOrchestratorHash: hash,
      expectedDescriptorHash: hash,
      expectedDecisionPolicyHash: hash,
      expectedWorkingRevision: 0,
      expectedWorkingStateHash: hash,
      expectedLedgerHeadHash: hash,
      expectedSeatAuthorityStateHash: hash,
      expectedControllerId: `controller-${seatId}`,
      expectedControlEpoch: 1,
      expectedSubmissionFenceToken: hash,
      expectedAiPolicyHash: hash,
    },
  };
}

test("prepared AI batch canonicalizes route seat order and hash", () => {
  const snapshotHash = sha256Canonical("snapshot");
  const input = {
    batchId: "batch-1",
    snapshotHash,
    routeSnapshot: route,
    chapterRuntimeId: "runtime-1",
    chapterId: "N1" as const,
    decisionPointId: "decision-1",
    expectedOrchestratorRevision: 3,
    expectedOrchestratorHash: snapshotHash,
    expectedWorkingRevision: 0,
    expectedWorkingStateHash: snapshotHash,
    expectedLedgerHeadHash: snapshotHash,
    expectedSeatAuthorityStateHash: snapshotHash,
    nextOrchestratorState: { orchestratorHash: snapshotHash } as never,
    chapterDescriptor: { descriptorHash: snapshotHash } as never,
    beatPlan: { postBeatOrchestratorState: { orchestratorHash: snapshotHash } } as never,
  };
  const left = createPreparedAutomationActionBatchV1({
    ...input,
    actions: [action("zhejiang_governor", snapshotHash), action("cabinet_finance", snapshotHash)],
  });
  const right = createPreparedAutomationActionBatchV1({
    ...input,
    actions: [action("cabinet_finance", snapshotHash), action("zhejiang_governor", snapshotHash)],
  });

  assert.deepEqual(
    left.actions.map((item) => item.command.action.seatId),
    ["cabinet_finance", "zhejiang_governor"],
  );
  assert.equal(left.batchHash, right.batchHash);
  assert.equal(left.actions[0]?.command.action.seatId, "cabinet_finance");
});

test("prepared AI batch rejects post-hash command tampering before opening a transaction", async () => {
  const snapshotHash = sha256Canonical("snapshot-tamper");
  const batch = createPreparedAutomationActionBatchV1({
    batchId: "batch-tamper",
    snapshotHash,
    routeSnapshot: route,
    chapterRuntimeId: "runtime-1",
    chapterId: "N1",
    decisionPointId: "decision-1",
    expectedOrchestratorRevision: 3,
    expectedOrchestratorHash: snapshotHash,
    expectedWorkingRevision: 0,
    expectedWorkingStateHash: snapshotHash,
    expectedLedgerHeadHash: snapshotHash,
    expectedSeatAuthorityStateHash: snapshotHash,
    nextOrchestratorState: { orchestratorHash: snapshotHash } as never,
    chapterDescriptor: { descriptorHash: snapshotHash } as never,
    beatPlan: { postBeatOrchestratorState: { orchestratorHash: snapshotHash } } as never,
    actions: [action("cabinet_finance", snapshotHash)],
  });
  batch.actions[0]!.command.nowMs += 1;
  let transactionCalls = 0;
  const adapter = new PrismaPreparedAutomationActionSubmissionV1({
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("TRANSACTION_MUST_NOT_OPEN");
    },
  } as never);

  await assert.rejects(
    () => adapter.submitPreparedBatch(batch),
    /Prepared automation batch binding is invalid/u,
  );
  assert.equal(transactionCalls, 0);
});
