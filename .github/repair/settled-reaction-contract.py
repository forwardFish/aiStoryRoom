from __future__ import annotations

import re
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


# Explicit author-owned current-reaction contract.
path = Path("packages/templates/src/story-package/part-one-runtime-types.ts")
text = path.read_text(encoding="utf-8")
contract = '''export type PartOneSettledReactionContract = {
  schemaVersion: "settled-reaction-v1";
  sourceAffordanceTemplateId: string;
  /** Author-reviewed current-turn reaction; never a next-decision prompt. */
  action: string;
};'''
text = insert_before(
    text,
    "export type PartOneAffordanceTemplate = {",
    contract,
    "settled reaction type",
)
text = replace_once(
    text,
    '''  playerVisibleFallback?: PartOnePlayerVisibleFallback;
  createsPendingConsequence: boolean;''',
    '''  playerVisibleFallback?: PartOnePlayerVisibleFallback;
  settledReaction?: PartOneSettledReactionContract;
  createsPendingConsequence: boolean;''',
    "settled reaction affordance field",
)
path.write_text(text, encoding="utf-8")


# Promote the already author-reviewed immediate/world reaction surface into a
# typed current-action contract at authoring compile time. Runtime never parses
# prose to choose a Kernel or infer causality.
path = Path("scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''        ...(kernelPlayerVisibleFallbacks[kernelId]?.[index]
          ? { playerVisibleFallback: kernelPlayerVisibleFallbacks[kernelId][index] }
          : {}),
        createsPendingConsequence: true,''',
    '''        ...(kernelPlayerVisibleFallbacks[kernelId]?.[index]
          ? {
            playerVisibleFallback: kernelPlayerVisibleFallbacks[kernelId][index],
            settledReaction: {
              schemaVersion: "settled-reaction-v1",
              sourceAffordanceTemplateId: `${kernelId}-OPT-0${index + 1}`,
              action: String(
                kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
                || kernelPlayerVisibleFallbacks[kernelId][index].WORLD_PRESSURE
                || ""
              ).trim(),
            },
          }
          : {}),
        createsPendingConsequence: true,''',
    "compile settled reaction contract",
)
validation_marker = '''  for (const option of options) {
    const refs = Array.isArray(option.protectedEffectRefs) ? option.protectedEffectRefs : [];'''
validation_replacement = '''  for (const option of options) {
    if (
      !option.settledReaction
      || option.settledReaction.schemaVersion !== "settled-reaction-v1"
      || option.settledReaction.sourceAffordanceTemplateId !== option.affordanceTemplateId
      || !String(option.settledReaction.action || "").trim()
    ) {
      throw new Error(`DECISION_KERNEL_SETTLED_REACTION_INVALID:${option.affordanceTemplateId}`);
    }
    const refs = Array.isArray(option.protectedEffectRefs) ? option.protectedEffectRefs : [];'''
text = replace_once(
    text,
    validation_marker,
    validation_replacement,
    "validate settled reaction contract",
)
path.write_text(text, encoding="utf-8")


# Bind only the current committed Affordance reaction. Existing Actor Policy
# resolution and actor refs remain authoritative; nextWorkingSet is untouched.
path = Path("packages/templates/src/story-package/part-one-runtime-engine.ts")
text = path.read_text(encoding="utf-8")
call_pattern = re.compile(
    r'(?P<indent>\s*)const authoritativeNpcReactions = '
    r'(?P<call>buildAuthoritativeNpcReactions\(.*?\));',
    re.S,
)
match = call_pattern.search(text)
if not match:
    raise SystemExit("authoritative NPC reaction call missing")
old = match.group(0)
indent = match.group("indent")
call = match.group("call")
new = (
    f"{indent}const authoritativeNpcReactions = "
    "bindSettledReactionContract(\n"
    f"{indent}  pkg,\n"
    f"{indent}  current,\n"
    f"{indent}  {call},\n"
    f"{indent});"
)
text = text[:match.start()] + new + text[match.end():]
helper = '''/**
 * Bind an author-reviewed reaction to the current committed Affordance. The
 * Actor Policy resolver still owns who reacts; this helper only prevents the
 * next Decision Point's prompt from replacing what the current Settlement
 * already caused.
 */
function bindSettledReactionContract(
  pkg: PartOneRuntimePackage,
  current: PartOneCurrentActionSettlement,
  reactions: PartOneCommittedEvent["authoritativeNpcReactions"],
): PartOneCommittedEvent["authoritativeNpcReactions"] {
  if (
    !current.decisionKernelId
    || !current.affordanceTemplateId
    || reactions.length === 0
  ) {
    return reactions;
  }
  const kernel = pkg.assets.find((asset) => (
    asset.assetType === "DECISION_KERNEL"
    && asset.assetId === current.decisionKernelId
  ));
  const option = kernel?.payload.options?.find((candidate) => (
    candidate.affordanceTemplateId === current.affordanceTemplateId
  ));
  const contract = option?.settledReaction;
  if (!contract) return reactions;
  if (
    contract.schemaVersion !== "settled-reaction-v1"
    || contract.sourceAffordanceTemplateId
      !== current.affordanceTemplateId
    || !contract.action.trim()
  ) {
    throw new Error("PART_ONE_SETTLED_REACTION_CONTRACT_INVALID");
  }
  return reactions.map((reaction, index) => (
    index === 0
      ? { ...reaction, action: contract.action }
      : reaction
  ));
}'''
text = insert_before(
    text,
    "function buildAuthoritativeNpcReactions(",
    helper,
    "settled reaction binder",
)
path.write_text(text, encoding="utf-8")


# Permanent package-level contract test. Full API/OpenNovel suites verify the
# rendered reaction and actor/scene boundaries end to end.
path = Path("packages/templates/tests/part-one-dynamic-kernel-lite.test.ts")
text = path.read_text(encoding="utf-8")
name = "every playable Affordance carries a current-turn settled reaction contract"
if name not in text:
    test_case = r'''test("every playable Affordance carries a current-turn settled reaction contract", () => {
  const pkg = packageUnderTest();
  const options = pkg.assets
    .filter((asset) => asset.assetType === "DECISION_KERNEL")
    .flatMap((asset) => asset.payload.options || []);
  assert.ok(options.length > 0);
  for (const option of options) {
    assert.equal(
      option.settledReaction?.schemaVersion,
      "settled-reaction-v1",
      option.affordanceTemplateId,
    );
    assert.equal(
      option.settledReaction?.sourceAffordanceTemplateId,
      option.affordanceTemplateId,
      option.affordanceTemplateId,
    );
    assert.ok(
      String(option.settledReaction?.action || "").trim().length > 0,
      option.affordanceTemplateId,
    );
  }
});'''
    text = text.rstrip() + "\n\n" + test_case + "\n"
path.write_text(text, encoding="utf-8")

print("settled reaction contract staged")
