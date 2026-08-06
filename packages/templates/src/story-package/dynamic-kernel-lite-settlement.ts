import {
  stableCanonicalJson,
  stableSha256,
} from "../runtime-contract/kernel-selector-lite.js";
import {
  buildDynamicPartOneRuntimeWorkingSet,
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
  PartOneRuntimePackage,
  PartOneRuntimeWorkingSet,
  PartOneState,
} from "./part-one-runtime-types.js";

export type DynamicPartOneSettlementExecutionOptions = {
  currentPin?: PartOneDecisionPin | null;
};

type ForcedSelectionRequest = {
  sectionId: string;
  kernelId: string;
  affordanceIds: string[];
};

/**
 * Project the exact state that the existing finalizer will commit after all
 * authorized due consequences have been surfaced in the current turn. Dynamic
 * selection must run on this state rather than on the intermediate DUE ledger;
 * otherwise a pressure that has already been paid can incorrectly choose the
 * next Kernel and the committed trace fingerprint will not match recovery.
 */
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
 * Coordinate Dynamic Kernel Lite with the frozen fact Settlement.
 *
 * The frozen engine remains the only causal writer. This layer only makes the
 * current authored decision and the already-selected next decision visible to
 * that engine. Floor continuations are reconstructed by the frozen engine from
 * sectionTurnNumber because their affordances do not live on the base Kernel
 * asset.
 */
export function settleDynamicPartOneAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  action: PartOneIncomingAction,
  turnNumber: number,
  options: DynamicPartOneSettlementExecutionOptions = {},
): DynamicPartOneActionSettlement {
  const current = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    state,
    Math.max(0, turnNumber - 1),
    options.currentPin
      ? { mode: "DYNAMIC_LITE", pin: options.currentPin }
      : {},
  );
  const opening = Boolean(action.decisionId?.startsWith("opening_"));
  if (!opening && action.affordanceTemplateId) {
    const bound = current.decisionAffordances.some((candidate) => (
      candidate.affordanceTemplateId === action.affordanceTemplateId
      && candidate.decisionKernelId === action.decisionKernelId
      && candidate.actionText === action.actionText
    ));
    if (!bound) {
      throw new Error("PART_ONE_DYNAMIC_STALE_OR_TAMPERED_AFFORDANCE");
    }
  }

  const currentKernelId = opening
    ? "DK-P1-REVIEW-INITIATION"
    : action.decisionKernelId || current.decisionPoint.decisionKernelId;
  const currentAffordanceId = opening
    ? null
    : action.affordanceTemplateId || null;
  const currentIsContinuation = !opening && isContinuation(current);
  const currentRequests: ForcedSelectionRequest[] = currentIsContinuation
    ? []
    : [{
      sectionId: state.sectionId,
      kernelId: currentKernelId,
      affordanceIds: currentAffordanceId ? [currentAffordanceId] : [],
    }];

  const provisional = settleLegacyAction(
    forcePackage(pkg, currentRequests),
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
  const nextRequest: ForcedSelectionRequest = {
    sectionId: selectionState.sectionId,
    kernelId: next.decisionPoint.decisionKernelId,
    affordanceIds: isContinuation(next)
      ? []
      : [...next.kernelSelection.selectedAffordanceIds],
  };
  const finalized = settleLegacyAction(
    forcePackage(pkg, [...currentRequests, nextRequest]),
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
 * The observe-only capability facade needs one authored affordance as a
 * scaffold. A Floor continuation already reconstructs its own option list and
 * therefore must receive the unmodified package.
 *
 * Recovery can supply an exact committed Pin. Normal Dynamic pins are rebuilt
 * directly; an authored Legacy fallback is the only valid exception and must
 * resolve to the same Kernel and Decision Point when recomputed from the same
 * state. This mirrors the formal-action recovery discipline without allowing a
 * capability turn to drift onto a different decision surface.
 */
export function packageForDynamicCapabilityAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  currentPin: PartOneDecisionPin | null = null,
): PartOneRuntimePackage {
  let current: DynamicPartOneRuntimeWorkingSet;
  if (currentPin) {
    try {
      current = buildDynamicPartOneRuntimeWorkingSet(
        pkg,
        state,
        Math.max(0, turnNumber - 1),
        { mode: "DYNAMIC_LITE", pin: currentPin },
      );
    } catch (pinError) {
      const fallback = buildDynamicPartOneRuntimeWorkingSet(
        pkg,
        state,
        Math.max(0, turnNumber - 1),
      );
      if (
        fallback.kernelSelection.mode !== "LEGACY_FALLBACK"
        || fallback.decisionPoint.decisionKernelId
          !== currentPin.decisionKernelId
        || fallback.decisionPoint.decisionPointId
          !== currentPin.decisionPointId
      ) {
        throw pinError;
      }
      current = fallback;
    }
  } else {
    current = buildDynamicPartOneRuntimeWorkingSet(
      pkg,
      state,
      Math.max(0, turnNumber - 1),
    );
  }
  if (isContinuation(current)) return pkg;
  return forcePackage(pkg, [{
    sectionId: state.sectionId,
    kernelId: current.decisionPoint.decisionKernelId,
    affordanceIds: current.decisionAffordances[0]
      ? [current.decisionAffordances[0].affordanceTemplateId]
      : [],
  }]);
}

/**
 * A committed Legacy fallback is already the canonical decision surface. It
 * may exist precisely because its authored options could not produce two
 * valid Dynamic previews, so ordinary pinned recovery must not demand that
 * those options pass the Dynamic preview gate a second time. Rebuild only the
 * exact committed Kernel and Affordance pair; all non-fallback pins keep the
 * stricter Dynamic recovery path.
 */
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
    forcePackage(pkg, [{
      sectionId: state.sectionId,
      kernelId: trace.selectedKernelId,
      affordanceIds: [...trace.selectedAffordanceIds],
    }]),
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

/**
 * The provisional pass exists only to expose the resulting authoritative state
 * to the selector. Reordering the next Kernel or its option surface must never
 * change the player action's causal result. The final pass may legitimately
 * produce different narrative pressure text, so scene.situation and narrative
 * plans are excluded; every durable or material state field remains covered.
 */
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

function forcePackage(
  pkg: PartOneRuntimePackage,
  requests: ForcedSelectionRequest[],
): PartOneRuntimePackage {
  const kernelsBySection = new Map<string, string[]>();
  const affordancesByKernel = new Map<string, string[]>();
  for (const request of requests) {
    const ids = kernelsBySection.get(request.sectionId) || [];
    if (!ids.includes(request.kernelId)) ids.push(request.kernelId);
    kernelsBySection.set(request.sectionId, ids);
    if (request.affordanceIds.length) {
      affordancesByKernel.set(
        request.kernelId,
        [...new Set(request.affordanceIds)],
      );
    }
  }

  return {
    ...pkg,
    sections: pkg.sections.map((section) => {
      const preferred = kernelsBySection.get(section.sectionId);
      return !preferred?.length
        ? section
        : {
          ...section,
          activeDecisionKernelIds: [
            ...preferred,
            ...section.activeDecisionKernelIds.filter(
              (id) => !preferred.includes(id),
            ),
          ],
        };
    }),
    assets: pkg.assets.map((asset) => {
      const affordanceIds = affordancesByKernel.get(asset.assetId);
      if (
        !affordanceIds?.length
        || asset.assetType !== "DECISION_KERNEL"
      ) {
        return asset;
      }
      const authored = Array.isArray(asset.payload.options)
        ? asset.payload.options
        : [];
      const selected = affordanceIds.map((affordanceId) => {
        const option = authored.find((candidate) => (
          candidate.affordanceTemplateId === affordanceId
        ));
        if (!option) {
          throw new Error(
            `PART_ONE_DYNAMIC_AFFORDANCE_NOT_FOUND:${affordanceId}`,
          );
        }
        return option;
      });
      const remaining = authored.filter((option) => (
        !affordanceIds.includes(option.affordanceTemplateId)
      ));
      const reordered = selected.length === 1
        ? [selected[0]!, ...remaining]
        : [selected[0]!, ...remaining, selected[1]!];
      return {
        ...asset,
        payload: { ...asset.payload, options: reordered },
      };
    }),
  };
}

function isContinuation(workingSet: PartOneRuntimeWorkingSet) {
  return workingSet.decisionPoint.decisionPointId
    !== workingSet.decisionPoint.decisionKernelId;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
