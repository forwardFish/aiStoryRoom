import assert from "node:assert/strict";
import test from "node:test";
import {
  freezePartOneSettledReactionContract,
  projectPartOneSettledReaction,
  validatePartOneSettledReactionTemplate,
} from "../src/story-package/settled-reaction-contract.js";
import type { PartOneSettledReactionTemplate } from "../src/story-package/part-one-runtime-types.js";
import { neutralScene, neutralState } from "./fixtures/neutral-unbound-world.js";

const template: PartOneSettledReactionTemplate = {
  schemaVersion: "settled-reaction-template-v1",
  sourceEventKind: "AFFORDANCE_SETTLEMENT",
  sourceActionId: "action.inspect-manifest",
  sourceAffordanceTemplateId: "affordance.inspect-manifest",
  responderActorIds: ["actor.cargo-clerk"],
  activationCondition: {
    allOf: [{
      ruleId: "rule.review-open",
      statePath: "review.authority",
      operator: "EQ",
      expectedValue: "OPEN",
      description: "The neutral review remains open.",
    }],
  },
  scenePolicy: "CURRENT_SCENE",
  reactionAction: {
    actionKind: "NPC_RESPONSE",
    targetEntityIds: ["document.cargo-manifest"],
    parameterBindings: { mode: "record-only" },
    visibleAction: "The cargo clerk records that the inspection request was received.",
  },
  resultCeiling: "Record receipt only; do not create cargo evidence or answer the next decision.",
  requiredVisibleEffects: ["The inspection request is visibly recorded."],
  forbiddenEscalations: ["NEW_EVIDENCE", "ANSWER_NEXT_DECISION"],
};

test("freezes a complete replayable reaction before the next decision", () => {
  validatePartOneSettledReactionTemplate(template);
  const nextDecisionPrompt = "Choose whether to detain or release the cargo.";
  const contract = freezePartOneSettledReactionContract({
    template,
    sourceEventId: "event.harbor.7",
    sourceEventKind: "AFFORDANCE_SETTLEMENT",
    sourceActionId: "action.inspect-manifest",
    sourceAffordanceTemplateId: "affordance.inspect-manifest",
    resolvedResponderActorIds: ["actor.cargo-clerk"],
    state: neutralState,
    sceneBefore: neutralScene,
    sceneAfter: neutralScene,
    sectionTransitioned: false,
    fallbackVisibleAction: nextDecisionPrompt,
    requiredVisibleEffects: ["The manifest remains unchanged."],
  });
  assert.ok(contract);
  assert.equal(contract.schemaVersion, "settled-reaction-contract-v1");
  assert.equal(contract.sourceEventId, "event.harbor.7");
  assert.equal(contract.sourceEventKind, "AFFORDANCE_SETTLEMENT");
  assert.equal(contract.sourceActionId, "action.inspect-manifest");
  assert.equal(contract.sourceAffordanceTemplateId, "affordance.inspect-manifest");
  assert.deepEqual(contract.responderActorIds, ["actor.cargo-clerk"]);
  assert.equal(contract.scenePolicy, "CURRENT_SCENE");
  assert.equal(contract.reactionAction.visibleAction, template.reactionAction.visibleAction);
  assert.notEqual(contract.reactionAction.visibleAction, nextDecisionPrompt);
  assert.equal(contract.forbiddenEscalations.includes("ANSWER_NEXT_DECISION"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(contract)), contract);

  const projected = projectPartOneSettledReaction(contract, [{
    reactionEventId: "policy-reaction",
    actorRefs: ["actor.cargo-clerk"],
    action: nextDecisionPrompt,
    policyAssetId: "policy.cargo-clerk",
  }]);
  assert.equal(projected[0]?.action, template.reactionAction.visibleAction);
});

test("activation conditions are evaluated from typed state, not prose", () => {
  const inactiveState = structuredClone(neutralState);
  inactiveState.review.authority = "CLOSED";
  const contract = freezePartOneSettledReactionContract({
    template,
    sourceEventId: "event.harbor.8",
    sourceEventKind: "AFFORDANCE_SETTLEMENT",
    sourceActionId: "action.inspect-manifest",
    sourceAffordanceTemplateId: "affordance.inspect-manifest",
    resolvedResponderActorIds: ["actor.cargo-clerk"],
    state: inactiveState,
    sceneBefore: neutralScene,
    sceneAfter: neutralScene,
    sectionTransitioned: false,
    fallbackVisibleAction: "ignored",
    requiredVisibleEffects: [],
  });
  assert.equal(contract, null);
});
