import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import {
  applyOpenNovelManeuverPlan,
  compileOpenNovelManeuverPlan,
  projectOpenNovelManeuvers,
  withOpenNovelManeuverState,
  type OpenNovelManeuverPlan,
} from "./openovel-maneuver";
import { hydrateOpenNovelManeuverStateFromEvents } from "./openovel-maneuver-context";
import { sangtianOpenNovelManeuverPackage } from "./sangtian-openovel-maneuver.package";

const game = getGameDefinition("sangtian");
const maneuverPackage = sangtianOpenNovelManeuverPackage;

function requirePlan(
  value: ReturnType<typeof compileOpenNovelManeuverPlan>,
): OpenNovelManeuverPlan {
  if ("accepted" in value) throw new Error(`expected plan: ${value.reason}`);
  return value;
}

test("partial metric corruption is rebuilt from authoritative maneuver results", () => {
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
      maneuverType: "contact",
      targetRoleKey: "xunfu",
      messageText: "请说明首批名册为何形成得如此迅速。",
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
      id: "metric-recovery-contact",
      turnNumber: 0,
      title: plan.title,
      narrative: plan.fallbackNarrative,
      idempotencyKey: "metric-recovery-idempotency",
      requestFingerprint: "metric-recovery-fingerprint",
      createdAt: "2026-08-07T00:00:00.000Z",
    },
  });
  const stateJson = withOpenNovelManeuverState({}, applied.state) as Record<string, any>;
  stateJson.openovelManeuver.metrics = {
    "总督权威": 99,
    phantom_metric: 42,
  };

  const hydrated = hydrateOpenNovelManeuverStateFromEvents({
    stateJson,
    eventPayloads: [{ result: applied.result }],
    turnNumber: 0,
    maneuverPackage,
  });

  assert.deepEqual(hydrated.state.metrics, plan.statePatch);
  assert.equal(hydrated.needsPersistence, true);
  assert.equal(hydrated.recoveredEventCount, 0);
});
