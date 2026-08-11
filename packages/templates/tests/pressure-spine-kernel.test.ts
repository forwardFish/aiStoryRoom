import assert from "node:assert/strict";
import test from "node:test";
import {
  beginPrepareResolutionPhase,
  lockCommitPhase,
  lockPreparePhase,
  openReactionOrSettlement,
  resolvePreparePhase,
  validatePressureActionIntent,
} from "../src/pressure-spine/runtime/index";
import {
  acceptedRuntimeContent,
  actionIntent,
  initializedAtN1,
  makeObjectPublic,
  previewAndConfirm,
  sealAllWith,
} from "./pressure-spine-runtime-fixture";

const content = acceptedRuntimeContent();

test("LIFE-001 P0 projects to N1 PREPARE and deadline cannot close early", () => {
  const state = initializedAtN1(content, { runId: "life-001", deadlineEpochMs: 10_000 });
  assert.equal(state.nodeId, "N1");
  assert.equal(state.phase, "PREPARE_OPEN");
  const before = lockPreparePhase(content, state, 9_999);
  assert.equal(before.phase, "PREPARE_OPEN");
  assert.equal(Object.keys(before.sealedActions).length, 0);
  const after = lockPreparePhase(content, state, 10_000);
  assert.equal(after.phase, "PREPARE_LOCKED");
  assert.equal(Object.keys(after.sealedActions).length, 6);
  assert.equal(new Set(Object.values(after.sealedActions).map((action) => action.command.defaultPolicyId)).size, 6);
});

test("LIFE-002 six sealed PREPARE actions may close before the deadline", () => {
  let state = initializedAtN1(content, { runId: "life-002", deadlineEpochMs: 100_000 });
  state = sealAllWith(content, state, "PREPARE");
  state = lockPreparePhase(content, state, 10_000);
  assert.equal(state.phase, "PREPARE_LOCKED");
  state = beginPrepareResolutionPhase(state);
  state = resolvePreparePhase(content, state, 11_000, 80_000).state;
  assert.equal(state.phase, "COMMIT_OPEN");
});

test("ACT-001 REST is legal and advances authored time/pressure only after prepare resolution", () => {
  let state = initializedAtN1(content, { runId: "act-rest", deadlineEpochMs: 100_000 });
  const seatId = content.seatIds[0];
  const rest = actionIntent(state, content, { seatId, type: "REST", idempotencyKey: "rest" });
  state = previewAndConfirm(content, state, rest).state;
  for (const other of content.seatIds.slice(1)) {
    state = previewAndConfirm(content, state, actionIntent(state, content, { seatId: other, type: "PLAN", idempotencyKey: `p:${other}` })).state;
  }
  state = lockPreparePhase(content, state, 20_000);
  state = beginPrepareResolutionPhase(state);
  const result = resolvePreparePhase(content, state, 21_000, 80_000);
  assert.equal(result.state.worldTimeMinutes >= 360, true);
  assert.equal(result.state.pressureLevel >= 1, true);
  assert.equal(result.state.seats[seatId].initiativeLost, true);
  assert.equal(result.state.seats[seatId].energy > state.seats[seatId].energy, true);
});

test("ACT-002 the six world actions compile through one server contract", () => {
  const cases = ["ALLOCATE", "SIGN", "TRANSFER", "SEIZE", "DISCLOSE", "DISPATCH"] as const;
  for (const [index, type] of cases.entries()) {
    let state = initializedAtN1(content, { runId: `act-${type.toLowerCase()}` });
    const seatId = content.seatIds[index % content.seatIds.length];
    const leverage = content.nodes.N1.seats.find((seat) => seat.seatId === seatId)!.keyLeverageObjectIds[0];
    makeObjectPublic(state, content, leverage);
    const object = state.objects[leverage];
    if (["TRANSFER", "SIGN", "DISPATCH"].includes(type)) {
      object.custodySeatId = seatId;
      object.custodyActorId = state.seats[seatId].currentActorId;
    }
    const knownFact = state.seats[seatId].knownFactIds[0];
    const resourceId = Object.keys(state.seats[seatId].resourceBalances)[0];
    const intent = actionIntent(state, content, {
      seatId,
      type,
      targetObjectId: ["SIGN", "TRANSFER", "SEIZE", "DISPATCH"].includes(type) ? leverage : null,
      targetSeatId: type === "TRANSFER" ? content.seatIds[(index + 1) % content.seatIds.length] : null,
      destinationId: type === "DISPATCH" ? "route.neutral" : null,
      factIds: type === "DISCLOSE" && knownFact ? [knownFact] : [],
      signatureId: type === "SIGN" ? "sig.neutral" : null,
      resourceCommitments: type === "ALLOCATE" && resourceId ? [{ resourceId, amount: 1 }] : [],
      idempotencyKey: `world:${type}`,
    });
    const preview = validatePressureActionIntent(content, state, intent);
    assert.equal(preview.accepted, true, `${type}:${preview.errorCode}`);
  }
});

test("LIFE-003 COMMIT closes only when six seats are sealed or deadline passes", () => {
  let state = initializedAtN1(content, { runId: "life-003", deadlineEpochMs: 5_000 });
  state = lockPreparePhase(content, state, 5_000);
  state = beginPrepareResolutionPhase(state);
  state = resolvePreparePhase(content, state, 6_000, 100_000).state;
  for (const seatId of content.seatIds.slice(0, 5)) {
    state = previewAndConfirm(content, state, actionIntent(state, content, { seatId, slot: "COMMIT", idempotencyKey: `c:${seatId}` })).state;
  }
  const open = lockCommitPhase(content, state, 99_999);
  assert.equal(open.phase, "COMMIT_OPEN");
  const timedOut = lockCommitPhase(content, state, 100_000);
  assert.equal(timedOut.phase, "COMMIT_LOCKED");
  assert.equal(Boolean(timedOut.actionIdBySeatSlot[`N1:${content.seatIds[5]}:COMMIT`]), true);
  const settling = openReactionOrSettlement(content, timedOut, 100_001);
  assert.equal(settling.phase, "SETTLING");
});
