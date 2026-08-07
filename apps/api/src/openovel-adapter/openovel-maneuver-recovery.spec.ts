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

function contactResult() {
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
  return { plan, applied };
}

test("partial metric corruption is rebuilt from authoritative maneuver results", () => {
  const { plan, applied } = contactResult();
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

test("maneuver AI budget is rebuilt from root-event token usage and budget fallback metadata", () => {
  const { applied } = contactResult();
  const stateJson = withOpenNovelManeuverState({}, applied.state) as Record<string, any>;
  stateJson.openovelManeuver.aiBudget = {
    ...stateJson.openovelManeuver.aiBudget,
    calls: 99,
    totalTokens: 999_999,
    totalCostMinor: 999,
    exhausted: false,
    lastFallbackReason: null,
  };
  const budgetBlockedResult = {
    ...applied.result,
    id: "budget-blocked-leverage",
    maneuverType: "leverage",
    decisionForm: "LEVERAGE",
    idempotencyKey: "budget-blocked-idempotency",
    requestFingerprint: "budget-blocked-fingerprint",
    statePatch: {},
    createdAt: "2026-08-07T00:01:00.000Z",
  };

  const hydrated = hydrateOpenNovelManeuverStateFromEvents({
    stateJson,
    eventPayloads: [
      {
        ...applied.result,
        tokenUsage: {
          attempts: 2,
          inputTokens: 100,
          outputTokens: 50,
          costMinor: 3,
        },
        fallbackReason: null,
      },
      {
        ...budgetBlockedResult,
        tokenUsage: {
          attempts: 0,
          inputTokens: 0,
          outputTokens: 0,
          costMinor: 0,
        },
        fallbackReason: "ai_budget_max_calls",
      },
    ],
    turnNumber: 0,
    maneuverPackage,
  });

  assert.equal(hydrated.state.aiBudget.calls, 2);
  assert.equal(hydrated.state.aiBudget.totalTokens, 150);
  assert.equal(hydrated.state.aiBudget.totalCostMinor, 3);
  assert.equal(hydrated.state.aiBudget.exhausted, true);
  assert.equal(hydrated.state.aiBudget.lastFallbackReason, "ai_budget_max_calls");
  assert.equal(hydrated.needsPersistence, true);
});
