import {
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
} from "@ai-story/shared";
import type {
  AppendPreparedAutomationActionCommandV1,
  PreparedAutomationActionBatchV1,
} from "./contracts";

export function createPreparedAutomationActionBatchV1(input: Readonly<{
  batchId: string;
  snapshotHash: string;
  routeSnapshot: AppendPreparedAutomationActionCommandV1["command"]["routeSnapshot"];
  chapterRuntimeId: string;
  chapterId: PreparedAutomationActionBatchV1["chapterId"];
  decisionPointId: string;
  expectedOrchestratorRevision: number;
  expectedOrchestratorHash: string;
  expectedWorkingRevision: number;
  expectedWorkingStateHash: string;
  expectedLedgerHeadHash: string;
  expectedSeatAuthorityStateHash: string;
  actions: readonly AppendPreparedAutomationActionCommandV1[];
}>): PreparedAutomationActionBatchV1 {
  const route = validateRunRouteSnapshotV1(input.routeSnapshot);
  const actions = [...input.actions]
    .map((item) => structuredClone(item))
    .sort((left, right) => compareCanonicalText(left.command.action.seatId, right.command.action.seatId));
  if (!actions.length) throw new Error("Prepared automation batch cannot be empty");
  if (!input.batchId.trim() || !isSha256(input.snapshotHash)) {
    throw new Error("Prepared automation batch identity is invalid");
  }
  if (actions.some((item) => (
    item.command.routeSnapshot.routeHash !== route.routeHash
    || item.command.action.runId !== route.runId
    || item.command.action.chapterRuntimeId !== input.chapterRuntimeId
    || item.command.action.chapterId !== input.chapterId
    || item.command.action.decisionPointId !== input.decisionPointId
    || item.authority.snapshotHash !== input.snapshotHash
    || item.authority.expectedLedgerHeadHash !== input.expectedLedgerHeadHash
  ))) {
    throw new Error("Prepared automation batch authority binding is invalid");
  }
  const body = {
    schemaVersion: "pressure_prepared_automation_action_batch_v1" as const,
    batchId: input.batchId,
    snapshotHash: input.snapshotHash,
    runId: route.runId,
    routeHash: route.routeHash,
    chapterRuntimeId: input.chapterRuntimeId,
    chapterId: input.chapterId,
    decisionPointId: input.decisionPointId,
    expectedOrchestratorRevision: input.expectedOrchestratorRevision,
    expectedOrchestratorHash: input.expectedOrchestratorHash,
    expectedWorkingRevision: input.expectedWorkingRevision,
    expectedWorkingStateHash: input.expectedWorkingStateHash,
    expectedLedgerHeadHash: input.expectedLedgerHeadHash,
    expectedSeatAuthorityStateHash: input.expectedSeatAuthorityStateHash,
    actions,
  };
  return {
    ...body,
    batchHash: sha256Canonical({
      ...body,
      actions: actions.map((item) => ({
        action: item.command.action,
        intent: item.command.intent,
        inputFingerprint: item.command.inputFingerprint,
        authority: item.authority,
      })),
    }),
  };
}
