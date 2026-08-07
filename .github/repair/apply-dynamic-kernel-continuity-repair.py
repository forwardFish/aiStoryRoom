from pathlib import Path


def replace_between(
    text: str,
    start_marker: str,
    end_marker: str,
    replacement: str,
) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"start marker missing: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"end marker missing: {end_marker}")
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


core = Path("packages/templates/src/runtime-contract/kernel-selector-lite.ts")
text = core.read_text(encoding="utf-8")
weight_needle = '  EXCLUSIVE_OBLIGATION: 15,\n'
if 'RECENT_REQUIREMENT_LINK' not in text:
    if weight_needle not in text:
        raise SystemExit("continuity weight insertion point missing")
    text = text.replace(
        weight_needle,
        weight_needle
        + '  RECENT_REQUIREMENT_LINK: 18,\n'
        + '  RECENT_ARC_LINK: 2,\n',
        1,
    )
field_needle = '  exclusiveObligationCount?: number;\n'
if 'recentRequirementLinkCount?: number;' not in text:
    if field_needle not in text:
        raise SystemExit("continuity field insertion point missing")
    text = text.replace(
        field_needle,
        field_needle
        + '  recentRequirementLinkCount?: number;\n'
        + '  recentArcLinkCount?: number;\n',
        1,
    )
score = '''export function scoreKernelCandidate(
  candidate: KernelSelectorLiteCandidate,
): number {
  return candidate.duePressureCount * KERNEL_SELECTOR_LITE_WEIGHTS.DUE_PRESSURE
    + candidate.unmetExitGateCount * KERNEL_SELECTOR_LITE_WEIGHTS.UNMET_EXIT_GATE
    + candidate.unmetMustEstablishCount * KERNEL_SELECTOR_LITE_WEIGHTS.UNMET_MUST_ESTABLISH
    + candidate.pendingPressureCount * KERNEL_SELECTOR_LITE_WEIGHTS.PENDING_PRESSURE
    + candidate.activeArcCount * KERNEL_SELECTOR_LITE_WEIGHTS.ACTIVE_ARC
    + Math.min(candidate.availablePressureActorCount, 3)
      * KERNEL_SELECTOR_LITE_WEIGHTS.PRESENT_PRESSURE_ACTOR
    + (candidate.exclusiveObligationCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.EXCLUSIVE_OBLIGATION
    + (candidate.recentRequirementLinkCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.RECENT_REQUIREMENT_LINK
    + (candidate.recentArcLinkCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.RECENT_ARC_LINK;
}'''
text = replace_between(
    text,
    'export function scoreKernelCandidate(',
    'export function selectKernelLite<',
    score,
)
core.write_text(text, encoding="utf-8")

runtime = Path(
    "packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts",
)
text = runtime.read_text(encoding="utf-8")
present_needle = '''  const present = new Set(state.scene?.presentActorRefs || []);
  if (options.length < 2) rejectionCodes.push("KERNEL_OPTIONS_MISSING");'''
present_replacement = '''  const present = new Set(state.scene?.presentActorRefs || []);
  const recentLinks = recentCausalContinuity(pkg, state, kernel);
  if (options.length < 2) rejectionCodes.push("KERNEL_OPTIONS_MISSING");'''
if present_needle not in text:
    raise SystemExit("recent continuity call insertion point missing")
text = text.replace(present_needle, present_replacement, 1)
field_needle = '''      exclusiveObligationCount: [...unmetMust, ...unmetExit]
        .filter((rule) => (
          obligationOwnership.exclusivePaths.has(rule.statePath)
        )).length,
      validAffordances: previews.map((preview) => ({'''
field_replacement = '''      exclusiveObligationCount: [...unmetMust, ...unmetExit]
        .filter((rule) => (
          obligationOwnership.exclusivePaths.has(rule.statePath)
        )).length,
      recentRequirementLinkCount: recentLinks.requirementCount,
      recentArcLinkCount: recentLinks.arcCount,
      validAffordances: previews.map((preview) => ({'''
if field_needle not in text:
    raise SystemExit("recent continuity candidate insertion point missing")
text = text.replace(field_needle, field_replacement, 1)
function = '''/**
 * Preserve causal continuity without consulting authored array position or
 * prose. The most recently completed Kernel is a structural fact of the run;
 * shared Requirement and Arc links indicate which unresolved conflicts are a
 * direct continuation of the player's preceding decision.
 */
function recentCausalContinuity(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  kernel: PartOneRuntimeAsset,
) {
  const recentKernelId = [...(state.completedKernelIds || [])].at(-1);
  if (!recentKernelId) return { requirementCount: 0, arcCount: 0 };
  const recent = pkg.assets.find((asset) => (
    asset.assetId === recentKernelId
    && asset.assetType === "DECISION_KERNEL"
  ));
  if (!recent) return { requirementCount: 0, arcCount: 0 };
  const requirements = new Set(recent.requirementIds);
  const arcs = new Set(recent.causalArcIds);
  return {
    requirementCount: kernel.requirementIds.filter(
      (requirementId) => requirements.has(requirementId),
    ).length,
    arcCount: kernel.causalArcIds.filter((arcId) => arcs.has(arcId)).length,
  };
}'''
marker = 'function selectAffordances('
index = text.find(marker)
if index < 0:
    raise SystemExit("recent continuity function insertion point missing")
text = text[:index] + function + "\n\n" + text[index:]
runtime.write_text(text, encoding="utf-8")

tests = Path("packages/templates/tests/kernel-selector-lite.test.ts")
text = tests.read_text(encoding="utf-8")
if "recent structural Requirement links preserve causal continuity" not in text:
    marker = (
        'test("exclusive obligation ownership outranks otherwise equal shared capability", '
        '() => {'
    )
    index = text.find(marker)
    if index < 0:
        raise SystemExit("continuity test insertion point missing")
    test_case = '''test("recent structural Requirement links preserve causal continuity", () => {
  const [base] = neutralCandidates();
  assert.ok(base);
  const unrelated = structuredClone(base);
  unrelated.kernelId = "kernel.unrelated";
  const linked = structuredClone(base);
  linked.kernelId = "kernel.causally-linked";
  linked.recentRequirementLinkCount = 1;
  const normal = selectKernelLite([unrelated, linked], "STATE-CONTINUITY");
  const reversed = selectKernelLite([linked, unrelated], "STATE-CONTINUITY");
  assert.equal(normal.selected?.kernelId, linked.kernelId);
  assert.equal(reversed.selected?.kernelId, linked.kernelId);
});

'''
    text = text[:index] + test_case + text[index:]
tests.write_text(text, encoding="utf-8")
