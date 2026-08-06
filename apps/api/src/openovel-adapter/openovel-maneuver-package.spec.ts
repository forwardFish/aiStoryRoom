import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyOpenNovelManeuverPlan,
  compileOpenNovelManeuverPlan,
  openNovelManeuverClock,
  projectOpenNovelManeuvers,
} from "./openovel-maneuver";
import {
  defineOpenNovelManeuverPackage,
  OpenNovelManeuverPackageRegistry,
} from "./openovel-maneuver-package";

const actors = {
  analyst: {
    roleKey: "analyst",
    displayName: "Analyst",
    publicIdentity: "Signal analyst",
    publicGoal: "Classify the anomaly",
    informationStyle: "Reports only verified observations",
  },
  courier: {
    roleKey: "courier",
    displayName: "Courier",
    publicIdentity: "Field courier",
    publicGoal: "Deliver the sealed packet",
    informationStyle: "Shares route details selectively",
  },
};

const investigation = {
  intentKey: "verify_signal",
  title: "Verify the signal",
  summary: "A repeated pulse has an unexplained offset.",
  resultTitle: "Signal verification",
  resultText: "The offset repeats at a stable interval.",
  factKeys: ["signal_interval_verified"],
  statePatch: { evidence: 4 },
  traces: ["signal log"],
};

const accessPass = {
  leverageKey: "access_pass",
  label: "Access pass",
  description: "Request one restricted archive response.",
  resolutionMode: "AI_REACTION" as const,
  requiresTarget: true,
  targetRoleKeys: ["analyst"],
  statePatch: { access: 2 },
  factKeys: [],
  resultTitle: "Access pass used",
  fallbackReply: "The archive can answer one bounded question.",
};

const NEUTRAL_TURN_CALENDAR = [
  { sceneKey: "phase_alpha", usageDay: 1 },
  { sceneKey: "phase_alpha", usageDay: 1 },
  { sceneKey: "phase_beta", usageDay: 2 },
  { sceneKey: "phase_beta", usageDay: 2 },
] as const;

const neutralPackage = defineOpenNovelManeuverPackage({
  packageVersion: "openovel_maneuver_package_v1",
  worldId: "neutral_fixture",
  calendar: {
    expectedTurns: NEUTRAL_TURN_CALENDAR.length,
    turns: NEUTRAL_TURN_CALENDAR,
    scenes: NEUTRAL_TURN_CALENDAR,
  },
  quota: { opportunitiesPerDay: 2 },
  initialLeverageKeys: ["access_pass"],
  customPlan: {
    maxLength: 120,
    title: "Plan recorded",
    statePatch: { initiative: 3 },
    factKeys: [],
    traces: ["player plan"],
    fallbackNarrative: (text) => `The plan "${text}" is recorded as one bounded task.`,
  },
  scene(sceneKey) {
    if (sceneKey === "phase_alpha") {
      return {
        sceneKey,
        contacts: [{
          ...actors.analyst,
          relevance: "Owns the current signal log",
          statePatch: { trust: 1 },
          allowedFactKeys: [],
          fallbackTitle: "Analyst responds",
          fallbackReply: "The offset is real, but its cause is not yet verified.",
        }],
        investigations: [investigation],
        playableLeverageKeys: ["access_pass"],
        customEnabled: true,
      };
    }
    if (sceneKey === "phase_beta") {
      return {
        sceneKey,
        contacts: [{
          ...actors.courier,
          relevance: "Observed the route change",
          statePatch: { trust: 1 },
          allowedFactKeys: [],
          fallbackTitle: "Courier responds",
          fallbackReply: "The route changed after the second checkpoint.",
        }],
        investigations: [],
        playableLeverageKeys: [],
        customEnabled: true,
      };
    }
    return null;
  },
  actor(roleKey) {
    return actors[roleKey as keyof typeof actors] || null;
  },
  leverage(leverageKey) {
    return leverageKey === accessPass.leverageKey ? accessPass : null;
  },
  surfaces: {
    contactFallback: (definition) => `${definition.displayName}: ${definition.fallbackReply}`,
    contactTrace: (definition) => `conversation:${definition.roleKey}`,
    leverageFallback: ({ definition, target, response }) => `${definition.label} -> ${target?.displayName || "world"}: ${response}`,
    leverageTrace: (definition) => `leverage:${definition.leverageKey}`,
    consumedLeverageLabel: "Consumed leverage",
  },
});

const neutralGame = {
  roles: [
    {
      roleKey: "operator",
      roleName: "Operator",
      identity: "Operations lead",
      publicInfo: "Coordinates the response",
      personalGoal: "Stabilize the system",
      currentState: "Active",
      abilityText: "Issue bounded tasks",
      arcText: "Choose what to verify",
      knownInfo: [],
      cannotDo: [],
    },
    {
      roleKey: "analyst",
      roleName: "Analyst",
      identity: "Signal analyst",
      publicInfo: "Reviews signal logs",
      personalGoal: "Verify anomalies",
      currentState: "Active",
      abilityText: "Read logs",
      arcText: "Protect evidence quality",
      knownInfo: [],
      cannotDo: [],
    },
  ],
};

function projection(turnNumber = 0) {
  return projectOpenNovelManeuvers({
    stateJson: {},
    turnNumber,
    runtimeStatus: "READY",
    mainDecisionOpen: true,
    canHumanAct: true,
    maneuverPackage: neutralPackage,
  });
}

test("registry resolves a neutral second-world package without a world branch", () => {
  const registry = new OpenNovelManeuverPackageRegistry([neutralPackage]);
  assert.equal(registry.require("neutral_fixture"), neutralPackage);
  assert.throws(
    () => registry.register(neutralPackage),
    /OPENOVEL_MANEUVER_PACKAGE_DUPLICATE/,
  );
});

test("neutral package owns calendar, leverage catalogue and custom metric effects", () => {
  assert.deepEqual(openNovelManeuverClock(0, neutralPackage), {
    turnNumber: 0,
    sceneIndex: 0,
    sceneKey: "phase_alpha",
    usageDay: 1,
  });
  assert.equal(openNovelManeuverClock(2, neutralPackage).sceneKey, "phase_beta");

  const first = projection();
  assert.equal(first.maneuverPanel.contact.options[0]?.roleKey, "analyst");
  assert.equal(first.maneuverPanel.investigate.options[0]?.intentKey, "verify_signal");
  assert.equal(first.leverageHand.items[0]?.leverageKey, "access_pass");

  const custom = compileOpenNovelManeuverPlan({
    command: { maneuverType: "custom", customText: "Compare both checkpoints" },
    projection: first,
    game: neutralGame,
    roleKey: "operator",
    turnNumber: 0,
    maneuverPackage: neutralPackage,
  });
  assert.equal("accepted" in custom, false);
  const applied = applyOpenNovelManeuverPlan({
    state: first.state,
    plan: custom as any,
    result: {
      id: "neutral-custom-1",
      turnNumber: 0,
      title: (custom as any).title,
      narrative: (custom as any).fallbackNarrative,
      idempotencyKey: "neutral-idempotency-1",
      requestFingerprint: "neutral-fingerprint-1",
      createdAt: new Date(0).toISOString(),
    },
  });
  assert.equal(applied.state.metrics.initiative, 3);
  assert.equal(applied.result.narrative, 'The plan "Compare both checkpoints" is recorded as one bounded task.');
});

test("generic adapter contains no Sangtian package constants or story metrics", async () => {
  const source = await readFile(new URL("./openovel-maneuver.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "mvp-maneuver-config",
    "INITIAL_MVP_LEVERAGE_KEYS",
    "EXPECTED_OPENOVEL_TURNS",
    "d1_1",
    "总督权威",
    "暗账完整度",
    "清算风险",
  ]) {
    assert.equal(source.includes(forbidden), false, `generic adapter must not contain ${forbidden}`);
  }
});
