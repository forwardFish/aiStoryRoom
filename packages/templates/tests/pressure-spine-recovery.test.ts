import assert from "node:assert/strict";
import test from "node:test";
import {
  beginPrepareResolutionPhase,
  freezeFinaleInput,
  interruptPressureRuntime,
  lockCommitPhase,
  lockPreparePhase,
  openReactionOrSettlement,
  pressureRuntimeReplayHash,
  projectNextPressureNode,
  recoverPressureRuntime,
  resolvePreparePhase,
  settlePressureNode,
  type PressureRuntimePhase,
} from "../src/pressure-spine/runtime/index";
import {
  acceptedRuntimeContent,
  forceNodePhase,
  initializedAtN1,
} from "./pressure-spine-runtime-fixture";

const content = acceptedRuntimeContent();

test("REC-001 FAILED_RECOVERABLE preserves resumePhase and never advances causal state", () => {
  let state = initializedAtN1(content, { runId: "rec-001" });
  state = lockPreparePhase(content, state, 1_000_000);
  state = beginPrepareResolutionPhase(state);
  const beforeHash = pressureRuntimeReplayHash(state);
  const interrupted = interruptPressureRuntime(state, { code: "INJECTED", message: "simulated", failedAtEpochMs: 2_000 });
  assert.equal(interrupted.phase, "FAILED_RECOVERABLE");
  assert.equal(interrupted.resumePhase, "PREPARE_RESOLVING");
  const recovered = recoverPressureRuntime(interrupted, { nowEpochMs: 3_000, expectedPackageSha256: content.packageSha256, expectedInputSnapshotHash: state.inputSnapshotHash });
  assert.equal(recovered.phase, "PREPARE_RESOLVING");
  assert.equal(recovered.resumePhase, null);
  const withoutRecoveryEvent = structuredClone(recovered);
  withoutRecoveryEvent.rootEvents = withoutRecoveryEvent.rootEvents.filter((event) => event.type !== "RECOVERY_COMPLETED");
  withoutRecoveryEvent.version = state.version;
  assert.equal(pressureRuntimeReplayHash(withoutRecoveryEvent), beforeHash);
});

test("REC-002 every nonterminal phase resumes only to its stored phase", () => {
  const phases: PressureRuntimePhase[] = [
    "P0_PROJECTING", "PREPARE_OPEN", "PREPARE_LOCKED", "PREPARE_RESOLVING", "COMMIT_OPEN",
    "COMMIT_LOCKED", "REACTION_OPEN", "SETTLING", "FROZEN", "PROJECTING", "FINALE_COMPUTING",
  ];
  for (const phase of phases) {
    const source = forceNodePhase(content, initializedAtN1(content, { runId: `phase-${phase}` }), phase === "P0_PROJECTING" ? "P0" : "N1", phase);
    const interrupted = interruptPressureRuntime(source, { code: `FAIL_${phase}`, message: "simulated", failedAtEpochMs: 2_000 });
    const recovered = recoverPressureRuntime(interrupted, { nowEpochMs: 3_000, expectedPackageSha256: content.packageSha256 });
    assert.equal(recovered.phase, phase);
  }
});

test("REC-003 package/input drift fails closed without mutating interrupted state", () => {
  const source = initializedAtN1(content, { runId: "rec-003" });
  const interrupted = interruptPressureRuntime(source, { code: "FAIL", message: "simulated", failedAtEpochMs: 2_000 });
  const before = structuredClone(interrupted);
  assert.throws(() => recoverPressureRuntime(interrupted, { nowEpochMs: 3_000, expectedPackageSha256: "0".repeat(64) }), /Package changed/);
  assert.throws(() => recoverPressureRuntime(interrupted, { nowEpochMs: 3_000, expectedPackageSha256: content.packageSha256, expectedInputSnapshotHash: "drift" }), /Input snapshot changed/);
  assert.deepEqual(interrupted, before);
});

test("FINALE-001 D2 ends at FINALE_COMPUTING and cannot emit FINALE_FROZEN/COMPLETED", () => {
  let state = forceNodePhase(content, initializedAtN1(content, { runId: "finale-001" }), "N7", "COMMIT_OPEN", 1_000);
  state = lockCommitPhase(content, state, 1_000);
  state = openReactionOrSettlement(content, state, 1_001);
  if (state.phase === "REACTION_OPEN") state = forceNodePhase(content, state, "N7", "SETTLING", 2_000);
  const result = settlePressureNode(content, state, 3_000);
  const projected = projectNextPressureNode(content, result.state, 4_000, 5_000);
  assert.equal(projected.state.phase, "FINALE_COMPUTING");
  assert.equal(projected.state.rootEvents.some((event) => event.type === "FINALE_FROZEN"), false);
  assert.throws(() => freezeFinaleInput(content, projected.state, 5_000), /belong to D3/);
});
