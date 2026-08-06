import { AsyncLocalStorage } from "node:async_hooks";
import runtimeFacade from "./runtime-facade.js";
import { stableSha256 } from "./runtime-contract/kernel-selector-lite.js";
import {
  applyNarrativeScenePatternToDramaticBeatPlan,
  type DramaticPatternPlanInput,
} from "./story-package/dramatic-beat-plan.js";
import {
  buildDynamicPartOneRuntimeWorkingSet,
  isDynamicCapabilityAction,
  type DynamicPartOneCommittedEvent as DynamicCommittedEvent,
  type DynamicPartOneRuntimeWorkingSet,
  type PartOneDecisionPin,
  type PartOneWorkingSetSelectionOptions,
} from "./story-package/dynamic-kernel-lite-runtime.js";
import {
  buildCommittedLegacyFallbackWorkingSet,
  packageForDynamicCapabilityAction,
  projectFinalizedPartOneSelectionState,
  settleDynamicPartOneAction,
  type DynamicPartOneSettlementExecutionOptions,
} from "./story-package/dynamic-kernel-lite-settlement.js";
import { loadPlayablePartOneRuntimePackage } from "./story-package/playable-part-one-runtime.js";

export * from "./index.js";
export {
  buildDynamicPartOneRuntimeWorkingSet,
  isDynamicCapabilityAction,
} from "./story-package/dynamic-kernel-lite-runtime.js";
export type {
  DynamicPartOneActionSettlement,
  DynamicPartOneCommittedEvent,
  DynamicPartOneRuntimeWorkingSet,
  KernelSelectionTrace,
  PartOneDecisionPin,
  PartOneKernelSelectionMode,
  PartOneWorkingSetSelectionOptions,
} from "./story-package/dynamic-kernel-lite-runtime.js";
export {
  buildCommittedLegacyFallbackWorkingSet,
  packageForDynamicCapabilityAction,
  projectFinalizedPartOneSelectionState,
  settleDynamicPartOneAction,
} from "./story-package/dynamic-kernel-lite-settlement.js";
export type {
  DynamicPartOneSettlementExecutionOptions,
} from "./story-package/dynamic-kernel-lite-settlement.js";

type PartOneDecisionExecutionContext = {
  pin: PartOneDecisionPin | null;
  workingSet: DynamicPartOneRuntimeWorkingSet | null;
};

/**
 * Recovery validation happens in the OpenNovel adapter before the frozen
 * authored-decision module binds and settles an action. The base module keeps
 * its stable public signature, so the exact committed decision surface is
 * carried through an AsyncLocalStorage scope. This is concurrency-safe and
 * prevents recovered Dynamic, Continuation or Legacy Fallback pairs from being
 * recomputed differently between display, binding and formal Settlement.
 */
const decisionContext = new AsyncLocalStorage<PartOneDecisionExecutionContext>();

export function withPartOneDecisionPin<T>(
  pin: PartOneDecisionPin | null,
  execute: () => T,
): T {
  return decisionContext.run({
    pin: pin ? structuredClone(pin) : null,
    workingSet: null,
  }, execute);
}

export function withPartOneDecisionWorkingSet<T>(
  workingSet: DynamicPartOneRuntimeWorkingSet,
  execute: () => T,
): T {
  const cloned = structuredClone(workingSet);
  return decisionContext.run({
    pin: {
      decisionKernelId: cloned.decisionPoint.decisionKernelId,
      decisionPointId: cloned.decisionPoint.decisionPointId,
      affordanceIds: cloned.decisionAffordances.map(
        (affordance) => affordance.affordanceTemplateId,
      ),
      ...(cloned.kernelSelection.selectedOutcomeHashes.length
        ? {
          outcomeHashes: [
            ...cloned.kernelSelection.selectedOutcomeHashes,
          ],
        }
        : {}),
    },
    workingSet: cloned,
  }, execute);
}

function contextualDecisionContext() {
  return decisionContext.getStore() || {
    pin: null,
    workingSet: null,
  };
}

/**
 * Explicit exports win over the star-exported frozen implementations. Native
 * ESM named imports, CommonJS namespace imports and the default runtime
 * namespace therefore use one playable loader and the Dynamic Kernel Selector
 * Lite path, while source-level authoring tests can still import the frozen
 * engine directly from story-package modules.
 */
export const loadPartOneRuntimePackage = loadPlayablePartOneRuntimePackage;

export const buildPartOneRuntimeWorkingSet = (
  pkg: Parameters<typeof buildDynamicPartOneRuntimeWorkingSet>[0],
  state: Parameters<typeof buildDynamicPartOneRuntimeWorkingSet>[1],
  turnNumber: Parameters<typeof buildDynamicPartOneRuntimeWorkingSet>[2],
  options: PartOneWorkingSetSelectionOptions = {},
): ReturnType<typeof buildDynamicPartOneRuntimeWorkingSet> => {
  const context = contextualDecisionContext();
  if (
    options.pin === undefined
    && options.mode !== "LEGACY_FIXED"
    && context.workingSet
  ) {
    const committed = context.workingSet;
    if (
      committed.packageHash !== pkg.immutableHash
      || committed.section.sectionId !== state.sectionId
      || committed.turnNumber !== turnNumber
      || committed.kernelSelection.sectionId !== state.sectionId
      || committed.kernelSelection.stateRevision !== Number(state.turnNumber)
      || committed.kernelSelection.stateFingerprint !== stableSha256(state)
    ) {
      throw new Error("PART_ONE_COMMITTED_WORKING_SET_MISMATCH");
    }
    return structuredClone(committed);
  }

  const effectiveOptions = options.pin !== undefined
    || options.mode === "LEGACY_FIXED"
    || !context.pin
    ? options
    : {
      ...options,
      mode: "DYNAMIC_LITE" as const,
      pin: context.pin,
    };
  return buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    state,
    turnNumber,
    effectiveOptions,
  );
};

/**
 * Dynamic next-decision traces are compiled from the state after all
 * authoritative due consequences for the turn are paid. The frozen finalizer
 * remains the sole state writer; this wrapper only verifies that its committed
 * result is exactly the state for which the trace was produced.
 */
export const finalizePartOneSettlement = (
  ...args: Parameters<typeof runtimeFacade.finalizePartOneSettlement>
): ReturnType<typeof runtimeFacade.finalizePartOneSettlement> => {
  const finalized = runtimeFacade.finalizePartOneSettlement(...args);
  const event = finalized.event as DynamicCommittedEvent;
  const trace = event.nextKernelSelection;
  if (!trace) return finalized;

  const stateRevision = Number(
    finalized.proposedState.turnNumber ?? event.turnNumber,
  );
  if (Number(trace.stateRevision) !== stateRevision) {
    throw new Error("PART_ONE_DYNAMIC_FINALIZED_TRACE_REVISION_MISMATCH");
  }
  if (trace.stateFingerprint !== stableSha256(finalized.proposedState)) {
    throw new Error("PART_ONE_DYNAMIC_FINALIZED_TRACE_FINGERPRINT_MISMATCH");
  }
  return finalized;
};

/**
 * Settlement is complete before scene grammar is attached. The selected
 * NarrativeScenePattern remains expression-only: it can order transient moves
 * for the Narrator, but it cannot change state, Canon, the open Kernel,
 * evidence, documents, secrets or pending consequences.
 */
export const settlePartOneAction = (
  pkg: Parameters<typeof runtimeFacade.settlePartOneAction>[0],
  state: Parameters<typeof runtimeFacade.settlePartOneAction>[1],
  action: Parameters<typeof runtimeFacade.settlePartOneAction>[2],
  turnNumber: Parameters<typeof runtimeFacade.settlePartOneAction>[3],
  options: DynamicPartOneSettlementExecutionOptions = {},
): ReturnType<typeof runtimeFacade.settlePartOneAction> => {
  const context = contextualDecisionContext();
  const currentPin = options.currentPin === undefined
    ? context.pin
    : options.currentPin;
  const currentWorkingSetOverride =
    options.currentWorkingSetOverride === undefined
      ? context.workingSet
      : options.currentWorkingSetOverride;
  const capabilityAction = isDynamicCapabilityAction(action);
  const settlement = capabilityAction
    ? runtimeFacade.settlePartOneAction(
      packageForDynamicCapabilityAction(
        pkg,
        state,
        turnNumber,
        currentPin,
        currentWorkingSetOverride,
      ),
      state,
      action,
      turnNumber,
    )
    : settleDynamicPartOneAction(
      pkg,
      state,
      action,
      turnNumber,
      {
        currentPin,
        currentWorkingSetOverride,
      },
    );

  if (capabilityAction) {
    attachCapabilityKernelSelection(
      pkg,
      settlement,
      turnNumber,
      currentPin,
    );
  }

  const nextStoryBeat = settlement.event.narrativePlan.nextStoryBeat;
  const primaryPattern = nextStoryBeat.dramaticGuidance.scenePatterns[0];
  nextStoryBeat.dramaticBeatPlan = applyNarrativeScenePatternToDramaticBeatPlan(
    nextStoryBeat.dramaticBeatPlan,
    primaryPattern ? nonVerbatimPattern(primaryPattern) : null,
  );
  return settlement;
};

/**
 * Observe-only capability actions intentionally leave the current formal
 * Decision Point open. They still produce an atomic turn, so the exact Kernel
 * and Affordance pair shown after that turn must be frozen in the same event as
 * ordinary authored actions rather than re-derived during recovery.
 */
function attachCapabilityKernelSelection(
  pkg: Parameters<typeof runtimeFacade.settlePartOneAction>[0],
  settlement: ReturnType<typeof runtimeFacade.settlePartOneAction>,
  turnNumber: number,
  currentPin: PartOneDecisionPin | null,
) {
  const event = settlement.event as DynamicCommittedEvent;
  const nextPoint = event.nextDecisionPoint;
  const selectionState = projectFinalizedPartOneSelectionState(settlement);
  const pin: PartOneDecisionPin = currentPin
    && currentPin.decisionKernelId === nextPoint.decisionKernelId
    && currentPin.decisionPointId === nextPoint.decisionPointId
    ? {
      decisionKernelId: currentPin.decisionKernelId,
      decisionPointId: currentPin.decisionPointId,
      ...(currentPin.affordanceIds?.length
        ? { affordanceIds: [...currentPin.affordanceIds] }
        : {}),
    }
    : {
      decisionKernelId: nextPoint.decisionKernelId,
      decisionPointId: nextPoint.decisionPointId,
    };
  let next: ReturnType<typeof buildDynamicPartOneRuntimeWorkingSet>;
  try {
    next = buildDynamicPartOneRuntimeWorkingSet(
      pkg,
      selectionState,
      turnNumber,
      { mode: "DYNAMIC_LITE", pin },
    );
  } catch (pinError) {
    const fallback = buildDynamicPartOneRuntimeWorkingSet(
      pkg,
      selectionState,
      turnNumber,
    );
    if (
      fallback.kernelSelection.mode !== "LEGACY_FALLBACK"
      || fallback.decisionPoint.decisionKernelId
        !== nextPoint.decisionKernelId
      || fallback.decisionPoint.decisionPointId
        !== nextPoint.decisionPointId
      || (
        pin.affordanceIds?.length
        && !sameStringArray(
          fallback.decisionAffordances.map(
            (affordance) => affordance.affordanceTemplateId,
          ),
          pin.affordanceIds,
        )
      )
    ) {
      throw pinError;
    }
    next = fallback;
  }
  if (
    next.decisionPoint.decisionKernelId !== nextPoint.decisionKernelId
    || next.decisionPoint.decisionPointId !== nextPoint.decisionPointId
  ) {
    throw new Error("PART_ONE_CAPABILITY_NEXT_DECISION_MISMATCH");
  }
  if (
    pin.affordanceIds?.length
    && !sameStringArray(
      next.decisionAffordances.map(
        (affordance) => affordance.affordanceTemplateId,
      ),
      pin.affordanceIds,
    )
  ) {
    throw new Error("PART_ONE_CAPABILITY_NEXT_AFFORDANCE_PAIR_MISMATCH");
  }
  event.nextKernelSelection = structuredClone(next.kernelSelection);
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function nonVerbatimPattern(pattern: DramaticPatternPlanInput): DramaticPatternPlanInput {
  return {
    openingPressure: mechanismFragments(pattern.openingPressure),
    orderedBeats: pattern.orderedBeats.map((beat) => ({
      ...beat,
      observableMove: mechanismFragments(beat.observableMove),
    })),
    objectPowerMoves: pattern.objectPowerMoves.map((move) => ({
      ...move,
      observableUse: mechanismFragments(move.observableUse),
    })),
  };
}

/**
 * Preserve the approved mechanism while making verbatim replay impossible.
 * This transformation is world-agnostic: CJK text is divided by Unicode code
 * points and whitespace-delimited text by words. The Narrator receives ordered
 * semantic fragments and must re-express them in the current scene.
 */
function mechanismFragments(value: string) {
  const text = String(value || "").trim();
  if (!text) return text;
  if (/\p{Script=Han}/u.test(text)) {
    const points = [...text];
    const chunks: string[] = [];
    for (let index = 0; index < points.length; index += 6) {
      chunks.push(points.slice(index, index + 6).join(""));
    }
    return chunks.join("／");
  }
  const words = text.split(/\s+/u).filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 3) {
    chunks.push(words.slice(index, index + 3).join(" "));
  }
  return chunks.join(" / ");
}

const runtimeEntry = {
  ...runtimeFacade,
  loadPartOneRuntimePackage,
  buildPartOneRuntimeWorkingSet,
  buildCommittedLegacyFallbackWorkingSet,
  finalizePartOneSettlement,
  projectFinalizedPartOneSelectionState,
  settlePartOneAction,
  withPartOneDecisionPin,
  withPartOneDecisionWorkingSet,
};

export default runtimeEntry;
