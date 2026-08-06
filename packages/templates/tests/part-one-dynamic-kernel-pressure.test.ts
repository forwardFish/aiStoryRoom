import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildDynamicPartOneRuntimeWorkingSet,
} from "../src/story-package/dynamic-kernel-lite-runtime.js";
import {
  createInitialPartOneState,
  partOneSceneForSection,
} from "../src/story-package/part-one-runtime-engine.js";
import { loadPlayablePartOneRuntimePackage } from "../src/story-package/playable-part-one-runtime.js";
import type {
  PartOnePendingConsequenceState,
  PartOneRuntimePackage,
  PartOneState,
} from "../src/story-package/part-one-runtime-types.js";

const configRoot = resolve(__dirname, "../config");
const SYNTHETIC_RULE_ID = "PCR-NEUTRAL-WITNESS-DUE";

function packageUnderTest() {
  return loadPlayablePartOneRuntimePackage(
    "sangtian",
    configRoot,
  ).package;
}

function authorityState(pkg: PartOneRuntimePackage): PartOneState {
  const state = createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 4;
  state.sectionTurnNumber = 0;
  state.completedKernelIds = [];
  state.pendingConsequences = [];
  state.partCompletionStatus = "IN_PROGRESS";
  state.review.authority = "UNDECIDED";
  state.review.procedureStatus = "UNDECIDED";
  state.witness.accessStatus = "PROTECTED_SECRETLY";
  state.evidence.chainStatus = "TRACEABLE";
  state.evidence.primaryCustodianRef = "actor.qingliu_magistrate";
  state.causalArcStages = {
    ...(state.causalArcStages || {}),
    "ARC-P1-CUSTODY-CONTEST": "OPEN",
  };
  return state;
}

function dueConsequence(index: number): PartOnePendingConsequenceState {
  return {
    consequenceId: `PC-NEUTRAL-WITNESS-${index}`,
    causedByEventId: `EVENT-NEUTRAL-${index}`,
    ruleAssetId: SYNTHETIC_RULE_ID,
    summary: `presentation-only-${index}`,
    payoffBeat: {
      beatId: `BEAT-NEUTRAL-${index}`,
      actorRefs: [],
      action: `presentation-only-${index}`,
      requiredTermGroups: [],
      resultCeiling: `presentation-only-${index}`,
    },
    dueTurn: 5,
    priority: "P0",
    status: "PENDING",
  };
}

test("two due structured pressures can reopen and prioritize their directly linked existing Kernel", () => {
  const basePackage = packageUnderTest();
  const state = authorityState(basePackage);
  const baseline = buildDynamicPartOneRuntimeWorkingSet(
    basePackage,
    state,
    4,
  );
  assert.equal(
    baseline.openDecisionKernel.assetId,
    "DK-P1-REVIEW-AUTHORITY",
  );

  const pkg = structuredClone(basePackage);
  const templateRule = pkg.assets.find((asset) => (
    asset.assetType === "PENDING_CONSEQUENCE_RULE"
    && asset.sectionIds.includes("SEC-P1-02")
  ));
  assert.ok(templateRule);
  pkg.assets.push({
    ...structuredClone(templateRule),
    assetId: SYNTHETIC_RULE_ID,
    sectionIds: ["SEC-P1-02"],
    requirementIds: [],
    decisionKernelIds: ["DK-P1-WITNESS-ACCESS"],
    causalArcIds: [],
    actorRefs: [],
    retrievalTags: ["PART-01", "SEC-P1-02", "PENDING_CONSEQUENCE"],
  });
  state.pendingConsequences = [
    dueConsequence(1),
    dueConsequence(2),
  ];

  const pressured = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
  const witness = pressured.kernelSelection.candidates.find((candidate) => (
    candidate.kernelId === "DK-P1-WITNESS-ACCESS"
  ));
  assert.ok(witness);
  assert.equal(witness.duePressureCount, undefined);
  assert.equal(
    witness.reasonCodes.includes("OBLIGATION_ALREADY_SATISFIED"),
    false,
  );
  assert.equal(
    pressured.openDecisionKernel.assetId,
    "DK-P1-WITNESS-ACCESS",
  );
  assert.equal(pressured.kernelSelection.mode, "DYNAMIC_LITE");
});
