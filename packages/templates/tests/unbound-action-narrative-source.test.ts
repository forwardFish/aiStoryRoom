import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildPartOneRuntimeWorkingSet,
  createInitialPartOneState,
  loadPartOneRuntimePackage,
  settlePartOneAction,
} from "../src/runtime-entry.js";
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
      parsingResult,
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

const configRoot = resolve(__dirname, "../config");
const CAPABILITY_ACTION_PREFIX = "\u2063OMW_CAPABILITY_V1:";
const CAPABILITY_ACTION_SUFFIX = "\u2063";

function capabilityEnvelope(decisionPointId: string, action: string) {
  const encoded = Buffer.from(JSON.stringify({
    schemaVersion: "omw-capability-action-v1",
    decisionPointId,
    action,
  }), "utf8").toString("base64url");
  return `${CAPABILITY_ACTION_PREFIX}${encoded}${CAPABILITY_ACTION_SUFFIX}`;
}

test("capability Settlement persists a complete unbound source and settled reaction", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const state = createInitialPartOneState(pkg);
  const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, 0);
  const action = "Record a bounded inspection request without changing material state.";

  const settlement = settlePartOneAction(pkg, state, {
    source: "FREE_TEXT",
    actionText: capabilityEnvelope(
      workingSet.decisionPoint.decisionPointId,
      action,
    ),
    targetRef: "public_frame",
  }, 1);

  const event = settlement.event;
  const frozen = event.settledReactionContract;
  const source = event.unboundActionNarrativeSource;
  assert.ok(frozen);
  assert.ok(source);
  assert.equal(frozen.schemaVersion, "settled-reaction-contract-v1");
  assert.equal(frozen.sourceEventId, event.eventId);
  assert.equal(frozen.sourceEventKind, "CAPABILITY_SETTLEMENT");
  assert.equal(source.schemaVersion, "unbound-action-narrative-source-v1");
  assert.equal(source.sourceEventId, event.eventId);
  assert.equal(source.actionText, action);
  assert.equal(source.parsingResult.parserId, "OMW_CAPABILITY_V1");
  assert.equal(source.capabilityValidation.status, "AUTHORIZED");
  assert.equal(source.settlementResult.status, "SETTLED");
  assert.deepEqual(source.settlementResult.changedStatePaths, []);
  assert.deepEqual(source.settlementResult.durableEffectTypes, []);
  assert.equal(source.currentScene.sceneId, event.sceneAfter.sceneId);
  assert.equal(
    source.visibleReactionSource.sourceKind,
    "SETTLED_REACTION_CONTRACT",
  );
  assert.deepEqual(event.narrativePlan.settledReactionContract, frozen);
  assert.deepEqual(event.narrativePlan.unboundActionNarrativeSource, source);
  assert.deepEqual(event.statePatch, {});
  assert.deepEqual(event.durableEffects, []);
});
