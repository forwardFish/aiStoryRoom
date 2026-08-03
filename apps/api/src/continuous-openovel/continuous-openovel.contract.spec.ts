import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_CALL_BUDGET_SCHEMA_VERSION,
  OPENOVEL_ROLE_RUNTIME_MODE,
  ROLE_NARRATIVE_INPUT_SCHEMA_VERSION,
  ROLE_NARRATIVE_OUTPUT_SCHEMA_VERSION,
  validateModelCallBudgetV1,
  validateRoleControllerV1,
  validateRoleNarrativeInputV1,
  validateRoleNarrativeOutputV1,
  type RoleNarrativeInputV1,
  type RoleNarrativeOutputV1
} from "@ai-story/shared";
import { evaluateCharacterProtection } from "./character-protection.policy";
import { readContinuousOpenNovelConfig, isContinuousOpenNovelEnabledForRun } from "./continuous-openovel.config";
import { ModelCallBudget } from "./model-call-budget";
import { commitWorldThenInvokeRoleRuntime } from "./world-first-role-runtime.orchestrator";

const input: RoleNarrativeInputV1 = {
  schemaVersion: ROLE_NARRATIVE_INPUT_SCHEMA_VERSION,
  runtimeMode: OPENOVEL_ROLE_RUNTIME_MODE,
  turnKind: "RESULT",
  roomId: "room-a",
  roleId: "role-a",
  actorTurnId: "turn-a",
  turnIndex: 2,
  baseWorldSequence: 4,
  appliedWorldSequence: 5,
  contextSnapshotHash: "hash-a",
  renderedWorkingSet: "Only role A can read this working set.",
  readerAction: "Request an answer",
  confirmedResolution: "The request was delivered; the target has not answered.",
  visibleWorldEvents: [{ schemaVersion: "role_visible_event_v1", id: "event-a", worldSequence: 5, type: "REQUEST_DELIVERED", content: "A request arrived." }],
  pendingInteractions: [{
    schemaVersion: "role_visible_interaction_v1",
    id: "interaction-a",
    sourceRoleId: "role-b",
    requestKind: "REQUEST_RESPONSE",
    pressure: { objective: "Answer", method: "Deliver a letter", sourceRoleName: "B", targetRoleName: "A" }
  }],
  modelCallBudget: { schemaVersion: MODEL_CALL_BUDGET_SCHEMA_VERSION, kind: "NORMAL", hardLimit: 3, consumed: 0 },
  idempotencyKey: "result:turn-a:5"
};

const output: RoleNarrativeOutputV1 = {
  schemaVersion: ROLE_NARRATIVE_OUTPUT_SCHEMA_VERSION,
  roomId: "room-a",
  roleId: "role-a",
  actorTurnId: "turn-a",
  narration: "The letter is now on the desk, while the answer remains entirely yours.",
  options: [{
    id: "answer-later",
    label: "Delay the answer",
    intentProposal: {
      objective: "Gain time before answering",
      target: { type: "ROLE", id: "role-b", label: "B" },
      method: "Send a receipt without accepting the request",
      leverageKeys: [],
      visibility: "LIMITED",
      riskTolerance: "LOW"
    }
  }],
  canonHash: "canon-a",
  workspaceRevision: 2,
  appliedWorldSequence: 5,
  warnings: [{ code: "OPTIONS_PARTIAL", severity: "LOW", blocksPlayer: false }],
  usage: { narratorCalls: 1, optionsCalls: 1, storykeeperCalls: 1, inputTokens: 10, outputTokens: 20 }
};

test("role runtime V1 contracts accept exact JSON and reject extra fields at every nested boundary", () => {
  assert.equal(validateRoleNarrativeInputV1(input).ok, true);
  assert.equal(validateRoleNarrativeOutputV1(output).ok, true);
  assert.equal(validateRoleNarrativeInputV1({ ...input, hiddenWorldState: {} }).ok, false);
  assert.equal(validateRoleNarrativeInputV1({ ...input, visibleWorldEvents: [{ ...input.visibleWorldEvents[0], secret: true }] }).ok, false);
  assert.equal(validateRoleNarrativeInputV1({ ...input, pendingInteractions: [{ ...input.pendingInteractions[0], pressure: { ...input.pendingInteractions[0].pressure, hidden: true } }] }).ok, false);
  assert.equal(validateRoleNarrativeOutputV1({ ...output, sharedStatePatch: {} }).ok, false);
  assert.equal(validateRoleNarrativeOutputV1({ ...output, options: [{ ...output.options[0], intentProposal: { ...output.options[0].intentProposal, hidden: true } }] }).ok, false);
  assert.equal(validateRoleNarrativeOutputV1({ ...output, warnings: [{ ...output.warnings[0], internalPrompt: "secret" }] }).ok, false);
  assert.equal(validateRoleNarrativeOutputV1({ ...output, usage: { ...output.usage, retries: 1 } }).ok, false);
  assert.equal(validateRoleNarrativeInputV1({ ...input, turnKind: "OPENING", appliedWorldSequence: 5 }).ok, false);
  assert.equal(validateRoleNarrativeInputV1({ ...input, turnKind: "RESULT", appliedWorldSequence: null }).ok, false);
});

test("controller and model-call budget V1 validators are strict", () => {
  const controller = { schemaVersion: "role_controller_v1", roleId: "role-a", controllerKind: "HUMAN", controlMode: "HUMAN_ACTIVE", controlEpoch: 1 };
  for (const controllerKind of ["HUMAN", "AI_AGENT", "STANDING_POLICY", "SYSTEM"]) {
    assert.equal(validateRoleControllerV1({ ...controller, controllerKind }).ok, true, `${controllerKind} must be accepted`);
  }
  assert.equal(validateRoleControllerV1({ ...controller, controllerKind: "AI" }).ok, false);
  assert.equal(validateRoleControllerV1({ ...controller, privateGoal: "leak" }).ok, false);
  const budget = { schemaVersion: MODEL_CALL_BUDGET_SCHEMA_VERSION, kind: "NORMAL", hardLimit: 3, consumed: 3 };
  assert.equal(validateModelCallBudgetV1(budget).ok, true);
  assert.equal(validateModelCallBudgetV1({ ...budget, consumed: 4 }).ok, false);
  assert.equal(validateModelCallBudgetV1({ ...budget, hidden: true }).ok, false);
});

test("continuous OpenNovel rollout is disabled unless the exact room is allowlisted", () => {
  assert.throws(() => readContinuousOpenNovelConfig({ CONTINUOUS_OPENOVEL_V1_ENABLED: "true" } as NodeJS.ProcessEnv), /ROOM_IDS is required/);
  const enabled = { CONTINUOUS_OPENOVEL_V1_ENABLED: "true", CONTINUOUS_OPENOVEL_ROOM_IDS: "room-a,room-b" } as NodeJS.ProcessEnv;
  assert.equal(isContinuousOpenNovelEnabledForRun({ id: "room-a", engineVersion: "continuous_openovel_v1" }, enabled), true);
  assert.equal(isContinuousOpenNovelEnabledForRun({ id: "room-c", engineVersion: "continuous_openovel_v1" }, enabled), false);
  assert.equal(isContinuousOpenNovelEnabledForRun({ id: "room-a", engineVersion: "continuous_story_v2" }, enabled), false);
});

test("world commits before runtime and runtime failure cannot roll it back", async () => {
  const order: string[] = [];
  const failed = await commitWorldThenInvokeRoleRuntime({
    budgetKind: "NORMAL",
    commitWorld: async () => { order.push("world"); return { resolutionId: "resolution-a", appliedWorldSequence: 5 }; },
    invokeRoleRuntime: async () => { order.push("runtime"); throw new Error("provider down"); }
  });
  assert.deepEqual(order, ["world", "runtime"]);
  assert.equal(failed.world.appliedWorldSequence, 5);
  assert.equal(failed.runtimeStatus, "FAILED_AFTER_WORLD_COMMIT");
});

test("all budget entry points enforce 3/4/6/0 and unaffected never invokes runtime", async () => {
  for (const [kind, limit] of [["NORMAL", 3], ["AI_TARGET", 4], ["CONVERGENCE", 6], ["UNAFFECTED", 0]] as const) {
    const budget = new ModelCallBudget(kind);
    assert.equal(budget.charge(limit).consumed, limit);
    assert.throws(() => budget.charge(1), /budget/i);
  }
  let runtimeCalls = 0;
  const unaffected = await commitWorldThenInvokeRoleRuntime({
    budgetKind: "UNAFFECTED",
    commitWorld: async () => ({ resolutionId: "resolution-b", appliedWorldSequence: 6 }),
    invokeRoleRuntime: async () => { runtimeCalls += 1; return output; }
  });
  assert.equal(unaffected.runtimeStatus, "SKIPPED_UNAFFECTED");
  assert.equal(runtimeCalls, 0);
});

test("character protection is structural and preserves human target agency", () => {
  const base = { actorRoleId: "role-a", targetRoleId: "role-b", targetControllerKind: "HUMAN", intent: {} as never, isFinale: false } as const;
  assert.deepEqual(evaluateCharacterProtection({ ...base, requestedEffect: "REQUEST" }), { accepted: true, requiresInteraction: true, requiresContest: false, code: "HUMAN_TARGET_RESPONSE_REQUIRED" });
  assert.deepEqual(evaluateCharacterProtection({ ...base, requestedEffect: "TRANSFER" }), { accepted: true, requiresInteraction: false, requiresContest: true, code: "HUMAN_TARGET_CONTEST_REQUIRED" });
  assert.equal(evaluateCharacterProtection({ ...base, requestedEffect: "PERMANENT_REMOVAL" }).accepted, false);
  assert.equal(evaluateCharacterProtection({ ...base, isFinale: true, requestedEffect: "PERMANENT_REMOVAL" }).accepted, true);
});
