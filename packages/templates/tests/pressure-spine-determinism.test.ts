import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFrozenNodeResultIntegrity,
  beginPrepareResolutionPhase,
  lockCommitPhase,
  lockPreparePhase,
  openReactionOrSettlement,
  pressureRuntimeReplayHash,
  projectNextPressureNode,
  resolvePreparePhase,
  settlePressureNode,
} from "../src/pressure-spine/runtime/index";
import {
  acceptedRuntimeContent,
  actionIntent,
  initializedAtN1,
  makeObjectPublic,
  previewAndConfirm,
} from "./pressure-spine-runtime-fixture";

const content = acceptedRuntimeContent();

function commitConflict(order: string[], nowEpochMs: number) {
  let state = initializedAtN1(content, { runId: "determinism-run", runSeed: "determinism-seed", deadlineEpochMs: 1_000 });
  state = lockPreparePhase(content, state, 1_000);
  state = beginPrepareResolutionPhase(state);
  state = resolvePreparePhase(content, state, 1_100, 5_000).state;
  const objectId = "obj.nine_weirs";
  makeObjectPublic(state, content, objectId);
  for (const [index, seatId] of order.entries()) {
    state = previewAndConfirm(content, state, actionIntent(state, content, {
      seatId,
      slot: "COMMIT",
      type: "SEIZE",
      targetObjectId: objectId,
      resourceCommitments: [],
      idempotencyKey: `seize:${seatId}`,
      submittedAtEpochMs: 2_000 + index,
    })).state;
  }
  state = lockCommitPhase(content, state, 3_000);
  state = openReactionOrSettlement(content, state, 3_100);
  return settlePressureNode(content, state, nowEpochMs);
}

test("SYNC-001 100 arrival orders produce one winner and one Frozen hash", () => {
  const baseline = commitConflict([...content.seatIds], 10_000);
  const expectedHash = baseline.frozenResult.contentHash;
  const expectedCustody = baseline.state.objects["obj.nine_weirs"].custodySeatId;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const order = [...content.seatIds].sort((left, right) => {
      const leftRank = Number.parseInt(`${iteration}${left.length}`, 10) % (left.charCodeAt(iteration % left.length) + 1);
      const rightRank = Number.parseInt(`${iteration}${right.length}`, 10) % (right.charCodeAt(iteration % right.length) + 1);
      return leftRank - rightRank || right.localeCompare(left);
    });
    const replay = commitConflict(order, 20_000 + iteration * 100);
    assert.equal(replay.frozenResult.contentHash, expectedHash);
    assert.equal(replay.state.objects["obj.nine_weirs"].custodySeatId, expectedCustody);
    const losers = replay.actionResolutions.filter((entry) => entry.reasonCode === "OBJECT_CONFLICT_LOST");
    assert.equal(losers.length, 5);
    assert.equal(losers.every((entry) => entry.resourceLedgerEntries.every((cost) => cost.status === "APPLIED")), true);
  }
});

test("SYNC-002 Frozen bytes/hash ignore absolute wall-clock timestamps", () => {
  const left = commitConflict([...content.seatIds], 10_000);
  const right = commitConflict([...content.seatIds], 9_999_999);
  assert.equal(left.frozenResult.contentHash, right.frozenResult.contentHash);
  assertFrozenNodeResultIntegrity(left.frozenResult);
  assertFrozenNodeResultIntegrity(right.frozenResult);
});

test("FREEZE-001 projection never mutates the Frozen canonical record", () => {
  const result = commitConflict([...content.seatIds], 10_000);
  const frozenBytes = JSON.stringify(result.frozenResult);
  const projected = projectNextPressureNode(content, result.state, 30_000, 60_000);
  assert.equal(JSON.stringify(result.frozenResult), frozenBytes);
  assert.equal(projected.state.frozenResults.find((entry) => entry.nodeId === "N1")?.contentHash, result.frozenResult.contentHash);
  assert.equal(projected.state.nodeId, "N2");
  assert.equal(projected.state.phase, "PREPARE_OPEN");
});

test("FREEZE-002 tampering any Frozen field fails closed and clones are mutation-safe", () => {
  const result = commitConflict([...content.seatIds], 10_000);
  const replay = settlePressureNode(content, result.state, 50_000);
  replay.frozenResult.branchId = "tampered";
  assert.notEqual(result.frozenResult.branchId, "tampered");
  const damaged = structuredClone(result.state);
  damaged.frozenResults[0].pressureAfter += 1;
  assert.throws(() => pressureRuntimeReplayHash(damaged), /Frozen result hash mismatch/);
});
