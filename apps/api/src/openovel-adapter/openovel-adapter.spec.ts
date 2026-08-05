import assert from "node:assert/strict";
import test from "node:test";
import { OpenNovelAdapterService, openNovelRunId } from "./openovel-adapter.service";
import { OpenNovelMirrorController } from "./openovel-mirror.controller";
import {
  OPENOVEL_ENGINE_VERSION,
  OPENOVEL_RUNTIME_MODE,
  readSse,
} from "./openovel-runtime.client";

const user = {
  id: "user-1",
  openid: "openid-1",
  email: null,
  emailVerifiedAt: null,
  nickname: "Player",
  authMethod: "PASSWORD" as const,
  authIdentityId: null,
};

test("OpenNovel run identity is stable and user scoped", () => {
  assert.equal(openNovelRunId("user-a", "request-123"), openNovelRunId("user-a", "request-123"));
  assert.notEqual(openNovelRunId("user-a", "request-123"), openNovelRunId("user-b", "request-123"));
  assert.match(openNovelRunId("user-a", "request-123"), /^solo_ovl_[a-f0-9]{32}$/);
});

test("SSE reader preserves split UTF-8 events and the final commit", async () => {
  const encoder = new TextEncoder();
  const source = [
    "event: narration.delta\r\ndata: {\"text\":\"县",
    "册\"}\r\n\r\nevent: options.complete\n",
    "data: {\"options\":[]}\n\nevent: turn.committed\n",
    "data: {\"turnNumber\":1}\n\n",
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of source) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const events: any[] = [];
  await readSse(stream, (event) => {
    events.push(event);
  });
  assert.deepEqual(events.map((event) => event.type), [
    "narration.delta",
    "options.complete",
    "turn.committed",
  ]);
  assert.equal(events[0].data.text, "县册");
  assert.equal(events[2].data.turnNumber, 1);
});

test("private mirror endpoint requires its dedicated shared token", async () => {
  const calls: any[] = [];
  const controller = new OpenNovelMirrorController({
    applyMirrorEvent: async (event: any) => {
      calls.push(event);
      return { accepted: true };
    },
  } as any);
  const previous = process.env.OPENOVEL_MIRROR_TOKEN;
  process.env.OPENOVEL_MIRROR_TOKEN = "mirror-test-secret";
  try {
    assert.throws(
      () => controller.apply("Bearer wrong", {
        kind: "run.created",
        runId: "solo_ovl_0123456789abcdef0123456789abcdef",
      }),
      /missing or invalid/,
    );
    const result = await controller.apply("Bearer mirror-test-secret", {
      kind: "run.created",
      runId: "solo_ovl_0123456789abcdef0123456789abcdef",
    });
    assert.deepEqual(result, { accepted: true });
    assert.equal(calls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.OPENOVEL_MIRROR_TOKEN;
    else process.env.OPENOVEL_MIRROR_TOKEN = previous;
  }
});

test("createRun freezes OpenNovel mode and never enters the legacy narrator", async () => {
  const calls: string[] = [];
  const runtimeRun = publicRun(0);
  const created = {
    id: openNovelRunId(user.id, "create-key-001"),
    stateJson: { room: { solo: true } },
    roles: [{ id: "role-governor", roleKey: "zhejiang_governor" }],
  };
  const saved = {
    ...created,
    ownerUserId: user.id,
    templateKey: "sangtian",
    engineVersion: OPENOVEL_ENGINE_VERSION,
    selectedRoleKey: "zhejiang_governor",
    billingPolicyVersion: "world_unlock_v1",
    billingPriceJson: {},
    players: [{ userId: user.id, role: { id: "role-governor", roleKey: "zhejiang_governor" } }],
  };
  const prisma: any = {
    storyRun: {
      findUnique: async () => null,
      update: async ({ data }: any) => {
        calls.push(`db:${data.status}`);
        return saved;
      },
    },
    eventLog: { create: async () => ({ id: "event-1" }) },
  };
  const story: any = {
    createRun: async (_openid: string, _input: any, versions: any) => {
      calls.push(`story:${versions.engineVersion}`);
      assert.equal(versions.engineVersion, OPENOVEL_ENGINE_VERSION);
      assert.equal(versions.strategyVersion, "openovel_first_v1");
      return created;
    },
    claimRole: async () => {
      calls.push("claim");
    },
  };
  const credits: any = {
    reserveCharge: async () => assert.fail("world_unlock_v1 must not reserve a run charge"),
  };
  const runtime: any = {
    health: async () => calls.push("runtime:health"),
    createRun: async () => {
      calls.push("runtime:create");
      return runtimeRun;
    },
  };
  const service = new OpenNovelAdapterService(prisma, story, credits, runtime);
  const previousPolicy = process.env.CREDIT_DEFAULT_POLICY;
  process.env.CREDIT_DEFAULT_POLICY = "world_unlock_v1";
  try {
    const projection = await service.createRun(user, { idempotencyKey: "create-key-001" });
    assert.equal(projection.runtimeMode, OPENOVEL_RUNTIME_MODE);
    assert.equal(projection.turnNumber, 0);
    assert.deepEqual(calls.slice(0, 3), ["runtime:health", "runtime:create", `story:${OPENOVEL_ENGINE_VERSION}`]);
  } finally {
    if (previousPolicy === undefined) delete process.env.CREDIT_DEFAULT_POLICY;
    else process.env.CREDIT_DEFAULT_POLICY = previousPolicy;
  }
});

test("one product action makes one runtime turn, mirrors it, then emits commit", async () => {
  const calls: string[] = [];
  const before = publicRun(0);
  const after = publicRun(1);
  const result = {
    runId: "solo_ovl_run",
    turnId: "T01",
    turnNumber: 1,
    narration: "书吏没有接话，只把公文又往案前推了半寸。",
    options: [{ id: "T01_A", label: "留下书吏，再问一句。" }],
    warnings: [],
    committedAt: new Date().toISOString(),
    narrator: { model: "GLM-5.2", usage: { inputTokens: 10, outputTokens: 20 }, latencyMs: 12 },
  };
  let runtimeReads = 0;
  const run: any = {
    id: "solo_ovl_run",
    ownerUserId: user.id,
    templateKey: "sangtian",
    engineVersion: OPENOVEL_ENGINE_VERSION,
    selectedRoleKey: "zhejiang_governor",
    billingPolicyVersion: "world_unlock_v1",
    billingPriceJson: {},
    stateJson: { openovel: { turnNumber: 0 } },
    players: [{ userId: user.id, role: { id: "role-governor", roleKey: "zhejiang_governor" } }],
  };
  const prisma: any = {
    storyRun: {
      findUnique: async () => run,
      update: async () => {
        calls.push("db:run");
        return run;
      },
    },
    playerAction: {
      findUnique: async () => null,
      create: async () => ({ id: "action-1" }),
      update: async () => {
        calls.push("db:action");
      },
      updateMany: async () => {
        calls.push("db:action");
        return { count: 1 };
      },
    },
    sceneNode: {
      create: async () => ({ id: "node-1" }),
      update: async () => {
        calls.push("db:node");
      },
      updateMany: async () => undefined,
    },
    eventLog: {
      create: async () => {
        calls.push("db:event");
      },
    },
    $transaction: async (operation: any) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      return operation(prisma);
    },
  };
  const runtime: any = {
    getRun: async () => runtimeReads++ === 0 ? before : after,
    streamAction: async (input: any, onEvent: any) => {
      assert.equal(input.submissionId, "action-1");
      calls.push("runtime:turn");
      await onEvent({ type: "narration.delta", data: { text: result.narration } });
      await onEvent({ type: "options.complete", data: { options: result.options } });
      await onEvent({ type: "turn.committed", data: result });
      return result;
    },
  };
  const service = new OpenNovelAdapterService(prisma, {} as any, {} as any, runtime);
  const visible: string[] = [];
  const actual = await service.submitAction(
    user,
    run.id,
    { action: "留下书吏，再问一句。", idempotencyKey: "turn-key-001" },
    (event) => {
      visible.push(event.type);
      if (event.type === "turn.committed") calls.push("ui:commit");
    },
  );
  assert.equal(actual.turnId, "T01");
  assert.equal(calls.filter((item) => item === "runtime:turn").length, 1);
  assert.deepEqual(visible, ["narration.delta", "options.complete", "turn.committed"]);
  assert.ok(calls.indexOf("db:event") < calls.indexOf("ui:commit"));
});

test("runtime failure before commit releases reserved Credits and does not advance the run", async () => {
  const calls: string[] = [];
  const before = publicRun(0);
  const prices = {
    currency: "WORLD_CREDITS",
    runCreate: 20,
    standardAction: 1,
    customAction: 2,
    complexAction: 2,
    sponsorshipPack: 10,
  };
  const run: any = {
    id: "solo_ovl_failed_run",
    ownerUserId: user.id,
    templateKey: "sangtian",
    engineVersion: OPENOVEL_ENGINE_VERSION,
    selectedRoleKey: "zhejiang_governor",
    billingPolicyVersion: "active_action_v1",
    billingPriceJson: prices,
    stateJson: { openovel: { turnNumber: 0 } },
    players: [{ userId: user.id, role: { id: "role-governor", roleKey: "zhejiang_governor" } }],
  };
  const prisma: any = {
    storyRun: {
      findUnique: async () => run,
      update: async () => assert.fail("failed foreground must not mirror a new run state"),
    },
    playerAction: {
      findUnique: async () => null,
      create: async () => ({ id: "action-failed-1" }),
      updateMany: async ({ data }: any) => {
        calls.push(`db:action:${data.status}`);
        return { count: 1 };
      },
    },
    sceneNode: {
      create: async () => ({ id: "node-failed-1" }),
      updateMany: async ({ data }: any) => {
        calls.push(`db:node:${data.status}`);
        return { count: 1 };
      },
    },
    eventLog: {
      create: async () => assert.fail("failed foreground must not emit committed event"),
    },
    $transaction: async (operation: any) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      return operation(prisma);
    },
  };
  const credits: any = {
    reserveCharge: async ({ amount }: any) => {
      calls.push(`credits:reserve:${amount}`);
      return { kind: "reserved", charge: { id: "charge-failed-1" } };
    },
    commitCharge: async () => assert.fail("failed foreground must not commit Credits"),
    releaseCharge: async (id: string, reason: string) => {
      calls.push(`credits:release:${id}:${reason}`);
    },
  };
  const runtime: any = {
    getRun: async () => before,
    streamAction: async () => {
      calls.push("runtime:failed");
      throw new Error("provider balance unavailable");
    },
  };
  const service = new OpenNovelAdapterService(prisma, {} as any, credits, runtime);

  await assert.rejects(
    service.submitAction(
      user,
      run.id,
      { action: "暂不签发，继续核对密信。", idempotencyKey: "turn-failed-key-001" },
      () => undefined,
    ),
    /provider balance unavailable/,
  );
  assert.deepEqual(calls, [
    "credits:reserve:2",
    "runtime:failed",
    "db:action:failed",
    "db:node:generation_failed",
    "credits:release:charge-failed-1:provider balance unavailable",
  ]);
  assert.equal(run.stateJson.openovel.turnNumber, 0);
});

test("durable mirror idempotently recovers a committed runtime turn and settles Credits", async () => {
  const calls: string[] = [];
  let actionStatus = "failed";
  let storedResult: any = null;
  let chargeStatus = "RESERVED";
  const run: any = {
    id: "solo_ovl_0123456789abcdef0123456789abcdef",
    ownerUserId: user.id,
    templateKey: "sangtian",
    engineVersion: OPENOVEL_ENGINE_VERSION,
    selectedRoleKey: "zhejiang_governor",
    stateJson: { openovel: { turnNumber: 0 } },
  };
  const action: any = {
    id: "action-mirror-001",
    runId: run.id,
    nodeId: "node-mirror-001",
    get status() {
      return actionStatus;
    },
  };
  const after = {
    ...publicRun(1),
    runId: run.id,
  };
  const prisma: any = {
    storyRun: {
      findUnique: async () => run,
      update: async () => {
        calls.push("db:run");
        return run;
      },
    },
    playerAction: {
      findUnique: async () => action,
      updateMany: async () => {
        if (!["generating", "failed"].includes(actionStatus)) return { count: 0 };
        actionStatus = "resolved";
        calls.push("db:action:resolved");
        return { count: 1 };
      },
    },
    sceneNode: {
      update: async () => {
        calls.push("db:node");
      },
    },
    eventLog: {
      create: async () => {
        calls.push("db:event");
      },
    },
    creditCharge: {
      findUnique: async () => ({ id: "charge-mirror-001", status: chargeStatus }),
    },
    $transaction: async (operation: any) => operation(prisma),
  };
  const credits: any = {
    commitCharge: async () => {
      calls.push("credits:commit");
      chargeStatus = "COMMITTED";
    },
  };
  const runtime: any = {
    getRun: async () => after,
  };
  prisma.playerAction.updateMany = async ({ data }: any) => {
    if (!["generating", "failed"].includes(actionStatus)) return { count: 0 };
    actionStatus = "resolved";
    storedResult = data.resolvedJson;
    calls.push("db:action:resolved");
    return { count: 1 };
  };
  const service = new OpenNovelAdapterService(prisma, {} as any, credits, runtime);
  const event = {
    kind: "turn.committed",
    runId: run.id,
    payload: {
      submissionId: action.id,
      result: {
        runId: run.id,
        turnId: "T01",
        turnNumber: 1,
        narration: "书吏仍在案前等候。",
        options: [{
          id: "T01_A",
          label: "继续查问。",
          effect: { consequence: "后台可见，玩家不可见。" },
        }],
        warnings: [],
        committedAt: new Date().toISOString(),
      },
    },
  };

  const first = await service.applyMirrorEvent(event);
  const second = await service.applyMirrorEvent(event);

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(actionStatus, "resolved");
  assert.equal(chargeStatus, "COMMITTED");
  assert.deepEqual(storedResult.options, [{ id: "T01_A", label: "继续查问。" }]);
  assert.equal(calls.filter((value) => value === "db:event").length, 1);
  assert.equal(calls.filter((value) => value === "credits:commit").length, 1);
});

function publicRun(turnNumber: number) {
  return {
    runId: "solo_ovl_run",
    worldId: "sangtian",
    roleId: "zhejiang_governor",
    runtimeMode: OPENOVEL_RUNTIME_MODE,
    turnNumber,
    status: "READY",
    canon: "开场",
    recentCanon: turnNumber ? "新一回合" : "开场",
    options: [{ id: `T${turnNumber}_A`, label: "继续查问。" }],
    updatedAt: new Date().toISOString(),
  };
}

test("completed OpenNovel run exposes the protagonist ending through the product result contract", async () => {
  const completed = {
    ...publicRun(20),
    status: "COMPLETED",
    options: [],
    ending: {
      schemaVersion: "openovel_ending_v1" as const,
      scope: "PART" as const,
      endingKey: "guarded_people_bore_responsibility",
      title: "守土担责",
      finalSceneNarrative: "驿骑已经离开杭州。",
      protagonistFate: "总督保住了证据，也把问责留给了自己。",
      aftermath: ["县册仍可追索。", "民田边界暂时仍在。"],
      sourceTurnId: "T20",
      sourceRevision: 20,
    },
  };
  const run = {
    id: completed.runId,
    title: "桑田诏",
    templateKey: "sangtian",
    ownerUserId: "user-1",
    engineVersion: OPENOVEL_ENGINE_VERSION,
    players: [{
      userId: "user-1",
      role: {
        roleName: "浙江总督",
        personalGoal: "守住浙江",
      },
    }],
  };
  const service = new OpenNovelAdapterService(
    {
      storyRun: { findUnique: async () => run },
    } as any,
    {} as any,
    {} as any,
    { getRun: async () => completed } as any,
  );

  const result = await service.result(
    { id: "user-1", openid: "openid-1" } as any,
    completed.runId,
  );

  assert.equal(result.chapter.title, "守土担责");
  assert.match(result.chapter.content, /主角命运/);
  assert.match(result.chapter.content, /总督保住了证据/);
  assert.equal(result.player?.endingTitle, "守土担责");
  assert.equal(result.completedNodes, 20);
});

test("product decision replay returns the committed result without advancing the runtime twice", async () => {
  const committed = {
    runId: "solo_ovl_replay",
    turnId: "T01",
    turnNumber: 1,
    narration: "书吏仍在案前等候，总督的第一道处置已经传出。",
    options: [{ id: "T01_A", label: "继续查问。" }],
    committedAt: new Date().toISOString(),
  };
  const run: any = {
    id: committed.runId,
    ownerUserId: user.id,
    templateKey: "sangtian",
    engineVersion: OPENOVEL_ENGINE_VERSION,
    selectedRoleKey: "zhejiang_governor",
    players: [{ userId: user.id, role: { id: "role-governor", roleKey: "zhejiang_governor" } }],
  };
  const replay: any = {
    runId: run.id,
    userId: user.id,
    status: "resolved",
    actionKey: "G00_B",
    method: "先封档房，再暂缓签发",
    freeText: null,
    immediateJson: { boundOption: { id: "G00_B", label: "先封档房，再暂缓签发" } },
    resolvedJson: committed,
  };
  const prisma: any = {
    playerAction: { findUnique: async () => replay },
    storyRun: { findUnique: async () => run },
  };
  const runtime: any = {
    getRun: async () => assert.fail("an idempotent product replay must not run another story turn"),
  };
  const service = new OpenNovelAdapterService(prisma, {} as any, {} as any, runtime);
  (service as any).game = async () => ({ schemaVersion: "continuous_game_projection_v2", worldSequence: 1 });

  const result = await service.submitDecision(user, run.id, "T01", {
    idempotencyKey: "decision-replay-001",
    turnRevision: 0,
    controlEpoch: 1,
    candidateId: "G00_B",
  } as any);

  assert.equal(result.accepted, true);
  assert.equal(result.resolution.id, "T01");
  assert.equal(result.resolution.appliedWorldSequence, 1);
  assert.equal(result.resolution.resultNarrative, committed.narration);
});
