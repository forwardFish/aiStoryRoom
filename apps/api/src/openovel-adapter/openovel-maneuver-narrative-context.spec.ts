import assert from "node:assert/strict";
import test from "node:test";
import type { OpenNovelPublicRun } from "./openovel-runtime.client";
import {
  ensureOpenNovelManeuverState,
  type OpenNovelManeuverPlan,
} from "./openovel-maneuver";
import type { OpenNovelManeuverPackage } from "./openovel-maneuver-package";
import { buildOpenNovelManeuverNarrativeContext } from "./openovel-maneuver-narrative-context";

const actor = {
  roleKey: "analyst",
  displayName: "Analyst",
  publicIdentity: "Signal analyst",
  publicGoal: "Verify the anomaly without overstating it",
  informationStyle: "Separates observations from inference",
};

const maneuverPackage: OpenNovelManeuverPackage = {
  packageVersion: "neutral-narrative-context-v1",
  worldId: "neutral_narrative_context",
  calendar: {
    expectedTurns: 1,
    turns: [{ sceneKey: "phase_alpha", usageDay: 1 }],
    scenes: [{ sceneKey: "phase_alpha", usageDay: 1 }],
  },
  quota: { opportunitiesPerDay: 2 },
  initialLeverageKeys: [],
  customPlan: {
    maxLength: 200,
    title: "Plan recorded",
    statePatch: {},
    factKeys: [],
    traces: [],
    fallbackNarrative: (text) => text,
  },
  scene(sceneKey) {
    return sceneKey === "phase_alpha" ? {
      sceneKey,
      contacts: [{
        ...actor,
        relevance: "Owns the current signal log",
        statePatch: { trust: 1 },
        allowedFactKeys: ["allowed_fact"],
        fallbackTitle: "Analyst responds",
        fallbackReply: "The observation is verified; the cause is not.",
      }],
      investigations: [],
      playableLeverageKeys: [],
      customEnabled: true,
    } : null;
  },
  actor(roleKey) {
    return roleKey === actor.roleKey ? actor : null;
  },
  leverage() {
    return null;
  },
  surfaces: {
    contactFallback: (definition) => definition.fallbackReply,
    contactTrace: (definition) => `conversation:${definition.roleKey}`,
    leverageFallback: ({ response }) => response,
    leverageTrace: (definition) => `leverage:${definition.leverageKey}`,
    consumedLeverageLabel: "Consumed leverage",
  },
};

const plan: OpenNovelManeuverPlan = {
  maneuverType: "contact",
  decisionForm: "CONVERSATION",
  sceneKey: "phase_alpha",
  usageDay: 1,
  title: "Analyst responds",
  fallbackNarrative: "The observation is verified; the cause is not.",
  targetRoleKey: "analyst",
  consumedLeverageKey: null,
  factKeys: [],
  traces: ["conversation:analyst"],
  statePatch: { trust: 1 },
  needsAiNarrative: true,
  playerMessage: "What can the signal log actually prove?",
};

const runtimeRun: OpenNovelPublicRun = {
  runId: "neutral-run",
  worldId: maneuverPackage.worldId,
  roleId: "operator",
  runtimeMode: "OPENOVEL_V1",
  turnNumber: 0,
  status: "READY",
  canon: "A repeated pulse appears in the public log.",
  recentCanon: "The team is deciding whether the pulse is evidence or noise.",
  options: [{ id: "observe", label: "Review the log" }],
  updatedAt: "2026-08-07T00:00:00.000Z",
};

test("maneuver narrative context includes persona fields and only explicitly allowed facts", () => {
  const state = ensureOpenNovelManeuverState({}, 0, maneuverPackage);
  state.results.push(
    {
      id: "allowed-result",
      turnNumber: 0,
      usageDay: 1,
      sceneKey: "phase_alpha",
      maneuverType: "investigate",
      decisionForm: "INVESTIGATION",
      title: "Allowed observation",
      narrative: "The pulse repeats at a stable interval.",
      targetRoleKey: null,
      consumedLeverageKey: null,
      discoveredFactKeys: ["allowed_fact"],
      traces: ["signal log"],
      statePatch: { evidence: 1 },
      idempotencyKey: "allowed-idempotency",
      requestFingerprint: "allowed-fingerprint",
      createdAt: "2026-08-07T00:00:00.000Z",
    },
    {
      id: "hidden-result",
      turnNumber: 0,
      usageDay: 1,
      sceneKey: "phase_alpha",
      maneuverType: "investigate",
      decisionForm: "INVESTIGATION",
      title: "Private inference",
      narrative: "A private hypothesis names a possible source.",
      targetRoleKey: null,
      consumedLeverageKey: null,
      discoveredFactKeys: ["hidden_fact"],
      traces: ["private note"],
      statePatch: { suspicion: 1 },
      idempotencyKey: "hidden-idempotency",
      requestFingerprint: "hidden-fingerprint",
      createdAt: "2026-08-07T00:01:00.000Z",
    },
  );

  const built = buildOpenNovelManeuverNarrativeContext({
    plan,
    state,
    runtimeRun,
    maneuverPackage,
  });

  assert.deepEqual(built.context.target, actor);
  assert.equal(built.context.playerMessage, plan.playerMessage);
  assert.deepEqual(
    built.context.visibleFacts.map((fact) => fact.factKey),
    ["allowed_fact"],
  );
  assert.equal(JSON.stringify(built.context).includes("hidden_fact"), false);
  assert.equal(JSON.stringify(built.context).includes("statePatch"), true);
  assert.deepEqual(built.context.immutableRuleResult.statePatchKeys, ["trust"]);
  assert.equal(built.targetName, "Analyst");
});
