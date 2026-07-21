import type { StoryPackageDirectorEvaluation, StoryPackageDirectorInput } from "./types";
import { loadStoryPackage } from "./loader";

export function evaluateStoryPackageDirector(worldId: string, input: StoryPackageDirectorInput): StoryPackageDirectorEvaluation {
  const loaded = loadStoryPackage(worldId);
  const node = loaded.storyPackage.nodes.find((candidate) => candidate.nodeId === input.currentNodeId);
  if (!node) throw new Error(`STORY_PACKAGE_NODE_UNKNOWN:${input.currentNodeId}`);
  const canonFacts = new Set(input.canonFactKeys);
  let directedBeat: StoryPackageDirectorEvaluation["directedBeat"] = null;
  const evaluatedObligations = node.floorObligationIds.map((obligationId) => {
    const obligation = loaded.storyPackage.floorObligations.find((candidate) => candidate.obligationId === obligationId);
    if (!obligation) throw new Error(`STORY_PACKAGE_FLOOR_UNKNOWN:${obligationId}`);
    if (obligation.satisfiedByAnyFactKeys.some((factKey) => canonFacts.has(factKey))) {
      return { obligationId, status: "SATISFIED" as const };
    }
    if ((obligation.earliestAtTurn ?? 1) > input.currentTurn || obligation.floorAtTurn > input.currentTurn) {
      return { obligationId, status: "NOT_DUE" as const };
    }
    if (obligation.preconditions.some((factKey) => !canonFacts.has(factKey))) {
      return { obligationId, status: "BLOCKED" as const };
    }
    if (!directedBeat && obligation.directedBeatTemplate) {
      directedBeat = {
        beatId: obligation.directedBeatTemplate.beatId,
        obligationId,
        externalWorldMove: obligation.directedBeatTemplate.externalWorldMove,
        targetNodeId: obligation.directedBeatTemplate.targetNodeId,
        sourceIds: obligation.directedBeatTemplate.allowedSourceIds
      };
    }
    return { obligationId, status: "OPEN" as const };
  });
  return {
    currentNodeId: node.nodeId,
    allowedAdjacentNodeIds: [...node.allowedAdjacentNodeIds],
    evaluatedObligations,
    directedBeat
  };
}
