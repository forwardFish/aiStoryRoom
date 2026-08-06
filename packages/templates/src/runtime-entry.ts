import runtimeFacade from "./runtime-facade.js";
import {
  applyNarrativeScenePatternToDramaticBeatPlan,
  type DramaticPatternPlanInput,
} from "./story-package/dramatic-beat-plan.js";
import {
  buildDynamicPartOneRuntimeWorkingSet,
  isDynamicCapabilityAction,
  type DynamicPartOneCommittedEvent as DynamicCommittedEvent,
} from "./story-package/dynamic-kernel-lite-runtime.js";
import {
  buildCommittedLegacyFallbackWorkingSet,
  packageForDynamicCapabilityAction,
  settleDynamicPartOneAction,
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
export const buildPartOneRuntimeWorkingSet = buildDynamicPartOneRuntimeWorkingSet;

/**
 * Settlement is complete before scene grammar is attached. The selected
 * NarrativeScenePattern therefore remains expression-only: it can order
 * transient moves for the Narrator, but it cannot change state, Canon, the
 * open Kernel, evidence, documents, secrets or pending consequences.
 */
export const settlePartOneAction = (
  ...args: Parameters<typeof runtimeFacade.settlePartOneAction>
): ReturnType<typeof runtimeFacade.settlePartOneAction> => {
  const [pkg, state, action, turnNumber] = args;
  const capabilityAction = isDynamicCapabilityAction(action);
  const settlement = capabilityAction
    ? runtimeFacade.settlePartOneAction(
      packageForDynamicCapabilityAction(pkg, state, turnNumber),
      state,
      action,
      turnNumber,
    )
    : settleDynamicPartOneAction(pkg, state, action, turnNumber);

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
  const next = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    settlement.proposedState,
    turnNumber,
    { mode: "DYNAMIC_LITE", pin },
  );
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
};

export default runtimeEntry;
