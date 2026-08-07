import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import {
  applyOpenNovelManeuverPlan,
  compileOpenNovelManeuverPlan,
  ensureOpenNovelManeuverState,
  openNovelManeuverClock,
  projectOpenNovelManeuvers,
  withOpenNovelManeuverState,
} from "./openovel-maneuver";
import { sangtianOpenNovelManeuverPackage } from "./sangtian-openovel-maneuver.package";

const game = getGameDefinition("sangtian");
const maneuverPackage = sangtianOpenNovelManeuverPackage;

function projection(stateJson: unknown = {}, turnNumber = 0) {
  return projectOpenNovelManeuvers({
    stateJson,
    turnNumber,
    runtimeStatus: "READY",
    mainDecisionOpen: true,
    canHumanAct: true,
    maneuverPackage,
  });
}

function resultInput(id: string, turnNumber: number, title: string, narrative: string) {
  return {
    id,
    turnNumber,
    title,
    narrative,
    idempotencyKey: `test-key-${id}`,
    requestFingerprint: `fingerprint-${id}`,
    createdAt: new Date(1_700_000_000_000 + turnNumber).toISOString(),
  };
}

test("OpenNovel projects server-authoritative maneuver availability for the opening turn", () => {
  const projected = projection();
  assert.deepEqual(openNovelManeuverClock(0, maneuverPackage), {
    turnNumber: 0,
    sceneIndex: 0,
    sceneKey: "d1_1",
    usageDay: 1,
  });
  assert.equal(projected.maneuverPanel.sceneKey, "d1_1");
  assert.equal(projected.maneuverPanel.quota.remaining, 2);
  assert.equal(projected.maneuverPanel.contact.enabled, true);
  assert.equal(projected.maneuverPanel.contact.count, 2);
  assert.equal(projected.maneuverPanel.investigate.enabled, true);
  assert.equal(projected.maneuverPanel.investigate.count, 1);
  assert.equal(projected.maneuverPanel.leverage.enabled, false);
  assert.equal(projected.maneuverPanel.leverage.disabledReason, "当前剧情没有合适的出牌时机");
  assert.equal(projected.maneuverPanel.custom.enabled, true);
  assert.equal(projected.leverageHand.availableCount, 3);
  assert.notEqual(projected.maneuverPanel.contact.disabledReason, "主动谋划配置正在加载");
});

test("two distinct maneuver types consume the daily quota without advancing the OpenNovel turn", () => {
  const opening = projection();
  const contact = compileOpenNovelManeuverPlan({
    command: {
      maneuverType: "contact",
      targetRoleKey: "county_magistrate",
      messageText: "原始名册为何早于诏令形成？",
    },
    projection: opening,
    game,
    roleKey: "zhejiang_governor",
    turnNumber: 0,
    maneuverPackage,
  });
  assert.equal("accepted" in contact, false);
  const afterContact = applyOpenNovelManeuverPlan({
    state: opening.state,
    plan: contact as any,
    result: resultInput("contact-1", 0, (contact as any).title, (contact as any).fallbackNarrative),
  });
  let stateJson = withOpenNovelManeuverState({}, afterContact.state);
  const oneUsed = projection(stateJson, 0);
  assert.equal(oneUsed.maneuverPanel.quota.remaining, 1);
  assert.equal(oneUsed.maneuverPanel.contact.enabled, false);
  assert.equal(oneUsed.maneuverPanel.investigate.enabled, true);

  const investigate = compileOpenNovelManeuverPlan({
    command: {
      maneuverType: "investigate",
      intentKey: "inspect_first_register_timing",
    },
    projection: oneUsed,
    game,
    roleKey: "zhejiang_governor",
    turnNumber: 0,
    maneuverPackage,
  });
  assert.equal((investigate as any).needsAiNarrative, false);
  const afterInvestigation = applyOpenNovelManeuverPlan({
    state: oneUsed.state,
    plan: investigate as any,
    result: resultInput("investigate-1", 0, (investigate as any).title, (investigate as any).fallbackNarrative),
  });
  stateJson = withOpenNovelManeuverState(stateJson, afterInvestigation.state);
  const exhausted = projection(stateJson, 0);
  assert.equal(exhausted.maneuverPanel.quota.remaining, 0);
  assert.equal(exhausted.state.results.length, 2);
  assert.deepEqual([...exhausted.state.usedTypesToday].sort(), ["contact", "investigate"]);
  assert.equal(exhausted.maneuverPanel.custom.enabled, false);
});

test("moving to the next authored day resets type quota but preserves durable facts and consumed leverage", () => {
  const d1SecondScene = projection({}, 2);
  assert.equal(d1SecondScene.maneuverPanel.sceneKey, "d1_2");
  const leverage = compileOpenNovelManeuverPlan({
    command: {
      maneuverType: "leverage",
      leverageKey: "xunfu_merchant_old_pact_rumor",
      targetRoleKey: "merchant",
    },
    projection: d1SecondScene,
    game,
    roleKey: "zhejiang_governor",
    turnNumber: 2,
    maneuverPackage,
  });
  const used = applyOpenNovelManeuverPlan({
    state: d1SecondScene.state,
    plan: leverage as any,
    result: resultInput("leverage-1", 2, (leverage as any).title, (leverage as any).fallbackNarrative),
  });
  const sameDay = projection(withOpenNovelManeuverState({}, used.state), 2);
  assert.equal(sameDay.leverageHand.items.some((item) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);

  const nextDay = projection(withOpenNovelManeuverState({}, used.state), 4);
  assert.equal(nextDay.state.usageDay, 2);
  assert.equal(nextDay.maneuverPanel.quota.remaining, 2);
  assert.deepEqual(nextDay.state.usedTypesToday, []);
  assert.ok(nextDay.state.usedLeverageKeys.includes("xunfu_merchant_old_pact_rumor"));
  assert.equal(nextDay.leverageHand.items.some((item) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);
});

test("legacy stateJson without maneuver fields is migrated deterministically", () => {
  const restored = ensureOpenNovelManeuverState({
    openovel: { turnNumber: 0 },
  }, 0, maneuverPackage);
  assert.equal(restored.schemaVersion, "openovel_maneuver_state_v1");
  assert.equal(restored.maneuverOpportunitiesRemaining, 2);
  assert.deepEqual(restored.usedTypesToday, []);
  assert.deepEqual(restored.usedLeverageKeys, []);
  assert.equal(restored.results.length, 0);
});

test("generic ActionGuard rejects an attempt to control every other actor", () => {
  const projected = projection();
  const guarded = compileOpenNovelManeuverPlan({
    command: {
      maneuverType: "custom",
      customText: "让所有人服从，并替其他角色决定接下来必须选择什么。",
    },
    projection: projected,
    game,
    roleKey: "zhejiang_governor",
    turnNumber: 0,
    maneuverPackage,
  });
  assert.equal("accepted" in guarded, true);
  assert.equal((guarded as any).accepted, false);
  assert.equal((guarded as any).code, "ACTION_BLOCKED");
});
