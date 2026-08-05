import runtimeFacade from "./runtime-facade.js";
import { applyNarrativeScenePatternToDramaticBeatPlan } from "./story-package/dramatic-beat-plan.js";

export * from "./index.js";

/**
 * Explicit export wins over the star-exported base implementation. This keeps
 * native ESM named imports, CommonJS namespace imports, and the default runtime
 * namespace on the same capability-aware settlement function.
 *
 * Settlement is complete before scene grammar is attached. The selected
 * NarrativeScenePattern therefore remains expression-only: it can order
 * transient moves for the Narrator, but it cannot change state, Canon, the
 * open Kernel, evidence, documents, secrets or pending consequences.
 */
export const settlePartOneAction = (
  ...args: Parameters<typeof runtimeFacade.settlePartOneAction>
): ReturnType<typeof runtimeFacade.settlePartOneAction> => {
  const settlement = runtimeFacade.settlePartOneAction(...args);
  const nextStoryBeat = settlement.event.narrativePlan.nextStoryBeat;
  const primaryPattern = nextStoryBeat.dramaticGuidance.scenePatterns[0];
  nextStoryBeat.dramaticBeatPlan = applyNarrativeScenePatternToDramaticBeatPlan(
    nextStoryBeat.dramaticBeatPlan,
    primaryPattern,
  );
  return settlement;
};

const runtimeEntry = {
  ...runtimeFacade,
  settlePartOneAction,
};

export default runtimeEntry;
