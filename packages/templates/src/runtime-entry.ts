import { AsyncLocalStorage } from "node:async_hooks";
import runtimeFacade from "./runtime-facade.js";
import {
  applyNarrativeScenePatternToDramaticBeatPlan,
  type DramaticPatternPlanInput,
} from "./story-package/dramatic-beat-plan.js";
import {
  buildDynamicPartOneRuntimeWorkingSet,
  isDynamicCapabilityAction,
  type DynamicPartOneCommittedEvent as DynamicCommittedEvent,
  type PartOneDecisionPin,
  type PartOneWorkingSetSelectionOptions,
} from "./story-package/dynamic-kernel-lite-runtime.js";
import {
  buildCommittedLegacyFallbackWorkingSet,
  packageForDynamicCapabilityAction,
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
  settleDynamicPartOneAction,
} from "./story-package/dynamic-kernel-lite-settlement.js";
export type {
  DynamicPartOneSettlementExecutionOptions,
} from "./story-package/dynamic-kernel-lite-settlement.js";

/**
 * Recovery validation happens in the OpenNovel adapter before the frozen
 * authored-decision module binds and settles an action. The base module keeps
 * its stable public signature, so the exact committed Pin is carried through
 * an AsyncLocalStorage scope. This is concurrency-safe and ensures both the
 * WorkingSet used for action binding and the formal Settlement use the same
 * already-committed decision surface.
 */
const decisionPinContext = new AsyncLocalStorage<PartOneDecisionPin | null>();

export function withPartOneDecisionPin<T>(
  pin: PartOneDecisionPin | null,
  execute: () => T,
): T {
  return decisionPinContext.run(
    pin ? structuredClone(pin) : null,
    execute,
  );
}

function contextualDecisionPin() {
  return decisionPinContext.getStore() ?? null;
}

/**
 * Explicit exports win over the star-exported frozen implementations. Native
 * ESM named imports, CommonJS namespace imports and the default runtime
 * namespace therefore use one playable loader and the Dynamic Kernel Selector
 * Lite path, while source-level authoring tests can still import the frozen
 * engine directly from story-package modules.
 *
 * Dynamic settlement is exported only from dynamic-kernel-lite-settlement.
 * The selector module deliberately exposes selection and trace contracts but
 * not its historical settlement harness, preventing tests or consumers from
 * accidentally validating a path that production does not execute.
 */
export const loadPartOneRuntimePackage = loadPlayablePartOneRuntimePackage;

export const buildPartOneRuntimeWorkingSet = (
  pkg: Parameters<typeof buildDynamicPartOneRuntimeWorkingSet>[0],
  state: Parameters<typeof buildDynamicPartOneRuntimeWorkingSet>[1],
  turnNumber: Parameters<typeof buildDynamicPartOneRuntimeWorkingSet>[2],
  options: PartOneWorkingSetSelectionOptions = {},
): ReturnType<typeof buildDynamicPartOneRuntimeWorkingSet> => {
  const ambientPin = contextualDecisionPin();
  const effectiveOptions = options.pin !== undefined
    || options.mode === "LEGACY_FIXED"
    || !ambientPin
    ? options
    : {
      ...options,
      mode: "DYNAMIC_LITE" as const,
      pin: ambientPin,
    };
  return buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    state,
    turnNumber,
    effectiveOptions,
  );
};

/**
 * Settlement is complete before scene grammar is attached. The selected
 * NarrativeScenePattern therefore remains expression-only: it can order
 * transient moves for the Narrator, but it cannot change state, Canon, the
 * open Kernel, evidence, documents, secrets or pending consequences.
 */
export const settlePartOneAction = (
  pkg: Parameters<typeof runtimeFacade.settlePartOneAction>[0],
  state: Parameters<typeof runtimeFacade.settlePartOneAction>[1],
  action: Parameters<typeof runtimeFacade.settlePartOneAction>[2],
  turnNumber: Parameters<typeof runtimeFacade.settlePartOneAction>[3],
  options: DynamicPartOneSettlementExecutionOptions = {},
): ReturnType<typeof runtimeFacade.settlePartOneAction> => {
  const ambientPin = contextualDecisionPin();
  const currentPin = options.currentPin === undefined
    ? ambientPin
    : options.currentPin;
  const capabilityAction = isDynamicCapabilityAction(action);
  const settlement = capabilityAction
    ? runtimeFacade.settlePartOneAction(
      packageForDynamicCapabilityAction(
        pkg,
        state,
        turnNumber,
        currentPin,
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
      { currentPin },
    );

  if (capabilityAction) {
    attachCapabilityKernelSelection(
      pkg,
      settlement,
      turnNumber,
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
 *
 * A committed Legacy fallback is the one valid exception to normal Dynamic
 * pinning: it can exist precisely because the Kernel has fewer than two unique
 * Preview Outcomes. If strict pinning rejects it, the only permitted recovery
 * is the same Legacy fallback Kernel and Decision Point selected from the same
 * proposed state. Every other pin failure remains fail-closed.
 */
function attachCapabilityKernelSelection(
  pkg: Parameters<typeof runtimeFacade.settlePartOneAction>[0],
  settlement: ReturnType<typeof runtimeFacade.settlePartOneAction>,
  turnNumber: number,
) {
  const event = settlement.event as DynamicCommittedEvent;
  const pin = {
    decisionKernelId: event.nextDecisionPoint.decisionKernelId,
    decisionPointId: event.nextDecisionPoint.decisionPointId,
  };
  let next: ReturnType<typeof buildDynamicPartOneRuntimeWorkingSet>;
  try {
    next = buildDynamicPartOneRuntimeWorkingSet(
      pkg,
      settlement.proposedState,
      turnNumber,
      { mode: "DYNAMIC_LITE", pin },
    );
  } catch (pinError) {
    const fallback = buildDynamicPartOneRuntimeWorkingSet(
      pkg,
      settlement.proposedState,
      turnNumber,
    );
    if (
      fallback.kernelSelection.mode !== "LEGACY_FALLBACK"
      || fallback.decisionPoint.decisionKernelId !== pin.decisionKernelId
      || fallback.decisionPoint.decisionPointId !== pin.decisionPointId
    ) {
      throw pinError;
    }
    next = fallback;
  }
  if (
    next.decisionPoint.decisionKernelId !== pin.decisionKernelId
    || next.decisionPoint.decisionPointId !== pin.decisionPointId
  ) {
    throw new Error("PART_ONE_CAPABILITY_NEXT_DECISION_MISMATCH");
  }
  event.nextKernelSelection = structuredClone(next.kernelSelection);
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
  settlePartOneAction,
  withPartOneDecisionPin,
};

export default runtimeEntry;
