import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutcomeSignature,
  selectKernelLite,
  type KernelSelectorLiteCandidate,
} from "../src/runtime-contract/kernel-selector-lite.js";
import {
  resolveRequirementDependencyBlock,
  validatePartOneSelectionRules,
} from "../src/story-package/requirement-dependency.js";
import type {
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneSectionContract,
  PartOneState,
} from "../src/story-package/part-one-runtime-types.js";

const section: PartOneSectionContract = {
  schemaVersion: "section-contract-v1",
  sectionId: "section.neutral-port",
  partId: "PART-01",
  title: "Neutral Port",
  dramaticPurpose: "Resolve access before auditing cargo.",
  targetTurnWindow: { earliest: 1, latest: 8 },
  entryRequirements: [],
  requiredRequirementIds: ["req.port-access", "req.cargo-audit", "req.release"],
  activeDecisionKernelIds: ["kernel.port-access", "kernel.bridge", "kernel.cargo-audit", "kernel.release"],
  activeCausalArcIds: [],
  foregroundActorRefs: [],
  mustEstablish: [
    rule("must.access", "port.accessMode", "NEQ", "UNSET"),
    rule("must.audit", "cargo.auditStatus", "NEQ", "UNSET"),
    rule("must.release", "cargo.releaseStatus", "NEQ", "UNSET"),
  ],
  requiredMaterialChangeClasses: [],
  forbiddenEarlyReveals: [],
  allowedNextSectionIds: [],
  exitGates: [
    rule("exit.access", "port.accessMode", "NEQ", "UNSET"),
    rule("exit.audit", "cargo.auditStatus", "NEQ", "UNSET"),
    rule("exit.release", "cargo.releaseStatus", "NEQ", "UNSET"),
  ],
  floorObligationIds: [],
  handoffStatePaths: ["port.accessMode", "cargo.auditStatus", "cargo.releaseStatus"],
};

const requirements = [
  requirement("req.port-access", ["kernel.port-access", "kernel.bridge"], ["port.accessMode"]),
  requirement("req.cargo-audit", ["kernel.bridge", "kernel.cargo-audit"], ["cargo.auditStatus"]),
  requirement("req.release", ["kernel.release"], ["cargo.releaseStatus"]),
];

const assets = [
  kernel("kernel.port-access", ["req.port-access"]),
  kernel("kernel.bridge", ["req.port-access", "req.cargo-audit"]),
  kernel("kernel.cargo-audit", ["req.cargo-audit"]),
  kernel("kernel.release", ["req.release"]),
];

function rule(ruleId: string, statePath: string, operator: "EQ" | "NEQ", expectedValue: unknown) {
  return { ruleId, statePath, operator, expectedValue, description: ruleId };
}
function requirement(requirementId: string, decisionKernelIds: string[], stateEffects: string[]) {
  return {
    requirementId,
    sectionIds: [section.sectionId],
    decisionKernelIds,
    runtimeAssetIds: [],
    stateEffects,
  };
}
function kernel(assetId: string, requirementIds: string[]): PartOneRuntimeAsset {
  return {
    schemaVersion: "runtime-story-asset-v1",
    assetId,
    assetType: "DECISION_KERNEL",
    partIds: ["PART-01"],
    sectionIds: [section.sectionId],
    requirementIds,
    decisionKernelIds: [assetId],
    causalArcIds: [],
    actorRefs: [],
    stateDependencies: [],
    visibilityRules: [],
    sourceClaimIds: ["neutral-source"],
    adaptationDecisionIds: [],
    retrievalTags: [],
    payload: {},
  };
}
function state(accessMode = "UNSET", emergency = false): PartOneState {
  return {
    partId: "PART-01",
    sectionId: section.sectionId,
    turnNumber: 1,
    durableState: { predicates: [] },
    scene: {
      sceneId: "scene.neutral-port",
      timeLabel: "Day 1",
      locationLabel: "Port",
      presentActorRefs: [],
      situation: "Two obligations are simultaneously actionable.",
    },
    reform: { executionMode: "UNKNOWN", scopeStatus: "UNSET", progress: "NOT_STARTED" },
    review: { initiationStatus: "NOT_STARTED", authority: "UNDECIDED", procedureStatus: "UNSET" },
    evidence: { chainStatus: "UNKNOWN", primaryCustodianRef: null, copyStatus: "NONE", archiveSealStatus: "UNKNOWN" },
    witness: { accessStatus: "UNKNOWN" },
    grain: { immediatePressure: "STABLE", officialStockStatus: "UNKNOWN", reliefChannel: "UNDECIDED" },
    merchant: { entryStatus: "ABSENT", grantedRights: [] },
    land: { riskLevel: "UNKNOWN", safeguardStatus: "NONE" },
    report: { authorshipMode: "UNKNOWN", firstNarrativeController: "UNDECIDED", attachmentStrength: "NONE", dispatchStatus: "NOT_STARTED" },
    responsibility: { firstRecordStatus: "EMPTY", governorExposure: 0, xunfuExposure: 0 },
    relations: { governorXunfu: 0 },
    knowledgeTransfers: [],
    pendingConsequences: [],
    completedKernelIds: [],
    port: { accessMode, emergency },
    cargo: { auditStatus: "UNSET", releaseStatus: "UNSET" },
  } as unknown as PartOneState;
}
function selectionRules(condition?: unknown) {
  return {
    schemaVersion: "requirement-selection-rules-v1",
    requirementDependencies: [{
      schemaVersion: "requirement-dependency-v1",
      dependencyId: "dep.access-before-audit",
      predecessorRequirementId: "req.port-access",
      successorRequirementId: "req.cargo-audit",
      predecessorDecisionKernelIds: ["kernel.port-access"],
      ...(condition ? { condition } : {}),
    }],
  };
}
function validate(raw = selectionRules(), overrides: Partial<Parameters<typeof validatePartOneSelectionRules>[0]> = {}) {
  return validatePartOneSelectionRules({
    selectionRules: raw,
    requirements: requirements as PartOneRuntimePackage["requirements"],
    sections: [section],
    assets,
    worldStartState: state(),
    ...overrides,
  });
}
function pkg(rules = validate()): PartOneRuntimePackage {
  return {
    selectionRules: rules,
    requirements,
    sections: [section],
    assets,
  } as unknown as PartOneRuntimePackage;
}
function candidate(kernelId: string, dependencyBlocked: boolean): KernelSelectorLiteCandidate {
  const outcomes = ["LEFT", "RIGHT"].map((value, index) => ({
    affordanceId: `${kernelId}.${index}`,
    sourceOrder: index,
    outcome: createOutcomeSignature({
      affordanceId: `${kernelId}.${index}`,
      stateFeatures: [`state:choice=${JSON.stringify(value)}`],
      durablePredicateFeatures: [],
      pendingRuleFeatures: [],
      sectionAfter: section.sectionId,
      partCompletionStatusAfter: null,
    }),
    payload: null,
  }));
  return {
    kernelId,
    completed: false,
    allowedInCurrentScope: true,
    structurallyResolved: false,
    dependencyBlocked,
    unmetMustEstablishCount: 1,
    unmetExitGateCount: 1,
    duePressureCount: 0,
    pendingPressureCount: 0,
    activeArcCount: 0,
    availablePressureActorCount: 0,
    validAffordances: outcomes,
    rejectionCodes: [],
  };
}

test("neutral-port selects the predecessor regardless of candidate and asset order", () => {
  const packageValue = pkg();
  const current = state();
  const access = resolveRequirementDependencyBlock(packageValue, current, section, assets[0]!);
  const audit = resolveRequirementDependencyBlock(packageValue, current, section, assets[2]!);
  assert.equal(access.blocked, false);
  assert.equal(audit.blocked, true);
  const normal = selectKernelLite([
    candidate("kernel.cargo-audit", audit.blocked),
    candidate("kernel.port-access", access.blocked),
  ], "NEUTRAL-PORT");
  const reversed = selectKernelLite([
    candidate("kernel.port-access", access.blocked),
    candidate("kernel.cargo-audit", audit.blocked),
  ], "NEUTRAL-PORT");
  assert.equal(normal.selected?.kernelId, "kernel.port-access");
  assert.equal(reversed.selected?.kernelId, "kernel.port-access");

  const reorderedPackage = pkg(validate(selectionRules(), {
    requirements: [...requirements].reverse() as PartOneRuntimePackage["requirements"],
    sections: [{ ...section, activeDecisionKernelIds: [...section.activeDecisionKernelIds].reverse() }],
    assets: [...assets].reverse(),
  }));
  assert.equal(
    resolveRequirementDependencyBlock(
      reorderedPackage,
      current,
      reorderedPackage.sections[0]!,
      reorderedPackage.assets.find((item) => item.assetId === "kernel.cargo-audit")!,
    ).blocked,
    true,
  );
});

test("typed dependency condition activates and deactivates from authoritative state", () => {
  const conditional = selectionRules({
    allOf: [{
      ruleId: "condition.emergency",
      statePath: "port.emergency",
      operator: "EQ",
      expectedValue: true,
      description: "Emergency protocol is active.",
    }],
  });
  const packageValue = pkg(validate(conditional));
  const auditKernel = assets.find((item) => item.assetId === "kernel.cargo-audit")!;
  assert.equal(
    resolveRequirementDependencyBlock(packageValue, state("UNSET", true), section, auditKernel).blocked,
    true,
  );
  assert.equal(
    resolveRequirementDependencyBlock(packageValue, state("UNSET", false), section, auditKernel).blocked,
    false,
  );
});

test("two simultaneously valid Requirements release the successor after authoritative satisfaction", () => {
  const packageValue = pkg();
  const auditKernel = assets.find((item) => item.assetId === "kernel.cargo-audit")!;
  assert.equal(resolveRequirementDependencyBlock(packageValue, state("UNSET"), section, auditKernel).blocked, true);
  assert.equal(resolveRequirementDependencyBlock(packageValue, state("AUTHORIZED"), section, auditKernel).blocked, false);
});

test("invalid references and self dependencies are rejected", () => {
  const unknown = structuredClone(selectionRules());
  unknown.requirementDependencies[0]!.successorRequirementId = "req.unknown";
  assert.throws(() => validate(unknown), /UNKNOWN_SUCCESSOR_REQUIREMENT/);
  const self = structuredClone(selectionRules());
  self.requirementDependencies[0]!.successorRequirementId = "req.port-access";
  assert.throws(() => validate(self), /SELF_DEPENDENCY/);
});

test("duplicate, conflicting, impossible and cyclic dependencies are rejected", () => {
  const duplicate = structuredClone(selectionRules());
  duplicate.requirementDependencies.push({
    ...duplicate.requirementDependencies[0]!,
    dependencyId: "dep.duplicate",
  });
  assert.throws(() => validate(duplicate), /DUPLICATE_DEPENDENCY/);

  const conflict = structuredClone(selectionRules());
  conflict.requirementDependencies.push({
    schemaVersion: "requirement-dependency-v1",
    dependencyId: "dep.reverse",
    predecessorRequirementId: "req.cargo-audit",
    successorRequirementId: "req.port-access",
    predecessorDecisionKernelIds: ["kernel.cargo-audit"],
  });
  assert.throws(() => validate(conflict), /CONFLICTING_DEPENDENCY/);

  const impossible = selectionRules({
    allOf: [
      rule("condition.one", "port.accessMode", "EQ", "A"),
      rule("condition.two", "port.accessMode", "EQ", "B"),
    ],
  });
  assert.throws(() => validate(impossible), /IMPOSSIBLE_DEPENDENCY_CONDITION/);

  const cycle = {
    schemaVersion: "requirement-selection-rules-v1",
    requirementDependencies: [
      {
        schemaVersion: "requirement-dependency-v1",
        dependencyId: "dep.a-b",
        predecessorRequirementId: "req.port-access",
        successorRequirementId: "req.cargo-audit",
        predecessorDecisionKernelIds: ["kernel.port-access"],
      },
      {
        schemaVersion: "requirement-dependency-v1",
        dependencyId: "dep.b-c",
        predecessorRequirementId: "req.cargo-audit",
        successorRequirementId: "req.release",
        predecessorDecisionKernelIds: ["kernel.cargo-audit"],
      },
      {
        schemaVersion: "requirement-dependency-v1",
        dependencyId: "dep.c-a",
        predecessorRequirementId: "req.release",
        successorRequirementId: "req.port-access",
        predecessorDecisionKernelIds: ["kernel.release"],
      },
    ],
  };
  assert.throws(() => validate(cycle), /DEPENDENCY_CYCLE/);
});

test("direct due pressure bypasses normal ordering only when explicitly authored", () => {
  const rules = selectionRules();
  Object.assign(rules.requirementDependencies[0]!, {
    bypassWhen: ["DIRECT_DUE_PRESSURE"],
  });
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
  Object.assign(invalid.requirementDependencies[0]!, {
    bypassWhen: ["PROSE_MATCH"],
  });
  assert.throws(
    () => validate(invalid),
    /UNKNOWN_DEPENDENCY_BYPASS/,
  );
});
