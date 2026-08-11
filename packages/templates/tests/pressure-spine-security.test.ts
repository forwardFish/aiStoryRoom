import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PRESSURE_ROOT_EVENT_TYPES,
  assertPressureRootEventLedger,
  beginPrepareResolutionPhase,
  confirmPressureActionIntent,
  interruptPressureRuntime,
  lockCommitPhase,
  lockPreparePhase,
  lockReactionPhase,
  openReactionOrSettlement,
  projectNextPressureNode,
  recoverPressureRuntime,
  resolvePreparePhase,
  settlePressureNode,
  validatePressureActionIntent,
} from "../src/pressure-spine/runtime/index";
import {
  acceptedRuntimeContent,
  actionIntent,
  forceNodePhase,
  initializedAtN1,
  makeObjectPublic,
  previewAndConfirm,
} from "./pressure-spine-runtime-fixture";

const content = acceptedRuntimeContent();

test("SEC-001 public intent rejects every client-supplied effect/state patch with zero mutation", () => {
  const state = initializedAtN1(content, { runId: "sec-extra" });
  const before = structuredClone(state);
  const base = actionIntent(state, content, { idempotencyKey: "malicious" });
  for (const forbidden of [
    { effect: { resourceDeltas: { forged: 1000 } } },
    { statePatch: { tracks: { arbitrary: 999 } } },
    { actionId: "client-action" },
    { requestFingerprint: "client-fingerprint" },
    { authorityGrants: [{ allowedOperations: ["DESTROY"] }] },
  ]) {
    assert.throws(() => validatePressureActionIntent(content, state, { ...base, ...forbidden }), /forbidden fields|ACTION_SCHEMA_INVALID/);
    assert.deepEqual(state, before);
  }
});

test("SEC-002 illegal slot/type/operation are exhaustive fail-closed", () => {
  const state = initializedAtN1(content, { runId: "sec-enums" });
  const base = actionIntent(state, content, { idempotencyKey: "enum" });
  assert.throws(() => validatePressureActionIntent(content, state, { ...base, slot: "MAIN" }), /Unsupported slot/);
  assert.throws(() => validatePressureActionIntent(content, state, { ...base, type: "MAKE_TRUE" }), /Unsupported action type/);
  assert.throws(() => validatePressureActionIntent(content, state, {
    ...base,
    parameters: { ...base.parameters, desiredDisposition: "ERASE" },
  }), /Unsupported desiredDisposition/);
});

test("IDEMP-001 same key/body replays ten times and changed body fails closed", () => {
  let state = initializedAtN1(content, { runId: "idemp-001" });
  const intent = actionIntent(state, content, { type: "REST", idempotencyKey: "same-key" });
  const preview = validatePressureActionIntent(content, state, intent);
  const first = confirmPressureActionIntent(content, state, preview.normalizedIntent, preview.previewToken);
  state = first.state;
  const originalEvents = state.rootEvents.length;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const replay = confirmPressureActionIntent(content, state, preview.normalizedIntent, preview.previewToken);
    assert.equal(replay.replayed, true);
    assert.equal(replay.action.command.actionId, first.action.command.actionId);
    assert.equal(replay.state.rootEvents.length, originalEvents);
  }
  const changed = { ...preview.normalizedIntent, intentText: "changed payload" };
  const changedPreview = validatePressureActionIntent(content, initializedAtN1(content, { runId: "idemp-001" }), changed);
  assert.throws(() => confirmPressureActionIntent(content, state, changedPreview.normalizedIntent, changedPreview.previewToken), /Idempotency key was reused/);
});

test("IDEMP-002 two seats cannot collide on a client action identity", () => {
  let state = initializedAtN1(content, { runId: "idemp-seats" });
  const firstIntent = actionIntent(state, content, { seatId: content.seatIds[0], idempotencyKey: "global-key" });
  const first = previewAndConfirm(content, state, firstIntent);
  state = first.state;
  const second = actionIntent(state, content, { seatId: content.seatIds[1], idempotencyKey: "global-key" });
  const secondPreview = validatePressureActionIntent(content, initializedAtN1(content, { runId: "idemp-seats" }), second);
  assert.throws(() => confirmPressureActionIntent(content, state, secondPreview.normalizedIntent, secondPreview.previewToken), /Idempotency key was reused/);
});

test("GUARD-001 stale version, unknown fact, hidden object and insufficient resource cause zero mutation", () => {
  const state = initializedAtN1(content, { runId: "guard-001" });
  const before = structuredClone(state);
  const stale = actionIntent(state, content, { expectedObjectVersionId: "stale", targetObjectId: "obj.nine_weirs", type: "SEIZE", idempotencyKey: "stale" });
  const stalePreview = validatePressureActionIntent(content, state, stale);
  assert.equal(stalePreview.accepted, false);
  assert.equal(stalePreview.errorCode, "OBJECT_VERSION_CONFLICT");

  const unknown = actionIntent(state, content, { type: "DISCLOSE", factIds: ["fact.unknown"], idempotencyKey: "unknown" });
  const unknownPreview = validatePressureActionIntent(content, state, unknown);
  assert.equal(unknownPreview.accepted, false);
  assert.equal(unknownPreview.errorCode, "OBJECT_NOT_KNOWN");

  const hiddenObject = state.objects["obj.breach_order_chain"];
  hiddenObject.visibility = "PRIVATE";
  hiddenObject.knownBySeatIds = [content.seatIds[1]];
  const hidden = actionIntent(state, content, { seatId: content.seatIds[0], type: "SEIZE", targetObjectId: hiddenObject.objectId, idempotencyKey: "hidden" });
  const hiddenPreview = validatePressureActionIntent(content, state, hidden);
  assert.equal(hiddenPreview.accepted, false);
  assert.equal(hiddenPreview.errorCode, "OBJECT_NOT_KNOWN");

  const resourceId = Object.keys(state.seats[content.seatIds[0]].resourceBalances)[0];
  const costly = actionIntent(state, content, { type: "ALLOCATE", resourceCommitments: [{ resourceId, amount: 999 }], idempotencyKey: "costly" });
  const costlyPreview = validatePressureActionIntent(content, state, costly);
  assert.equal(costlyPreview.accepted, false);
  assert.equal(costlyPreview.errorCode, "RESOURCE_INSUFFICIENT");
  state.objects["obj.breach_order_chain"] = before.objects["obj.breach_order_chain"];
  assert.deepEqual(state, before);
});

test("CUSTODY-001 real COMMIT acquire blocks same-node REACTION destroy", () => {
  let state = forceNodePhase(content, initializedAtN1(content, { runId: "custody-001" }), "N4", "COMMIT_OPEN", 100_000);
  const seatId = "seat.zhejiang_governor";
  const objectId = "obj.tongwo_prisoners";
  makeObjectPublic(state, content, objectId);
  state = previewAndConfirm(content, state, actionIntent(state, content, {
    seatId,
    slot: "COMMIT",
    type: "SEIZE",
    targetObjectId: objectId,
    idempotencyKey: "acquire-prisoners",
  })).state;
  for (const other of content.seatIds.filter((entry) => entry !== seatId)) {
    const resourceId = Object.keys(state.seats[other].resourceBalances)[0];
    state = previewAndConfirm(content, state, actionIntent(state, content, {
      seatId: other,
      slot: "COMMIT",
      type: "ALLOCATE",
      resourceCommitments: resourceId ? [{ resourceId, amount: 1 }] : [],
      idempotencyKey: `other:${other}`,
    })).state;
  }
  state = lockCommitPhase(content, state, 20_000);
  state = openReactionOrSettlement(content, state, 20_001);
  assert.equal(state.phase, "REACTION_OPEN");
  const destroy = actionIntent(state, content, {
    seatId,
    slot: "REACTION",
    type: "SEIZE",
    targetObjectId: objectId,
    desiredDisposition: "DESTROY",
    idempotencyKey: "destroy-same-node",
  });
  const preview = validatePressureActionIntent(content, state, destroy);
  assert.equal(preview.accepted, false);
  assert.equal(preview.errorCode, "OBJECT_NEWLY_ACQUIRED_DESTROY_FORBIDDEN");
});

test("CUSTODY-002 same-node destroy ban survives recovery and next-node destruction requires retained custody", () => {
  let state = forceNodePhase(content, initializedAtN1(content, { runId: "custody-002" }), "N4", "COMMIT_OPEN", 100_000);
  const seatId = "seat.zhejiang_governor";
  const objectId = "obj.tongwo_prisoners";
  state.selectorState.refusalOrReviewRecordValid = false;
  makeObjectPublic(state, content, objectId);
  state = previewAndConfirm(content, state, actionIntent(state, content, {
    seatId,
    slot: "COMMIT",
    type: "SEIZE",
    targetObjectId: objectId,
    idempotencyKey: "acquire-before-recovery",
  })).state;
  for (const other of content.seatIds.filter((entry) => entry !== seatId)) {
    state = previewAndConfirm(content, state, actionIntent(state, content, {
      seatId: other,
      slot: "COMMIT",
      type: "PLAN",
      idempotencyKey: `acquire-other:${other}`,
    })).state;
  }
  state = lockCommitPhase(content, state, 20_000);
  state = openReactionOrSettlement(content, state, 20_001);
  assert.equal(state.phase, "REACTION_OPEN");

  const interrupted = interruptPressureRuntime(state, {
    code: "INJECTED_RECOVERY",
    message: "simulated",
    failedAtEpochMs: 20_002,
  });
  const recovered = recoverPressureRuntime(interrupted, {
    nowEpochMs: 20_003,
    expectedPackageSha256: content.packageSha256,
    expectedInputSnapshotHash: state.inputSnapshotHash,
  });
  const sameNodeDestroy = validatePressureActionIntent(content, recovered, actionIntent(recovered, content, {
    seatId,
    slot: "REACTION",
    type: "SEIZE",
    targetObjectId: objectId,
    desiredDisposition: "DESTROY",
    idempotencyKey: "destroy-after-recovery",
  }));
  assert.equal(sameNodeDestroy.accepted, false);
  assert.equal(sameNodeDestroy.errorCode, "OBJECT_NEWLY_ACQUIRED_DESTROY_FORBIDDEN");

  state = lockReactionPhase(content, recovered, recovered.reactionWindow!.closesAtEpochMs);
  const settled = settlePressureNode(content, state, recovered.reactionWindow!.closesAtEpochMs + 1);
  assert.equal(settled.state.objects[objectId].custodySeatId, seatId);
  assert.equal(settled.state.objects[objectId].acquiredInNodeId, "N4");

  let next = projectNextPressureNode(content, settled.state, 30_000, 60_000).state;
  assert.equal(next.nodeId, "N5");
  const nextNodeDestroy = validatePressureActionIntent(content, next, actionIntent(next, content, {
    seatId,
    slot: "PREPARE",
    type: "SEIZE",
    targetObjectId: objectId,
    desiredDisposition: "DESTROY",
    idempotencyKey: "destroy-next-node",
  }));
  assert.equal(nextNodeDestroy.accepted, true, `${nextNodeDestroy.errorCode}:${nextNodeDestroy.safeMessage}`);
  next = confirmPressureActionIntent(content, next, nextNodeDestroy.normalizedIntent, nextNodeDestroy.previewToken).state;
  next = lockPreparePhase(content, next, 60_000);
  next = beginPrepareResolutionPhase(next);
  next = resolvePreparePhase(content, next, 60_001, 90_000).state;
  assert.equal(next.objects[objectId].status, "DESTROYED");
  assert.equal(next.objects[objectId].custodySeatId, null);
  assert.equal(next.objects[objectId].custodyActorId, null);
});

test("EVT-001 only the locked 12 root types are accepted", () => {
  const state = initializedAtN1(content, { runId: "evt-001" });
  assert.equal(PRESSURE_ROOT_EVENT_TYPES.length, 12);
  assertPressureRootEventLedger(state.rootEvents);
  const corrupted = structuredClone(state.rootEvents);
  corrupted.push({ ...corrupted[0], eventId: "bad", sequence: corrupted.length + 1, type: "ACTION_RESOLVED" as any, dedupeKey: "bad" });
  assert.throws(() => assertPressureRootEventLedger(corrupted), /root event type/i);
});

test("GENERIC-001 production D2 free-text module contains no story-language classifier", () => {
  const source = readFileSync("packages/templates/src/pressure-spine/runtime/free-text.ts", "utf8");
  for (const forbidden of ["皇帝", "朝廷", "十万大军", "喝茶", "睡半天", "账册", "毁堤"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(source.includes("upstream structural classification"), true);
});
