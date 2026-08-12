import { compareCanonicalText } from "@ai-story/shared";

import type {
  ChapterWorkingState,
  DecisionPointDefinition,
  PressureChapterDefinition,
} from "./types";

export type RequirementDependencyBlock = {
  blocked: boolean;
  dependencyIds: string[];
  reasonCodes: string[];
};

/** Requirement dependencies are eligibility gates, never score bonuses. */
export function resolveRequirementDependencyBlock(
  chapter: PressureChapterDefinition,
  state: ChapterWorkingState,
  point: DecisionPointDefinition,
): RequirementDependencyBlock {
  const satisfied = new Set(state.satisfiedRequirementIds);
  const pointRequirements = new Set(point.requirementIds);
  const blocking = chapter.requirementDependencies
    .filter((dependency) => (
      pointRequirements.has(dependency.successorRequirementId)
      && !satisfied.has(dependency.predecessorRequirementId)
    ))
    .sort((left, right) => compareCanonicalText(left.dependencyId, right.dependencyId));
  return {
    blocked: blocking.length > 0,
    dependencyIds: blocking.map((item) => item.dependencyId),
    reasonCodes: blocking.map((item) => (
      `REQUIREMENT_DEPENDENCY_BLOCKED:${item.dependencyId}:`
      + `${item.predecessorRequirementId}->${item.successorRequirementId}`
    )),
  };
}
