import {
  stableSha256,
} from "../runtime-contract/kernel-selector-lite.js";
import {
  forcePackageForProvisionalSettlement,
} from "./dynamic-kernel-lite-projection.js";
import {
  buildDynamicPartOneRuntimeWorkingSet,
  buildRecoveredNextTurnWorkingSet,
  type DynamicPartOneActionSettlement,
  type DynamicPartOneCommittedEvent,
  type DynamicPartOneRuntimeWorkingSet,
  type KernelSelectionTrace,
  type PartOneDecisionPin,
} from "./dynamic-kernel-lite-runtime.js";
import {
  buildPartOneRuntimeWorkingSet as buildLegacyWorkingSet,
  completePartOneActionSettlement,
  settlePartOneCurrentAction,
  type PartOneCurrentActionSettlement,
  type PartOneIncomingAction,
} from "./part-one-runtime-engine.js";
import type {
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneState,
} from "./part-one-runtime-types.js";

export type DynamicPartOneSettlementExecutionOptions = {
  currentPin?: PartOneDecisionPin | null;
  currentWorkingSetOverride?: DynamicPartOneRuntimeWorkingSet | null;
};

type NextTurnPlan = {
  workingSet: DynamicPartOneRuntimeWorkingSet;
  status: "PLANNED" | "RECOVERED";
  failureCode?: string;
};

export function projectFinalizedPartOneSelectionState(
  settlement: Pick<DynamicPartOneActionSettlement, "proposedState" | "event">,
): PartOneState {
  const projected = clone(settlement.proposedState);
  const paidIds = new Set(settlement.event.duePendingConsequenceIds);
  if (!paidIds.size) return projected;
  projected.pendingConsequences = projected.pendingConsequences.map((item) => (
    paidIds.has(item.consequenceId)
      ? { ...item, status: "PAID" as const }
      : item
  ));
  return projected;
}

/**
 * Execute the committed current decision surface exactly once, then plan the
 * next revision independently. A next-turn planning failure is recovered after
 * the current causal state exists and therefore cannot reject or rebind the
 * legal action that produced that state.
 */
export function settleDynamicPartOneAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  action: PartOneIncomingAction,
  turnNumber: number,
  options: DynamicPartOneSettlementExecutionOptions = {},
): DynamicPartOneActionSettlement {
  const opening = Boolean(action.decisionId?.startsWith("opening_"));
  const current = opening
    ? null
    : resolveCurrentWorkingSet(
      pkg,
      state,
      turnNumber,
      options.currentPin ?? null,
      options.currentWorkingSetOverride ?? null,
    );

  if (!opening && action.affordanceTemplateId) {
    const bound = current!.decisionAffordances.some((candidate) => (
      candidate.affordanceTemplateId === action.affordanceTemplateId
      && candidate.decisionKernelId === action.decisionKernelId
      && candidate.actionText === action.actionText
    ));
    if (!bound) {
      throw new Error("PART_ONE_DYNAMIC_STALE_OR_TAMPERED_AFFORDANCE");
    }
  }

  const causal = settlePartOneCurrentAction(
    pkg,
    state,
    action,
    turnNumber,
    current ?? undefined,
  );
  const recoverySurface = current ?? buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    state,
    Math.max(0, turnNumber - 1),
  );
  const reactionPlan = planNextTurn(
    pkg,
    causal.proposedState,
    turnNumber,
    recoverySurface,
  );
  let plan = reactionPlan;
  let settlement = completeWithRecoverablePlan(
    pkg,
    causal,
    plan,
    recoverySurface,
    reactionPlan,
  );

  const finalizedSelectionState = projectFinalizedPartOneSelectionState(
    settlement as DynamicPartOneActionSettlement,
  );
  if (
    plan.workingSet.kernelSelection.stateFingerprint
      !== stableSha256(finalizedSelectionState)
  ) {
    plan = planNextTurn(
      pkg,
      finalizedSelectionState,
      turnNumber,
      recoverySurface,
    );
    settlement = completeWithRecoverablePlan(
      pkg,
      causal,
      plan,
      recoverySurface,
      reactionPlan,
    );
  }

  if (
    settlement.event.nextDecisionPoint.decisionKernelId
      !== plan.workingSet.decisionPoint.decisionKernelId
    || settlement.event.nextDecisionPoint.decisionPointId
      !== plan.workingSet.decisionPoint.decisionPointId
  ) {
    throw new Error("PART_ONE_DYNAMIC_NEXT_DECISION_MISMATCH");
  }
  const event = settlement.event as DynamicPartOneCommittedEvent;
  event.nextKernelSelection = clone(plan.workingSet.kernelSelection);
  event.nextPlanningStatus = plan.status;
  if (plan.failureCode) event.nextPlanningFailureCode = plan.failureCode;
  return settlement as DynamicPartOneActionSettlement;
}

function completeWithRecoverablePlan(
  pkg: PartOneRuntimePackage,
  causal: PartOneCurrentActionSettlement,
  plan: NextTurnPlan,
  recoverySurface: DynamicPartOneRuntimeWorkingSet,
  reactionPlan: NextTurnPlan,
) {
  try {
    return completePartOneActionSettlement(
      pkg,
      causal,
      plan.workingSet,
      reactionPlan.workingSet,
    );
  } catch (error) {
    if (plan.status === "RECOVERED") throw error;
    const failureCode = normalizeErrorCode(error);
    const recovered = buildRecoveredNextTurnWorkingSet(
      pkg,
      causal.proposedState,
      causal.turnNumber,
      recoverySurface,
      error,
    );
    plan.workingSet = recovered;
    plan.status = "RECOVERED";
    plan.failureCode = failureCode;
    if (plan === reactionPlan) {
      reactionPlan.workingSet = recovered;
      reactionPlan.status = "RECOVERED";
      reactionPlan.failureCode = failureCode;
    }
    return completePartOneActionSettlement(
      pkg,
      causal,
      recovered,
      reactionPlan.workingSet,
    );
  }
}

function planNextTurn(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  recoverySurface: DynamicPartOneRuntimeWorkingSet,
): NextTurnPlan {
  try {
    return {
      workingSet: buildDynamicPartOneRuntimeWorkingSet(
        pkg,
        state,
        turnNumber,
      ),
      status: "PLANNED",
    };
  } catch (error) {
    return {
      workingSet: buildRecoveredNextTurnWorkingSet(
        pkg,
        state,
        turnNumber,
        recoverySurface,
        error,
      ),
      status: "RECOVERED",
      failureCode: normalizeErrorCode(error),
    };
  }
}

/**
 * Preserve the historical public projection contract used by source-level
 * capability tests. Existing Floor continuations keep the immutable package;
 * Primary surfaces receive only the committed current Pair projection.
 */
export function packageForDynamicCapabilityAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  currentPin: PartOneDecisionPin | null = null,
  currentWorkingSetOverride: DynamicPartOneRuntimeWorkingSet | null = null,
): PartOneRuntimePackage {
  const current = resolveCurrentWorkingSet(
    pkg,
    state,
    turnNumber,
    currentPin,
    currentWorkingSetOverride,
  );
  if (isContinuation(current)) return pkg;
  return forcePackageForProvisionalSettlement(pkg, state, current);
}

/**
 * Internal observe-only capability scaffold. Capability behavior is preserved
 * while authored-action Settlement uses the two-phase current/next contract.
 */
export function packageForDynamicCapabilitySettlement(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  currentPin: PartOneDecisionPin | null = null,
  currentWorkingSetOverride: DynamicPartOneRuntimeWorkingSet | null = null,
): PartOneRuntimePackage {
  const current = resolveCurrentWorkingSet(
    pkg,
    state,
    turnNumber,
    currentPin,
    currentWorkingSetOverride,
  );
  return forcePackageForProvisionalSettlement(pkg, state, current);
}

export function buildCommittedLegacyFallbackWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  trace: KernelSelectionTrace,
): DynamicPartOneRuntimeWorkingSet {
  if (trace.mode !== "LEGACY_FALLBACK") {
    throw new Error("PART_ONE_COMMITTED_FALLBACK_TRACE_MODE_INVALID");
  }
  if (
    trace.sectionId !== state.sectionId
    || trace.selectedAffordanceIds.length !== 2
    || !trace.selectedKernelId
    || !trace.selectedDecisionPointId
  ) {
    throw new Error("PART_ONE_COMMITTED_FALLBACK_TRACE_INVALID");
  }
  if (trace.stateFingerprint !== stableSha256(state)) {
    throw new Error(
      "PART_ONE_COMMITTED_FALLBACK_STATE_FINGERPRINT_MISMATCH",
    );
  }
  const section = pkg.sections.find(
    (item) => item.sectionId === state.sectionId,
  );
  if (
    !section
    || !section.activeDecisionKernelIds.includes(trace.selectedKernelId)
  ) {
    throw new Error("PART_ONE_COMMITTED_FALLBACK_KERNEL_NOT_IN_SECTION");
  }

  const workingSet = buildLegacyWorkingSet(
    forceFallbackPackage(
      pkg,
      state.sectionId,
      trace.selectedKernelId,
      trace.selectedAffordanceIds,
    ),
    state,
    turnNumber,
  );
  const actualIds = workingSet.decisionAffordances.map(
    (item) => item.affordanceTemplateId,
  );
  if (
    workingSet.decisionPoint.decisionKernelId !== trace.selectedKernelId
    || workingSet.decisionPoint.decisionPointId
      !== trace.selectedDecisionPointId
    || !sameStringArray(actualIds, trace.selectedAffordanceIds)
  ) {
    throw new Error("PART_ONE_COMMITTED_FALLBACK_RECOVERY_MISMATCH");
  }

  return {
    ...workingSet,
    kernelSelection: {
      ...clone(trace),
      mode: "PINNED_RECOVERY",
      stateRevision: Number(state.turnNumber ?? turnNumber),
    },
  };
}

function resolveCurrentWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  currentPin: PartOneDecisionPin | null,
  currentWorkingSetOverride: DynamicPartOneRuntimeWorkingSet | null,
) {
  return currentWorkingSetOverride
    ? validateCurrentWorkingSetOverride(
      pkg,
      state,
      turnNumber,
      currentWorkingSetOverride,
    )
    : buildDynamicPartOneRuntimeWorkingSet(
      pkg,
      state,
      Math.max(0, turnNumber - 1),
      currentPin
        ? { mode: "DYNAMIC_LITE", pin: currentPin }
        : {},
    );
}

function validateCurrentWorkingSetOverride(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  workingSet: DynamicPartOneRuntimeWorkingSet,
): DynamicPartOneRuntimeWorkingSet {
  const expectedTurn = Math.max(0, turnNumber - 1);
  if (
    workingSet.packageHash !== pkg.immutableHash
    || workingSet.section.sectionId !== state.sectionId
    || workingSet.turnNumber !== expectedTurn
    || workingSet.kernelSelection.sectionId !== state.sectionId
    || workingSet.kernelSelection.stateRevision
      !== Number(state.turnNumber ?? expectedTurn)
    || workingSet.kernelSelection.stateFingerprint !== stableSha256(state)
    || workingSet.decisionPoint.decisionKernelId
      !== workingSet.kernelSelection.selectedKernelId
    || workingSet.decisionPoint.decisionPointId
      !== workingSet.kernelSelection.selectedDecisionPointId
    || !sameStringArray(
      workingSet.decisionAffordances.map(
        (affordance) => affordance.affordanceTemplateId,
      ),
      workingSet.kernelSelection.selectedAffordanceIds,
    )
  ) {
    throw new Error("PART_ONE_COMMITTED_WORKING_SET_MISMATCH");
  }
  return clone(workingSet);
}

function forceFallbackPackage(
  pkg: PartOneRuntimePackage,
  sectionId: string,
  kernelId: string,
  affordanceIds: string[],
): PartOneRuntimePackage {
  const projected = clone(pkg);
  projected.sections = projected.sections.map((section) => (
    section.sectionId === sectionId
      ? {
        ...section,
        activeDecisionKernelIds: [
          kernelId,
          ...section.activeDecisionKernelIds.filter((id) => id !== kernelId),
        ],
      }
      : section
  ));
  projected.assets = projected.assets.map((asset) => (
    asset.assetId === kernelId && asset.assetType === "DECISION_KERNEL"
      ? reorderOptions(asset, affordanceIds)
      : asset
  ));
  return projected;
}

function reorderOptions(
  asset: PartOneRuntimeAsset,
  affordanceIds: string[],
) {
  const authored = Array.isArray(asset.payload.options)
    ? asset.payload.options
    : [];
  const ids = [...new Set(affordanceIds)];
  const selected = ids.map((id) => authored.find(
    (option) => option.affordanceTemplateId === id,
  ));
  if (selected.some((option) => !option)) {
    throw new Error(
      `PART_ONE_DYNAMIC_AFFORDANCE_NOT_FOUND:${ids.join(",")}`,
    );
  }
  const remaining = authored.filter(
    (option) => !ids.includes(option.affordanceTemplateId),
  );
  return {
    ...asset,
    payload: {
      ...asset.payload,
      options: [selected[0]!, ...remaining, selected[1]!],
    },
  };
}

function isContinuation(workingSet: DynamicPartOneRuntimeWorkingSet) {
  return workingSet.decisionPoint.decisionPointId
    !== workingSet.decisionPoint.decisionKernelId;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (message.split(":", 1)[0] || "UNKNOWN_ERROR")
    .trim()
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .toUpperCase()
    .slice(0, 96) || "UNKNOWN_ERROR";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
