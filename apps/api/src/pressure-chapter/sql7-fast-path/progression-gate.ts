import type { PreparedAutomationActionBatchV1 } from "../decision-automation/contracts";

export type PressureSql7BatchProgressionV1 = Readonly<{
  kind: "NEXT_BEAT" | "CHAPTER_SUMMARY_READY";
  chapterId: PreparedAutomationActionBatchV1["chapterId"];
  currentDecisionPointId: string;
  nextDecisionPointId: string | null;
}>;

/**
 * Reads only the result of the existing planBeatProgressionV1 call embedded in
 * the prepared batch. It prevents the settlement-only SQL7 builder from
 * interpreting an intermediate Beat as an N1 -> N2 chapter close.
 */
export function classifyPressureSql7BatchProgressionV1(
  batch: Readonly<PreparedAutomationActionBatchV1>,
): PressureSql7BatchProgressionV1 {
  const state = batch.beatPlan.postBeatOrchestratorState;
  if (batch.beatPlan.settlementInput === null) {
    const next = state.activeDecision;
    if (
      state.phase !== "ACTIVE"
      || state.currentChapterId !== batch.chapterId
      || state.chapterRuntimeId !== batch.chapterRuntimeId
      || !next
      || next.decisionPointId === batch.decisionPointId
    ) invalid("INTERMEDIATE_BEAT_BINDING");
    return Object.freeze({
      kind: "NEXT_BEAT" as const,
      chapterId: batch.chapterId,
      currentDecisionPointId: batch.decisionPointId,
      nextDecisionPointId: next.decisionPointId,
    });
  }
  if (
    state.phase !== "SETTLING"
    || state.currentChapterId !== batch.chapterId
    || state.chapterRuntimeId !== batch.chapterRuntimeId
    || state.activeDecision !== null
    || state.settlementInputHash !== batch.beatPlan.settlementInput.inputHash
  ) invalid("TERMINAL_BEAT_BINDING");
  return Object.freeze({
    kind: "CHAPTER_SUMMARY_READY" as const,
    chapterId: batch.chapterId,
    currentDecisionPointId: batch.decisionPointId,
    nextDecisionPointId: null,
  });
}

function invalid(detail: string): never {
  throw new Error(`PRESSURE_SQL7_PROGRESSION_INVALID:${detail}`);
}
