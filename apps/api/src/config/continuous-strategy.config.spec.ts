import assert from "node:assert/strict";
import {
  InjectedCheckpointExitError,
  isInjectedCheckpointExit,
  maybeInjectRoleAgentFault,
  normalizeRoleAgentAttemptTimeoutMs,
  normalizeResolutionTaskLeaseMs,
  normalizeStoryTaskLeaseMs,
  readContinuousStrategyConfig,
  ROLE_AGENT_FAULT_BOUNDARIES,
  selectRunVersions
} from "./continuous-strategy.config";

assert.equal(normalizeStoryTaskLeaseMs(undefined), 30_000);
assert.equal(normalizeStoryTaskLeaseMs(1_000), 5_000);
assert.equal(normalizeStoryTaskLeaseMs(12_345.9), 12_345);
assert.equal(normalizeStoryTaskLeaseMs(999_999), 300_000);
assert.equal(normalizeStoryTaskLeaseMs("invalid"), 30_000);
assert.equal(normalizeResolutionTaskLeaseMs(15_000), 45_000);
assert.equal(normalizeResolutionTaskLeaseMs(60_000), 60_000);
assert.equal(normalizeResolutionTaskLeaseMs("invalid"), 45_000);
assert.equal(normalizeRoleAgentAttemptTimeoutMs(undefined), 4_500);
assert.equal(normalizeRoleAgentAttemptTimeoutMs(100), 250);
assert.equal(normalizeRoleAgentAttemptTimeoutMs(1_250.8), 1_250);
assert.equal(normalizeRoleAgentAttemptTimeoutMs(10_000), 4_500);
assert.equal(normalizeRoleAgentAttemptTimeoutMs("invalid"), 4_500);

assert.deepEqual(selectRunVersions({ templateKey: "sangtian", mode: "room", maxPlayers: 3, enabledForNewRooms: true }), {
  engineVersion: "continuous_strategy_v1_1",
  strategyVersion: "sangtian_v1_1"
});
for (const maxPlayers of [1, 2]) {
  assert.deepEqual(selectRunVersions({ templateKey: "sangtian", mode: "room", maxPlayers, enabledForNewRooms: true }), {
    engineVersion: "continuous_strategy_v1_1",
    strategyVersion: "sangtian_v1_1"
  });
}
for (const changed of [
  { templateKey: "other", mode: "room", maxPlayers: 3 },
  { templateKey: "sangtian", mode: "single", maxPlayers: 3 },
  { templateKey: "sangtian", mode: "room", maxPlayers: 4 }
]) {
  assert.deepEqual(selectRunVersions({ ...changed, enabledForNewRooms: true }), { engineVersion: "legacy_v1", strategyVersion: "legacy_v1" });
}
assert.equal(readContinuousStrategyConfig({} as NodeJS.ProcessEnv).enabledForNewRooms, false);
assert.equal(readContinuousStrategyConfig({ MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED: "true" } as NodeJS.ProcessEnv).enabledForNewRooms, true);
assert.throws(() => readContinuousStrategyConfig({ MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED: "yes" } as NodeJS.ProcessEnv), /exactly true or false/);
assert.throws(() => readContinuousStrategyConfig({ NODE_ENV: "production", FAIL_AFTER_CHECKPOINT: "RULES_APPLIED" } as NodeJS.ProcessEnv), /forbidden in production/);
for (const targetName of ["FAIL_AFTER_CHECKPOINT_RUN_ID", "FAIL_AFTER_CHECKPOINT_WINDOW_ID", "FAIL_AFTER_CHECKPOINT_STAGE", "FAIL_ROLE_AGENT_TASK_ID"]) {
  assert.throws(() => readContinuousStrategyConfig({ NODE_ENV: "production", [targetName]: "target" } as NodeJS.ProcessEnv), /forbidden in production/);
}
assert.throws(() => readContinuousStrategyConfig({ NODE_ENV: "production", FAIL_ROLE_AGENT_AT: "TASK_LEASED" } as NodeJS.ProcessEnv), /forbidden in production/);
assert.throws(() => readContinuousStrategyConfig({ NODE_ENV: "development", FAIL_ROLE_AGENT_AT: "TASK_LEASED" } as NodeJS.ProcessEnv), /Fault injection is disabled/);
assert.throws(() => readContinuousStrategyConfig({ NODE_ENV: "test", FAIL_ROLE_AGENT_AT: "PROVIDER" } as NodeJS.ProcessEnv), /must be one of/);
for (const boundary of ROLE_AGENT_FAULT_BOUNDARIES) {
  const config = readContinuousStrategyConfig({ NODE_ENV: "test", FAIL_ROLE_AGENT_AT: boundary, FAIL_ROLE_AGENT_TASK_ID: "task-target" } as NodeJS.ProcessEnv);
  assert.equal(config.faultInjectionAllowed, true);
  assert.equal(config.roleAgentFaultAt, boundary);
}
assert.throws(
  () => readContinuousStrategyConfig({ NODE_ENV: "test", FAIL_ROLE_AGENT_AT: "TASK_LEASED" } as NodeJS.ProcessEnv),
  /FAIL_ROLE_AGENT_TASK_ID is required/
);
assert.equal(readContinuousStrategyConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv).roleAgentFaultAt, null);
assert.throws(
  () => maybeInjectRoleAgentFault("PROVIDER_RETURNED", "task-1", { NODE_ENV: "test", FAIL_ROLE_AGENT_AT: "PROVIDER_RETURNED", FAIL_ROLE_AGENT_TASK_ID: "task-1" } as NodeJS.ProcessEnv),
  (error: unknown) => error instanceof InjectedCheckpointExitError
    && error.name === "INJECTED_CHECKPOINT_EXIT"
    && error.code === "INJECTED_CHECKPOINT_EXIT"
    && error.exitCode === 86
    && error.checkpoint === "PROVIDER_RETURNED"
    && error.taskId === "task-1"
);
assert.doesNotThrow(() => maybeInjectRoleAgentFault("PROVIDER_RETURNED", "task-other", {
  NODE_ENV: "test",
  FAIL_ROLE_AGENT_AT: "PROVIDER_RETURNED",
  FAIL_ROLE_AGENT_TASK_ID: "task-target"
} as NodeJS.ProcessEnv));
assert.doesNotThrow(() => maybeInjectRoleAgentFault("ACTION_SEALED", "task-1", { NODE_ENV: "test", FAIL_ROLE_AGENT_AT: "TASK_LEASED", FAIL_ROLE_AGENT_TASK_ID: "task-1" } as NodeJS.ProcessEnv));
assert.equal(isInjectedCheckpointExit(Object.assign(new Error("external checkpoint"), { code: "INJECTED_CHECKPOINT_EXIT" })), true);
assert.equal(isInjectedCheckpointExit(new Error("ordinary")), false);
console.log("continuous-strategy configuration contracts: PASS");
