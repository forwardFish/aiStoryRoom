import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildDynamicPartOneRuntimeWorkingSet,
  settleDynamicPartOneAction,
} from "../src/story-package/dynamic-kernel-lite-runtime.js";
import {
  createInitialPartOneState,
  partOneSceneForSection,
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
  }
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

test("formal settlement and deterministic rebuild agree on the next decision point", () => {
  const pkg = packageUnderTest();
  const state = stateWithOnlyAuthorityUnresolved(pkg);
  const workingSet = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
  const chosen = workingSet.decisionAffordances[0]!;
  const settlement = settleDynamicPartOneAction(pkg, state, {
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
});
