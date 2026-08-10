import { evaluatePartOneRule } from "./part-one-runtime-engine.js";
import type {
  PartOneRequirementDependency,
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneSectionContract,
  PartOneSelectionRules,
  PartOneState,
  PartOneStateRule,
} from "./part-one-runtime-types.js";

const DEPENDENCY_BYPASSES = new Set([
  "DIRECT_DUE_PRESSURE",
]);

const RULE_OPERATORS = new Set([
  "EQ",
  "NEQ",
  "IN",
  "NOT_NULL",
  "ANY_PENDING",
]);

export type RequirementDependencyValidationInput = {
  selectionRules: unknown;
  requirements: PartOneRuntimePackage["requirements"];
  sections: PartOneSectionContract[];
  assets: PartOneRuntimeAsset[];
  worldStartState: PartOneState;
};

export type RequirementDependencyRuntimeContext = {
  directDuePressureCount?: number;
};

export type RequirementDependencyBlock = {
  blocked: boolean;
  reasonCodes: string[];
  dependencyIds: string[];
};

/**
 * Validate the author-owned dependency graph before a Story Package can be
 * published or loaded. Conditional edges are still checked as graph edges so
 * a latent state cannot activate a cycle later in a run.
 */
export function validatePartOneSelectionRules(
  input: RequirementDependencyValidationInput,
): PartOneSelectionRules {
  const rawRules = asRecord(input.selectionRules, "selectionRules");
  exact(
    rawRules.schemaVersion,
    "requirement-selection-rules-v1",
    "selectionRules.schemaVersion",
  );
  const rawDependencies = asArray(
    rawRules.requirementDependencies,
    "selectionRules.requirementDependencies",
  );
  const requirementById = new Map(
    input.requirements.map((requirement) => [
      requirement.requirementId,
      requirement,
    ]),
  );
  const kernelById = new Map(
    input.assets
      .filter((asset) => asset.assetType === "DECISION_KERNEL")
      .map((asset) => [asset.assetId, asset]),
  );
  const dependencyIds = new Set<string>();
  const pairIds = new Set<string>();
  const normalized: PartOneRequirementDependency[] = [];

  for (const rawDependency of rawDependencies) {
    const row = asRecord(rawDependency, "requirementDependency");
    exact(
      row.schemaVersion,
      "requirement-dependency-v1",
      "requirementDependency.schemaVersion",
    );
    const dependencyId = requiredText(
      row.dependencyId,
      "requirementDependency.dependencyId",
    );
    const predecessorRequirementId = requiredText(
      row.predecessorRequirementId,
      `${dependencyId}.predecessorRequirementId`,
    );
    const successorRequirementId = requiredText(
      row.successorRequirementId,
      `${dependencyId}.successorRequirementId`,
    );
    if (dependencyIds.has(dependencyId)) {
      fail("DUPLICATE_DEPENDENCY_ID", dependencyId);
    }
    dependencyIds.add(dependencyId);
    if (predecessorRequirementId === successorRequirementId) {
      fail("SELF_DEPENDENCY", dependencyId);
    }
    const predecessor = requirementById.get(predecessorRequirementId);
    const successor = requirementById.get(successorRequirementId);
    if (!predecessor) {
      fail("UNKNOWN_PREDECESSOR_REQUIREMENT", predecessorRequirementId);
    }
    if (!successor) {
      fail("UNKNOWN_SUCCESSOR_REQUIREMENT", successorRequirementId);
    }
    const pairId = `${predecessorRequirementId}->${successorRequirementId}`;
    const reversePairId = `${successorRequirementId}->${predecessorRequirementId}`;
    if (pairIds.has(pairId)) {
      fail("DUPLICATE_DEPENDENCY", pairId);
    }
    if (pairIds.has(reversePairId)) {
      fail("CONFLICTING_DEPENDENCY", pairId);
    }
    pairIds.add(pairId);

    const sharedSections = input.sections.filter((section) => (
      section.requiredRequirementIds.includes(predecessorRequirementId)
      && section.requiredRequirementIds.includes(successorRequirementId)
      && predecessor.sectionIds.includes(section.sectionId)
      && successor.sectionIds.includes(section.sectionId)
    ));
    if (!sharedSections.length) {
      fail("DEPENDENCY_HAS_NO_SHARED_SECTION", dependencyId);
    }

    const explicitPredecessorKernelIds = row.predecessorDecisionKernelIds === undefined
      ? []
      : uniqueTextArray(
        row.predecessorDecisionKernelIds,
        `${dependencyId}.predecessorDecisionKernelIds`,
      );
    const successorKernelIds = new Set(successor.decisionKernelIds);
    const derivedPredecessorKernelIds = predecessor.decisionKernelIds.filter(
      (kernelId) => !successorKernelIds.has(kernelId),
    );
    const predecessorDecisionKernelIds = explicitPredecessorKernelIds.length
      ? explicitPredecessorKernelIds
      : derivedPredecessorKernelIds;
    if (!predecessorDecisionKernelIds.length) {
      fail("DEPENDENCY_HAS_NO_PREDECESSOR_KERNEL", dependencyId);
    }
    for (const kernelId of predecessorDecisionKernelIds) {
      const kernel = kernelById.get(kernelId);
      if (!kernel) {
        fail("UNKNOWN_PREDECESSOR_KERNEL", `${dependencyId}:${kernelId}`);
      }
      if (!kernel.requirementIds.includes(predecessorRequirementId)) {
        fail("PREDECESSOR_KERNEL_REQUIREMENT_MISMATCH", `${dependencyId}:${kernelId}`);
      }
      if (!sharedSections.some((section) => (
        section.activeDecisionKernelIds.includes(kernelId)
        && kernel.sectionIds.includes(section.sectionId)
      ))) {
        fail("PREDECESSOR_KERNEL_OUTSIDE_SHARED_SECTION", `${dependencyId}:${kernelId}`);
      }
    }

    const predecessorEffects = new Set(stringArray(
      predecessor.stateEffects,
      `${predecessorRequirementId}.stateEffects`,
    ));
    const satisfactionRules = sharedSections.flatMap((section) => [
      ...section.mustEstablish,
      ...section.exitGates,
    ]).filter((rule) => predecessorEffects.has(rule.statePath));
    if (!satisfactionRules.length) {
      fail("UNSATISFIABLE_PREDECESSOR", dependencyId);
    }

    const condition = row.condition === undefined
      ? undefined
      : validateCondition(
        row.condition,
        dependencyId,
        input.worldStartState,
      );
    const bypassWhen = row.bypassWhen === undefined
      ? []
      : uniqueTextArray(row.bypassWhen, `${dependencyId}.bypassWhen`);
    for (const bypass of bypassWhen) {
      if (!DEPENDENCY_BYPASSES.has(bypass)) {
        fail("UNKNOWN_DEPENDENCY_BYPASS", `${dependencyId}:${bypass}`);
      }
    }
    normalized.push({
      schemaVersion: "requirement-dependency-v1",
      dependencyId,
      predecessorRequirementId,
      successorRequirementId,
      predecessorDecisionKernelIds: [...predecessorDecisionKernelIds].sort(),
      ...(condition ? { condition } : {}),
      ...(bypassWhen.length
        ? {
          bypassWhen: [...bypassWhen].sort() as PartOneRequirementDependency["bypassWhen"],
        }
        : {}),
    });
  }

  assertAcyclic(normalized);
  return {
    schemaVersion: "requirement-selection-rules-v1",
    requirementDependencies: normalized.sort((left, right) => (
      left.dependencyId.localeCompare(right.dependencyId)
    )),
  };
}

/**
 * Determine whether one existing Kernel is currently blocked by an active,
 * validated Requirement dependency. This is an eligibility gate, never a
 * score bonus: ordinary scoring starts only after the dependency graph has
 * admitted a candidate.
 */
export function resolveRequirementDependencyBlock(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  section: PartOneSectionContract,
  kernel: PartOneRuntimeAsset,
  context: RequirementDependencyRuntimeContext = {},
): RequirementDependencyBlock {
  const completed = new Set(state.completedKernelIds || []);
  const dependencies = [...pkg.selectionRules.requirementDependencies]
    .sort((left, right) => left.dependencyId.localeCompare(right.dependencyId));
  const blocking: PartOneRequirementDependency[] = [];

  for (const dependency of dependencies) {
    if (
      !section.requiredRequirementIds.includes(
        dependency.predecessorRequirementId,
      )
      || !section.requiredRequirementIds.includes(
        dependency.successorRequirementId,
      )
      || !kernel.requirementIds.includes(
        dependency.successorRequirementId,
      )
    ) {
      continue;
    }
    if (
      dependency.condition
      && !dependency.condition.allOf.every((rule) => (
        evaluatePartOneRule(state, rule)
      ))
    ) {
      continue;
    }
    if (
      dependency.bypassWhen?.includes("DIRECT_DUE_PRESSURE")
      && Number(context.directDuePressureCount || 0) > 0
    ) {
      continue;
    }
    const predecessorKernelIds = new Set(
      dependency.predecessorDecisionKernelIds || [],
    );
    if (predecessorKernelIds.has(kernel.assetId)) {
      continue;
    }
    if (predecessorRequirementSatisfied(
      pkg,
      state,
      section,
      dependency.predecessorRequirementId,
    )) {
      continue;
    }
    const hasOpenPredecessor = [...predecessorKernelIds].some((kernelId) => (
      section.activeDecisionKernelIds.includes(kernelId)
      && !completed.has(kernelId)
    ));
    if (!hasOpenPredecessor) {
      // A stale author dependency must not deadlock a run after every admitted
      // predecessor path has been consumed. Validation still prevents a
      // package from starting with no predecessor path at all.
      continue;
    }
    blocking.push(dependency);
  }

  const dependencyIds = blocking.map((dependency) => dependency.dependencyId);
  return {
    blocked: dependencyIds.length > 0,
    dependencyIds,
    reasonCodes: blocking.map((dependency) => (
      `REQUIREMENT_DEPENDENCY_BLOCKED:${dependency.dependencyId}:`
      + `${dependency.predecessorRequirementId}->`
      + dependency.successorRequirementId
    )),
  };
}

function predecessorRequirementSatisfied(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  section: PartOneSectionContract,
  requirementId: string,
) {
  const requirement = pkg.requirements.find((item) => (
    item.requirementId === requirementId
  ));
  if (!requirement) return false;
  const effects = new Set(stringArray(
    requirement.stateEffects,
    `${requirementId}.stateEffects`,
  ));
  const rules = uniqueRules([
    ...section.mustEstablish,
    ...section.exitGates,
  ].filter((rule) => effects.has(rule.statePath)));
  return rules.length > 0 && rules.every((rule) => (
    evaluatePartOneRule(state, rule)
  ));
}

function validateCondition(
  value: unknown,
  dependencyId: string,
  worldStartState: PartOneState,
) {
  const condition = asRecord(value, `${dependencyId}.condition`);
  const allOf = asArray(
    condition.allOf,
    `${dependencyId}.condition.allOf`,
  ).map((rawRule, index) => validateRule(
    rawRule,
    `${dependencyId}.condition.allOf[${index}]`,
    worldStartState,
  ));
  if (!allOf.length) {
    fail("EMPTY_DEPENDENCY_CONDITION", dependencyId);
  }
  const ruleIds = new Set<string>();
  for (const rule of allOf) {
    if (ruleIds.has(rule.ruleId)) {
      fail("DUPLICATE_CONDITION_RULE_ID", `${dependencyId}:${rule.ruleId}`);
    }
    ruleIds.add(rule.ruleId);
  }
  assertConditionSatisfiable(allOf, dependencyId);
  return { allOf };
}

function validateRule(
  value: unknown,
  label: string,
  worldStartState: PartOneState,
): PartOneStateRule {
  const row = asRecord(value, label);
  const ruleId = requiredText(row.ruleId, `${label}.ruleId`);
  const statePath = requiredText(row.statePath, `${label}.statePath`);
  const operator = requiredText(row.operator, `${label}.operator`);
  if (!RULE_OPERATORS.has(operator)) {
    fail("UNKNOWN_CONDITION_OPERATOR", `${label}:${operator}`);
  }
  if (!hasStatePath(worldStartState, statePath)) {
    fail("UNKNOWN_CONDITION_STATE_PATH", `${label}:${statePath}`);
  }
  if (!("expectedValue" in row)) {
    fail("CONDITION_EXPECTED_VALUE_MISSING", label);
  }
  if (operator === "IN" && (
    !Array.isArray(row.expectedValue)
    || row.expectedValue.length === 0
  )) {
    fail("CONDITION_IN_SET_EMPTY", label);
  }
  if (operator === "NOT_NULL" && row.expectedValue !== true) {
    fail("CONDITION_NOT_NULL_EXPECTS_TRUE", label);
  }
  if (operator === "ANY_PENDING" && typeof row.expectedValue !== "boolean") {
    fail("CONDITION_ANY_PENDING_EXPECTS_BOOLEAN", label);
  }
  return {
    ruleId,
    statePath,
    operator: operator as PartOneStateRule["operator"],
    expectedValue: row.expectedValue,
    description: requiredText(row.description, `${label}.description`),
  };
}

function assertConditionSatisfiable(
  rules: PartOneStateRule[],
  dependencyId: string,
) {
  const byPath = new Map<string, PartOneStateRule[]>();
  for (const rule of rules) {
    const group = byPath.get(rule.statePath) || [];
    group.push(rule);
    byPath.set(rule.statePath, group);
  }
  for (const [statePath, group] of byPath) {
    const equals = group.filter((rule) => rule.operator === "EQ");
    if (new Set(equals.map((rule) => JSON.stringify(rule.expectedValue))).size > 1) {
      fail("IMPOSSIBLE_DEPENDENCY_CONDITION", `${dependencyId}:${statePath}`);
    }
    const equal = equals[0];
    if (equal && group.some((rule) => (
      rule.operator === "NEQ"
      && JSON.stringify(rule.expectedValue)
        === JSON.stringify(equal.expectedValue)
    ))) {
      fail("IMPOSSIBLE_DEPENDENCY_CONDITION", `${dependencyId}:${statePath}`);
    }
    if (equal && group.some((rule) => (
      rule.operator === "NOT_NULL"
      && equal.expectedValue === null
    ))) {
      fail("IMPOSSIBLE_DEPENDENCY_CONDITION", `${dependencyId}:${statePath}`);
    }
    const inRules = group.filter((rule) => rule.operator === "IN");
    if (inRules.length > 1) {
      let intersection = new Set(inRules[0]!.expectedValue as unknown[]);
      for (const rule of inRules.slice(1)) {
        const allowed = new Set(rule.expectedValue as unknown[]);
        intersection = new Set(
          [...intersection].filter((item) => allowed.has(item)),
        );
      }
      if (!intersection.size) {
        fail("IMPOSSIBLE_DEPENDENCY_CONDITION", `${dependencyId}:${statePath}`);
      }
    }
  }
}

function assertAcyclic(dependencies: PartOneRequirementDependency[]) {
  const edges = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const outgoing = edges.get(dependency.predecessorRequirementId) || [];
    outgoing.push(dependency.successorRequirementId);
    edges.set(dependency.predecessorRequirementId, outgoing);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (requirementId: string, path: string[]) => {
    if (visiting.has(requirementId)) {
      fail("DEPENDENCY_CYCLE", [...path, requirementId].join("->"));
    }
    if (visited.has(requirementId)) return;
    visiting.add(requirementId);
    for (const successor of edges.get(requirementId) || []) {
      visit(successor, [...path, requirementId]);
    }
    visiting.delete(requirementId);
    visited.add(requirementId);
  };
  for (const requirementId of edges.keys()) visit(requirementId, []);
}

function uniqueRules(rules: PartOneStateRule[]) {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const key = [
      rule.statePath,
      rule.operator,
      JSON.stringify(rule.expectedValue),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasStatePath(value: unknown, path: string) {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return false;
    }
    if (!(segment in current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail("STRING_ARRAY_REQUIRED", label);
  }
  return value as string[];
}

function uniqueTextArray(value: unknown, label: string) {
  const values = stringArray(value, label).map((item) => item.trim());
  if (values.some((item) => !item)) fail("EMPTY_ARRAY_VALUE", label);
  if (new Set(values).size !== values.length) fail("DUPLICATE_ARRAY_VALUE", label);
  return values;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("OBJECT_REQUIRED", label);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail("ARRAY_REQUIRED", label);
  return value as unknown[];
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    fail("TEXT_REQUIRED", label);
  }
  return value.trim();
}

function exact(actual: unknown, expected: string, label: string) {
  if (actual !== expected) fail("VALUE_MISMATCH", `${label}:${String(actual)}`);
}

function fail(code: string, detail: string): never {
  throw new Error(`PART_ONE_REQUIREMENT_DEPENDENCY_INVALID:${code}:${detail}`);
}
