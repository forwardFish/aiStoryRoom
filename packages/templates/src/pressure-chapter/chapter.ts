import { assertWorkingOnly, cloneValue, sortedUnique } from "./canonical";
import type {
  ChapterWorkingState,
  PressureChapterDefinition,
  PressureChapterId,
  RequirementDependency,
} from "./types";
import { PRESSURE_CHAPTER_IDS } from "./types";

export function chapterSequence(chapterId: PressureChapterId): number {
  return PRESSURE_CHAPTER_IDS.indexOf(chapterId) + 1;
}

export function assertPressureChapterDefinition(
  definition: PressureChapterDefinition,
): PressureChapterDefinition {
  if (definition.schemaVersion !== "pressure_chapter_definition_v1") {
    invalid("SCHEMA_VERSION", definition.schemaVersion);
  }
  if (!PRESSURE_CHAPTER_IDS.includes(definition.chapterId)) {
    invalid("CHAPTER_ID", definition.chapterId);
  }
  if (definition.sequence !== chapterSequence(definition.chapterId)) {
    invalid("CHAPTER_SEQUENCE", `${definition.chapterId}:${definition.sequence}`);
  }
  if (!definition.decisionPoints.length) {
    invalid("DECISION_POINTS_EMPTY", definition.chapterId);
  }

  const pointIds = new Set<string>();
  const kernelIds = new Set<string>();
  const knownRequirements = new Set<string>();
  for (const point of definition.decisionPoints) {
    requiredText(point.decisionPointId, "decisionPointId");
    requiredText(point.kernelId, `${point.decisionPointId}.kernelId`);
    requiredText(point.prompt, `${point.decisionPointId}.prompt`);
    if (point.chapterId !== definition.chapterId) {
      invalid("POINT_CHAPTER_MISMATCH", point.decisionPointId);
    }
    if (!Number.isInteger(point.sourceOrder) || point.sourceOrder < 0) {
      invalid("POINT_SOURCE_ORDER", point.decisionPointId);
    }
    if (pointIds.has(point.decisionPointId)) {
      invalid("DUPLICATE_DECISION_POINT", point.decisionPointId);
    }
    if (kernelIds.has(point.kernelId)) {
      invalid("DUPLICATE_KERNEL", point.kernelId);
    }
    pointIds.add(point.decisionPointId);
    kernelIds.add(point.kernelId);
    point.requirementIds.forEach((id) => {
      requiredText(id, `${point.decisionPointId}.requirementId`);
      knownRequirements.add(id);
    });
    if (!point.options.length) invalid("OPTIONS_EMPTY", point.decisionPointId);
    const optionIds = new Set<string>();
    for (const option of point.options) {
      requiredText(option.optionId, `${point.decisionPointId}.optionId`);
      requiredText(option.label, `${point.decisionPointId}.${option.optionId}.label`);
      if (!Number.isInteger(option.sourceOrder) || option.sourceOrder < 0) {
        invalid("OPTION_SOURCE_ORDER", `${point.decisionPointId}:${option.optionId}`);
      }
      if (optionIds.has(option.optionId)) {
        invalid("DUPLICATE_OPTION", `${point.decisionPointId}:${option.optionId}`);
      }
      optionIds.add(option.optionId);
      option.workingDelta.satisfyRequirementIds?.forEach((id) => {
        requiredText(id, `${point.decisionPointId}.${option.optionId}.satisfyRequirementId`);
        knownRequirements.add(id);
      });
      assertWorkingOnly(option.workingDelta, `${point.decisionPointId}.${option.optionId}`);
    }
  }
  validateDependencies(definition.requirementDependencies, knownRequirements);
  return cloneValue(definition);
}

export function createChapterWorkingState(input: {
  runId: string;
  chapterId: PressureChapterId;
  facts?: ChapterWorkingState["facts"];
  counters?: ChapterWorkingState["counters"];
  satisfiedRequirementIds?: string[];
}): ChapterWorkingState {
  requiredText(input.runId, "runId");
  if (!PRESSURE_CHAPTER_IDS.includes(input.chapterId)) {
    invalid("CHAPTER_ID", input.chapterId);
  }
  assertWorkingOnly(input.facts || {}, "initialFacts");
  return {
    schemaVersion: "pressure_chapter_working_state_v1",
    runId: input.runId,
    chapterId: input.chapterId,
    revision: 0,
    facts: cloneValue(input.facts || {}),
    counters: cloneValue(input.counters || {}),
    satisfiedRequirementIds: sortedUnique(input.satisfiedRequirementIds || []),
    completedDecisionPointIds: [],
    settledReactions: [],
    lastBeatId: null,
  };
}

function validateDependencies(
  dependencies: RequirementDependency[],
  knownRequirements: Set<string>,
) {
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const edges = new Map<string, string[]>();
  for (const dependency of dependencies) {
    requiredText(dependency.dependencyId, "dependencyId");
    requiredText(dependency.predecessorRequirementId, `${dependency.dependencyId}.predecessor`);
    requiredText(dependency.successorRequirementId, `${dependency.dependencyId}.successor`);
    if (ids.has(dependency.dependencyId)) invalid("DUPLICATE_DEPENDENCY", dependency.dependencyId);
    ids.add(dependency.dependencyId);
    if (dependency.predecessorRequirementId === dependency.successorRequirementId) {
      invalid("SELF_DEPENDENCY", dependency.dependencyId);
    }
    if (!knownRequirements.has(dependency.predecessorRequirementId)) {
      invalid("UNKNOWN_PREDECESSOR", dependency.predecessorRequirementId);
    }
    if (!knownRequirements.has(dependency.successorRequirementId)) {
      invalid("UNKNOWN_SUCCESSOR", dependency.successorRequirementId);
    }
    const pair = `${dependency.predecessorRequirementId}->${dependency.successorRequirementId}`;
    if (pairs.has(pair)) invalid("DUPLICATE_DEPENDENCY_PAIR", pair);
    pairs.add(pair);
    const successors = edges.get(dependency.predecessorRequirementId) || [];
    successors.push(dependency.successorRequirementId);
    edges.set(dependency.predecessorRequirementId, successors);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) invalid("DEPENDENCY_CYCLE", [...path, id].join("->"));
    if (visited.has(id)) return;
    visiting.add(id);
    for (const successor of edges.get(id) || []) visit(successor, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) visit(id, []);
}

function requiredText(value: string, label: string) {
  if (typeof value !== "string" || !value.trim()) invalid("TEXT_REQUIRED", label);
}

function invalid(code: string, detail: unknown): never {
  throw new Error(`PRESSURE_CHAPTER_DEFINITION_INVALID:${code}:${String(detail)}`);
}
