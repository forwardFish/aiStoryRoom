from pathlib import Path

source_path = Path(".github/repair/settled-reaction-contract-v2.py")
source = source_path.read_text(encoding="utf-8")
start_marker = "# Dynamic selection purpose: RequirementDependency gates next decision only"
end_marker = "# Current reaction planner and next decision planner remain independent"
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("settled reaction purpose section markers missing")

replacement = r"""# Dynamic selection purpose: dependencies gate next decisions, not reactions.
path = Path("packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts")
text = path.read_text(encoding="utf-8")
if 'purpose?: "NEXT_DECISION" | "REACTION_PROJECTION";' not in text:
    text = replace_once(
        text,
        '''export type PartOneWorkingSetSelectionOptions = {
  mode?: PartOneKernelSelectionMode;
  pin?: PartOneDecisionPin | null;
};''',
        '''export type PartOneWorkingSetSelectionOptions = {
  mode?: PartOneKernelSelectionMode;
  pin?: PartOneDecisionPin | null;
  purpose?: "NEXT_DECISION" | "REACTION_PROJECTION";
};''',
        "working set purpose",
    )
    text = replace_once(
        text,
        '''  const evaluated = unresolved.map((kernelId) => evaluateKernelSafely(
    pkg,
    state,
    section,
    kernelId,
    turnNumber,
  ));''',
        '''  const enforceRequirementDependencies =
    options.purpose !== "REACTION_PROJECTION";
  const evaluated = unresolved.map((kernelId) => evaluateKernelSafely(
    pkg,
    state,
    section,
    kernelId,
    turnNumber,
    enforceRequirementDependencies,
  ));''',
        "purpose-aware candidate evaluation",
    )
    text = replace_once(
        text,
        '''  kernelId: string,
  turnNumber: number,
): Evaluation {
  try {
    return evaluateKernel(pkg, state, section, kernelId, turnNumber);''',
        '''  kernelId: string,
  turnNumber: number,
  enforceRequirementDependencies = true,
): Evaluation {
  try {
    return evaluateKernel(
      pkg,
      state,
      section,
      kernelId,
      turnNumber,
      enforceRequirementDependencies,
    );''',
        "safe evaluation purpose",
    )
    text = replace_once(
        text,
        '''  kernelId: string,
  turnNumber: number,
): Evaluation {
  const kernel = requireKernel(pkg, kernelId);''',
        '''  kernelId: string,
  turnNumber: number,
  enforceRequirementDependencies = true,
): Evaluation {
  const kernel = requireKernel(pkg, kernelId);''',
        "evaluation purpose",
    )
    text = replace_once(
        text,
        '''  const dependencyBlock = resolveRequirementDependencyBlock(
    pkg,
    state,
    section,
    kernel,
    { directDuePressureCount },
  );
  rejectionCodes.push(...dependencyBlock.reasonCodes);''',
        '''  const dependencyBlock = enforceRequirementDependencies
    ? resolveRequirementDependencyBlock(
      pkg,
      state,
      section,
      kernel,
      { directDuePressureCount },
    )
    : { blocked: false, dependencyIds: [], reasonCodes: [] };
  rejectionCodes.push(...dependencyBlock.reasonCodes);''',
        "purpose-aware dependency gate",
    )
path.write_text(text, encoding="utf-8")


"""
patched = source[:start] + replacement + source[end:]
exec(compile(patched, str(source_path), "exec"), {"__name__": "__main__"})
