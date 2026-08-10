from pathlib import Path

source_path = Path(".github/repair/settled-reaction-contract-v2.py")
source = source_path.read_text(encoding="utf-8")
source = source.replace(
    '''def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)
''',
    '''def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if label == "narrative plan contract inputs" and count >= 1:
        return text.replace(old, new, 1)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)
''',
    1,
)

purpose_start = "# Dynamic selection purpose: RequirementDependency gates next decision only"
purpose_end = "# Current reaction planner and next decision planner remain independent"
start = source.find(purpose_start)
end = source.find(purpose_end, start)
if start < 0 or end < 0:
    raise SystemExit("settled reaction purpose section markers missing")

purpose_replacement = r"""# Dynamic selection purpose: dependencies gate next decisions, not reactions.
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
source = source[:start] + purpose_replacement + source[end:]

narrative_start = "# Narrative-plan contract fields."
narrative_end = "# Replace hard Kernel-only provenance with Kernel or structured unbound source."
start = source.find(narrative_start)
end = source.find(narrative_end, start)
if start < 0 or end < 0:
    raise SystemExit("narrative wiring section markers missing")

narrative_replacement = r"""# Narrative-plan and next-beat contracts are wired by function boundary.
def replace_in_function(
    value: str,
    function_name: str,
    next_function_name: str,
    old: str,
    new: str,
    label: str,
) -> str:
    begin = value.find(f"function {function_name}(")
    finish = value.find(f"function {next_function_name}(", begin + 1)
    if begin < 0 or finish < 0:
        raise SystemExit(f"{label}: function boundary missing")
    segment = value[begin:finish]
    count = segment.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match in {function_name}, found {count}")
    return value[:begin] + segment.replace(old, new, 1) + value[finish:]

text = replace_in_function(
    text,
    "buildNarrativePlan",
    "buildNextStoryBeat",
    '''  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];''',
    '''  authoritativeObservableFacts: string[];
  settledReactionContract: PartOneSettledReactionContract | null;
  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];''',
    "buildNarrativePlan input contract",
)
text = replace_in_function(
    text,
    "buildNarrativePlan",
    "buildNextStoryBeat",
    '''    authoritativeObservableFacts: input.authoritativeObservableFacts,
    authoritativeNpcReactions: input.authoritativeNpcReactions,''',
    '''    authoritativeObservableFacts: input.authoritativeObservableFacts,
    settledReactionContract: input.settledReactionContract,
    unboundActionNarrativeSource: input.unboundActionNarrativeSource,
    authoritativeNpcReactions: input.authoritativeNpcReactions,''',
    "buildNextStoryBeat call contract",
)
text = replace_in_function(
    text,
    "buildNextStoryBeat",
    "renderPlayerVisibleSceneContext",
    '''  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];''',
    '''  authoritativeObservableFacts: string[];
  settledReactionContract: PartOneSettledReactionContract | null;
  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];''',
    "buildNextStoryBeat input contract",
)
path.write_text(text, encoding="utf-8")


"""
source = source[:start] + narrative_replacement + source[end:]
exec(compile(source, str(source_path), "exec"), {"__name__": "__main__"})
