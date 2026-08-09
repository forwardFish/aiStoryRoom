import assert from "node:assert/strict";
import test from "node:test";
import { ReconciledOpenNovelAdapterService } from "./reconciled-openovel-adapter.service";
import {
  createHarness,
  user,
  withFastReconcile,
} from "./openovel-stage-b-test-fixture";

test("a lost HTTP or SSE response after commit is replayed with the same key without duplicating durable state", async () => {
  const h = createHarness();
  const service = h.service();
  const input = {
    action: "完成最后提交。",
    idempotencyKey: "lost-response-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };
  let firstCommit = true;
  await assert.rejects(
    service.submitAction(user, h.runId, input, (event) => {
      if (event.type === "turn.committed" && firstCommit) {
        firstCommit = false;
        throw new Error("injected response disconnect");
      }
    }),
    /injected response disconnect/,
  );

  const restarted = h.service();
  const replayed = await restarted.submitAction(user, h.runId, input, () => undefined);
  assert.equal(replayed.turnId, "T20");
  assert.equal(h.counts().streamCalls, 1);
  assert.equal(h.counts().modelCalls, 1);
  assert.equal(h.counts().events, 1);
  assert.equal(h.counts().commitTransitions, 1);
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().endingCount, 1);
});

class MirrorFailureService extends ReconciledOpenNovelAdapterService {
  constructor(
    prisma: any,
    story: any,
    credits: any,
    runtime: any,
    replay: any,
    private failures: number,
  ) {
    super(prisma, story, credits, runtime, replay);
  }

  protected override async persistStageBCommittedTurn(context: any, runtimeAfter: any, result: any) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("injected DB mirror failure after Runtime commit");
    }
    return super.persistStageBCommittedTurn(context, runtimeAfter, result);
  }
}

test("an SSE stream lost after the Runtime Head commit is recovered from the same submission without a second model call", async () => {
  const h = createHarness({ failStreamAfterCommitTimes: 1 });
  const result = await withFastReconcile(() => h.service().submitAction(user, h.runId, {
    action: "完成最后提交。",
    idempotencyKey: "lost-sse-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  }, () => undefined));
  assert.equal(result.turnId, "T20");
  assert.equal(h.counts().streamCalls, 1);
  assert.ok(h.counts().replayCalls >= 1);
  assert.equal(h.counts().modelCalls, 1);
  assert.equal(h.counts().settlementCalls, 1);
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().endingCount, 1);
  assert.equal(h.counts().events, 1);
  assert.equal(h.counts().commitTransitions, 1);
});

test("service restart reconciles a generating action from the authoritative Runtime Head after DB mirror loss", async () => {
  const h = createHarness();
  const failing = new MirrorFailureService(
    h.prisma,
    {} as any,
    h.credits,
    h.runtime,
    h.replay,
    1,
  );
  const input = {
    action: "完成最后提交。",
    idempotencyKey: "mirror-loss-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };
  await assert.rejects(
    failing.submitAction(user, h.runId, input, () => undefined),
    /injected DB mirror failure/,
  );
  assert.equal([...h.actions.values()][0].status, "generating");
  assert.equal([...h.charges.values()][0].status, "RESERVED");
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().events, 0);

  const restarted = h.service();
  const recovered = await withFastReconcile(() => (
    restarted.submitAction(user, h.runId, input, () => undefined)
  ));
  assert.equal(recovered.turnId, "T20");
  assert.equal([...h.actions.values()][0].status, "resolved");
  assert.equal([...h.charges.values()][0].status, "COMMITTED");
  assert.equal(h.counts().streamCalls, 1);
  assert.equal(h.counts().replayCalls, 1);
  assert.equal(h.counts().modelCalls, 1);
  assert.equal(h.counts().settlementCalls, 1);
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().endingCount, 1);
  assert.equal(h.counts().events, 1);
});

test("a charge commit failure after DB mirror is completed exactly once by the same-key retry", async () => {
  const h = createHarness({ failCommitChargeTimes: 1 });
  const input = {
    action: "完成最后提交。",
    idempotencyKey: "charge-loss-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };
  await assert.rejects(
    h.service().submitAction(user, h.runId, input, () => undefined),
    /injected charge commit failure/,
  );
  assert.equal([...h.actions.values()][0].status, "resolved");
  assert.equal([...h.charges.values()][0].status, "RESERVED");

  const recovered = await h.service().submitAction(user, h.runId, input, () => undefined);
  assert.equal(recovered.turnId, "T20");
  assert.equal([...h.charges.values()][0].status, "COMMITTED");
  assert.equal(h.counts().reserveCreates, 1);
  assert.equal(h.counts().commitTransitions, 1);
  assert.equal(h.counts().events, 1);
  assert.equal(h.counts().modelCalls, 1);
});

test("a definitive precommit failure releases its charge and the same key safely reclaims one action with a new charge attempt", async () => {
  const h = createHarness({ failBeforeCommit: true });
  const input = {
    action: "完成最后提交。",
    idempotencyKey: "precommit-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };
  await assert.rejects(
    withFastReconcile(() => h.service().submitAction(user, h.runId, input, () => undefined)),
    /injected precommit provider failure/,
  );
  assert.equal([...h.actions.values()][0].status, "failed");
  assert.equal([...h.nodes.values()][0].status, "generation_failed");
  assert.equal([...h.charges.values()][0].status, "RELEASED");
  assert.equal(h.counts().releaseTransitions, 1);
  assert.equal(h.counts().headCount, 0);
  assert.equal(h.counts().modelCalls, 1);

  h.setFailBeforeCommit(false);
  const result = await h.service().submitAction(user, h.runId, input, () => undefined);
  assert.equal(result.turnId, "T20");
  assert.equal(h.counts().actions, 1);
  assert.equal(h.counts().nodes, 1);
  assert.equal(h.counts().charges, 2);
  assert.equal([...h.charges.values()].filter((charge) => charge.status === "RELEASED").length, 1);
  assert.equal([...h.charges.values()].filter((charge) => charge.status === "COMMITTED").length, 1);
  assert.equal(h.counts().commitTransitions, 1);
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().endingCount, 1);
  assert.equal(h.counts().events, 1);
  assert.equal(h.counts().modelCalls, 2);
});

test("duplicate mirror delivery and refresh/retry never duplicate action, node, audit event, charge, Head or Ending", async () => {
  const h = createHarness();
  const input = {
    action: "完成最后提交。",
    idempotencyKey: "duplicate-mirror-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };
  const result = await h.service().submitAction(user, h.runId, input, () => undefined);
  const action = [...h.actions.values()][0];
  const event = {
    kind: "turn.committed",
    runId: h.runId,
    payload: { submissionId: action.id, result },
  };
  const service = h.service();
  const first = await service.applyMirrorEvent(event);
  const second = await service.applyMirrorEvent(event);
  assert.equal(first.applied, false);
  assert.equal(second.applied, false);
  await service.submitAction(user, h.runId, input, () => undefined);
  assert.equal(h.counts().actions, 1);
  assert.equal(h.counts().nodes, 1);
  assert.equal(h.counts().events, 1);
  assert.equal(h.counts().charges, 1);
  assert.equal(h.counts().commitTransitions, 1);
  assert.equal(h.counts().headCount, 1);
  assert.equal(h.counts().endingCount, 1);
  assert.equal(h.counts().narrativeEntries, 1);
});

