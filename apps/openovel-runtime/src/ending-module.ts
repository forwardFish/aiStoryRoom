import type { PreparedAuthoredDecision } from "./decision-adapter.js";
import type { EndingPresentation } from "./types.js";

export type EndingModuleInput = {
  runId: string;
  turnId: string;
  turnNumber: number;
  finalNarration: string;
  preparedDecision: PreparedAuthoredDecision | null;
};

/**
 * Ending is a lifecycle module, not a Narrator side effect. It reads the
 * settled final state and returns only player-visible ending material.
 */
export interface EndingModule {
  readonly moduleId: string;
  build(input: EndingModuleInput): Promise<EndingPresentation> | EndingPresentation;
}

export class BasicEndingModule implements EndingModule {
  readonly moduleId = "openovel.basic-ending.v1";

  build(input: EndingModuleInput): EndingPresentation {
    return {
      schemaVersion: "openovel_ending_v1",
      scope: "STORY",
      endingKey: "story_complete",
      title: "这一段人生已经落定",
      finalSceneNarrative: input.finalNarration.trim(),
      protagonistFate: "你的最后选择已经成为这个世界无法收回的一部分。",
      aftermath: [],
      sourceTurnId: input.turnId,
      sourceRevision: input.turnNumber,
    };
  }
}
