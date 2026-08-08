from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("packages/templates/src/story-package/requirement-dependency.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  candidateRequirementIds: string[];
  evaluateRule: (state: PartOneState, rule: PartOneStateRule) => boolean;
};''',
    '''  candidateRequirementIds: string[];
  completedKernelIds?: string[];
  successorHasDuePressure?: boolean;
  evaluateRule: (state: PartOneState, rule: PartOneStateRule) => boolean;
};''',
    "dependency blocking input extension",
)
text = replace_once(
    text,
    '''  for (const dependency of input.dependencies) {
    if (!candidateRequirements.has(dependency.successorRequirementId)) {
      continue;
    }
    const predecessor = requirements.get(''',
    '''  for (const dependency of input.dependencies) {
    if (!candidateRequirements.has(dependency.successorRequirementId)) {
      continue;
    }
    // A bridge Kernel that owns both sides may satisfy the predecessor while
    // answering the successor. Blocking it would manufacture a deadlock.
    if (candidateRequirements.has(dependency.predecessorRequirementId)) {
      continue;
    }
    // An already-due consequence is authoritative causal debt. It may preempt
    // ordinary Requirement ordering, while pending/non-due pressure may not.
    if (input.successorHasDuePressure === true) continue;
    const predecessor = requirements.get(''',
    "bridge and due-pressure semantics",
)
text = replace_once(
    text,
    '''    const conditionMatches = (dependency.condition?.allOf || [])
      .every((rule) => input.evaluateRule(input.state, rule));
    if (!conditionMatches) continue;

    const resolutionRules = requirementResolutionRules(''',
    '''    const conditionMatches = (dependency.condition?.allOf || [])
      .every((rule) => input.evaluateRule(input.state, rule));
    if (!conditionMatches) continue;

    const completedKernelIds = new Set(input.completedKernelIds || []);
    const predecessorHasOpenRoute = stringArray(predecessor.decisionKernelIds)
      .some((kernelId) => (
        input.section.activeDecisionKernelIds.includes(kernelId)
        && !completedKernelIds.has(kernelId)
      ));
    if (!predecessorHasOpenRoute) continue;

    const resolutionRules = requirementResolutionRules(''',
    "predecessor open route semantics",
)
path.write_text(text, encoding="utf-8")

path = Path("packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  return blockingRequirementDependencyIds({
    dependencies: pkg.requirementDependencies,
    requirements: pkg.requirements,
    section,
    state,
    candidateRequirementIds: kernel.requirementIds,
    evaluateRule: evaluatePartOneRule,
  });''',
    '''  const nextTurn = Number(state.turnNumber || 0) + 1;
  const successorHasDuePressure = linkedPending(pkg, state, kernel)
    .some((item) => item.dueTurn <= nextTurn);
  return blockingRequirementDependencyIds({
    dependencies: pkg.requirementDependencies,
    requirements: pkg.requirements,
    section,
    state,
    candidateRequirementIds: kernel.requirementIds,
    completedKernelIds: state.completedKernelIds,
    successorHasDuePressure,
    evaluateRule: evaluatePartOneRule,
  });''',
    "runtime dependency context",
)
path.write_text(text, encoding="utf-8")

path = Path("packages/templates/tests/requirement-dependency.test.ts")
text = path.read_text(encoding="utf-8")
marker = '''test("neutral dependency evaluation is invariant to Requirement, dependency and Section asset order", () => {'''
insert = '''test("a bridge candidate and a directly due successor pressure may bypass ordinary dependency order", () => {
  const fixture = neutralPortFixture();
  assert.deepEqual(blockingRequirementDependencyIds({
    dependencies: fixture.dependencies,
    requirements: fixture.requirements,
    section: fixture.section,
    state: fixture.state,
    candidateRequirementIds: ["req.port-access", "req.cargo-audit"],
    evaluateRule,
  }), []);
  assert.deepEqual(blockingRequirementDependencyIds({
    dependencies: fixture.dependencies,
    requirements: fixture.requirements,
    section: fixture.section,
    state: fixture.state,
    candidateRequirementIds: ["req.cargo-audit"],
    successorHasDuePressure: true,
    evaluateRule,
  }), []);
});

test("a dependency releases when no unresolved Kernel can still satisfy its predecessor", () => {
  const fixture = neutralPortFixture();
  assert.deepEqual(blockingRequirementDependencyIds({
    dependencies: fixture.dependencies,
    requirements: fixture.requirements,
    section: fixture.section,
    state: fixture.state,
    candidateRequirementIds: ["req.cargo-audit"],
    completedKernelIds: ["kernel.port-access"],
    evaluateRule,
  }), []);
});

'''
if marker not in text:
    raise SystemExit("neutral dependency test insertion point missing")
text = text.replace(marker, insert + marker, 1)
path.write_text(text.rstrip() + "\n", encoding="utf-8")
