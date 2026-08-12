import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { DecisionConvergenceStageTimingsV1 } from "../decision-automation/contracts";

export type PressureDecisionTimedStageV1 =
  | "orchestratorReconcileMs"
  | "beatMs"
  | "settlementMs"
  | "nextOpenMs";

interface PressureDecisionTimingContextV1 {
  timings: DecisionConvergenceStageTimingsV1;
  onW4Conflict: () => void;
}

const storage = new AsyncLocalStorage<PressureDecisionTimingContextV1>();

/**
 * Binds internal Orchestrator stage timings to one convergence attempt without
 * changing authority contracts or returning diagnostics to player projections.
 */
export async function runWithPressureDecisionConvergenceTimingV1<T>(
  timings: DecisionConvergenceStageTimingsV1,
  onW4Conflict: () => void,
  operation: () => Promise<T>,
): Promise<T> {
  return storage.run({ timings, onW4Conflict }, operation);
}

export async function measurePressureDecisionStageV1<T>(
  stage: PressureDecisionTimedStageV1,
  operation: () => Promise<T>,
): Promise<T> {
  const active = storage.getStore();
  if (!active) return operation();
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    active.timings[stage] += Math.max(0, performance.now() - startedAt);
  }
}

export function recordPressureDecisionW4ConflictV1(): void {
  storage.getStore()?.onW4Conflict();
}
