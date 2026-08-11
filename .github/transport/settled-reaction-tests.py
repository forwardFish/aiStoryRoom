from __future__ import annotations

import json
from pathlib import Path

ROOT = Path.cwd()


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


fixture = r'''import type {
  PartOneRuntimeAsset,
  PartOneSceneState,
  PartOneState,
} from "../../src/story-package/part-one-runtime-types.js";

export const neutralScene: PartOneSceneState = {
  sceneId: "scene.harbor-office",
  timeLabel: "morning",
  locationLabel: "harbor office",
  locationRef: "location.harbor-office",
  presentActorRefs: ["actor.harbor-master", "actor.cargo-clerk"],
  situation: "A routine cargo discrepancy is awaiting a documented response.",
  observableFacts: ["The manifest discrepancy is visible to both actors."],
  documentStates: [],
  objectStates: [],
};

export const neutralState = {
  partId: "PART-01",
  sectionId: "section.harbor",
  turnNumber: 1,
  durableState: {
    worldId: "neutral-harbor",
    revision: 0,
    predicates: [],
    pendingRuleIds: [],
  },
  scene: neutralScene,
  reform: { executionMode: "UNSET", scopeStatus: "UNSET", progress: "UNSET" },
  review: { initiationStatus: "UNSET", authority: "OPEN", procedureStatus: "UNSET" },
  evidence: { chainStatus: "UNSET", primaryCustodianRef: null, copyStatus: "UNSET", archiveSealStatus: "UNSET" },
  witness: { accessStatus: "UNSET" },
  grain: { immediatePressure: "UNSET", officialStockStatus: "UNSET", reliefChannel: "UNSET" },
  merchant: { entryStatus: "UNSET", grantedRights: [] },
  land: { riskLevel: "UNSET", safeguardStatus: "UNSET" },
  report: { authorshipMode: "UNSET", firstNarrativeController: "UNSET", attachmentStrength: "UNSET", dispatchStatus: "UNSET" },
  responsibility: { firstRecordStatus: "UNSET", governorExposure: 0, xunfuExposure: 0 },
  relations: { governorXunfu: 0 },
  knowledgeTransfers: [],
  pendingConsequences: [],
  completedKernelIds: [],
  sectionTurnNumber: 0,
  causalArcStages: {},
  lastCommittedEventId: null,
  partCompletionStatus: "IN_PROGRESS",
} as unknown as PartOneState;

export const neutralActorPolicies: PartOneRuntimeAsset[] = [{
  schemaVersion: "runtime-story-asset-v1",
  assetId: "policy.cargo-clerk",
  assetType: "ACTOR_POLICY",
  partIds: ["PART-01"],
  sectionIds: ["section.harbor"],
  requirementIds: ["requirement.cargo-review"],
  decisionKernelIds: [],
  causalArcIds: [],
  actorRefs: ["actor.cargo-clerk"],
  stateDependencies: [],
  visibilityRules: [{
    visibilityClass: "SERVER_AUTHORITATIVE",
    rule: "Only validated current-scene behavior is visible.",
  }],
  sourceClaimIds: [],
  adaptationDecisionIds: [],
  retrievalTags: ["neutral-harbor", "actor-policy"],
  payload: {
    goal: "Preserve an auditable manifest without inventing cargo facts.",
  },
}];
'''
write("packages/templates/tests/fixtures/neutral-unbound-world.ts", fixture)

contract_test = r'''import assert from "node:assert/strict";
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
'''
write("packages/templates/tests/settled-reaction-contract.test.ts", contract_test)

unbound_test = r'''import assert from "node:assert/strict";
import test from "node:test";
import { buildPartOneUnboundActionNarrativeSource } from "../src/story-package/settled-reaction-contract.js";
import { neutralActorPolicies, neutralScene } from "./fixtures/neutral-unbound-world.js";

const parsingResult = {
  schemaVersion: "unbound-action-parsing-result-v1" as const,
  parserId: "neutral-structured-parser-v1",
  intentKind: "REQUEST_INSPECTION_RECORD",
  actorId: "actor.harbor-master",
  targetEntityIds: ["document.cargo-manifest"],
  requestedStatePaths: [],
  requestedDurableEffectTypes: [],
  parameters: { scope: "visible-manifest-only" },
};

const capabilityValidation = {
  schemaVersion: "unbound-capability-validation-v1" as const,
  status: "AUTHORIZED" as const,
  capabilityIds: ["capability.inspect-visible-record"],
  validatedConstraintIds: ["constraint.no-material-change"],
  allowedStatePaths: [],
  allowedDurableEffectTypes: [],
  rejectionCodes: [],
};

const settlementResult = {
  schemaVersion: "unbound-settlement-result-v1" as const,
  settlementEventId: "event.harbor.unbound.1",
  status: "SETTLED" as const,
  changedStatePaths: [],
  durableEffectTypes: [],
  requiredVisibleEffects: ["The request is acknowledged without changing cargo state."],
};

const materialEffectPolicy = {
  allowedStatePaths: [],
  allowedDurableEffectTypes: [],
  forbiddenStatePaths: ["cargo.ownership", "cargo.evidenceStatus"],
  forbiddenDurableEffectTypes: ["DOCUMENT.CREATED" as const],
};

test("builds structured narrative provenance for a legal neutral-world action", () => {
  const source = buildPartOneUnboundActionNarrativeSource({
    sourceEventId: "event.harbor.unbound.1",
    sourceActionId: "action.harbor.unbound.1",
    actionText: "Ask the clerk to record that a visible-manifest inspection was requested.",
    parsingResult,
    capabilityValidation,
    settlementResult,
    currentScene: neutralScene,
    actorPolicies: neutralActorPolicies,
    materialEffectPolicy,
    settledReactionContract: null,
    policyResolvedReactions: [{
      reactionEventId: "reaction.harbor.1",
      actorRefs: ["actor.cargo-clerk"],
      action: "The clerk acknowledges the request without altering the manifest.",
      policyAssetId: "policy.cargo-clerk",
    }],
    resultCeiling: "Narrate acknowledgment and inspection preparation only.",
    forbiddenEscalations: ["NEW_EVIDENCE", "NEW_MAJOR_COMMAND"],
  });
  assert.equal(source.schemaVersion, "unbound-action-narrative-source-v1");
  assert.equal(source.capabilityValidation.status, "AUTHORIZED");
  assert.equal(source.settlementResult.status, "SETTLED");
  assert.equal(source.currentScene.sceneId, neutralScene.sceneId);
  assert.equal(source.actorGoals[0]?.actorId, "actor.cargo-clerk");
  assert.equal(source.visibleReactionSource.sourceKind, "POLICY_REACTION");
  assert.deepEqual(JSON.parse(JSON.stringify(source)), source);
});

test("fails closed when Settlement applies an unauthorized material change", () => {
  assert.throws(
    () => buildPartOneUnboundActionNarrativeSource({
      sourceEventId: "event.harbor.unbound.2",
      sourceActionId: "action.harbor.unbound.2",
      actionText: "Request an inspection.",
      parsingResult: { ...parsingResult, requestedStatePaths: ["cargo.ownership"] },
      capabilityValidation,
      settlementResult: {
        ...settlementResult,
        settlementEventId: "event.harbor.unbound.2",
        changedStatePaths: ["cargo.ownership"],
      },
      currentScene: neutralScene,
      actorPolicies: neutralActorPolicies,
      materialEffectPolicy,
      settledReactionContract: null,
      policyResolvedReactions: [],
      resultCeiling: "No material change is authorized.",
      forbiddenEscalations: [],
    }),
    /UNBOUND_SETTLEMENT_STATE_PATH_NOT_AUTHORIZED/,
  );
});

test("fails closed when capability validation rejects the action", () => {
  assert.throws(
    () => buildPartOneUnboundActionNarrativeSource({
      sourceEventId: "event.harbor.unbound.3",
      sourceActionId: "action.harbor.unbound.3",
      actionText: "Request an inspection.",
      parsingResult,
      capabilityValidation: {
        ...capabilityValidation,
        status: "REJECTED",
        rejectionCodes: ["OUTSIDE_CAPABILITY"],
      },
      settlementResult: {
        ...settlementResult,
        settlementEventId: "event.harbor.unbound.3",
      },
      currentScene: neutralScene,
      actorPolicies: neutralActorPolicies,
      materialEffectPolicy,
      settledReactionContract: null,
      policyResolvedReactions: [],
      resultCeiling: "Rejected actions cannot become narrative canon.",
      forbiddenEscalations: [],
    }),
    /UNBOUND_CAPABILITY_NOT_AUTHORIZED/,
  );
});
'''
write("packages/templates/tests/unbound-action-narrative-source.test.ts", unbound_test)

existing_test = "packages/templates/tests/part-one-dynamic-kernel-lite.test.ts"
text = read(existing_test)
text = text.replace('"settled-reaction-v1"', '"settled-reaction-template-v1"')
text = text.replace(
    'option.settledReaction?.sourceAffordanceTemplateId,\n      option.affordanceTemplateId,',
    'option.settledReaction?.sourceActionId,\n      option.affordanceTemplateId,',
)
text = text.replace(
    'String(option.settledReaction?.action || "").trim().length > 0',
    'String(option.settledReaction?.reactionAction.visibleAction || "").trim().length > 0',
)
write(existing_test, text)

package_path = "packages/templates/package.json"
data = json.loads(read(package_path))
data["scripts"]["test:settled-reaction-contract"] = (
    "node --import tsx --test "
    "tests/settled-reaction-contract.test.ts "
    "tests/unbound-action-narrative-source.test.ts"
)
story_package = data["scripts"].get("test:story-package", "")
for test_path in [
    "tests/settled-reaction-contract.test.ts",
    "tests/unbound-action-narrative-source.test.ts",
]:
    if test_path not in story_package:
        story_package += " " + test_path
data["scripts"]["test:story-package"] = story_package.strip()
write(package_path, json.dumps(data, ensure_ascii=False, indent=2))
print("neutral second-world and focused tests staged")
