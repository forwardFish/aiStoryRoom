import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sangtianRuntimeFixture,
  sangtianSettlementFixture,
} from "../src/runtime-contract/fixtures";
import {
  DeterministicSettlementEngine,
  validateSettlementPackage,
} from "../src/runtime-contract/settlement";
import type {
  PlayerActionIntent,
  SettlementSnapshot,
  WorldRuntimeContract,
} from "../src/runtime-contract/types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function openingSnapshot(contract: WorldRuntimeContract): SettlementSnapshot {
  return { state: clone(contract.openingState), events: [], pending: [] };
}

function intentFor(contract: WorldRuntimeContract): PlayerActionIntent {
  return {
    actionId: `${contract.worldId}.action.round3-review`,
    runId: `${contract.worldId}.run.round3-review`,
    actorId: contract.roles[0].actorId,
    rawText: "structured action",
    submittedAt: "2026-08-03T00:00:00.000Z",
    expectedStateRevision: 0,
    intentType: "USE_CAPABILITY",
    referencedEntityIds: [contract.entities[2].id],
    proposedCapabilityId: contract.capabilities[0].id,
    explicitCommitment: false,
    explicitOrder: false,
    confidence: 1,
  };
}

test("legacy affectedActorIds cannot bypass the typed audience and visibility contract", () => {
  const contract = clone(sangtianRuntimeFixture);
  const settlementPackage = clone(sangtianSettlementFixture);
  const route = settlementPackage.bindings[0].echoRoutes.find(
    (candidate) => candidate.category === "CROSS_PLAYER",
  )!;

  (route as unknown as Record<string, unknown>).affectedActorIds = [
    contract.roles[1].actorId,
  ];

  assert.throws(
    () => validateSettlementPackage(settlementPackage, contract),
    /ECHO_ROUTE_INVALID|UNKNOWN_FIELD/,
  );
});

test("RELATION_BASED visibility never expands to an unrelated durable actor", () => {
  const contract = clone(sangtianRuntimeFixture);
  const settlementPackage = clone(sangtianSettlementFixture);
  const unrelatedActorId = "sangtian.actor.unrelated_clerk";
  contract.entities.push({
    id: unrelatedActorId,
    kind: "ACTOR",
    displayName: "Unrelated clerk",
    aliases: [],
    durable: true,
    initialStatus: {},
  });
  contract.capabilities[0].effectPatterns.push({
    type: "WORLD.PRESSURE_CHANGED",
    constraints: {},
  });
  contract.delayedRules[0].capabilityId = contract.capabilities[0].id;
  contract.delayedRules[0].condition = {
    all: [contract.causalRules[0].effects[0]],
  };
  contract.delayedRules[0].visibility = {
    scope: "RELATION_BASED",
    policyId: contract.roles[0].policyId,
  };
  settlementPackage.bindings[0].delayedRuleIds = [contract.delayedRules[0].id];

  const outcome = new DeterministicSettlementEngine().settle(
    contract,
    settlementPackage,
    openingSnapshot(contract),
    intentFor(contract),
  );

  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") return;
  const relationEvent = outcome.result.events.find(
    (event) => event.status === "SCHEDULED",
  );
  assert.ok(relationEvent);
  assert.ok(
    !relationEvent.affectedActorIds.includes(unrelatedActorId),
    `${relationEvent.eventId} leaked a relation-scoped event to an unrelated actor`,
  );
});

test("PERSONAL CROSS_PLAYER and WORLD echoes require distinct causal sources", () => {
  const contract = sangtianRuntimeFixture;
  const settlementPackage = clone(sangtianSettlementFixture);
  for (const route of settlementPackage.bindings[0].echoRoutes) {
    route.ruleId = contract.causalRules[0].id;
    route.effectIndex = 0;
  }

  assert.throws(
    () => validateSettlementPackage(settlementPackage, contract),
    /ECHO_CAUSAL_SOURCE_DUPLICATE|ECHO_EFFECT_DUPLICATE/,
  );
});

test("neutral synthetic package settles without world-specific runtime behavior", () => {
  const neutralize = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value).replaceAll("sangtian", "neutral")) as T;
  const contract = neutralize(sangtianRuntimeFixture);
  const settlementPackage = neutralize(sangtianSettlementFixture);
  contract.title = "Neutral synthetic world";
  contract.entities.forEach((entity, index) => {
    entity.displayName = `Entity ${index + 1}`;
    entity.aliases = [];
  });
  contract.roles.forEach((role) => { role.destinyQuestion = "What changes next?"; });

  const outcome = new DeterministicSettlementEngine().settle(
    contract,
    settlementPackage,
    openingSnapshot(contract),
    intentFor(contract),
  );

  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") return;
  assert.equal(outcome.result.envelope.personalEffects.length, 1);
  assert.equal(outcome.result.envelope.crossPlayerEffects.length, 1);
  assert.equal(outcome.result.envelope.worldEffects.length, 1);
});
