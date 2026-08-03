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

function durableIntent(contract: WorldRuntimeContract, revision = 0): PlayerActionIntent {
  return {
    actionId: `${contract.worldId}.action.review`,
    runId: `${contract.worldId}.run.review`,
    actorId: contract.roles[0].actorId,
    rawText: "review action",
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

function packageWithPrivateDelayedRule(): {
  contract: WorldRuntimeContract;
  settlementPackage: SettlementPackage;
} {
  const contract = clone(sangtianRuntimeFixture);
  contract.capabilities[0].effectPatterns.push({
    type: "WORLD.PRESSURE_CHANGED",
    constraints: {},
  });
  contract.delayedRules[0].capabilityId = contract.capabilities[0].id;
  contract.delayedRules[0].condition = {
    all: [contract.causalRules[0].effects[0]],
  };
  contract.delayedRules[0].visibility = {
    scope: "PRIVATE",
    actorId: contract.roles[0].actorId,
  };
  const settlementPackage = clone(sangtianSettlementFixture);
  settlementPackage.bindings[0].delayedRuleIds = [contract.delayedRules[0].id];
  return { contract, settlementPackage };
}

test("a reused actionId cannot create duplicate durable events under a new coordinator key", async () => {
  const contract = sangtianRuntimeFixture;
  const coordinator = new InMemorySettlementCoordinator(openingSnapshot(contract));
  const engine = new DeterministicSettlementEngine();
  const first = await coordinator.submit(
    engine,
    contract,
    sangtianSettlementFixture,
    "review.key.one",
    durableIntent(contract),
  );
  assert.equal(first.kind, "ACCEPTED");

  const second = await coordinator.submit(
    engine,
    contract,
    sangtianSettlementFixture,
    "review.key.two",
    durableIntent(contract, 1),
  );
  assert.equal(second.kind, "REJECTED");
  const snapshot = coordinator.read();
  assert.equal(snapshot.state.revision, 1);
  assert.equal(
    new Set(snapshot.events.map((event) => event.eventId)).size,
    snapshot.events.length,
  );
});

test("a protected template must actually materialize the settled player outcome", () => {
  const contract = sangtianRuntimeFixture;
  const settlementPackage = clone(sangtianSettlementFixture);
  settlementPackage.bindings[0].protectedTemplate =
    "A fixed sentence that omits every settled fact.";
  assert.throws(
    () => validateSettlementPackage(settlementPackage, contract),
    /PROTECTED_TEMPLATE/,
  );
});

test("one intent and capability selector cannot have two competing bindings", () => {
  const contract = sangtianRuntimeFixture;
  const settlementPackage = clone(sangtianSettlementFixture);
  settlementPackage.bindings.push({
    ...clone(settlementPackage.bindings[0]),
    id: "sangtian.binding.competing",
    protectedTemplate: "Competing result: {summary}",
  });
  assert.throws(
    () => validateSettlementPackage(settlementPackage, contract),
    /BINDING|SELECTOR|DUPLICATE/,
  );
});

test("the three echo groups cannot silently contain an extra unrendered route", () => {
  const contract = sangtianRuntimeFixture;
  const settlementPackage = clone(sangtianSettlementFixture);
  settlementPackage.bindings[0].echoRoutes.push({
    ...clone(settlementPackage.bindings[0].echoRoutes[1]),
    summary: "A second authorized reaction must not disappear from fallback.",
  });
  assert.throws(
    () => validateSettlementPackage(settlementPackage, contract),
    /ECHO|ROUTE|DUPLICATE/,
  );
});

test("a private delayed consequence is routed only to actors authorized by visibility", () => {
  const { contract, settlementPackage } = packageWithPrivateDelayedRule();
  const outcome = new DeterministicSettlementEngine().settle(
    contract,
    settlementPackage,
    openingSnapshot(contract),
    durableIntent(contract),
  );
  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") return;
  const delayed = outcome.result.events.find((event) => event.status === "SCHEDULED");
  assert.ok(delayed);
  assert.deepEqual(delayed.affectedActorIds, [contract.roles[0].actorId]);
  assert.deepEqual(Object.keys(delayed.affectedPlayerSummaries), [contract.roles[0].actorId]);
});

test("scheduling a delayed rule is reflected in the durable state's pending rule IDs", () => {
  const { contract, settlementPackage } = packageWithPrivateDelayedRule();
  const outcome = new DeterministicSettlementEngine().settle(
    contract,
    settlementPackage,
    openingSnapshot(contract),
    durableIntent(contract),
  );
  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") return;
  assert.deepEqual(outcome.result.snapshot.state.pendingRuleIds, [contract.delayedRules[0].id]);
});

test("a pending event missing from the causal-event ledger cannot alter durable state", () => {
  const { contract, settlementPackage } = packageWithPrivateDelayedRule();
  const engine = new DeterministicSettlementEngine();
  const outcome = engine.settle(
    contract,
    settlementPackage,
    openingSnapshot(contract),
    durableIntent(contract),
  );
  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") return;
  const broken = clone(outcome.result.snapshot);
  const delayed = broken.pending[0].event;
  broken.events = broken.events.filter((event) => event.eventId !== delayed.eventId);
  broken.state.revision = delayed.applyAtRevision ?? broken.state.revision;
  assert.throws(() => engine.applyDue(contract, broken), /PENDING|EVENT|SNAPSHOT/);
});

test("a condition-due delayed batch applies once and advances revision exactly once", () => {
  const { contract, settlementPackage } = packageWithPrivateDelayedRule();
  const engine = new DeterministicSettlementEngine();
  const outcome = engine.settle(contract, settlementPackage, openingSnapshot(contract), durableIntent(contract));
  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") return;
  const candidate = clone(outcome.result.snapshot);
  const pendingEvent = candidate.pending[0].event;
  const ledgerEvent = candidate.events.find((event) => event.eventId === pendingEvent.eventId)!;
  delete pendingEvent.applyAtRevision;
  delete ledgerEvent.applyAtRevision;
  pendingEvent.triggerCondition = { all: [contract.openingState.predicates[0]] };
  ledgerEvent.triggerCondition = clone(pendingEvent.triggerCondition);
  const beforeRevision = candidate.state.revision;
  const applied = engine.applyDue(contract, candidate);
  assert.equal(applied.state.revision, beforeRevision + 1);
  assert.equal(applied.pending[0].event.status, "APPLIED");
  assert.deepEqual(applied.state.pendingRuleIds, []);
  assert.deepEqual(engine.applyDue(contract, clone(applied)), applied);
});
