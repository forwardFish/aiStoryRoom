import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import {
  compileConfirmedManeuverContext,
  hydrateOpenNovelManeuverStateFromEvents,
  markConfirmedManeuverContextConsumed,
  projectOpenNovelManeuverKnowledge,
} from "./openovel-maneuver-context";
import {
  applyOpenNovelManeuverPlan,
  compileOpenNovelManeuverPlan,
  projectOpenNovelManeuvers,
  type OpenNovelManeuverPlan,
} from "./openovel-maneuver";
import { sangtianOpenNovelManeuverPackage } from "./sangtian-openovel-maneuver.package";

const game = getGameDefinition("sangtian");
const maneuverPackage = sangtianOpenNovelManeuverPackage;

function openingProjection(stateJson: unknown = {}) {
  return projectOpenNovelManeuvers({
    stateJson,
    turnNumber: 0,
    runtimeStatus: "READY",
    mainDecisionOpen: true,
    canHumanAct: true,
    maneuverPackage,
  });
}

function requirePlan(value: ReturnType<typeof compileOpenNovelManeuverPlan>): OpenNovelManeuverPlan {
  if ("accepted" in value) throw new Error(`expected accepted plan: ${value.reason}`);
  return value;
}

test("confirmed investigation becomes player-safe Canon context and projected knowledge", () => {
  const projection = openingProjection();
  const plan = requirePlan(compileOpenNovelManeuverPlan({
    command: {
      maneuverType: "investigate",
      intentKey: "inspect_first_register_timing",
    },
    projection,
    game,
    roleKey: "zhejiang_governor",
    turnNumber: 0,
    maneuverPackage,
  }));
  const applied = applyOpenNovelManeuverPlan({
    state: projection.state,
    plan,
    result: {
      id: "confirmed-investigation-1",
      turnNumber: 0,
      title: plan.title,
      narrative: plan.fallbackNarrative,
      idempotencyKey: "context-test-investigation",
      requestFingerprint: "context-fingerprint-investigation",
      createdAt: "2026-08-07T00:00:00.000Z",
    },
  });
  const stateJson = { openovelManeuver: applied.state };
  const context = compileConfirmedManeuverContext({
    stateJson,
    turnNumber: 0,
    maneuverPackage,
  });
  assert.ok(context);
  assert.deepEqual(context.sourceResultIds, ["confirmed-investigation-1"]);
  assert.deepEqual(context.visibleFacts.map((fact) => fact.factKey), ["first_registers_prepared_early"]);
  assert.equal(context.summaries[0].decisionForm, "INVESTIGATION");
  assert.equal(JSON.stringify(context).includes("statePatch"), false);

  const knowledge = projectOpenNovelManeuverKnowledge(applied.state);
  assert.deepEqual(knowledge.visibleFacts.map((fact) => fact.factKey), ["first_registers_prepared_early"]);
  assert.deepEqual(knowledge.evidenceHoldings.map((item) => item.assetKey), ["first_registers_prepared_early"]);
  assert.equal(knowledge.observableTraces.length, 2);
});

test("a confirmed result is supplied to main Canon exactly once", () => {
  const projection = openingProjection();
  const plan = requirePlan(compileOpenNovelManeuverPlan({
    command: {
      maneuverType: "contact",
      targetRoleKey: "county_magistrate",
      messageText: "原始名册是否完整？",
    },
    projection,
    game,
    roleKey: "zhejiang_governor",
    turnNumber: 0,
    maneuverPackage,
  }));
  const applied = applyOpenNovelManeuverPlan({
    state: projection.state,
    plan,
    result: {
      id: "confirmed-contact-1",
      turnNumber: 0,
      title: plan.title,
      narrative: plan.fallbackNarrative,
      idempotencyKey: "context-test-contact",
      requestFingerprint: "context-fingerprint-contact",
      createdAt: "2026-08-07T00:00:00.000Z",
    },
  });
  const stateJson = { openovelManeuver: applied.state };
  const first = compileConfirmedManeuverContext({ stateJson, turnNumber: 0, maneuverPackage });
  assert.ok(first);
  const consumed = markConfirmedManeuverContextConsumed({
    stateJson,
    turnNumber: 1,
    maneuverPackage,
    resultIds: first.sourceResultIds,
  });
  assert.equal(compileConfirmedManeuverContext({
    stateJson: consumed,
    turnNumber: 1,
    maneuverPackage,
  }), null);
});

test("legacy stateJson can rebuild maneuver state from authoritative StoryEvent payloads", () => {
  const projection = openingProjection();
  const plan = requirePlan(compileOpenNovelManeuverPlan({
    command: {
      maneuverType: "investigate",
      intentKey: "inspect_first_register_timing",
    },
    projection,
    game,
    roleKey: "zhejiang_governor",
    turnNumber: 0,
    maneuverPackage,
  }));
  const applied = applyOpenNovelManeuverPlan({
    state: projection.state,
    plan,
    result: {
      id: "event-recovery-investigation-1",
      turnNumber: 0,
      title: plan.title,
      narrative: plan.fallbackNarrative,
      idempotencyKey: "event-recovery-investigation",
      requestFingerprint: "event-recovery-fingerprint",
      createdAt: "2026-08-07T00:00:00.000Z",
    },
  });
  const recovered = hydrateOpenNovelManeuverStateFromEvents({
    stateJson: { openovel: { turnNumber: 0 } },
    eventPayloads: [{ result: applied.result }],
    turnNumber: 0,
    maneuverPackage,
  });
  assert.equal(recovered.recoveredEventCount, 1);
  assert.deepEqual(recovered.state.usedTypesToday, ["investigate"]);
  assert.deepEqual(recovered.state.discoveredFactKeys, ["first_registers_prepared_early"]);
  assert.equal(recovered.state.maneuverOpportunitiesRemaining, 1);
  assert.equal(recovered.state.results[0].id, "event-recovery-investigation-1");
});
