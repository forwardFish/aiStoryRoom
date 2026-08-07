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
weight_needle = "  RECENT_ARC_LINK: 2,\n"
if "OBLIGATION_BREADTH_PENALTY" not in text:
    if weight_needle not in text:
        raise SystemExit("obligation breadth weight insertion point missing")
    text = text.replace(
        weight_needle,
        weight_needle + "  OBLIGATION_BREADTH_PENALTY: 20,\n",
        1,
    )
score = '''export function scoreKernelCandidate(
  candidate: KernelSelectorLiteCandidate,
): number {
  const obligationSpan = Math.max(
    candidate.unmetExitGateCount,
    candidate.unmetMustEstablishCount,
  );
  return (candidate.duePressureCount
      * KERNEL_SELECTOR_LITE_WEIGHTS.DUE_PRESSURE)
    + (candidate.unmetExitGateCount > 0
      ? KERNEL_SELECTOR_LITE_WEIGHTS.UNMET_EXIT_GATE
      : 0)
    + (candidate.unmetMustEstablishCount > 0
      ? KERNEL_SELECTOR_LITE_WEIGHTS.UNMET_MUST_ESTABLISH
      : 0)
    + (candidate.pendingPressureCount
      * KERNEL_SELECTOR_LITE_WEIGHTS.PENDING_PRESSURE)
    + (candidate.activeArcCount
      * KERNEL_SELECTOR_LITE_WEIGHTS.ACTIVE_ARC)
    + (Math.min(candidate.availablePressureActorCount, 3)
      * KERNEL_SELECTOR_LITE_WEIGHTS.PRESENT_PRESSURE_ACTOR)
    + ((candidate.exclusiveObligationCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.EXCLUSIVE_OBLIGATION)
    + ((candidate.recentRequirementLinkCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.RECENT_REQUIREMENT_LINK)
    + ((candidate.recentArcLinkCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.RECENT_ARC_LINK)
    - (Math.max(0, obligationSpan - 1)
      * KERNEL_SELECTOR_LITE_WEIGHTS.OBLIGATION_BREADTH_PENALTY);
}'''
text = replace_between(
    text,
    "export function scoreKernelCandidate(",
    "export function selectKernelLite<",
    score,
)
core.write_text(text, encoding="utf-8")

engine = Path(
    "packages/templates/src/story-package/part-one-runtime-engine.ts",
)
text = engine.read_text(encoding="utf-8")
call_needle = '''    decisionKernelId: input.decisionKernelId,
    actionText: input.action.actionText,'''
call_replacement = '''    decisionKernelId: input.decisionKernelId,
    actionSource: input.action.source,
    actionText: input.action.actionText,'''
if call_needle not in text:
    raise SystemExit("buildNextStoryBeat call insertion point missing")
text = text.replace(call_needle, call_replacement, 1)
start = text.find("function buildNextStoryBeat(")
if start < 0:
    raise SystemExit("buildNextStoryBeat start missing")
end = text.find("\nfunction ", start + 1)
if end < 0:
    raise SystemExit("buildNextStoryBeat end missing")
segment = text[start:end]
type_needle = '''  decisionKernelId: string | null;
  actionText: string;'''
type_replacement = '''  decisionKernelId: string | null;
  actionSource: PartOneIncomingAction["source"];
  actionText: string;'''
if type_needle not in segment:
    raise SystemExit("buildNextStoryBeat input type insertion point missing")
segment = segment.replace(type_needle, type_replacement, 1)
segment = segment.replace(
    "input.decisionKernelId",
    "narrativeKernelId",
)
guard = '''  if (!narrativeKernelId) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");
  }'''
replacement = '''  const narrativeKernelId = input.decisionKernelId
    || (input.actionSource === "CUSTOM"
      ? input.nextDecisionPoint.decisionKernelId
      : null);
  if (!narrativeKernelId) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");
  }'''
if guard not in segment:
    raise SystemExit("buildNextStoryBeat guard replacement missing")
segment = segment.replace(guard, replacement, 1)
text = text[:start] + segment + text[end:]
engine.write_text(text, encoding="utf-8")

tests = Path("packages/templates/tests/kernel-selector-lite.test.ts")
text = tests.read_text(encoding="utf-8")
name = "a focused obligation is not outscored merely by a broader bundle"
if name not in text:
    marker = (
        'test("recent structural Requirement links preserve causal continuity", '
        '() => {'
    )
    index = text.find(marker)
    if index < 0:
        raise SystemExit("focused obligation test insertion point missing")
    test_case = '''test("a focused obligation is not outscored merely by a broader bundle", () => {
  const [base] = neutralCandidates();
  assert.ok(base);
  const focused = structuredClone(base);
  focused.kernelId = "kernel.focused";
  focused.unmetMustEstablishCount = 1;
  focused.unmetExitGateCount = 1;

  const broad = structuredClone(base);
  broad.kernelId = "kernel.broad";
  broad.unmetMustEstablishCount = 2;
  broad.unmetExitGateCount = 2;

  const normal = selectKernelLite([broad, focused], "STATE-FOCUS");
  const reversed = selectKernelLite([focused, broad], "STATE-FOCUS");
  assert.equal(normal.selected?.kernelId, focused.kernelId);
  assert.equal(reversed.selected?.kernelId, focused.kernelId);
});

'''
    text = text[:index] + test_case + text[index:]
tests.write_text(text, encoding="utf-8")
