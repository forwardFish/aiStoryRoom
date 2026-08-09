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


# Typed dependency policy.
path = Path("packages/templates/src/story-package/part-one-runtime-types.ts")
text = path.read_text(encoding="utf-8")
text = insert_before(
    text,
    'export type PartOneRequirementDependency = {',
    '''export type PartOneRequirementDependencyBypass =
  | "DIRECT_DUE_PRESSURE";''',
    "dependency bypass type",
)
text = replace_once(
    text,
    '''  predecessorDecisionKernelIds?: string[];
  condition?: PartOneRequirementDependencyCondition;
};''',
    '''  predecessorDecisionKernelIds?: string[];
  condition?: PartOneRequirementDependencyCondition;
  /**
   * Explicit world-agnostic causal debt that may bypass normal ordering.
   * The Selector receives this only from typed Pending Consequences directly
   * linked to the candidate; prose and scores cannot activate it.
   */
  bypassWhen?: PartOneRequirementDependencyBypass[];
};''',
    "dependency bypass field",
)
path.write_text(text, encoding="utf-8")


# Runtime and loader validator.
path = Path("packages/templates/src/story-package/requirement-dependency.ts")
text = path.read_text(encoding="utf-8")
text = insert_before(
    text,
    'const RULE_OPERATORS = new Set([',
    '''const DEPENDENCY_BYPASSES = new Set([
  "DIRECT_DUE_PRESSURE",
]);''',
    "dependency bypass constants",
)
text = insert_before(
    text,
    'export type RequirementDependencyBlock = {',
    '''export type RequirementDependencyRuntimeContext = {
  directDuePressureCount?: number;
};''',
    "dependency runtime context type",
)
text = replace_once(
    text,
    '''    const condition = row.condition === undefined
      ? undefined
      : validateCondition(
        row.condition,
        dependencyId,
        input.worldStartState,
      );
    normalized.push({''',
    '''    const condition = row.condition === undefined
      ? undefined
      : validateCondition(
        row.condition,
        dependencyId,
        input.worldStartState,
      );
    const bypassWhen = row.bypassWhen === undefined
      ? []
      : uniqueTextArray(row.bypassWhen, `${dependencyId}.bypassWhen`);
    for (const bypass of bypassWhen) {
      if (!DEPENDENCY_BYPASSES.has(bypass)) {
        fail("UNKNOWN_DEPENDENCY_BYPASS", `${dependencyId}:${bypass}`);
      }
    }
    normalized.push({''',
    "validate dependency bypass",
)
text = replace_once(
    text,
    '''      predecessorDecisionKernelIds: [...predecessorDecisionKernelIds].sort(),
      ...(condition ? { condition } : {}),
    });''',
    '''      predecessorDecisionKernelIds: [...predecessorDecisionKernelIds].sort(),
      ...(condition ? { condition } : {}),
      ...(bypassWhen.length
        ? {
          bypassWhen: [...bypassWhen].sort() as PartOneRequirementDependency["bypassWhen"],
        }
        : {}),
    });''',
    "normalize dependency bypass",
)
text = replace_once(
    text,
    '''  section: PartOneSectionContract,
  kernel: PartOneRuntimeAsset,
): RequirementDependencyBlock {''',
    '''  section: PartOneSectionContract,
  kernel: PartOneRuntimeAsset,
  context: RequirementDependencyRuntimeContext = {},
): RequirementDependencyBlock {''',
    "dependency runtime context parameter",
)
text = replace_once(
    text,
    '''    if (
      dependency.condition
      && !dependency.condition.allOf.every((rule) => (
        evaluatePartOneRule(state, rule)
      ))
    ) {
      continue;
    }
    const predecessorKernelIds = new Set(''',
    '''    if (
      dependency.condition
      && !dependency.condition.allOf.every((rule) => (
        evaluatePartOneRule(state, rule)
      ))
    ) {
      continue;
    }
    if (
      dependency.bypassWhen?.includes("DIRECT_DUE_PRESSURE")
      && Number(context.directDuePressureCount || 0) > 0
    ) {
      continue;
    }
    const predecessorKernelIds = new Set(''',
    "dependency direct due bypass",
)
path.write_text(text, encoding="utf-8")


# Runtime supplies only direct structured Pending Consequences linked to this
# candidate. This remains an eligibility decision, not a scoring bonus.
path = Path("packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  const nextTurn = turnNumber + 1;
  const present = new Set(state.scene?.presentActorRefs || []);''',
    '''  const nextTurn = turnNumber + 1;
  const directDuePressureCount = pending.filter(
    (item) => item.dueTurn <= nextTurn,
  ).length;
  const present = new Set(state.scene?.presentActorRefs || []);''',
    "compute direct due pressure",
)
text = replace_once(
    text,
    '''    section,
    kernel,
  );
  rejectionCodes.push(...dependencyBlock.reasonCodes);''',
    '''    section,
    kernel,
    { directDuePressureCount },
  );
  rejectionCodes.push(...dependencyBlock.reasonCodes);''',
    "supply direct due pressure",
)
text = replace_once(
    text,
    '''      duePressureCount: pending.filter(
        (item) => item.dueTurn <= nextTurn,
      ).length,''',
    '''      duePressureCount: directDuePressureCount,''',
    "reuse direct due pressure count",
)
path.write_text(text, encoding="utf-8")


# Compiler-side validator mirrors the product validator.
path = Path("scripts/story-decomposition/lib/requirement-dependency.mjs")
text = path.read_text(encoding="utf-8")
text = insert_before(
    text,
    'const OPS = new Set([',
    'const BYPASSES = new Set(["DIRECT_DUE_PRESSURE"]);',
    "compiler bypass constants",
)
text = replace_once(
    text,
    '''    const condition = row.condition === undefined
      ? undefined
      : validateCondition(row.condition, dependencyId, input.worldStartState);
    return {''',
    '''    const condition = row.condition === undefined
      ? undefined
      : validateCondition(row.condition, dependencyId, input.worldStartState);
    const bypassWhen = row.bypassWhen === undefined
      ? []
      : uniqueTextArray(row.bypassWhen, `${dependencyId}.bypassWhen`);
    for (const bypass of bypassWhen) {
      if (!BYPASSES.has(bypass)) fail("UNKNOWN_DEPENDENCY_BYPASS", `${dependencyId}:${bypass}`);
    }
    return {''',
    "compiler validate bypass",
)
text = replace_once(
    text,
    '''      predecessorDecisionKernelIds: [...predecessorDecisionKernelIds].sort(),
      ...(condition ? { condition } : {}),
    };''',
    '''      predecessorDecisionKernelIds: [...predecessorDecisionKernelIds].sort(),
      ...(condition ? { condition } : {}),
      ...(bypassWhen.length ? { bypassWhen: [...bypassWhen].sort() } : {}),
    };''',
    "compiler normalize bypass",
)
path.write_text(text, encoding="utf-8")


# Author-owned Sangtian assets explicitly permit already-due direct causal debt
# to pre-empt the ordinary Review-before-custody/witness ordering.
path = Path("packages/templates/authoring/sangtian/requirements/part-01.requirements.json")
data = json.loads(path.read_text(encoding="utf-8"))
for dependency in data["selectionRules"]["requirementDependencies"]:
    dependency["bypassWhen"] = ["DIRECT_DUE_PRESSURE"]
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

path = Path("scripts/story-decomposition/build-sangtian-part-one-authoring.mjs")
text = path.read_text(encoding="utf-8")
text = text.replace(
    '''      predecessorDecisionKernelIds: ["DK-P1-REVIEW-AUTHORITY"],
    },''',
    '''      predecessorDecisionKernelIds: ["DK-P1-REVIEW-AUTHORITY"],
      bypassWhen: ["DIRECT_DUE_PRESSURE"],
    },''',
)
if text.count('bypassWhen: ["DIRECT_DUE_PRESSURE"]') < 2:
    raise SystemExit("source selection rules did not receive two due-pressure bypasses")
path.write_text(text, encoding="utf-8")


# Neutral-world permanent tests: direct due pressure bypasses only when the
# author contract allows it; unknown bypasses are rejected at package load.
path = Path("packages/templates/tests/requirement-dependency.test.ts")
text = path.read_text(encoding="utf-8")
name = "direct due pressure bypasses normal ordering only when explicitly authored"
if name not in text:
    test_case = r'''test("direct due pressure bypasses normal ordering only when explicitly authored", () => {
  const rules = selectionRules();
  rules.requirementDependencies[0]!.bypassWhen = [
    "DIRECT_DUE_PRESSURE",
  ];
  const packageValue = pkg(validate(rules));
  const auditKernel = assets.find((item) => (
    item.assetId === "kernel.cargo-audit"
  ))!;
  assert.equal(
    resolveRequirementDependencyBlock(
      packageValue,
      state("UNSET"),
      section,
      auditKernel,
      { directDuePressureCount: 0 },
    ).blocked,
    true,
  );
  assert.equal(
    resolveRequirementDependencyBlock(
      packageValue,
      state("UNSET"),
      section,
      auditKernel,
      { directDuePressureCount: 1 },
    ).blocked,
    false,
  );

  const invalid = selectionRules();
  invalid.requirementDependencies[0]!.bypassWhen = ["PROSE_MATCH"];
  assert.throws(
    () => validate(invalid),
    /UNKNOWN_DEPENDENCY_BYPASS/,
  );
});'''
    text = text.rstrip() + "\n\n" + test_case + "\n"
path.write_text(text, encoding="utf-8")

print("direct due-pressure dependency override staged")
