import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sangtianRuntimeFixture,
  sangtianSettlementFixture,
} from "../src/runtime-contract/fixtures";
import {
  DeterministicSettlementEngine,
  InMemorySettlementCoordinator,
  validateSettlementPackage,
} from "../src/runtime-contract/settlement";
import type {
  PlayerActionIntent,
  SettlementPackage,
  SettlementSnapshot,
  WorldRuntimeContract,
} from "../src/runtime-contract/types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function openingSnapshot(contract: WorldRuntimeContract): SettlementSnapshot {
  return { state: clone(contract.openingState), events: [], pending: [] };
}

function intentFor(
  contract: WorldRuntimeContract,
  actorId: string,
  revision = 0,
  runId = `${contract.worldId}.run.audience`,
  actionId = `${contract.worldId}.action.audience`,
): PlayerActionIntent {
  return {
    actionId,
    runId,
    actorId,
    rawText: "structured action",
    submittedAt: "2026-08-03T00:00:00.000Z",
    expectedStateRevision: revision,
    intentType: "USE_CAPABILITY",
    referencedEntityIds: [contract.entities[2].id],
    proposedCapabilityId: contract.capabilities[0].id,
    explicitCommitment: false,
    explicitOrder: false,
    confidence: 1,
  };
}

test("PERSONAL routing follows the actual origin actor when a capability is shared", () => {
  const contract = clone(sangtianRuntimeFixture);
  const secondActor = contract.roles[1].actorId;
  contract.capabilities[0].allowedActorIds.push(secondActor);
  contract.actorPolicies[1].capabilityIds.push(contract.capabilities[0].id);
  const outcome = new DeterministicSettlementEngine().settle(
    contract,
    clone(sangtianSettlementFixture),
    openingSnapshot(contract),
    intentFor(contract, secondActor),
  );
  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") return;
  const personalRef = outcome.result.envelope.personalEffects[0];
  const personalEvent = outcome.result.events.find(
    (event) => event.eventId === personalRef.eventId,
  );
  assert.ok(personalEvent);
  assert.ok(personalEvent.affectedActorIds.includes(secondActor));
});

test("CROSS_PLAYER routing cannot resolve only to the origin player", () => {
  const contract = sangtianRuntimeFixture;
  const settlementPackage = clone(sangtianSettlementFixture);
  settlementPackage.bindings[0].echoRoutes.find(
    (route) => route.category === "CROSS_PLAYER",
  )!.affectedActorIds = [contract.roles[0].actorId];
  const outcome = new DeterministicSettlementEngine().settle(
    contract,
    settlementPackage,
    openingSnapshot(contract),
    intentFor(contract, contract.roles[0].actorId),
  );
  assert.equal(outcome.kind, "REJECTED");
});

test("an immediate PRIVATE rule cannot route an echo summary to another player", () => {
  const contract = clone(sangtianRuntimeFixture);
  contract.causalRules[0].visibility = {
    scope: "PRIVATE",
    actorId: contract.roles[0].actorId,
  };
  assert.throws(
    () => validateSettlementPackage(clone(sangtianSettlementFixture), contract),
    /VISIBILITY|ROUTE|ACTOR/,
  );
});

test("one settlement snapshot cannot mix events from two runs", async () => {
  const contract = sangtianRuntimeFixture;
  const coordinator = new InMemorySettlementCoordinator(openingSnapshot(contract));
  const engine = new DeterministicSettlementEngine();
  const actor = contract.roles[0].actorId;
  const first = await coordinator.submit(
    engine,
    contract,
    sangtianSettlementFixture,
    "audience.key.one",
    intentFor(
      contract,
      actor,
      0,
      `${contract.worldId}.run.one`,
      `${contract.worldId}.action.one`,
    ),
  );
  assert.equal(first.kind, "ACCEPTED");
  const second = await coordinator.submit(
    engine,
    contract,
    sangtianSettlementFixture,
    "audience.key.two",
    intentFor(
      contract,
      actor,
      1,
      `${contract.worldId}.run.two`,
      `${contract.worldId}.action.two`,
    ),
  );
  assert.equal(second.kind, "REJECTED");
  assert.equal(coordinator.read().state.revision, 1);
});

test("a private delayed world event may target a non-player actor without leaking to players", () => {
  const contract = clone(sangtianRuntimeFixture);
  const npcId = "sangtian.actor.clerk";
  contract.entities.push({
    id: npcId,
    kind: "ACTOR",
    displayName: "Clerk",
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
  contract.delayedRules[0].visibility = { scope: "PRIVATE", actorId: npcId };
  const settlementPackage: SettlementPackage = clone(sangtianSettlementFixture);
  settlementPackage.bindings[0].delayedRuleIds = [contract.delayedRules[0].id];
  const outcome = new DeterministicSettlementEngine().settle(
    contract,
    settlementPackage,
    openingSnapshot(contract),
    intentFor(contract, contract.roles[0].actorId),
  );
  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") return;
  const delayed = outcome.result.events.find((event) => event.status === "SCHEDULED");
  assert.ok(delayed);
  assert.deepEqual(delayed.affectedActorIds, [npcId]);
  assert.deepEqual(delayed.affectedPlayerSummaries, {});
});
