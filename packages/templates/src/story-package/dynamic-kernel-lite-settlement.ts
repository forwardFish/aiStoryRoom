import {
  stableCanonicalJson,
  stableSha256,
} from "../runtime-contract/kernel-selector-lite.js";
import {
  forcePackageForProvisionalSettlement,
} from "./dynamic-kernel-lite-projection.js";
import {
  buildDynamicPartOneRuntimeWorkingSet,
  forcePackageForDynamicWorkingSets,
  type DynamicPartOneActionSettlement,
  type DynamicPartOneCommittedEvent,
  type DynamicPartOneRuntimeWorkingSet,
  type KernelSelectionTrace,
  type PartOneDecisionPin,
} from "./dynamic-kernel-lite-runtime.js";
import {
  buildPartOneRuntimeWorkingSet as buildLegacyWorkingSet,
  settlePartOneAction as settleLegacyAction,
  type PartOneIncomingAction,
} from "./part-one-runtime-engine.js";
import type {
  PartOneActionSettlement,
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneState,
} from "./part-one-runtime-types.js";

export type DynamicPartOneSettlementExecutionOptions = {
  currentPin?: PartOneDecisionPin | null;
  currentWorkingSetOverride?: DynamicPartOneRuntimeWorkingSet | null;
};

export function projectFinalizedPartOneSelectionState(
  settlement: Pick<PartOneActionSettlement, "proposedState" | "event">,
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
 * The frozen engine remains the only causal writer. This coordinator projects
 * the exact committed current WorkingSet and the exact selected next
 * WorkingSet into immutable package clones. The provisional pass is isolated
 * from unrelated later Kernels; the final pass is bound to the real next
 * decision selected from the authoritative finalized-state projection.
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

  const provisionalPackage = current
    ? forcePackageForProvisionalSettlement(pkg, state, current)
    : pkg;
  const provisional = settleLegacyAction(
    provisionalPackage,
    state,
    action,
    turnNumber,
  );
  const selectionState = projectFinalizedPartOneSelectionState(provisional);
  const next = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    selectionState,
    turnNumber,
  );
  const projections = current
    ? [
      { state, workingSet: current },
      { state: selectionState, workingSet: next },
    ]
    : [{ state: selectionState, workingSet: next }];
  const finalized = settleLegacyAction(
    forcePackageForDynamicWorkingSets(pkg, projections),
    state,
    action,
    turnNumber,
  );

  assertProvisionalCausalStateStable(provisional, finalized);
  if (
    finalized.event.nextDecisionPoint.decisionKernelId
      !== next.decisionPoint.decisionKernelId
    || finalized.event.nextDecisionPoint.decisionPointId
      !== next.decisionPoint.decisionPointId
  ) {
    throw new Error("PART_ONE_DYNAMIC_NEXT_DECISION_MISMATCH");
  }
  (finalized.event as DynamicPartOneCommittedEvent).nextKernelSelection = clone(
    next.kernelSelection,
  );
  return finalized as DynamicPartOneActionSettlement;
}

/**
 * Preserve the historical helper contract used by source-level tests and by
 * callers that only need to inspect the authored capability surface. An
 * existing Floor Continuation is already a complete decision surface and must
 * keep the original immutable package identity. Primary surfaces still need a
 * projected option order so the legacy facade can inspect the chosen Pair.
 *
 * Formal capability Settlement uses packageForDynamicCapabilitySettlement()
 * below; it may add an internal successor continuation to an isolated clone so
 * the frozen engine can finish its scaffold pass without mutating this public
 * projection contract.
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
 * Internal production scaffold for an observe-only capability turn. Unlike the
 * public projection helper, this always provides the frozen engine with the
 * exact committed WorkingSet plus one deterministic continuation successor.
 * It is an immutable package clone and never changes authoritative state.
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

function assertProvisionalCausalStateStable(
  provisional: PartOneActionSettlement,
  finalized: PartOneActionSettlement,
) {
  const left = causalSettlementSnapshot(provisional);
  const right = causalSettlementSnapshot(finalized);
  if (stableCanonicalJson(left) !== stableCanonicalJson(right)) {
    throw new Error("PART_ONE_DYNAMIC_PROVISIONAL_FINAL_CAUSAL_MISMATCH");
  }
}

function causalSettlementSnapshot(settlement: PartOneActionSettlement) {
  const proposedState = clone(settlement.proposedState);
  if (proposedState.scene) {
    proposedState.scene = {
      ...proposedState.scene,
      situation: "",
    };
  }
  return {
    proposedState,
    decisionKernelId: settlement.event.decisionKernelId,
    affordanceTemplateId: settlement.event.affordanceTemplateId,
    sectionIdBefore: settlement.event.sectionIdBefore,
    sectionIdAfter: settlement.event.sectionIdAfter,
    sectionTransitioned: settlement.event.sectionTransitioned,
    statePatch: settlement.event.statePatch,
    durableEffects: settlement.event.durableEffects,
    changedStatePaths: [...settlement.event.changedStatePaths].sort(),
    createdPendingConsequenceIds: [
      ...settlement.event.createdPendingConsequenceIds,
    ].sort(),
    duePendingConsequenceIds: [
      ...settlement.event.duePendingConsequenceIds,
    ].sort(),
  };
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

function clone<T>(value: T): T {
  return structuredClone(value);
}
