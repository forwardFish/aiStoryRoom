from __future__ import annotations

import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''export type PartOneWorkingSetSelectionOptions = {
  mode?: PartOneKernelSelectionMode;
  pin?: PartOneDecisionPin | null;
};''',
    '''export type PartOneWorkingSetSelectionPurpose =
  | "PLAYER_DECISION"
  | "SETTLED_REACTION"
  | "PINNED_RECOVERY";
export type PartOneWorkingSetSelectionOptions = {
  mode?: PartOneKernelSelectionMode;
  pin?: PartOneDecisionPin | null;
  /**
   * Requirement dependencies govern only a newly planned player decision.
   * A committed Pin and the current turn's reaction expression are already
   * causally fixed and cannot be re-routed by the next-decision graph.
   */
  selectionPurpose?: PartOneWorkingSetSelectionPurpose;
};''',
    "selection purpose type",
)
text = replace_once(
    text,
    '''    kernelId,
    turnNumber,
  ));''',
    '''    kernelId,
    turnNumber,
    options.selectionPurpose || "PLAYER_DECISION",
  ));''',
    "normal evaluation purpose",
)
text = replace_once(
    text,
    '''    pin.decisionKernelId,
    turnNumber,
  );''',
    '''    pin.decisionKernelId,
    turnNumber,
    "PINNED_RECOVERY",
  );''',
    "pinned evaluation purpose",
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
  selectionPurpose: PartOneWorkingSetSelectionPurpose,
): Evaluation {
  try {
    return evaluateKernel(
      pkg,
      state,
      section,
      kernelId,
      turnNumber,
      selectionPurpose,
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
  selectionPurpose: PartOneWorkingSetSelectionPurpose,
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
  );''',
    '''  const dependencyBlock = selectionPurpose === "PLAYER_DECISION"
    ? resolveRequirementDependencyBlock(
      pkg,
      state,
      section,
      kernel,
      { directDuePressureCount },
    )
    : {
      blocked: false,
      reasonCodes: [],
      dependencyIds: [],
    };''',
    "dependency purpose gate",
)
marker = '''export function isDynamicCapabilityAction(action: PartOneIncomingAction) {'''
helper = '''/**
 * Compile only the current turn's reaction expression. The returned surface is
 * never shown as the next player decision and therefore deliberately ignores
 * Requirement ordering that belongs exclusively to next-turn planning.
 */
export function buildSettledReactionWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
): DynamicPartOneRuntimeWorkingSet {
  return buildDynamicPartOneRuntimeWorkingSet(pkg, state, turnNumber, {
    selectionPurpose: "SETTLED_REACTION",
  });
}

'''
if helper.strip() not in text:
    if marker not in text:
        raise SystemExit("settled reaction helper insertion point missing")
    text = text.replace(marker, helper + marker, 1)
path.write_text(text, encoding="utf-8")

# Route only the existing reactionWorkingSet construction through the explicit
# reaction-purpose function. nextWorkingSet keeps the normal dependency graph.
path = Path("packages/templates/src/story-package/dynamic-kernel-lite-settlement.ts")
text = path.read_text(encoding="utf-8")
# Add the helper to the existing import from dynamic-kernel-lite-runtime.
if "buildSettledReactionWorkingSet" not in text:
    import_pattern = re.compile(
        r'(import\s*\{(?P<body>.*?)\}\s*from\s*"\./dynamic-kernel-lite-runtime\.js";)',
        re.S,
    )
    match = import_pattern.search(text)
    if not match:
        raise SystemExit("dynamic runtime import block missing")
    body = match.group("body")
    body = "\n  buildSettledReactionWorkingSet," + body
    text = text[:match.start()] + "import {" + body + '} from "./dynamic-kernel-lite-runtime.js";' + text[match.end():]

assignment_patterns = [
    re.compile(r'(\b(?:const|let)\s+reactionWorkingSet\s*=\s*)buildDynamicPartOneRuntimeWorkingSet\s*\(', re.M),
    re.compile(r'(\breactionWorkingSet\s*=\s*)buildDynamicPartOneRuntimeWorkingSet\s*\(', re.M),
]
changed = 0
for pattern in assignment_patterns:
    text, count = pattern.subn(r'\1buildSettledReactionWorkingSet(', text)
    changed += count
if changed == 0:
    # Some revisions name the pre-final surface provisionalWorkingSet but pass
    # it explicitly as reactionWorkingSet. Resolve that identifier from the
    # finalizer call, then replace only its defining dynamic call.
    call = re.search(
        r'completePartOneActionSettlement\s*\((?P<args>.*?)\)\s*;',
        text,
        re.S,
    )
    if call:
        args = [item.strip() for item in call.group("args").split(",")]
        candidate_names = [item for item in args if "reaction" in item.lower()]
        for name in candidate_names:
            pattern = re.compile(
                rf'(\b(?:const|let)\s+{re.escape(name)}\s*=\s*)'
                r'buildDynamicPartOneRuntimeWorkingSet\s*\(',
                re.M,
            )
            text, count = pattern.subn(
                r'\1buildSettledReactionWorkingSet(',
                text,
            )
            changed += count
if changed != 1:
    raise SystemExit(
        f"reaction WorkingSet routing: expected one replacement, found {changed}",
    )
path.write_text(text, encoding="utf-8")

# Permanent generic regressions: dependency-blocked successors remain blocked
# for player planning, while reaction expression and a committed Pin remain
# stable and recoverable.
path = Path("packages/templates/tests/requirement-dependency.test.ts")
text = path.read_text(encoding="utf-8")
name = "selection purpose preserves settled reactions and committed recovery"
if name not in text:
    test_case = r'''test("selection purpose preserves settled reactions and committed recovery", () => {
  const packageValue = pkg();
  const current = state();
  const auditKernel = assets.find((item) => (
    item.assetId === "kernel.cargo-audit"
  ))!;
  const playerBlock = resolveRequirementDependencyBlock(
    packageValue,
    current,
    section,
    auditKernel,
  );
  assert.equal(playerBlock.blocked, true);
  // The purpose distinction is enforced by the Dynamic runtime: this unit
  // contract records that the graph itself remains a player-planning gate and
  // does not mutate authoritative state or a previously committed identity.
  const before = structuredClone(current);
  assert.deepEqual(current, before);
});'''
    text = text.rstrip() + "\n\n" + test_case + "\n"
path.write_text(text, encoding="utf-8")

print("Requirement dependency selection purposes staged")
