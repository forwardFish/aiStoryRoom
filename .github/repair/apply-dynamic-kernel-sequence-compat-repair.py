from pathlib import Path


core = Path("packages/templates/src/runtime-contract/kernel-selector-lite.ts")
text = core.read_text(encoding="utf-8")
needle = "  RECENT_REQUIREMENT_LINK: 18,\n"
if needle not in text:
    raise SystemExit("recent requirement weight insertion point missing")
text = text.replace(
    needle,
    "  RECENT_REQUIREMENT_LINK: 120,\n",
    1,
)
core.write_text(text, encoding="utf-8")

engine = Path(
    "packages/templates/src/story-package/part-one-runtime-engine.ts",
)
text = engine.read_text(encoding="utf-8")
start = text.find("function buildNextStoryBeat(")
if start < 0:
    raise SystemExit("buildNextStoryBeat start missing")
end = text.find("\nfunction ", start + 1)
if end < 0:
    raise SystemExit("buildNextStoryBeat end missing")
segment = text[start:end]
segment = segment.replace(
    "input.decisionKernelId",
    "narrativeKernelId",
)
entry = ''')}): PartOneNarrativePlan["nextStoryBeat"] {
  if (!narrativeKernelId) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");
  }'''
replacement = ''')}): PartOneNarrativePlan["nextStoryBeat"] {
  const narrativeKernelId = input.decisionKernelId
    || input.nextDecisionPoint.decisionKernelId;
  if (!narrativeKernelId) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");
  }'''
if entry not in segment:
    raise SystemExit("buildNextStoryBeat entry replacement missing")
segment = segment.replace(entry, replacement, 1)
text = text[:start] + segment + text[end:]
engine.write_text(text, encoding="utf-8")

tests = Path("packages/templates/tests/kernel-selector-lite.test.ts")
text = tests.read_text(encoding="utf-8")
name = (
    "direct causal continuity outranks a broader but unrelated obligation bundle"
)
if name not in text:
    marker = (
        'test("recent structural Requirement links preserve causal continuity", '
        '() => {'
    )
    index = text.find(marker)
    if index < 0:
        raise SystemExit("sequence test insertion point missing")
    test_case = '''test("direct causal continuity outranks a broader but unrelated obligation bundle", () => {
  const [base] = neutralCandidates();
  assert.ok(base);
  const directlyLinked = structuredClone(base);
  directlyLinked.kernelId = "kernel.directly-linked";
  directlyLinked.unmetMustEstablishCount = 1;
  directlyLinked.unmetExitGateCount = 1;
  directlyLinked.exclusiveObligationCount = 0;
  directlyLinked.recentRequirementLinkCount = 2;
  directlyLinked.recentArcLinkCount = 1;

  const broadBundle = structuredClone(base);
  broadBundle.kernelId = "kernel.broad-bundle";
  broadBundle.unmetMustEstablishCount = 2;
  broadBundle.unmetExitGateCount = 2;
  broadBundle.exclusiveObligationCount = 2;
  broadBundle.recentRequirementLinkCount = 1;
  broadBundle.recentArcLinkCount = 1;

  const normal = selectKernelLite(
    [broadBundle, directlyLinked],
    "STATE-DIRECT-CONTINUITY",
  );
  const reversed = selectKernelLite(
    [directlyLinked, broadBundle],
    "STATE-DIRECT-CONTINUITY",
  );
  assert.equal(normal.selected?.kernelId, directlyLinked.kernelId);
  assert.equal(reversed.selected?.kernelId, directlyLinked.kernelId);
});

'''
    text = text[:index] + test_case + text[index:]
tests.write_text(text, encoding="utf-8")
