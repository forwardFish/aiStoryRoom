from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# Extend the public, world-agnostic dependency contract.
path = Path("packages/templates/src/story-package/part-one-runtime-types.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  predecessorRequirementId: string;
  successorRequirementId: string;
  /** All rules must match for this dependency edge to become active. */''',
    '''  predecessorRequirementId: string;
  successorRequirementId: string;
  /**
   * Optional authored Kernel route(s) that are allowed to discharge the
   * predecessor while this edge is active. Core logic treats these as opaque,
   * validated IDs and never branches on world vocabulary.
   */
  predecessorDecisionKernelIds?: string[];
  /** All rules must match for this dependency edge to become active. */''',
    "dependency predecessor kernel type",
)
path.write_text(text, encoding="utf-8")

# Validate the optional Kernel route and use it in runtime blocking semantics.
path = Path("packages/templates/src/story-package/requirement-dependency.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  candidateRequirementIds: string[];
  completedKernelIds?: string[];''',
    '''  candidateRequirementIds: string[];
  candidateKernelId?: string;
  completedKernelIds?: string[];''',
    "candidate kernel input",
)
text = replace_once(
    text,
    '''    const commonSections = commonSectionIds.map((sectionId) => {
      const section = sections.get(sectionId);
      if (!section) {
        invalid(
          "UNKNOWN_DEPENDENCY_SECTION",
          `${dependency.dependencyId}:${sectionId}`,
        );
      }
      return section!;
    });

    if (!requirementHasActiveKernel(predecessor!, commonSections)) {''',
    '''    const commonSections = commonSectionIds.map((sectionId) => {
      const section = sections.get(sectionId);
      if (!section) {
        invalid(
          "UNKNOWN_DEPENDENCY_SECTION",
          `${dependency.dependencyId}:${sectionId}`,
        );
      }
      return section!;
    });

    const predecessorDecisionKernelIds = stringArray(
      dependency.predecessorDecisionKernelIds,
    );
    if (
      dependency.predecessorDecisionKernelIds !== undefined
      && predecessorDecisionKernelIds.length === 0
    ) {
      invalid("EMPTY_PREDECESSOR_KERNEL_SET", dependency.dependencyId);
    }
    if (
      new Set(predecessorDecisionKernelIds).size
      !== predecessorDecisionKernelIds.length
    ) {
      invalid("DUPLICATE_PREDECESSOR_KERNEL", dependency.dependencyId);
    }
    const activeKernelIds = new Set(
      commonSections.flatMap((section) => section.activeDecisionKernelIds),
    );
    for (const kernelId of predecessorDecisionKernelIds) {
      if (!stringArray(predecessor!.decisionKernelIds).includes(kernelId)) {
        invalid(
          "PREDECESSOR_KERNEL_NOT_OWNED",
          `${dependency.dependencyId}:${kernelId}`,
        );
      }
      if (!activeKernelIds.has(kernelId)) {
        invalid(
          "PREDECESSOR_KERNEL_NOT_ACTIVE",
          `${dependency.dependencyId}:${kernelId}`,
        );
      }
    }

    if (!requirementHasActiveKernel(predecessor!, commonSections)) {''',
    "validate predecessor kernel route",
)
text = replace_once(
    text,
    '''    // A bridge Kernel that owns both sides may satisfy the predecessor while
    // answering the successor. Blocking it would manufacture a deadlock.
    if (candidateRequirements.has(dependency.predecessorRequirementId)) {
      continue;
    }
    // An already-due consequence is authoritative causal debt.''',
    '''    const designatedPredecessorKernels = stringArray(
      dependency.predecessorDecisionKernelIds,
    );
    // A bridge Kernel may satisfy the predecessor while answering the
    // successor only when it is an authored predecessor route. If no route is
    // declared, every Kernel owning the predecessor remains valid.
    if (
      candidateRequirements.has(dependency.predecessorRequirementId)
      && (
        designatedPredecessorKernels.length === 0
        || designatedPredecessorKernels.includes(input.candidateKernelId || "")
      )
    ) {
      continue;
    }
    // An already-due consequence is authoritative causal debt.''',
    "designated bridge semantics",
)
text = replace_once(
    text,
    '''    const completedKernelIds = new Set(input.completedKernelIds || []);
    const predecessorHasOpenRoute = stringArray(predecessor.decisionKernelIds)
      .some((kernelId) => (''',
    '''    const completedKernelIds = new Set(input.completedKernelIds || []);
    const predecessorRoutes = designatedPredecessorKernels.length
      ? designatedPredecessorKernels
      : stringArray(predecessor.decisionKernelIds);
    const predecessorHasOpenRoute = predecessorRoutes.some((kernelId) => (''',
    "designated predecessor route availability",
)
path.write_text(text, encoding="utf-8")

# Pass the actual candidate Kernel as opaque identity.
path = Path("packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''    state,
    candidateRequirementIds: kernel.requirementIds,
    completedKernelIds: state.completedKernelIds,''',
    '''    state,
    candidateRequirementIds: kernel.requirementIds,
    candidateKernelId: kernel.assetId,
    completedKernelIds: state.completedKernelIds,''',
    "runtime candidate kernel identity",
)
path.write_text(text, encoding="utf-8")

# Keep the authoring/compiler-side validator equivalent.
path = Path("scripts/story-decomposition/lib/requirement-dependency.mjs")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''    const commonSections = commonIds.map((id) => {
      const section = sectionById.get(id);
      if (!section) fail("UNKNOWN_DEPENDENCY_SECTION", `${dependency.dependencyId}:${id}`);
      return section;
    });
    if (!hasActiveKernel(predecessor, commonSections)) {''',
    '''    const commonSections = commonIds.map((id) => {
      const section = sectionById.get(id);
      if (!section) fail("UNKNOWN_DEPENDENCY_SECTION", `${dependency.dependencyId}:${id}`);
      return section;
    });
    const predecessorDecisionKernelIds = dependency.predecessorDecisionKernelIds || [];
    if (!Array.isArray(predecessorDecisionKernelIds)) {
      fail("PREDECESSOR_KERNEL_SET_NOT_ARRAY", dependency.dependencyId);
    }
    if (
      dependency.predecessorDecisionKernelIds !== undefined
      && predecessorDecisionKernelIds.length === 0
    ) {
      fail("EMPTY_PREDECESSOR_KERNEL_SET", dependency.dependencyId);
    }
    if (new Set(predecessorDecisionKernelIds).size !== predecessorDecisionKernelIds.length) {
      fail("DUPLICATE_PREDECESSOR_KERNEL", dependency.dependencyId);
    }
    const activeKernelIds = new Set(
      commonSections.flatMap((section) => section.activeDecisionKernelIds),
    );
    for (const kernelId of predecessorDecisionKernelIds) {
      if (!predecessor.decisionKernelIds.includes(kernelId)) {
        fail("PREDECESSOR_KERNEL_NOT_OWNED", `${dependency.dependencyId}:${kernelId}`);
      }
      if (!activeKernelIds.has(kernelId)) {
        fail("PREDECESSOR_KERNEL_NOT_ACTIVE", `${dependency.dependencyId}:${kernelId}`);
      }
    }
    if (!hasActiveKernel(predecessor, commonSections)) {''',
    "js validator predecessor route",
)
path.write_text(text, encoding="utf-8")

# Author the Sangtian-specific ordering only in author assets, never core code.
path = Path("packages/templates/authoring/sangtian/requirements/part-01.requirements.json")
data = json.loads(path.read_text(encoding="utf-8"))
for dependency in data["requirementDependencies"]:
    dependency["predecessorDecisionKernelIds"] = [
        "DK-P1-REVIEW-AUTHORITY",
    ]
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

path = Path("scripts/story-decomposition/build-sangtian-part-one-authoring.mjs")
text = path.read_text(encoding="utf-8")
for successor in ["REQ-P1-REGISTER-CUSTODY", "REQ-P1-KNOWLEDGE-CHAIN"]:
    text = replace_once(
        text,
        f'''    successorRequirementId: "{successor}",\n  }},''',
        f'''    successorRequirementId: "{successor}",\n    predecessorDecisionKernelIds: ["DK-P1-REVIEW-AUTHORITY"],\n  }},''',
        f"author predecessor kernel for {successor}",
    )
path.write_text(text, encoding="utf-8")

# Add neutral contract tests for the minimal extension and invalid references.
path = Path("packages/templates/tests/requirement-dependency.test.ts")
text = path.read_text(encoding="utf-8")
marker = '''test("a bridge candidate and a directly due successor pressure may bypass ordinary dependency order", () => {'''
insert = '''test("an authored predecessor Kernel route disambiguates a bridge Kernel without core story knowledge", () => {
  const fixture = neutralPortFixture();
  const dependency = {
    ...fixture.dependencies[0]!,
    predecessorDecisionKernelIds: ["kernel.port-access"],
  };
  assert.deepEqual(blockingRequirementDependencyIds({
    dependencies: [dependency],
    requirements: fixture.requirements,
    section: fixture.section,
    state: fixture.state,
    candidateRequirementIds: ["req.port-access", "req.cargo-audit"],
    candidateKernelId: "kernel.bridge",
    evaluateRule,
  }), ["dep.access-before-audit"]);
  assert.deepEqual(blockingRequirementDependencyIds({
    dependencies: [dependency],
    requirements: fixture.requirements,
    section: fixture.section,
    state: fixture.state,
    candidateRequirementIds: ["req.port-access", "req.cargo-audit"],
    candidateKernelId: "kernel.port-access",
    evaluateRule,
  }), []);
  assert.throws(() => validatePartOneRequirementDependencies({
    dependencies: [{
      ...dependency,
      predecessorDecisionKernelIds: ["kernel.unknown"],
    }],
    requirements: fixture.requirements,
    sections: [fixture.section],
    worldStartState: fixture.state,
  }), /PREDECESSOR_KERNEL_NOT_OWNED/u);
});

'''
if marker not in text:
    raise SystemExit("predecessor kernel test insertion point missing")
text = text.replace(marker, insert + marker, 1)
path.write_text(text.rstrip() + "\n", encoding="utf-8")
