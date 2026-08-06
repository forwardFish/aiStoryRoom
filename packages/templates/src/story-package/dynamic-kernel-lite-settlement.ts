import {
  buildDynamicPartOneRuntimeWorkingSet,
  type DynamicPartOneActionSettlement,
  type DynamicPartOneCommittedEvent,
  type PartOneDecisionPin,
} from "./dynamic-kernel-lite-runtime.js";
import {
  settlePartOneAction as settleLegacyAction,
  type PartOneIncomingAction,
} from "./part-one-runtime-engine.js";
import type {
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
  const next = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    provisional.proposedState,
    turnNumber,
  );
  const nextRequest: ForcedSelectionRequest = {
    sectionId: provisional.proposedState.sectionId,
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
 */
export function packageForDynamicCapabilityAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
): PartOneRuntimePackage {
  const current = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    state,
    Math.max(0, turnNumber - 1),
  );
  if (isContinuation(current)) return pkg;
  return forcePackage(pkg, [{
    sectionId: state.sectionId,
    kernelId: current.decisionPoint.decisionKernelId,
    affordanceIds: current.decisionAffordances[0]
      ? [current.decisionAffordances[0].affordanceTemplateId]
      : [],
  }]);
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
