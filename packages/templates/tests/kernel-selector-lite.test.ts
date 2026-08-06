import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createOutcomeSignature,
  selectKernelLite,
  type KernelSelectorLiteCandidate,
} from "../src/runtime-contract/kernel-selector-lite.js";

function outcome(affordanceId: string, stateFeature: string) {
  return createOutcomeSignature({
    affordanceId,
    stateFeatures: [stateFeature],
    durablePredicateFeatures: [],
    pendingRuleFeatures: [],
    sectionAfter: "section.port",
    partCompletionStatusAfter: null,
  });
}

function neutralCandidates(): Array<KernelSelectorLiteCandidate<{ id: string }>> {
  return [
    {
      kernelId: "kernel.supply-control",
      completed: false,
      allowedInCurrentScope: true,
      structurallyResolved: false,
      unmetMustEstablishCount: 1,
      unmetExitGateCount: 1,
      duePressureCount: 1,
      pendingPressureCount: 0,
      activeArcCount: 1,
      availablePressureActorCount: 2,
      validAffordances: [
        { affordanceId: "action.ration", sourceOrder: 0, outcome: outcome("action.ration", "state:supply=RATIONED"), payload: { id: "ration" } },
        { affordanceId: "action.release", sourceOrder: 1, outcome: outcome("action.release", "state:supply=RELEASED"), payload: { id: "release" } },
      ],
      rejectionCodes: [],
    },
    {
      kernelId: "kernel.access-policy",
      completed: false,
      allowedInCurrentScope: true,
      structurallyResolved: false,
      unmetMustEstablishCount: 1,
      unmetExitGateCount: 0,
      duePressureCount: 0,
      pendingPressureCount: 0,
      activeArcCount: 1,
      availablePressureActorCount: 1,
      validAffordances: [
        { affordanceId: "action.open", sourceOrder: 0, outcome: outcome("action.open", "state:access=OPEN"), payload: { id: "open" } },
        { affordanceId: "action.restrict", sourceOrder: 1, outcome: outcome("action.restrict", "state:access=RESTRICTED"), payload: { id: "restrict" } },
      ],
      rejectionCodes: [],
    },
  ];
}

test("neutral-port selection is independent of input array order", () => {
  const candidates = neutralCandidates();
  const normal = selectKernelLite(candidates, "STATE-A");
  const reversed = selectKernelLite([...candidates].reverse(), "STATE-A");
  assert.equal(normal.selected?.kernelId, "kernel.supply-control");
  assert.equal(reversed.selected?.kernelId, normal.selected?.kernelId);
  assert.deepEqual(
    reversed.selected?.pair && [reversed.selected.pair.left.affordanceId, reversed.selected.pair.right.affordanceId],
    normal.selected?.pair && [normal.selected.pair.left.affordanceId, normal.selected.pair.right.affordanceId],
  );
});

test("same state and candidates remain stable for one hundred executions", () => {
  const candidates = neutralCandidates();
  const expected = selectKernelLite(candidates, "STATE-B");
  for (let index = 0; index < 100; index += 1) {
    const actual = selectKernelLite(candidates, "STATE-B");
    assert.equal(actual.selected?.kernelId, expected.selected?.kernelId);
    assert.equal(actual.selected?.pair?.left.affordanceId, expected.selected?.pair?.left.affordanceId);
    assert.equal(actual.selected?.pair?.right.affordanceId, expected.selected?.pair?.right.affordanceId);
    assert.equal(actual.selected?.maximumOutcomeDistance, expected.selected?.maximumOutcomeDistance);
  }
});

test("duplicate outcomes cannot form a valid option pair", () => {
  const duplicate = outcome("action.first", "state:access=OPEN");
  const result = selectKernelLite([{
    kernelId: "kernel.duplicate",
    completed: false,
    allowedInCurrentScope: true,
    structurallyResolved: false,
    unmetMustEstablishCount: 1,
    unmetExitGateCount: 1,
    duePressureCount: 0,
    pendingPressureCount: 0,
    activeArcCount: 1,
    availablePressureActorCount: 1,
    validAffordances: [
      { affordanceId: "action.first", sourceOrder: 0, outcome: duplicate, payload: { id: "first" } },
      { affordanceId: "action.second", sourceOrder: 1, outcome: { ...duplicate, affordanceId: "action.second" }, payload: { id: "second" } },
    ],
    rejectionCodes: [],
  }], "STATE-C");
  assert.equal(result.selected, null);
  assert.equal(result.evaluations[0]?.reasonCodes.includes("INSUFFICIENT_DISTINCT_OUTCOMES"), true);
});

test("completed and structurally resolved kernels are never eligible", () => {
  const [completed, resolved] = neutralCandidates();
  completed.completed = true;
  resolved.structurallyResolved = true;
  const result = selectKernelLite([completed, resolved], "STATE-D");
  assert.equal(result.selected, null);
  assert.equal(result.evaluations.find((item) => item.kernelId === completed.kernelId)?.reasonCodes.includes("KERNEL_COMPLETED"), true);
  assert.equal(result.evaluations.find((item) => item.kernelId === resolved.kernelId)?.reasonCodes.includes("OBLIGATION_ALREADY_SATISFIED"), true);
});

test("the reusable selector core contains no story vocabulary or narrative parsing hooks", () => {
  const source = readFileSync(
    resolve(__dirname, "../src/runtime-contract/kernel-selector-lite.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /\p{Script=Han}/u);
  for (const forbidden of [
    "sangtian",
    "zhejiang",
    "qingliu",
    "review.authority",
    "evidence.chainStatus",
    "availableWhen",
    "actionText",
    "protectedNarrative",
    "decisionPrompt",
  ]) {
    assert.equal(
      source.toLocaleLowerCase("und").includes(forbidden.toLocaleLowerCase("und")),
      false,
      `world-agnostic selector leaked forbidden token: ${forbidden}`,
    );
  }
});
