import runtimeFacade from "./runtime-facade.js";
import {
  applyNarrativeScenePatternToDramaticBeatPlan,
  type DramaticPatternPlanInput,
} from "./story-package/dramatic-beat-plan.js";

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
    primaryPattern ? nonVerbatimPattern(primaryPattern) : null,
  );
  return settlement;
};

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
  settlePartOneAction,
};

export default runtimeEntry;
