import assert from "node:assert/strict";
import test from "node:test";
import {
  createHarness,
  deferred,
  responseCode,
  user,
  withFastReconcile,
} from "./openovel-stage-b-test-fixture";
import {
  openNovelActionIdempotencyKey,
  openNovelChargeIdempotencyKey,
  openNovelCommitEventId,
  openNovelPlayerActionId,
  openNovelRevisionNodeId,
  openNovelRevisionNodeIndex,
} from "./reconciled-openovel-adapter.service";

test("Stage B deterministic identifiers bind one action slot to one Runtime revision", () => {
  const runId = "run-neutral";
  const key = openNovelActionIdempotencyKey(runId, "user-neutral", "idempotency-0001");
  assert.equal(openNovelRevisionNodeId(runId, 20), openNovelRevisionNodeId(runId, 20));
  assert.notEqual(openNovelRevisionNodeId(runId, 20), openNovelRevisionNodeId(runId, 21));
  assert.equal(openNovelRevisionNodeIndex(20), 1_000_020);
  assert.equal(openNovelPlayerActionId(key), openNovelPlayerActionId(key));
  assert.notEqual(openNovelChargeIdempotencyKey("action", 1), openNovelChargeIdempotencyKey("action", 2));
  assert.equal(openNovelCommitEventId("action"), openNovelCommitEventId("action"));
});

test("submitDecision routes two concurrent same-key T20 commands through the same claim-or-replay contract", async () => {
  const gate = deferred<void>();
  const h = createHarness({ gate });
  const service = h.service();
  const command = {
    candidateId: "T20_A",
    customAction: "",
    idempotencyKey: "decision-stage-b-001",
    turnRevision: 19,
  } as any;

  const first = service.submitDecision(user, h.runId, "T20", command);
  await h.streamEntered.promise;
  const second = service.submitDecision(user, h.runId, "T20", command);
  gate.resolve();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.accepted, true);
  assert.equal(right.accepted, true);
  assert.deepEqual(left.resolution, right.resolution);
  assert.equal(h.counts().actions, 1);
  assert.equal(h.counts().nodes, 1);
  assert.equal(h.counts().charges, 1);
  assert.equal(h.counts().modelCalls, 1);
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().endingCount, 1);
});

test("two concurrent T20 requests with the same key converge to one action, Head, Ending, event and charge", async () => {
  const gate = deferred<void>();
  const h = createHarness({ gate });
  const service = h.service();
  const input = {
    action: "完成最后提交。",
    idempotencyKey: "same-key-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };

  await withFastReconcile(async () => {
    const first = service.submitAction(user, h.runId, input, () => undefined);
    await h.streamEntered.promise;
    const second = service.submitAction(user, h.runId, input, () => undefined);
    gate.resolve();
    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
  });

  assert.deepEqual(h.counts(), {
    actions: 1,
    nodes: 1,
    events: 1,
    charges: 1,
    reserveCreates: 1,
    commitTransitions: 1,
    releaseTransitions: 0,
    attachTransitions: 1,
    streamCalls: 1,
    replayCalls: 0,
    modelCalls: 1,
    settlementCalls: 1,
    headCount: 1,
    endingCount: 1,
    narrativeEntries: 1,
  });
  assert.equal([...h.actions.values()][0].status, "resolved");
  assert.equal([...h.nodes.values()][0].status, "resolved");
});

test("two API processes racing the same key converge through the database claim and Runtime replay", async () => {
  const gate = deferred<void>();
  const h = createHarness({ gate });
  const firstProcess = h.service();
  const secondProcess = h.service();
  const input = {
    action: "完成最后提交。",
    idempotencyKey: "same-key-two-processes-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };

  await withFastReconcile(async () => {
    const first = firstProcess.submitAction(user, h.runId, input, () => undefined);
    await h.streamEntered.promise;
    const second = secondProcess.submitAction(user, h.runId, input, () => undefined);
    gate.resolve();
    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
  });

  assert.equal(h.counts().actions, 1);
  assert.equal(h.counts().nodes, 1);
  assert.equal(h.counts().events, 1);
  assert.equal(h.counts().charges, 1);
  assert.equal(h.counts().modelCalls, 1);
  assert.equal(h.counts().settlementCalls, 1);
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().endingCount, 1);
  assert.equal(h.counts().narrativeEntries, 1);
});

test("different keys racing for the same revision produce one commit and one stable revision conflict before charge or Runtime", async () => {
  const gate = deferred<void>();
  const h = createHarness({ gate });
  const service = h.service();
  const common = {
    action: "完成最后提交。",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };

  const first = service.submitAction(user, h.runId, {
    ...common,
    idempotencyKey: "different-key-stage-b-a",
  }, () => undefined);
  await h.streamEntered.promise;
  const second = service.submitAction(user, h.runId, {
    ...common,
    idempotencyKey: "different-key-stage-b-b",
  }, () => undefined);
  gate.resolve();
  const settled = await Promise.allSettled([first, second]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
  assert.ok(rejected);
  assert.equal(responseCode(rejected?.reason), "OPENOVEL_REVISION_CONFLICT");
  assert.equal(h.counts().actions, 1);
  assert.equal(h.counts().nodes, 1);
  assert.equal(h.counts().reserveCreates, 1);
  assert.equal(h.counts().streamCalls, 1);
  assert.equal(h.counts().modelCalls, 1);
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().commitTransitions, 1);
});

