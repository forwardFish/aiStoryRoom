import assert from "node:assert/strict";
import test from "node:test";
import {
  caesarRuntimeFixture,
  caesarSettlementFixture,
  sangtianRuntimeFixture,
  sangtianSettlementFixture,
} from "../src/runtime-contract/fixtures";
import {
  compileDestinyNetProjection,
  compilePlayerTurnProjection,
} from "../src/runtime-contract/projection";
import { DeterministicSettlementEngine } from "../src/runtime-contract/settlement";
import type {
  CausalEvent,
  DurableTurnEnvelope,
  PlayerActionIntent,
  SettlementSnapshot,
  WorldRuntimeContract,
} from "../src/runtime-contract/types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test("P06 one settlement produces distinct safe projections for both Sangtian players", () => {
  const outcome = settleFixture(sangtianRuntimeFixture, sangtianSettlementFixture);
  const governor = compilePlayerTurnProjection({
    contract: sangtianRuntimeFixture,
    snapshot: outcome.snapshot,
    envelope: outcome.envelope,
    actorId: "sangtian.actor.governor",
  });
  const inspector = compilePlayerTurnProjection({
    contract: sangtianRuntimeFixture,
    snapshot: outcome.snapshot,
    envelope: outcome.envelope,
    actorId: "sangtian.actor.inspector",
  });

  assert.equal(governor.personalEchoes.length, 1);
  assert.equal(inspector.personalEchoes.length, 0);
  assert.equal(governor.crossPlayerEchoes.length, 1);
  assert.equal(inspector.crossPlayerEchoes.length, 1);
  assert.equal(governor.worldEchoes.length, 1);
  assert.equal(inspector.worldEchoes.length, 1);
  assert.equal(governor.destinyQuestion, "如何维持局势？");
  assert.equal(inspector.destinyQuestion, "如何查明事实？");
  assert.doesNotMatch(JSON.stringify(governor), /sangtian\.secret\.plan/u);
  assert.doesNotMatch(JSON.stringify(inspector), /sangtian\.secret\.plan/u);
});

test("P06 the same projection compiler builds Caesar relations and destiny-net data", () => {
  const outcome = settleFixture(caesarRuntimeFixture, caesarSettlementFixture);
  const senator = compilePlayerTurnProjection({
    contract: caesarRuntimeFixture,
    snapshot: outcome.snapshot,
    envelope: outcome.envelope,
    actorId: "caesar.actor.senator",
  });
  const net = compileDestinyNetProjection(senator, caesarRuntimeFixture);

  assert.equal(senator.relationshipChanges[0]?.kind, "TRUST");
  assert.equal(senator.relationshipChanges[0]?.delta, 1);
  assert.ok(net.nodes.some((node) => node.id === "caesar.actor.senator" && node.type === "SELF"));
  assert.ok(net.nodes.some((node) => node.id === "caesar.actor.envoy" && node.type === "ACTOR"));
  assert.ok(net.edges.some((edge) => (
    edge.from === "caesar.actor.senator"
    && edge.to === "caesar.actor.envoy"
  )));
  assert.doesNotMatch(JSON.stringify(senator), /caesar\.secret\.route/u);
  assert.doesNotMatch(JSON.stringify(net), /caesar\.secret\.route/u);
});

test("P06 a private causal event reaches only its authorized player", () => {
  const event = privateCaesarEvent();
  const snapshot: SettlementSnapshot = {
    runId: event.runId,
    state: {
      ...clone(caesarRuntimeFixture.openingState),
      revision: 1,
      predicates: [
        ...clone(caesarRuntimeFixture.openingState.predicates),
        clone(event.predicate),
      ],
    },
    events: [event],
    pending: [],
  };
  const envelope = privateEnvelope(event);
  const envoy = compilePlayerTurnProjection({
    contract: caesarRuntimeFixture,
    snapshot,
    envelope,
    actorId: "caesar.actor.envoy",
  });
  const senator = compilePlayerTurnProjection({
    contract: caesarRuntimeFixture,
    snapshot,
    envelope,
    actorId: "caesar.actor.senator",
  });

  assert.equal(envoy.privateFacts.length, 1);
  assert.equal(envoy.personalEchoes.length, 1);
  assert.equal(senator.privateFacts.length, 0);
  assert.equal(senator.personalEchoes.length, 0);
  assert.doesNotMatch(JSON.stringify(senator), /letter is gone|EVIDENCE\.DESTROYED|caesar\.event\.letter-destroyed/iu);
});

function settleFixture(
  contract: WorldRuntimeContract,
  settlementPackage: Parameters<DeterministicSettlementEngine["settle"]>[1],
) {
  const result = new DeterministicSettlementEngine().settle(
    contract,
    settlementPackage,
    { runId: `${contract.worldId}.run.one`, state: clone(contract.openingState), events: [], pending: [] },
    intent(contract),
  );
  assert.equal(result.kind, "ACCEPTED");
  if (result.kind !== "ACCEPTED") throw new Error(result.code);
  return result.result;
}

function intent(contract: WorldRuntimeContract): PlayerActionIntent {
  return {
    actionId: `${contract.worldId}.action.one`,
    runId: `${contract.worldId}.run.one`,
    actorId: contract.roles[0]!.actorId,
    rawText: "The player selects the available capability.",
    submittedAt: "2026-08-03T00:00:00.000Z",
    expectedStateRevision: 0,
    intentType: "USE_CAPABILITY",
    referencedEntityIds: [contract.entities[2]!.id],
    proposedCapabilityId: contract.capabilities[0]!.id,
    explicitCommitment: false,
    explicitOrder: false,
    confidence: 1,
  };
}

function privateCaesarEvent(): CausalEvent {
  return {
    eventId: "caesar.event.letter-destroyed",
    runId: "caesar.run.private",
    worldId: "caesar",
    worldTurnId: "caesar.run.private.turn.1",
    sourceActionId: "caesar.action.private",
    sourceRuleId: "caesar.rule.destroy",
    originActorId: "caesar.actor.envoy",
    affectedActorIds: ["caesar.actor.envoy"],
    predicate: { type: "EVIDENCE.DESTROYED", evidenceId: "caesar.evidence.letter" },
    status: "APPLIED",
    createdAtRevision: 0,
    visibility: { scope: "PRIVATE", actorId: "caesar.actor.envoy" },
    affectedPlayerSummaries: {
      "caesar.actor.envoy": "The letter is gone.",
    },
    revealOriginActor: true,
    containsProtectedSecret: false,
    idempotencyKey: "caesar.key.letter-destroyed",
  };
}

function privateEnvelope(event: CausalEvent): DurableTurnEnvelope {
  return {
    turnEnvelopeId: "caesar.envelope.private",
    runId: event.runId,
    worldTurnId: event.worldTurnId,
    beforeStateRevision: 0,
    sourceActionId: event.sourceActionId,
    originActorId: event.originActorId,
    allowedPredicates: [{
      type: "EVIDENCE.DESTROYED",
      constraints: { evidenceId: "caesar.evidence.letter" },
    }],
    requiredVisiblePredicates: [],
    forbiddenPredicatePatterns: [],
    unresolvedFacts: [],
    activeSceneEntityIds: ["caesar.actor.envoy", "caesar.evidence.letter"],
    personalEffects: [{ eventId: event.eventId, expectedStatus: "APPLIED" }],
    crossPlayerEffects: [],
    worldEffects: [],
    delayedEffects: [],
    projectionActorId: event.originActorId,
    narrativeSeed: {
      playerOutcome: "The letter is gone.",
      npcOrWorldPressure: "The warning route is now constrained.",
      stopCondition: "Choose who to warn next.",
    },
  };
}
