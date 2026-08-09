from __future__ import annotations

import json
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def insert_before(text: str, marker: str, value: str, label: str) -> str:
    if value.strip() in text:
        return text
    index = text.find(marker)
    if index < 0:
        raise SystemExit(f"{label}: marker missing")
    return text[:index] + value.rstrip() + "\n\n" + text[index:]


def write_text(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Product types
# ---------------------------------------------------------------------------
path = Path("packages/templates/src/story-package/part-one-runtime-types.ts")
text = path.read_text(encoding="utf-8")
types = '''export type PartOneRequirementDependencyCondition = {
  allOf: PartOneStateRule[];
};

/**
 * Author-owned, world-agnostic ordering between two gameplay Requirements.
 * Runtime code treats every identifier as opaque and evaluates only typed
 * state rules plus the authoritative committed state.
 */
export type PartOneRequirementDependency = {
  schemaVersion: "requirement-dependency-v1";
  dependencyId: string;
  predecessorRequirementId: string;
  successorRequirementId: string;
  /**
   * Existing Kernels that are allowed to discharge the predecessor. This is
   * required when one bridge Kernel belongs to both Requirements, avoiding an
   * implicit array-order or Kernel-name interpretation in the generic core.
   */
  predecessorDecisionKernelIds?: string[];
  condition?: PartOneRequirementDependencyCondition;
};

export type PartOneSelectionRules = {
  schemaVersion: "requirement-selection-rules-v1";
  requirementDependencies: PartOneRequirementDependency[];
};'''
text = insert_before(
    text,
    "export type PartOneSectionContract = {",
    types,
    "requirement dependency types",
)
text = replace_once(
    text,
    '''    assets: number;
    requirements: number;
    sections: number;''',
    '''    assets: number;
    requirements: number;
    requirementDependencies: number;
    sections: number;''',
    "content count type",
)
text = replace_once(
    text,
    '''  requirements: Array<Record<string, unknown> & { requirementId: string; sectionIds: string[]; decisionKernelIds: string[]; runtimeAssetIds: string[] }>;
  approvedAdaptations:''',
    '''  requirements: Array<Record<string, unknown> & { requirementId: string; sectionIds: string[]; decisionKernelIds: string[]; runtimeAssetIds: string[] }>;
  selectionRules: PartOneSelectionRules;
  approvedAdaptations:''',
    "runtime package selection rules",
)
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Generic validator + runtime dependency resolution
# ---------------------------------------------------------------------------
write_text(
    "packages/templates/src/story-package/requirement-dependency.ts",
    r'''import { evaluatePartOneRule } from "./part-one-runtime-engine.js";
import type {
  PartOneRequirementDependency,
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneSectionContract,
  PartOneSelectionRules,
  PartOneState,
  PartOneStateRule,
} from "./part-one-runtime-types.js";

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
    normalized.push({
      schemaVersion: "requirement-dependency-v1",
      dependencyId,
      predecessorRequirementId,
      successorRequirementId,
      predecessorDecisionKernelIds: [...predecessorDecisionKernelIds].sort(),
      ...(condition ? { condition } : {}),
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
''',
)


# Export the product module.
path = Path("packages/templates/src/story-package/index.ts")
text = path.read_text(encoding="utf-8")
if 'export * from "./requirement-dependency";' not in text:
    text = text.rstrip() + '\nexport * from "./requirement-dependency";\n'
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Runtime package validation
# ---------------------------------------------------------------------------
path = Path("packages/templates/src/story-package/part-one-runtime-loader.ts")
text = path.read_text(encoding="utf-8")
text = insert_before(
    text,
    'import type { LoadedPartOneRuntimePackage, PartOneRuntimePackage } from "./part-one-runtime-types";',
    'import { validatePartOneSelectionRules } from "./requirement-dependency";',
    "loader dependency validator import",
)
needle = '''  text(worldStartScene.situation, "worldStart.state.scene.situation");
  equal(style.profileId, "STYLE-SANGTIAN-HISTORICAL-NOVEL", "styleProfile.profileId");'''
replacement = '''  text(worldStartScene.situation, "worldStart.state.scene.situation");
  const selectionRules = validatePartOneSelectionRules({
    selectionRules: value.selectionRules,
    requirements: requirements as unknown as PartOneRuntimePackage["requirements"],
    sections: sections as unknown as PartOneRuntimePackage["sections"],
    assets: assets as unknown as PartOneRuntimePackage["assets"],
    worldStartState: worldStartState as unknown as PartOneRuntimePackage["worldStart"]["state"],
  });
  count(
    counts.requirementDependencies,
    selectionRules.requirementDependencies.length,
    "requirementDependencies",
  );
  count(
    authoringManifest.requirementDependencyCount,
    selectionRules.requirementDependencies.length,
    "authoringManifest.requirementDependencyCount",
  );
  equal(style.profileId, "STYLE-SANGTIAN-HISTORICAL-NOVEL", "styleProfile.profileId");'''
text = replace_once(text, needle, replacement, "loader selection rules validation")
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Selector eligibility and dynamic runtime integration
# ---------------------------------------------------------------------------
path = Path("packages/templates/src/runtime-contract/kernel-selector-lite.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  structurallyResolved: boolean;
  unmetMustEstablishCount: number;''',
    '''  structurallyResolved: boolean;
  /** Validated Requirement graph rejected this candidate before scoring. */
  dependencyBlocked?: boolean;
  unmetMustEstablishCount: number;''',
    "selector dependency field",
)
text = replace_once(
    text,
    '''    if (candidate.structurallyResolved) reasons.push("OBLIGATION_ALREADY_SATISFIED");
    if (!pair) reasons.push("INSUFFICIENT_DISTINCT_OUTCOMES");
    const eligible = !candidate.completed
      && candidate.allowedInCurrentScope
      && !candidate.structurallyResolved
      && Boolean(pair);''',
    '''    if (candidate.structurallyResolved) reasons.push("OBLIGATION_ALREADY_SATISFIED");
    if (candidate.dependencyBlocked) reasons.push("REQUIREMENT_DEPENDENCY_BLOCKED");
    if (!pair) reasons.push("INSUFFICIENT_DISTINCT_OUTCOMES");
    const eligible = !candidate.completed
      && candidate.allowedInCurrentScope
      && !candidate.structurallyResolved
      && !candidate.dependencyBlocked
      && Boolean(pair);''',
    "selector dependency eligibility",
)
path.write_text(text, encoding="utf-8")

path = Path("packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts")
text = path.read_text(encoding="utf-8")
text = insert_before(
    text,
    'import {\n  buildPartOneRuntimeWorkingSet as buildLegacyWorkingSet,',
    'import { resolveRequirementDependencyBlock } from "./requirement-dependency.js";',
    "dynamic dependency import",
)
text = replace_once(
    text,
    '''        structurallyResolved: false,
        unmetMustEstablishCount: 0,''',
    '''        structurallyResolved: false,
        dependencyBlocked: false,
        unmetMustEstablishCount: 0,''',
    "safe candidate dependency default",
)
text = replace_once(
    text,
    '''  const recentRequirementContinuity = countRecentRequirementContinuity(
    pkg,
    state,
    kernel,
  );
  if (options.length < 2) rejectionCodes.push("KERNEL_OPTIONS_MISSING");''',
    '''  const recentRequirementContinuity = countRecentRequirementContinuity(
    pkg,
    state,
    kernel,
  );
  const dependencyBlock = resolveRequirementDependencyBlock(
    pkg,
    state,
    section,
    kernel,
  );
  rejectionCodes.push(...dependencyBlock.reasonCodes);
  if (options.length < 2) rejectionCodes.push("KERNEL_OPTIONS_MISSING");''',
    "runtime dependency resolution",
)
text = replace_once(
    text,
    '''      structurallyResolved:
        mustRules.length + exitRules.length > 0
        && unmetMust.length === 0
        && unmetExit.length === 0
        && pending.length === 0,
      unmetMustEstablishCount:''',
    '''      structurallyResolved:
        mustRules.length + exitRules.length > 0
        && unmetMust.length === 0
        && unmetExit.length === 0
        && pending.length === 0,
      dependencyBlocked: dependencyBlock.blocked,
      unmetMustEstablishCount:''',
    "runtime dependency candidate field",
)
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Authoring/compiler validation (Node-side, before immutable output)
# ---------------------------------------------------------------------------
write_text(
    "scripts/story-decomposition/lib/requirement-dependency.mjs",
    r'''const OPS = new Set(["EQ", "NEQ", "IN", "NOT_NULL", "ANY_PENDING"]);

export function validateRequirementSelectionRules(input) {
  const rules = record(input.selectionRules, "selectionRules");
  exact(rules.schemaVersion, "requirement-selection-rules-v1", "selectionRules.schemaVersion");
  const requirements = new Map(input.requirements.map((item) => [item.requirementId, item]));
  const kernelIds = new Set(input.kernelIds);
  const dependencyIds = new Set();
  const pairs = new Set();
  const dependencies = array(rules.requirementDependencies, "requirementDependencies").map((raw) => {
    const row = record(raw, "dependency");
    exact(row.schemaVersion, "requirement-dependency-v1", "dependency.schemaVersion");
    const dependencyId = requiredText(row.dependencyId, "dependencyId");
    const predecessorRequirementId = requiredText(row.predecessorRequirementId, `${dependencyId}.predecessorRequirementId`);
    const successorRequirementId = requiredText(row.successorRequirementId, `${dependencyId}.successorRequirementId`);
    if (dependencyIds.has(dependencyId)) fail("DUPLICATE_DEPENDENCY_ID", dependencyId);
    dependencyIds.add(dependencyId);
    if (predecessorRequirementId === successorRequirementId) fail("SELF_DEPENDENCY", dependencyId);
    const predecessor = requirements.get(predecessorRequirementId);
    const successor = requirements.get(successorRequirementId);
    if (!predecessor) fail("UNKNOWN_PREDECESSOR_REQUIREMENT", predecessorRequirementId);
    if (!successor) fail("UNKNOWN_SUCCESSOR_REQUIREMENT", successorRequirementId);
    const pair = `${predecessorRequirementId}->${successorRequirementId}`;
    const reverse = `${successorRequirementId}->${predecessorRequirementId}`;
    if (pairs.has(pair)) fail("DUPLICATE_DEPENDENCY", pair);
    if (pairs.has(reverse)) fail("CONFLICTING_DEPENDENCY", pair);
    pairs.add(pair);
    const sharedSections = input.sections.filter((section) => (
      section.requiredRequirementIds.includes(predecessorRequirementId)
      && section.requiredRequirementIds.includes(successorRequirementId)
      && predecessor.sectionIds.includes(section.sectionId)
      && successor.sectionIds.includes(section.sectionId)
    ));
    if (!sharedSections.length) fail("DEPENDENCY_HAS_NO_SHARED_SECTION", dependencyId);
    const explicit = row.predecessorDecisionKernelIds === undefined
      ? []
      : uniqueTextArray(row.predecessorDecisionKernelIds, `${dependencyId}.predecessorDecisionKernelIds`);
    const successorKernels = new Set(successor.decisionKernelIds);
    const derived = predecessor.decisionKernelIds.filter((id) => !successorKernels.has(id));
    const predecessorDecisionKernelIds = explicit.length ? explicit : derived;
    if (!predecessorDecisionKernelIds.length) fail("DEPENDENCY_HAS_NO_PREDECESSOR_KERNEL", dependencyId);
    for (const kernelId of predecessorDecisionKernelIds) {
      if (!kernelIds.has(kernelId)) fail("UNKNOWN_PREDECESSOR_KERNEL", `${dependencyId}:${kernelId}`);
      if (!predecessor.decisionKernelIds.includes(kernelId)) fail("PREDECESSOR_KERNEL_REQUIREMENT_MISMATCH", `${dependencyId}:${kernelId}`);
      if (!sharedSections.some((section) => section.activeDecisionKernelIds.includes(kernelId))) {
        fail("PREDECESSOR_KERNEL_OUTSIDE_SHARED_SECTION", `${dependencyId}:${kernelId}`);
      }
    }
    const effects = new Set(textArray(predecessor.stateEffects, `${predecessorRequirementId}.stateEffects`));
    const satisfactionRules = sharedSections.flatMap((section) => [
      ...section.mustEstablish,
      ...section.exitGates,
    ]).filter((rule) => effects.has(rule.statePath));
    if (!satisfactionRules.length) fail("UNSATISFIABLE_PREDECESSOR", dependencyId);
    const condition = row.condition === undefined
      ? undefined
      : validateCondition(row.condition, dependencyId, input.worldStartState);
    return {
      schemaVersion: "requirement-dependency-v1",
      dependencyId,
      predecessorRequirementId,
      successorRequirementId,
      predecessorDecisionKernelIds: [...predecessorDecisionKernelIds].sort(),
      ...(condition ? { condition } : {}),
    };
  });
  assertAcyclic(dependencies);
  return {
    schemaVersion: "requirement-selection-rules-v1",
    requirementDependencies: dependencies.sort((a, b) => a.dependencyId.localeCompare(b.dependencyId)),
  };
}

function validateCondition(value, dependencyId, worldStartState) {
  const allOf = array(record(value, `${dependencyId}.condition`).allOf, `${dependencyId}.condition.allOf`)
    .map((raw, index) => validateRule(raw, `${dependencyId}.condition.allOf[${index}]`, worldStartState));
  if (!allOf.length) fail("EMPTY_DEPENDENCY_CONDITION", dependencyId);
  const ids = new Set();
  for (const rule of allOf) {
    if (ids.has(rule.ruleId)) fail("DUPLICATE_CONDITION_RULE_ID", `${dependencyId}:${rule.ruleId}`);
    ids.add(rule.ruleId);
  }
  assertConditionSatisfiable(allOf, dependencyId);
  return { allOf };
}

function validateRule(value, label, worldStartState) {
  const row = record(value, label);
  const operator = requiredText(row.operator, `${label}.operator`);
  const statePath = requiredText(row.statePath, `${label}.statePath`);
  if (!OPS.has(operator)) fail("UNKNOWN_CONDITION_OPERATOR", `${label}:${operator}`);
  if (!hasPath(worldStartState, statePath)) fail("UNKNOWN_CONDITION_STATE_PATH", `${label}:${statePath}`);
  if (!("expectedValue" in row)) fail("CONDITION_EXPECTED_VALUE_MISSING", label);
  if (operator === "IN" && (!Array.isArray(row.expectedValue) || !row.expectedValue.length)) fail("CONDITION_IN_SET_EMPTY", label);
  if (operator === "NOT_NULL" && row.expectedValue !== true) fail("CONDITION_NOT_NULL_EXPECTS_TRUE", label);
  if (operator === "ANY_PENDING" && typeof row.expectedValue !== "boolean") fail("CONDITION_ANY_PENDING_EXPECTS_BOOLEAN", label);
  return {
    ruleId: requiredText(row.ruleId, `${label}.ruleId`),
    statePath,
    operator,
    expectedValue: row.expectedValue,
    description: requiredText(row.description, `${label}.description`),
  };
}

function assertConditionSatisfiable(rules, dependencyId) {
  const byPath = new Map();
  for (const rule of rules) {
    const group = byPath.get(rule.statePath) || [];
    group.push(rule);
    byPath.set(rule.statePath, group);
  }
  for (const [path, group] of byPath) {
    const equals = group.filter((rule) => rule.operator === "EQ");
    if (new Set(equals.map((rule) => JSON.stringify(rule.expectedValue))).size > 1) fail("IMPOSSIBLE_DEPENDENCY_CONDITION", `${dependencyId}:${path}`);
    const equal = equals[0];
    if (equal && group.some((rule) => rule.operator === "NEQ" && JSON.stringify(rule.expectedValue) === JSON.stringify(equal.expectedValue))) fail("IMPOSSIBLE_DEPENDENCY_CONDITION", `${dependencyId}:${path}`);
    if (equal && equal.expectedValue === null && group.some((rule) => rule.operator === "NOT_NULL")) fail("IMPOSSIBLE_DEPENDENCY_CONDITION", `${dependencyId}:${path}`);
    const inRules = group.filter((rule) => rule.operator === "IN");
    if (inRules.length > 1) {
      let intersection = new Set(inRules[0].expectedValue);
      for (const rule of inRules.slice(1)) intersection = new Set([...intersection].filter((item) => new Set(rule.expectedValue).has(item)));
      if (!intersection.size) fail("IMPOSSIBLE_DEPENDENCY_CONDITION", `${dependencyId}:${path}`);
    }
  }
}

function assertAcyclic(dependencies) {
  const edges = new Map();
  for (const dependency of dependencies) {
    const outgoing = edges.get(dependency.predecessorRequirementId) || [];
    outgoing.push(dependency.successorRequirementId);
    edges.set(dependency.predecessorRequirementId, outgoing);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path) => {
    if (visiting.has(id)) fail("DEPENDENCY_CYCLE", [...path, id].join("->"));
    if (visited.has(id)) return;
    visiting.add(id);
    for (const successor of edges.get(id) || []) visit(successor, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) visit(id, []);
}

function hasPath(value, path) {
  let current = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) return false;
    current = current[segment];
  }
  return true;
}
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("OBJECT_REQUIRED", label); return value; }
function array(value, label) { if (!Array.isArray(value)) fail("ARRAY_REQUIRED", label); return value; }
function requiredText(value, label) { if (typeof value !== "string" || !value.trim()) fail("TEXT_REQUIRED", label); return value.trim(); }
function textArray(value, label) { if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail("STRING_ARRAY_REQUIRED", label); return value; }
function uniqueTextArray(value, label) { const values = textArray(value, label).map((item) => item.trim()); if (values.some((item) => !item) || new Set(values).size !== values.length) fail("INVALID_UNIQUE_TEXT_ARRAY", label); return values; }
function exact(actual, expected, label) { if (actual !== expected) fail("VALUE_MISMATCH", `${label}:${String(actual)}`); }
function fail(code, detail) { throw new Error(`PART_ONE_REQUIREMENT_DEPENDENCY_INVALID:${code}:${detail}`); }
''',
)

path = Path("scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs")
text = path.read_text(encoding="utf-8")
text = insert_before(
    text,
    'const RELEASE_VERSION = ',
    'import { validateRequirementSelectionRules } from "./lib/requirement-dependency.mjs";',
    "compiler dependency import",
)
text = replace_once(
    text,
    'const RELEASE_VERSION = "sangtian-part-one-authoring-v1.3.0";',
    'const RELEASE_VERSION = "sangtian-part-one-authoring-v1.3.1";',
    "compiler release version",
)
text = replace_once(
    text,
    '''const sectionByRequirement = new Map(sections.flatMap((section) => section.requiredRequirementIds.map((id) => [id, section])));
const assets = [];''',
    '''const selectionRules = validateRequirementSelectionRules({
  selectionRules: requirementSet.selectionRules,
  requirements: requirementSet.requirements,
  sections,
  kernelIds: Object.keys(kernelOptions),
  worldStartState: worldStart.state,
});
const sectionByRequirement = new Map(sections.flatMap((section) => section.requiredRequirementIds.map((id) => [id, section])));
const assets = [];''',
    "compiler selection rule validation",
)
text = replace_once(
    text,
    '''  requirementCount: requirementSet.requirements.length,
  assetIds:''',
    '''  requirementCount: requirementSet.requirements.length,
  requirementDependencyCount: selectionRules.requirementDependencies.length,
  assetIds:''',
    "manifest dependency count",
)
text = replace_once(
    text,
    '''    requirements: requirementSet.requirements.length,
    sections: sections.length,''',
    '''    requirements: requirementSet.requirements.length,
    requirementDependencies: selectionRules.requirementDependencies.length,
    sections: sections.length,''',
    "runtime content dependency count",
)
text = replace_once(
    text,
    '''  requirements: requirementSet.requirements,
  approvedAdaptations:''',
    '''  requirements: requirementSet.requirements,
  selectionRules,
  approvedAdaptations:''',
    "runtime package selection rules",
)
path.write_text(text, encoding="utf-8")

# Keep the source generator authoritative for future rebuilds.
path = Path("scripts/story-decomposition/build-sangtian-part-one-authoring.mjs")
text = path.read_text(encoding="utf-8")
selection_rules_js = '''const selectionRules = {
  schemaVersion: "requirement-selection-rules-v1",
  requirementDependencies: [
    {
      schemaVersion: "requirement-dependency-v1",
      dependencyId: "REQDEP-P1-S2-REVIEW-BEFORE-CUSTODY",
      predecessorRequirementId: "REQ-P1-REVIEW-AUTHORITY",
      successorRequirementId: "REQ-P1-REGISTER-CUSTODY",
      predecessorDecisionKernelIds: ["DK-P1-REVIEW-AUTHORITY"],
    },
    {
      schemaVersion: "requirement-dependency-v1",
      dependencyId: "REQDEP-P1-S2-REVIEW-BEFORE-WITNESS",
      predecessorRequirementId: "REQ-P1-REVIEW-AUTHORITY",
      successorRequirementId: "REQ-P1-KNOWLEDGE-CHAIN",
      predecessorDecisionKernelIds: ["DK-P1-REVIEW-AUTHORITY"],
    },
  ],
};'''
text = insert_before(
    text,
    "const adaptations = [",
    selection_rules_js,
    "source selection rules",
)
text = replace_once(
    text,
    '''await writeJson(resolve(authoringRoot, "requirements/part-01.requirements.json"), { schemaVersion: "story-capability-requirement-set-v1", requirements });''',
    '''await writeJson(resolve(authoringRoot, "requirements/part-01.requirements.json"), {
  schemaVersion: "story-capability-requirement-set-v1",
  selectionRules,
  requirements,
});''',
    "source requirement set write",
)
path.write_text(text, encoding="utf-8")

# Update reviewed author asset directly. The immutable runtime package is
# regenerated by the workflow after this script finishes.
path = Path("packages/templates/authoring/sangtian/requirements/part-01.requirements.json")
data = json.loads(path.read_text(encoding="utf-8"))
data["selectionRules"] = {
    "schemaVersion": "requirement-selection-rules-v1",
    "requirementDependencies": [
        {
            "schemaVersion": "requirement-dependency-v1",
            "dependencyId": "REQDEP-P1-S2-REVIEW-BEFORE-CUSTODY",
            "predecessorRequirementId": "REQ-P1-REVIEW-AUTHORITY",
            "successorRequirementId": "REQ-P1-REGISTER-CUSTODY",
            "predecessorDecisionKernelIds": ["DK-P1-REVIEW-AUTHORITY"],
        },
        {
            "schemaVersion": "requirement-dependency-v1",
            "dependencyId": "REQDEP-P1-S2-REVIEW-BEFORE-WITNESS",
            "predecessorRequirementId": "REQ-P1-REVIEW-AUTHORITY",
            "successorRequirementId": "REQ-P1-KNOWLEDGE-CHAIN",
            "predecessorDecisionKernelIds": ["DK-P1-REVIEW-AUTHORITY"],
        },
    ],
}
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Neutral second-world tests and Sangtian integration tests
# ---------------------------------------------------------------------------
write_text(
    "packages/templates/tests/requirement-dependency.test.ts",
    r'''import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutcomeSignature,
  selectKernelLite,
  type KernelSelectorLiteCandidate,
} from "../src/runtime-contract/kernel-selector-lite.js";
import {
  resolveRequirementDependencyBlock,
  validatePartOneSelectionRules,
} from "../src/story-package/requirement-dependency.js";
import type {
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneSectionContract,
  PartOneState,
} from "../src/story-package/part-one-runtime-types.js";

const section: PartOneSectionContract = {
  schemaVersion: "section-contract-v1",
  sectionId: "section.neutral-port",
  partId: "PART-01",
  title: "Neutral Port",
  dramaticPurpose: "Resolve access before auditing cargo.",
  targetTurnWindow: { earliest: 1, latest: 8 },
  entryRequirements: [],
  requiredRequirementIds: ["req.port-access", "req.cargo-audit", "req.release"],
  activeDecisionKernelIds: ["kernel.port-access", "kernel.bridge", "kernel.cargo-audit", "kernel.release"],
  activeCausalArcIds: [],
  foregroundActorRefs: [],
  mustEstablish: [
    rule("must.access", "port.accessMode", "NEQ", "UNSET"),
    rule("must.audit", "cargo.auditStatus", "NEQ", "UNSET"),
    rule("must.release", "cargo.releaseStatus", "NEQ", "UNSET"),
  ],
  requiredMaterialChangeClasses: [],
  forbiddenEarlyReveals: [],
  allowedNextSectionIds: [],
  exitGates: [
    rule("exit.access", "port.accessMode", "NEQ", "UNSET"),
    rule("exit.audit", "cargo.auditStatus", "NEQ", "UNSET"),
    rule("exit.release", "cargo.releaseStatus", "NEQ", "UNSET"),
  ],
  floorObligationIds: [],
  handoffStatePaths: ["port.accessMode", "cargo.auditStatus", "cargo.releaseStatus"],
};

const requirements = [
  requirement("req.port-access", ["kernel.port-access", "kernel.bridge"], ["port.accessMode"]),
  requirement("req.cargo-audit", ["kernel.bridge", "kernel.cargo-audit"], ["cargo.auditStatus"]),
  requirement("req.release", ["kernel.release"], ["cargo.releaseStatus"]),
];

const assets = [
  kernel("kernel.port-access", ["req.port-access"]),
  kernel("kernel.bridge", ["req.port-access", "req.cargo-audit"]),
  kernel("kernel.cargo-audit", ["req.cargo-audit"]),
  kernel("kernel.release", ["req.release"]),
];

function rule(ruleId: string, statePath: string, operator: "EQ" | "NEQ", expectedValue: unknown) {
  return { ruleId, statePath, operator, expectedValue, description: ruleId };
}
function requirement(requirementId: string, decisionKernelIds: string[], stateEffects: string[]) {
  return {
    requirementId,
    sectionIds: [section.sectionId],
    decisionKernelIds,
    runtimeAssetIds: [],
    stateEffects,
  };
}
function kernel(assetId: string, requirementIds: string[]): PartOneRuntimeAsset {
  return {
    schemaVersion: "runtime-story-asset-v1",
    assetId,
    assetType: "DECISION_KERNEL",
    partIds: ["PART-01"],
    sectionIds: [section.sectionId],
    requirementIds,
    decisionKernelIds: [assetId],
    causalArcIds: [],
    actorRefs: [],
    stateDependencies: [],
    visibilityRules: [],
    sourceClaimIds: ["neutral-source"],
    adaptationDecisionIds: [],
    retrievalTags: [],
    payload: {},
  };
}
function state(accessMode = "UNSET", emergency = false): PartOneState {
  return {
    partId: "PART-01",
    sectionId: section.sectionId,
    turnNumber: 1,
    durableState: { predicates: [] },
    scene: {
      sceneId: "scene.neutral-port",
      timeLabel: "Day 1",
      locationLabel: "Port",
      presentActorRefs: [],
      situation: "Two obligations are simultaneously actionable.",
    },
    reform: { executionMode: "UNKNOWN", scopeStatus: "UNSET", progress: "NOT_STARTED" },
    review: { initiationStatus: "NOT_STARTED", authority: "UNDECIDED", procedureStatus: "UNSET" },
    evidence: { chainStatus: "UNKNOWN", primaryCustodianRef: null, copyStatus: "NONE", archiveSealStatus: "UNKNOWN" },
    witness: { accessStatus: "UNKNOWN" },
    grain: { immediatePressure: "STABLE", officialStockStatus: "UNKNOWN", reliefChannel: "UNDECIDED" },
    merchant: { entryStatus: "ABSENT", grantedRights: [] },
    land: { riskLevel: "UNKNOWN", safeguardStatus: "NONE" },
    report: { authorshipMode: "UNKNOWN", firstNarrativeController: "UNDECIDED", attachmentStrength: "NONE", dispatchStatus: "NOT_STARTED" },
    responsibility: { firstRecordStatus: "EMPTY", governorExposure: 0, xunfuExposure: 0 },
    relations: { governorXunfu: 0 },
    knowledgeTransfers: [],
    pendingConsequences: [],
    completedKernelIds: [],
    port: { accessMode, emergency },
    cargo: { auditStatus: "UNSET", releaseStatus: "UNSET" },
  } as unknown as PartOneState;
}
function selectionRules(condition?: unknown) {
  return {
    schemaVersion: "requirement-selection-rules-v1",
    requirementDependencies: [{
      schemaVersion: "requirement-dependency-v1",
      dependencyId: "dep.access-before-audit",
      predecessorRequirementId: "req.port-access",
      successorRequirementId: "req.cargo-audit",
      predecessorDecisionKernelIds: ["kernel.port-access"],
      ...(condition ? { condition } : {}),
    }],
  };
}
function validate(raw = selectionRules(), overrides: Partial<Parameters<typeof validatePartOneSelectionRules>[0]> = {}) {
  return validatePartOneSelectionRules({
    selectionRules: raw,
    requirements: requirements as PartOneRuntimePackage["requirements"],
    sections: [section],
    assets,
    worldStartState: state(),
    ...overrides,
  });
}
function pkg(rules = validate()): PartOneRuntimePackage {
  return {
    selectionRules: rules,
    requirements,
    sections: [section],
    assets,
  } as unknown as PartOneRuntimePackage;
}
function candidate(kernelId: string, dependencyBlocked: boolean): KernelSelectorLiteCandidate {
  const outcomes = ["LEFT", "RIGHT"].map((value, index) => ({
    affordanceId: `${kernelId}.${index}`,
    sourceOrder: index,
    outcome: createOutcomeSignature({
      affordanceId: `${kernelId}.${index}`,
      stateFeatures: [`state:choice=${JSON.stringify(value)}`],
      durablePredicateFeatures: [],
      pendingRuleFeatures: [],
      sectionAfter: section.sectionId,
      partCompletionStatusAfter: null,
    }),
    payload: null,
  }));
  return {
    kernelId,
    completed: false,
    allowedInCurrentScope: true,
    structurallyResolved: false,
    dependencyBlocked,
    unmetMustEstablishCount: 1,
    unmetExitGateCount: 1,
    duePressureCount: 0,
    pendingPressureCount: 0,
    activeArcCount: 0,
    availablePressureActorCount: 0,
    validAffordances: outcomes,
    rejectionCodes: [],
  };
}

test("neutral-port selects the predecessor regardless of candidate and asset order", () => {
  const packageValue = pkg();
  const current = state();
  const access = resolveRequirementDependencyBlock(packageValue, current, section, assets[0]!);
  const audit = resolveRequirementDependencyBlock(packageValue, current, section, assets[2]!);
  assert.equal(access.blocked, false);
  assert.equal(audit.blocked, true);
  const normal = selectKernelLite([
    candidate("kernel.cargo-audit", audit.blocked),
    candidate("kernel.port-access", access.blocked),
  ], "NEUTRAL-PORT");
  const reversed = selectKernelLite([
    candidate("kernel.port-access", access.blocked),
    candidate("kernel.cargo-audit", audit.blocked),
  ], "NEUTRAL-PORT");
  assert.equal(normal.selected?.kernelId, "kernel.port-access");
  assert.equal(reversed.selected?.kernelId, "kernel.port-access");

  const reorderedPackage = pkg(validate(selectionRules(), {
    requirements: [...requirements].reverse() as PartOneRuntimePackage["requirements"],
    sections: [{ ...section, activeDecisionKernelIds: [...section.activeDecisionKernelIds].reverse() }],
    assets: [...assets].reverse(),
  }));
  assert.equal(
    resolveRequirementDependencyBlock(
      reorderedPackage,
      current,
      reorderedPackage.sections[0]!,
      reorderedPackage.assets.find((item) => item.assetId === "kernel.cargo-audit")!,
    ).blocked,
    true,
  );
});

test("typed dependency condition activates and deactivates from authoritative state", () => {
  const conditional = selectionRules({
    allOf: [{
      ruleId: "condition.emergency",
      statePath: "port.emergency",
      operator: "EQ",
      expectedValue: true,
      description: "Emergency protocol is active.",
    }],
  });
  const packageValue = pkg(validate(conditional));
  const auditKernel = assets.find((item) => item.assetId === "kernel.cargo-audit")!;
  assert.equal(
    resolveRequirementDependencyBlock(packageValue, state("UNSET", true), section, auditKernel).blocked,
    true,
  );
  assert.equal(
    resolveRequirementDependencyBlock(packageValue, state("UNSET", false), section, auditKernel).blocked,
    false,
  );
});

test("two simultaneously valid Requirements release the successor after authoritative satisfaction", () => {
  const packageValue = pkg();
  const auditKernel = assets.find((item) => item.assetId === "kernel.cargo-audit")!;
  assert.equal(resolveRequirementDependencyBlock(packageValue, state("UNSET"), section, auditKernel).blocked, true);
  assert.equal(resolveRequirementDependencyBlock(packageValue, state("AUTHORIZED"), section, auditKernel).blocked, false);
});

test("invalid references and self dependencies are rejected", () => {
  const unknown = structuredClone(selectionRules());
  unknown.requirementDependencies[0]!.successorRequirementId = "req.unknown";
  assert.throws(() => validate(unknown), /UNKNOWN_SUCCESSOR_REQUIREMENT/);
  const self = structuredClone(selectionRules());
  self.requirementDependencies[0]!.successorRequirementId = "req.port-access";
  assert.throws(() => validate(self), /SELF_DEPENDENCY/);
});

test("duplicate, conflicting, impossible and cyclic dependencies are rejected", () => {
  const duplicate = structuredClone(selectionRules());
  duplicate.requirementDependencies.push({
    ...duplicate.requirementDependencies[0]!,
    dependencyId: "dep.duplicate",
  });
  assert.throws(() => validate(duplicate), /DUPLICATE_DEPENDENCY/);

  const conflict = structuredClone(selectionRules());
  conflict.requirementDependencies.push({
    schemaVersion: "requirement-dependency-v1",
    dependencyId: "dep.reverse",
    predecessorRequirementId: "req.cargo-audit",
    successorRequirementId: "req.port-access",
    predecessorDecisionKernelIds: ["kernel.cargo-audit"],
  });
  assert.throws(() => validate(conflict), /CONFLICTING_DEPENDENCY/);

  const impossible = selectionRules({
    allOf: [
      rule("condition.one", "port.accessMode", "EQ", "A"),
      rule("condition.two", "port.accessMode", "EQ", "B"),
    ],
  });
  assert.throws(() => validate(impossible), /IMPOSSIBLE_DEPENDENCY_CONDITION/);

  const cycle = {
    schemaVersion: "requirement-selection-rules-v1",
    requirementDependencies: [
      {
        schemaVersion: "requirement-dependency-v1",
        dependencyId: "dep.a-b",
        predecessorRequirementId: "req.port-access",
        successorRequirementId: "req.cargo-audit",
        predecessorDecisionKernelIds: ["kernel.port-access"],
      },
      {
        schemaVersion: "requirement-dependency-v1",
        dependencyId: "dep.b-c",
        predecessorRequirementId: "req.cargo-audit",
        successorRequirementId: "req.release",
        predecessorDecisionKernelIds: ["kernel.cargo-audit"],
      },
      {
        schemaVersion: "requirement-dependency-v1",
        dependencyId: "dep.c-a",
        predecessorRequirementId: "req.release",
        successorRequirementId: "req.port-access",
        predecessorDecisionKernelIds: ["kernel.release"],
      },
    ],
  };
  assert.throws(() => validate(cycle), /DEPENDENCY_CYCLE/);
});
''',
)

# Add the neutral test to the actual package gate.
path = Path("packages/templates/package.json")
data = json.loads(path.read_text(encoding="utf-8"))
command = data["scripts"]["test:story-package"]
neutral_test = "tests/requirement-dependency.test.ts"
if neutral_test not in command:
    command = command.replace(
        "tests/story-package.test.ts",
        f"tests/story-package.test.ts {neutral_test}",
        1,
    )
data["scripts"]["test:story-package"] = command
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Sangtian integration: both obligations are legal, but the validated graph
# admits Review Authority first and remains invariant to every authored array.
path = Path("packages/templates/tests/part-one-dynamic-kernel-lite.test.ts")
text = path.read_text(encoding="utf-8")
name = "validated Requirement dependencies choose review authority before witness access"
if name not in text:
    test_case = r'''test("validated Requirement dependencies choose review authority before witness access", () => {
  const pkg = structuredClone(packageUnderTest());
  const state = createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 3;
  state.sectionTurnNumber = 0;
  state.completedKernelIds = [
    "DK-P1-REVIEW-INITIATION",
    "DK-P1-EXECUTION-SCOPE",
    "DK-P1-RESPONSIBILITY-RECORD",
  ];
  state.review.authority = "UNDECIDED";
  state.review.procedureStatus = "UNSET";
  state.evidence.chainStatus = "UNKNOWN";
  state.evidence.primaryCustodianRef = null;
  state.evidence.copyStatus = "NONE";
  state.evidence.archiveSealStatus = "UNKNOWN";
  state.witness.accessStatus = "UNKNOWN";
  state.pendingConsequences = [];

  const normal = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 3);
  assert.equal(normal.openDecisionKernel.assetId, "DK-P1-REVIEW-AUTHORITY");
  const witness = normal.kernelSelection.candidates.find((candidate) => (
    candidate.kernelId === "DK-P1-WITNESS-ACCESS"
  ));
  assert.ok(witness);
  assert.equal(witness.eligible, false);
  assert.equal(
    witness.reasonCodes.some((code) => (
      code.startsWith("REQUIREMENT_DEPENDENCY_BLOCKED:")
    )),
    true,
  );

  const reversed = structuredClone(pkg);
  reversed.requirements.reverse();
  reversed.selectionRules.requirementDependencies.reverse();
  reversed.assets.reverse();
  reversed.sections = reversed.sections.map((section) => ({
    ...section,
    activeDecisionKernelIds: [...section.activeDecisionKernelIds].reverse(),
    requiredRequirementIds: [...section.requiredRequirementIds].reverse(),
  }));
  const reordered = buildDynamicPartOneRuntimeWorkingSet(reversed, state, 3);
  assert.equal(reordered.openDecisionKernel.assetId, normal.openDecisionKernel.assetId);
  assert.deepEqual(
    reordered.decisionAffordances.map((item) => item.affordanceTemplateId),
    normal.decisionAffordances.map((item) => item.affordanceTemplateId),
  );
});'''
    text = text.rstrip() + "\n\n" + test_case + "\n"
path.write_text(text, encoding="utf-8")

# App-level production test proves the public runtime entry consumes the
# tracked package contract, rather than only a private package-unit helper.
write_text(
    "apps/openovel-runtime/tests/requirement-dependency-production.spec.ts",
    r'''import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPartOneRuntimeWorkingSet,
  createInitialPartOneState,
  loadPartOneRuntimePackage,
  partOneSceneForSection,
} from "@ai-story/templates";

test("production runtime honors the tracked Requirement dependency graph", () => {
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const state = createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 3;
  state.sectionTurnNumber = 0;
  state.completedKernelIds = [
    "DK-P1-REVIEW-INITIATION",
    "DK-P1-EXECUTION-SCOPE",
    "DK-P1-RESPONSIBILITY-RECORD",
  ];
  state.review.authority = "UNDECIDED";
  state.review.procedureStatus = "UNSET";
  state.evidence.chainStatus = "UNKNOWN";
  state.evidence.primaryCustodianRef = null;
  state.witness.accessStatus = "UNKNOWN";
  state.pendingConsequences = [];

  const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, 3);
  assert.equal(
    workingSet.openDecisionKernel.assetId,
    "DK-P1-REVIEW-AUTHORITY",
  );
  assert.equal(
    pkg.selectionRules.requirementDependencies.some((dependency) => (
      dependency.predecessorRequirementId === "REQ-P1-REVIEW-AUTHORITY"
      && dependency.successorRequirementId === "REQ-P1-KNOWLEDGE-CHAIN"
    )),
    true,
  );
});
''',
)
path = Path("apps/openovel-runtime/package.json")
data = json.loads(path.read_text(encoding="utf-8"))
app_test = "tests/requirement-dependency-production.spec.ts"
if app_test not in data["scripts"]["test"]:
    data["scripts"]["test"] += f" {app_test}"
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("tracked Requirement dependency product changes staged")
