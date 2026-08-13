import assert from "node:assert/strict";
import test from "node:test";
import type { AEmotionAuthoritySignalV1 } from "./contracts";
import {
  deriveCrossImpactPresentationV1,
  deriveStateTransitionPresentationV1,
  isFirstDangerCrossingV1,
  isFirstMilestoneAchievementV1,
} from "./trigger-derivation";

test("CROSS_IMPACT sends minor effects to Feed and major effects to a center card, never a modal", () => {
  const minor = deriveCrossImpactPresentationV1({
    sourceSeatId: "zhejiang_governor",
    signal: signal({ severity: "MINOR", targetSeatId: "jiangnan_merchant" }),
  });
  assert.equal(minor.kind, "DIRECT_IMPACT");
  assert.deepEqual(minor.presentation, {
    recommendedPresentation: "FEED_ONLY",
    centerCardType: null,
    responseOptions: [],
    modalTrigger: null,
  });

  const major = deriveCrossImpactPresentationV1({
    sourceSeatId: "zhejiang_governor",
    signal: signal({ severity: "MAJOR", targetSeatId: "jiangnan_merchant" }),
  });
  assert.equal(major.presentation.recommendedPresentation, "CENTER_CARD");
  assert.equal(major.presentation.centerCardType, "CROSS_IMPACT");
  assert.equal(major.presentation.responseOptions.length, 3);
  assert.equal(major.presentation.modalTrigger, null);

  const self = signal({ severity: "CRITICAL", targetSeatId: "zhejiang_governor" });
  assert.deepEqual(deriveCrossImpactPresentationV1({
    sourceSeatId: "zhejiang_governor",
    signal: self,
  }), self);
});

test("CRISIS fires only on the first non-DANGER to DANGER crossing", () => {
  for (const beforeTone of ["DEFAULT", "GOOD", "WARN"] as const) {
    assert.equal(isFirstDangerCrossingV1({
      metricTransitionId: "emperor-trust",
      beforeTone,
      afterTone: "DANGER",
    }), true);
  }
  assert.equal(isFirstDangerCrossingV1({
    metricTransitionId: "emperor-trust",
    beforeTone: "DANGER",
    afterTone: "DANGER",
  }), false, "continuing decline inside DANGER must not repeat the modal");
  assert.equal(isFirstDangerCrossingV1({
    metricTransitionId: "emperor-trust",
    beforeTone: "DANGER",
    afterTone: "WARN",
  }), false);

  const first = deriveStateTransitionPresentationV1({
    signal: modalCandidate("CRISIS"),
    stateVersion: 7,
    metric: {
      metricTransitionId: "emperor-trust:danger-entry",
      beforeTone: "WARN",
      afterTone: "DANGER",
    },
  });
  assert.equal(first.metricTransitionId, "emperor-trust:danger-entry");
  assert.deepEqual(first.presentation.modalTrigger, {
    type: "CRISIS",
    triggerId: "emperor-trust:danger-entry",
    stateVersion: 7,
  });

  const continuing = deriveStateTransitionPresentationV1({
    signal: modalCandidate("CRISIS"),
    stateVersion: 8,
    metric: {
      metricTransitionId: "emperor-trust:danger-entry",
      beforeTone: "DANGER",
      afterTone: "DANGER",
    },
  });
  assert.equal(continuing.metricTransitionId, null);
  assert.equal(continuing.presentation.recommendedPresentation, "CENTER_CARD");
  assert.equal(continuing.presentation.modalTrigger, null);
});

test("STAGE_VICTORY fires only on INACTIVE to ACHIEVED and is not terminal authority", () => {
  assert.equal(isFirstMilestoneAchievementV1({
    milestoneId: "chapter:N3:HIGH",
    beforeState: "INACTIVE",
    afterState: "ACHIEVED",
  }), true);
  assert.equal(isFirstMilestoneAchievementV1({
    milestoneId: "chapter:N3:HIGH",
    beforeState: "ACHIEVED",
    afterState: "ACHIEVED",
  }), false);

  const first = deriveStateTransitionPresentationV1({
    signal: modalCandidate("STAGE_VICTORY"),
    stateVersion: 3,
    milestone: {
      milestoneId: "chapter:N3:HIGH",
      beforeState: "INACTIVE",
      afterState: "ACHIEVED",
    },
  });
  assert.equal(first.milestoneId, "chapter:N3:HIGH");
  assert.equal(first.presentation.modalTrigger?.type, "STAGE_VICTORY");
  assert.equal("terminal" in first, false);
  assert.equal("worldSequence" in first, false);
});

test("trigger derivation is deterministic under duplicate calculation", () => {
  const input = {
    signal: modalCandidate("CRISIS"),
    stateVersion: 5,
    metric: {
      metricTransitionId: "grain-price:danger-entry",
      beforeTone: "GOOD" as const,
      afterTone: "DANGER" as const,
    },
  };
  assert.deepEqual(
    deriveStateTransitionPresentationV1(input),
    deriveStateTransitionPresentationV1(structuredClone(input)),
  );
});

test("deterministic trigger capability has no Provider, LLM, network, or authority writer dependency", () => {
  const graph = [
    deriveCrossImpactPresentationV1,
    deriveStateTransitionPresentationV1,
    isFirstDangerCrossingV1,
    isFirstMilestoneAchievementV1,
  ].map((capability) => capability.toString()).join("\n");
  assert.doesNotMatch(graph, /provider|\bllm\b|fetch\s*\(|worldSequence|settlement|finale/iu);
});

function signal(input: {
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  targetSeatId: "zhejiang_governor" | "jiangnan_merchant";
}): AEmotionAuthoritySignalV1 {
  return {
    signalId: "signal-cross-impact",
    kind: "PUBLIC_ACTION",
    eventCode: "SANGTIAN_BEAT_ACTION_COMMITTED",
    eventFamily: "SANGTIAN_BEAT_ACTION",
    severity: input.severity,
    sharedObjectId: null,
    factRefs: [],
    publicFactRefs: [],
    impacts: [{
      targetSeatId: input.targetSeatId,
      visibility: "TARGET_ONLY",
      type: "GOAL_PROGRESS",
      key: "workingGoalProgress",
      before: 0,
      after: 1,
      delta: 1,
      effectCode: "SANGTIAN_WORKING_ARC_DELTA",
    }],
    audienceSpec: { type: "EXPLICIT", seatIds: [input.targetSeatId] },
    disclosure: "HIDDEN",
    suspectedSeatIds: [],
    suspicionBasisRefs: [],
    evidenceRefs: [],
    revealOfEventId: null,
    promiseId: null,
    milestoneId: null,
    metricTransitionId: null,
    presentation: {
      recommendedPresentation: "FEED_ONLY",
      centerCardType: null,
      responseOptions: [],
      modalTrigger: null,
    },
  };
}

function modalCandidate(type: "CRISIS" | "STAGE_VICTORY"): AEmotionAuthoritySignalV1 {
  return {
    ...signal({ severity: "CRITICAL", targetSeatId: "zhejiang_governor" }),
    signalId: `signal-${type}`,
    kind: "DIRECT_IMPACT",
    presentation: {
      recommendedPresentation: "KEY_MODAL",
      centerCardType: type,
      responseOptions: [
        { code: "VIEW_DETAILS", preferredEntry: "INVESTIGATE", consumesManeuverOnSubmit: false },
        { code: "RESPOND_NOW", preferredEntry: "PLAN", consumesManeuverOnSubmit: false },
        { code: "VIEW_LATER", preferredEntry: "DEFER", consumesManeuverOnSubmit: false },
      ],
      modalTrigger: { type, triggerId: `template-${type}`, stateVersion: 1 },
    },
  };
}
