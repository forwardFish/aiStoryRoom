const BYPASSES = new Set(["DIRECT_DUE_PRESSURE"]);

const OPS = new Set(["EQ", "NEQ", "IN", "NOT_NULL", "ANY_PENDING"]);

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
    const bypassWhen = row.bypassWhen === undefined
      ? []
      : uniqueTextArray(row.bypassWhen, `${dependencyId}.bypassWhen`);
    for (const bypass of bypassWhen) {
      if (!BYPASSES.has(bypass)) fail("UNKNOWN_DEPENDENCY_BYPASS", `${dependencyId}:${bypass}`);
    }
    return {
      schemaVersion: "requirement-dependency-v1",
      dependencyId,
      predecessorRequirementId,
      successorRequirementId,
      predecessorDecisionKernelIds: [...predecessorDecisionKernelIds].sort(),
      ...(condition ? { condition } : {}),
      ...(bypassWhen.length ? { bypassWhen: [...bypassWhen].sort() } : {}),
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
