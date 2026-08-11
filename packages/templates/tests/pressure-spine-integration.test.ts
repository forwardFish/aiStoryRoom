import assert from "node:assert/strict";
import test from "node:test";
import {
  beginPrepareResolutionPhase,
  lockCommitPhase,
  lockPreparePhase,
  lockReactionPhase,
  openReactionOrSettlement,
  projectNextPressureNode,
  resolvePreparePhase,
  settlePressureNode,
} from "../src/pressure-spine/runtime/index";
import {
  acceptedRuntimeContent,
  actionIntent,
  forceNodePhase,
  initializedAtN1,
  previewAndConfirm,
  sealAllWith,
} from "./pressure-spine-runtime-fixture";

const content = acceptedRuntimeContent();

function commitSixAllocate(nodeId: "N2" | "N4" | "N7") {
  let state = forceNodePhase(content, initializedAtN1(content, { runId: `reaction-${nodeId}` }), nodeId, "COMMIT_OPEN", 100_000);
  state = sealAllWith(content, state, "COMMIT", (current, seatId, index) => {
    const resourceId = Object.keys(current.seats[seatId].resourceBalances)[0];
    return actionIntent(current, content, {
      seatId,
      slot: "COMMIT",
      type: "ALLOCATE",
      resourceCommitments: resourceId ? [{ resourceId, amount: 1 }] : [],
      idempotencyKey: `${nodeId}:allocate:${index}`,
      submittedAtEpochMs: 10_000 + index,
    });
  });
  state = lockCommitPhase(content, state, 20_000);
  return openReactionOrSettlement(content, state, 20_001);
}

test("REACTION-001 N2/N4/N7 eligibility is authored and deadline/defaults are deterministic", () => {
  for (const nodeId of ["N2", "N4", "N7"] as const) {
    const open = commitSixAllocate(nodeId);
    assert.equal(open.phase, "REACTION_OPEN");
    assert.deepEqual(open.reactionWindow?.eligibleSeatIds, content.nodes[nodeId].reaction?.eligibleSeatIds);
    const closesAt = open.reactionWindow!.closesAtEpochMs;
    const early = lockReactionPhase(content, open, closesAt - 1);
    assert.equal(early.phase, "REACTION_OPEN");
    const expired = lockReactionPhase(content, open, closesAt);
    assert.equal(expired.phase, "SETTLING");
    for (const seatId of content.nodes[nodeId].reaction!.eligibleSeatIds) {
      const actionId = expired.actionIdBySeatSlot[`${nodeId}:${seatId}:REACTION`];
      assert.equal(Boolean(actionId), true);
      assert.equal(expired.sealedActions[actionId].command.isDefault, true);
      assert.equal(expired.sealedActions[actionId].command.defaultPolicyId, content.nodes[nodeId].defaultPolicies.find((entry) => entry.seatId === seatId)?.defaultPolicyId);
    }
  }
});

test("DEFAULT-001 six authored defaults are seat-specific and not a hard-coded common action", () => {
  let state = initializedAtN1(content, { runId: "default-001", deadlineEpochMs: 1_000 });
  state = lockPreparePhase(content, state, 1_000);
  const actions = content.seatIds.map((seatId) => state.sealedActions[state.actionIdBySeatSlot[`N1:${seatId}:PREPARE`]].command);
  assert.equal(new Set(actions.map((entry) => entry.defaultPolicyId)).size, 6);
  assert.equal(new Set(actions.map((entry) => entry.intentText)).size, 6);
  assert.equal(actions.every((entry) => entry.type === "PLAN"), true);
});

test("PROJ-001 predecessor FrozenResult selects the exact next opening projection once", () => {
  let state = initializedAtN1(content, { runId: "proj-001", deadlineEpochMs: 1_000 });
  state = lockPreparePhase(content, state, 1_000);
  state = beginPrepareResolutionPhase(state);
  state = resolvePreparePhase(content, state, 2_000, 3_000).state;
  state = lockCommitPhase(content, state, 3_000);
  state = openReactionOrSettlement(content, state, 3_001);
  const settled = settlePressureNode(content, state, 5_000);
  const projected = projectNextPressureNode(content, settled.state, 6_000, 9_000);
  const frozen = settled.frozenResult;
  const expected = content.nodes.N2.openingVariants.find((entry) => entry.predecessorFrozenResultId === frozen.frozenResultId && entry.predecessorBranchId === frozen.branchId);
  assert.equal(frozen.openingProjectionRef, expected?.openingProjectionId);
  assert.equal(projected.publicProjection?.predecessorFrozenResultId, frozen.frozenResultId);
  assert.equal(projected.privateProjections.length, 6);
  const replay = projectNextPressureNode(content, settled.state, 99_000, 199_000);
  assert.equal(replay.publicProjection?.contentHash, projected.publicProjection?.contentHash);
});

test("TRACK-001 five world tracks and responsibility/knowledge ledgers are updated by rules only", () => {
  let state = initializedAtN1(content, { runId: "track-001", deadlineEpochMs: 1_000 });
  state = lockPreparePhase(content, state, 1_000);
  state = beginPrepareResolutionPhase(state);
  state = resolvePreparePhase(content, state, 2_000, 3_000).state;
  state = sealAllWith(content, state, "COMMIT", (current, seatId, index) => actionIntent(current, content, {
    seatId,
    slot: "COMMIT",
    type: "SIGN",
    targetObjectId: null,
    signatureId: `sig:${index}`,
    idempotencyKey: `sign:${index}`,
  }));
  state = lockCommitPhase(content, state, 2_500);
  state = openReactionOrSettlement(content, state, 2_501);
  const result = settlePressureNode(content, state, 3_000);
  assert.equal(Object.keys(result.state.tracks).length, 5);
  assert.equal(result.state.responsibilities.length, 6);
  assert.equal(result.frozenResult.frozenFactIds.every((factId) => Boolean(result.state.knowledge[factId])), true);
});
