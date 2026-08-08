import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildDynamicPartOneRuntimeWorkingSet,
} from "../src/story-package/dynamic-kernel-lite-runtime.js";
import {
  settleDynamicPartOneAction,
} from "../src/story-package/dynamic-kernel-lite-settlement.js";
import {
  completePartOneActionSettlement,
  createInitialPartOneState,
  partOneSceneForSection,
  settlePartOneCurrentAction,
} from "../src/story-package/part-one-runtime-engine.js";
import { loadPlayablePartOneRuntimePackage } from "../src/story-package/playable-part-one-runtime.js";
import type {
  PartOneRuntimePackage,
  PartOneState,
} from "../src/story-package/part-one-runtime-types.js";

const configRoot = resolve(__dirname, "../config");

function packageUnderTest() {
  return loadPlayablePartOneRuntimePackage("sangtian", configRoot).package;
}

function sectionTwoState(pkg: PartOneRuntimePackage): PartOneState {
  const state = createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 4;
  state.sectionTurnNumber = 0;
  state.completedKernelIds = [];
  state.pendingConsequences = [];
  state.partCompletionStatus = "IN_PROGRESS";
  state.causalArcStages = {
    ...(state.causalArcStages || {}),
    "ARC-P1-CUSTODY-CONTEST": "OPEN",
  };
  return state;
}

function stateWithOnlyAuthorityUnresolved(pkg: PartOneRuntimePackage) {
  const state = sectionTwoState(pkg);
  state.review.authority = "UNDECIDED";
  state.review.procedureStatus = "UNDECIDED";
  state.witness.accessStatus = "PROTECTED_SECRETLY";
  state.evidence.chainStatus = "TRACEABLE";
  state.evidence.primaryCustodianRef = "actor.qingliu_magistrate";
  return state;
}

function stateWithOnlyWitnessUnresolved(pkg: PartOneRuntimePackage) {
  const state = sectionTwoState(pkg);
  state.review.authority = "JOINT";
  state.review.procedureStatus = "JOINT_REVIEW";
  state.witness.accessStatus = "UNKNOWN";
  state.evidence.chainStatus = "TRACEABLE";
  state.evidence.primaryCustodianRef = "actor.qingliu_magistrate";
  return state;
}

test("SEC-P1-02 selects different existing kernels for different authoritative states", () => {
  const pkg = packageUnderTest();
  const authority = buildDynamicPartOneRuntimeWorkingSet(pkg, stateWithOnlyAuthorityUnresolved(pkg), 4);
  const witness = buildDynamicPartOneRuntimeWorkingSet(pkg, stateWithOnlyWitnessUnresolved(pkg), 4);
  assert.equal(authority.openDecisionKernel.assetId, "DK-P1-REVIEW-AUTHORITY");
  assert.equal(witness.openDecisionKernel.assetId, "DK-P1-WITNESS-ACCESS");
});

test("reversing activeDecisionKernelIds cannot change the selected kernel or pair", () => {
  const pkg = packageUnderTest();
  const state = stateWithOnlyAuthorityUnresolved(pkg);
  const normal = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
  const reversed = structuredClone(pkg);
  const section = reversed.sections.find((item) => item.sectionId === "SEC-P1-02");
  assert.ok(section);
  section.activeDecisionKernelIds.reverse();
  const actual = buildDynamicPartOneRuntimeWorkingSet(reversed, state, 4);
  assert.equal(actual.openDecisionKernel.assetId, normal.openDecisionKernel.assetId);
  assert.deepEqual(
    actual.decisionAffordances.map((item) => item.affordanceTemplateId),
    normal.decisionAffordances.map((item) => item.affordanceTemplateId),
  );
  assert.deepEqual(
    actual.kernelSelection.candidates.map((item) => [item.kernelId, item.tieBreaker]),
    normal.kernelSelection.candidates.map((item) => [item.kernelId, item.tieBreaker]),
  );
});

test("same Part One state remains stable for one hundred selector executions", () => {
  const pkg = packageUnderTest();
  const state = stateWithOnlyWitnessUnresolved(pkg);
  const expected = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
  for (let index = 0; index < 100; index += 1) {
    const actual = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
    assert.equal(actual.kernelSelection.stateFingerprint, expected.kernelSelection.stateFingerprint);
    assert.equal(actual.openDecisionKernel.assetId, expected.openDecisionKernel.assetId);
    assert.deepEqual(
      actual.decisionAffordances.map((item) => item.affordanceTemplateId),
      expected.decisionAffordances.map((item) => item.affordanceTemplateId),
    );
    assert.deepEqual(
      actual.kernelSelection.candidates.map((item) => item.tieBreaker),
      expected.kernelSelection.candidates.map((item) => item.tieBreaker),
    );
  }
});

test("selection trace revision follows the authoritative turn rather than a lagging durable revision", () => {
  const pkg = packageUnderTest();
  const state = stateWithOnlyAuthorityUnresolved(pkg);
  state.turnNumber = 7;
  state.durableState.revision = 2;
  const workingSet = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 7);
  assert.equal(workingSet.kernelSelection.stateRevision, 7);
});

test("reaction WorkingSet cannot be overwritten by the final next-decision WorkingSet", () => {
  const pkg = packageUnderTest();
  const initial = createInitialPartOneState(pkg);
  const current = settlePartOneCurrentAction(
    pkg,
    initial,
    {
      source: "RECOMMENDED",
      decisionId: "opening_d1",
      actionText: "opening_d1",
    },
    1,
  );
  const reactionWorkingSet = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    current.proposedState,
    1,
    {
      pin: {
        decisionKernelId: "DK-P1-EXECUTION-SCOPE",
        decisionPointId: "DK-P1-EXECUTION-SCOPE",
      },
    },
  );
  const nextWorkingSet = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    current.proposedState,
    1,
    {
      pin: {
        decisionKernelId: "DK-P1-RESPONSIBILITY-RECORD",
        decisionPointId: "DK-P1-RESPONSIBILITY-RECORD",
      },
    },
  );
  assert.notEqual(
    reactionWorkingSet.decisionPoint.prompt,
    nextWorkingSet.decisionPoint.prompt,
  );

  const settlement = completePartOneActionSettlement(
    pkg,
    current,
    nextWorkingSet,
    reactionWorkingSet,
  );
  assert.equal(
    settlement.event.authoritativeNpcReactions[0]?.action,
    reactionWorkingSet.decisionPoint.prompt,
  );
  assert.equal(
    settlement.event.nextDecisionPoint.decisionPointId,
    nextWorkingSet.decisionPoint.decisionPointId,
  );
});

test("one malformed candidate is isolated instead of aborting another valid dynamic kernel", () => {
  const pkg = structuredClone(packageUnderTest());
  const broken = pkg.assets.find((item) => (
    item.assetId === "DK-P1-REVIEW-AUTHORITY"
  ));
  assert.ok(broken);
  broken.payload.options = [];

  const workingSet = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    stateWithOnlyWitnessUnresolved(pkg),
    4,
  );
  assert.equal(workingSet.openDecisionKernel.assetId, "DK-P1-WITNESS-ACCESS");
  const failed = workingSet.kernelSelection.candidates.find((item) => (
    item.kernelId === "DK-P1-REVIEW-AUTHORITY"
  ));
  assert.ok(failed);
  assert.equal(failed.eligible, false);
  assert.equal(
    failed.reasonCodes.some((code) => code.startsWith("KERNEL_EVALUATION_FAILED:")),
    true,
  );
});

test("completed kernels and structurally satisfied obligations do not reopen", () => {
  const pkg = packageUnderTest();
  const completedState = stateWithOnlyAuthorityUnresolved(pkg);
  completedState.completedKernelIds = ["DK-P1-REVIEW-AUTHORITY"];
  const completed = buildDynamicPartOneRuntimeWorkingSet(pkg, completedState, 4);
  assert.notEqual(completed.openDecisionKernel.assetId, "DK-P1-REVIEW-AUTHORITY");

  const resolvedState = stateWithOnlyWitnessUnresolved(pkg);
  const resolved = buildDynamicPartOneRuntimeWorkingSet(pkg, resolvedState, 4);
  const authorityTrace = resolved.kernelSelection.candidates.find((item) => (
    item.kernelId === "DK-P1-REVIEW-AUTHORITY"
  ));
  assert.ok(authorityTrace);
  assert.equal(authorityTrace.reasonCodes.includes("OBLIGATION_ALREADY_SATISFIED"), true);
});

test("selected player options always have two distinct authoritative outcomes", () => {
  const pkg = packageUnderTest();
  const workingSet = buildDynamicPartOneRuntimeWorkingSet(pkg, stateWithOnlyAuthorityUnresolved(pkg), 4);
  assert.equal(workingSet.decisionAffordances.length, 2);
  assert.equal(workingSet.kernelSelection.selectedOutcomeHashes.length, 2);
  assert.notEqual(
    workingSet.kernelSelection.selectedOutcomeHashes[0],
    workingSet.kernelSelection.selectedOutcomeHashes[1],
  );
});

test("no distinct preview pair safely falls back to the legacy selector", () => {
  const pkg = structuredClone(packageUnderTest());
  const section = pkg.sections.find((item) => item.sectionId === "SEC-P1-02");
  assert.ok(section);
  section.activeDecisionKernelIds = ["DK-P1-REVIEW-AUTHORITY"];
  const kernel = pkg.assets.find((item) => item.assetId === "DK-P1-REVIEW-AUTHORITY");
  assert.ok(kernel);
  const options = Array.isArray(kernel.payload.options) ? kernel.payload.options : [];
  kernel.payload.options = options.map((option) => ({
    ...option,
    stateEffects: ["review.authority"],
    statePatch: { "review.authority": "JOINT" },
    durableEffects: [],
  }));
  const workingSet = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    stateWithOnlyAuthorityUnresolved(pkg),
    4,
  );
  assert.equal(workingSet.kernelSelection.mode, "LEGACY_FALLBACK");
  assert.equal(workingSet.openDecisionKernel.assetId, "DK-P1-REVIEW-AUTHORITY");
});

test("production settlement coordinator and deterministic rebuild agree on every selected branch", () => {
  const pkg = packageUnderTest();
  const states = [
    stateWithOnlyAuthorityUnresolved(pkg),
    stateWithOnlyWitnessUnresolved(pkg),
  ];

  for (const state of states) {
    const workingSet = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
    for (const chosen of workingSet.decisionAffordances) {
      const settlement = settleDynamicPartOneAction(pkg, structuredClone(state), {
        source: "RECOMMENDED",
        decisionId: chosen.affordanceTemplateId,
        decisionKernelId: chosen.decisionKernelId,
        affordanceTemplateId: chosen.affordanceTemplateId,
        label: chosen.title,
        actionText: chosen.actionText,
        targetRef: chosen.target.id,
      }, 5);
      const rebuilt = buildDynamicPartOneRuntimeWorkingSet(pkg, settlement.proposedState, 5);
      assert.equal(
        settlement.event.nextDecisionPoint.decisionKernelId,
        rebuilt.decisionPoint.decisionKernelId,
      );
      assert.equal(
        settlement.event.nextDecisionPoint.decisionPointId,
        rebuilt.decisionPoint.decisionPointId,
      );
      assert.deepEqual(
        settlement.event.nextKernelSelection?.selectedAffordanceIds,
        rebuilt.kernelSelection.selectedAffordanceIds,
      );
      assert.deepEqual(
        settlement.event.nextKernelSelection?.selectedOutcomeHashes,
        rebuilt.kernelSelection.selectedOutcomeHashes,
      );
    }
  }
});

test("pinned primary recovery reproduces the committed pair and rejects hash drift", () => {
  const pkg = packageUnderTest();
  const state = stateWithOnlyAuthorityUnresolved(pkg);
  const original = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
  const pin = {
    decisionKernelId: original.decisionPoint.decisionKernelId,
    decisionPointId: original.decisionPoint.decisionPointId,
    affordanceIds: [...original.kernelSelection.selectedAffordanceIds],
    outcomeHashes: [...original.kernelSelection.selectedOutcomeHashes],
  };
  const recovered = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4, { pin });
  assert.equal(recovered.kernelSelection.mode, "PINNED_RECOVERY");
  assert.deepEqual(
    recovered.decisionAffordances.map((item) => item.affordanceTemplateId),
    original.decisionAffordances.map((item) => item.affordanceTemplateId),
  );
  assert.throws(() => buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4, {
    pin: { ...pin, outcomeHashes: ["BAD", ...pin.outcomeHashes.slice(1)] },
  }), /PART_ONE_PINNED_OUTCOME_HASH_MISMATCH/u);
});

test("pinned continuation recovery keeps the exact continuation decision point", () => {
  const pkg = packageUnderTest();
  const state = sectionTwoState(pkg);
  const section = pkg.sections.find((item) => item.sectionId === state.sectionId);
  assert.ok(section);
  state.completedKernelIds = [...section.activeDecisionKernelIds];
  state.sectionTurnNumber = section.activeDecisionKernelIds.length;
  const continuation = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 8);
  assert.notEqual(
    continuation.decisionPoint.decisionPointId,
    continuation.decisionPoint.decisionKernelId,
  );
  const recovered = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 8, {
    pin: {
      decisionKernelId: continuation.decisionPoint.decisionKernelId,
      decisionPointId: continuation.decisionPoint.decisionPointId,
    },
  });
  assert.equal(recovered.decisionPoint.decisionKernelId, continuation.decisionPoint.decisionKernelId);
  assert.equal(recovered.decisionPoint.decisionPointId, continuation.decisionPoint.decisionPointId);
  assert.deepEqual(
    recovered.decisionAffordances.map((item) => item.affordanceTemplateId),
    continuation.decisionAffordances.map((item) => item.affordanceTemplateId),
  );
});
