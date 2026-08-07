import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import {
  applyOpenNovelManeuverPlan,
  compileOpenNovelManeuverPlan,
  projectOpenNovelManeuvers,
  type OpenNovelManeuverPlan,
} from "./openovel-maneuver";
import {
  compileConfirmedManeuverContext,
  hydrateOpenNovelManeuverStateFromEvents,
} from "./openovel-maneuver-context";
import { sangtianOpenNovelManeuverPackage } from "./sangtian-openovel-maneuver.package";

const game = getGameDefinition("sangtian");
const maneuverPackage = sangtianOpenNovelManeuverPackage;

function requirePlan(
  value: ReturnType<typeof compileOpenNovelManeuverPlan>,
): OpenNovelManeuverPlan {
  if ("accepted" in value) throw new Error(`expected plan: ${value.reason}`);
  return value;
}

test("Canon consumption acknowledgement prevents reinjection after stateJson loss", () => {
  const projection = projectOpenNovelManeuvers({
    stateJson: {},
    turnNumber: 0,
    runtimeStatus: "READY",
    mainDecisionOpen: true,
    canHumanAct: true,
    maneuverPackage,
  });
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
      id: "canon-ack-investigation",
      turnNumber: 0,
      title: plan.title,
      narrative: plan.fallbackNarrative,
      idempotencyKey: "canon-ack-idempotency",
      requestFingerprint: "canon-ack-fingerprint",
      createdAt: "2026-08-07T00:00:00.000Z",
    },
  });

  const recovered = hydrateOpenNovelManeuverStateFromEvents({
    stateJson: { openovel: { turnNumber: 1 } },
    eventPayloads: [{ result: applied.result }],
    consumptionPayloads: [{
      sourceResultIds: [applied.result.id, "unknown-result"],
      turnNumber: 1,
    }],
    turnNumber: 1,
    maneuverPackage,
  });

  assert.equal(recovered.recoveredEventCount, 1);
  assert.equal(recovered.recoveredConsumptionCount, 1);
  assert.deepEqual(recovered.state.canonConsumedResultIds, [applied.result.id]);
  assert.equal(recovered.state.lastCanonBridgeTurnNumber, 1);
  assert.equal(compileConfirmedManeuverContext({
    stateJson: recovered.stateJson,
    turnNumber: 1,
    maneuverPackage,
  }), null);
});
