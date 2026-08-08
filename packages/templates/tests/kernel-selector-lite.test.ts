import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createOutcomeSignature,
  kernelTieBreaker,
  selectKernelLite,
  stableSha256,
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
    assert.equal(actual.selected?.tieBreaker, expected.selected?.tieBreaker);
  }
});

test("equal structural candidates use a state-bound tie breaker rather than array position", () => {
  const template = neutralCandidates()[0]!;
  const alpha = structuredClone(template);
  alpha.kernelId = "kernel.alpha";
  const beta = structuredClone(template);
  beta.kernelId = "kernel.beta";
  const fingerprint = "STATE-TIE";

  const normal = selectKernelLite([alpha, beta], fingerprint);
  const reversed = selectKernelLite([beta, alpha], fingerprint);
  const expected = [alpha.kernelId, beta.kernelId]
    .sort((left, right) => (
      kernelTieBreaker(fingerprint, left).localeCompare(
        kernelTieBreaker(fingerprint, right),
      )
      || left.localeCompare(right)
    ))[0];

  assert.equal(normal.selected?.kernelId, expected);
  assert.equal(reversed.selected?.kernelId, expected);
  assert.equal(
    normal.evaluations.find((item) => item.kernelId === alpha.kernelId)?.tieBreaker,
    kernelTieBreaker(fingerprint, alpha.kernelId),
  );
  assert.notEqual(
    kernelTieBreaker("STATE-TIE-A", alpha.kernelId),
    kernelTieBreaker("STATE-TIE-B", alpha.kernelId),
  );
});

test("state fingerprints ignore runtime identities and presentation prose but retain structured state", () => {
  const state = (suffix: string, authority = "JOINT") => ({
    sectionId: "section.port",
    turnNumber: 7,
    lastCommittedEventId: `EVENT-${suffix}`,
    review: { authority },
    scene: {
      sceneId: "scene.port",
      locationRef: "location.port",
      locationLabel: `Harbor Hall ${suffix}`,
      timeLabel: `Day ${suffix}`,
      presentActorRefs: ["actor.governor"],
      situation: `Narrative pressure ${suffix}`,
      observableFacts: [`Visible prose ${suffix}`],
      documentStates: [{
        documentRef: "document.manifest",
        accessState: "SEALED",
        holderRef: "actor.governor",
        label: `Manifest ${suffix}`,
        continuityNote: `Prose ${suffix}`,
      }],
    },
    pendingConsequences: [{
      consequenceId: `PC-${suffix}`,
      causedByEventId: `EVENT-${suffix}`,
      ruleAssetId: "rule.deadline",
      dueTurn: 8,
      priority: "P0",
      status: "PENDING",
      summary: `Summary ${suffix}`,
      payoffBeat: {
        beatId: `BEAT-${suffix}`,
        actorRefs: ["actor.governor"],
        action: `Action prose ${suffix}`,
        requiredTermGroups: [[`term-${suffix}`]],
        resultCeiling: `Ceiling ${suffix}`,
      },
    }],
  });

  const first = stableSha256(state("A"));
  const proseOnly = stableSha256(state("B"));
  const structuredChange = stableSha256(state("C", "COUNTY_FIRST"));

  assert.equal(first, proseOnly);
  assert.notEqual(first, structuredChange);
});

test("runtime-generated transfer and event identities cannot manufacture Outcome diversity", () => {
  const transfer = (suffix: string, topic = "records_available") => ({
    transferId: `KT-${suffix}`,
    causedByEventId: `EVENT-${suffix}`,
    topic,
    senderRef: "actor.sender",
    recipientRef: "actor.recipient",
    deliveryMode: "COURIER",
    status: "DELIVERED",
    nested: {
      beatId: `BEAT-${suffix}`,
      sourceEventId: `SOURCE-${suffix}`,
      stableValue: "kept",
    },
  });
  const signature = (suffix: string, topic?: string) => createOutcomeSignature({
    affordanceId: `action.${suffix}`,
    stateFeatures: [
      `state:knowledgeTransfers=${JSON.stringify([transfer(suffix, topic)])}`,
    ],
    durablePredicateFeatures: [],
    pendingRuleFeatures: [],
    sectionAfter: "section.port",
    partCompletionStatusAfter: null,
  });

  const first = signature("A");
  const retry = signature("B");
  const semanticChange = signature("C", "different_topic");

  assert.deepEqual(first.stateFeatures, retry.stateFeatures);
  assert.equal(first.hash, retry.hash);
  assert.notEqual(first.hash, semanticChange.hash);
  assert.match(first.stateFeatures[0]!, /records_available/u);
  assert.match(first.stateFeatures[0]!, /stableValue/u);
  assert.doesNotMatch(
    first.stateFeatures[0]!,
    /KT-A|EVENT-A|BEAT-A|SOURCE-A/u,
  );
});

test("recent structured Requirement continuity outranks a later outcome-distance tie", () => {
  const [base] = neutralCandidates();
  assert.ok(base);
  const direct = structuredClone(base);
  direct.kernelId = "kernel.direct-continuation";
  direct.recentRequirementContinuityCount = 2;

  const adjacent = structuredClone(base);
  adjacent.kernelId = "kernel.adjacent-conflict";
  adjacent.recentRequirementContinuityCount = 1;

  const normal = selectKernelLite([adjacent, direct], "STATE-CONTINUITY");
  const reversed = selectKernelLite([direct, adjacent], "STATE-CONTINUITY");
  assert.equal(normal.selected?.kernelId, direct.kernelId);
  assert.equal(reversed.selected?.kernelId, direct.kernelId);
});

test("duplicate outcomes are traced and cannot form a valid option pair", () => {
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
  const evaluation = result.evaluations[0];
  assert.equal(result.selected, null);
  assert.ok(evaluation);
  assert.equal(
    evaluation.reasonCodes.includes("INSUFFICIENT_DISTINCT_OUTCOMES"),
    true,
  );
  assert.equal(
    evaluation.reasonCodes.includes(
      "DUPLICATE_OUTCOME:action.second:action.first",
    ),
    true,
  );
  assert.deepEqual(evaluation.validAffordanceIds, ["action.first"]);
  assert.equal(evaluation.outcomeHashes.length, 1);
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
