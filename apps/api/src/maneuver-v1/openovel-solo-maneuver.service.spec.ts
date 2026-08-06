import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { OpenNovelSoloManeuverService, type OpenNovelManeuverRunV1 } from "./openovel-solo-maneuver.service";
import { openNovelGameProjection } from "../openovel-adapter/openovel-game-projection";
import { OPENOVEL_RUNTIME_MODE, type OpenNovelPublicRun } from "../openovel-adapter/openovel-runtime.client";

type Row = Record<string, any>;

class OpenNovelManeuverMemoryPrisma {
  run: OpenNovelManeuverRunV1 & Row;
  actions: Row[] = [];
  nodes: Row[] = [];
  entries: Row[] = [];

  constructor(run: OpenNovelManeuverRunV1 & Row) {
    this.run = structuredClone(run);
  }

  storyRun = {
    findUnique: async ({ where, include, select }: any) => {
      if (where.id !== this.run.id) return null;
      if (select) return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, (this.run as any)[key]]));
      if (include?.players) return structuredClone(this.run);
      return structuredClone(this.run);
    },
    updateMany: async ({ where, data }: any) => {
      if (where.id !== this.run.id || (where.version !== undefined && where.version !== this.run.version)) return { count: 0 };
      this.apply(this.run, data);
      return { count: 1 };
    },
  } as any;

  sceneNode = {
    upsert: async ({ where, update, create }: any) => {
      let row = this.nodes.find((item) => item.id === where.id);
      if (row) this.apply(row, update);
      else {
        row = { createdAt: new Date(), updatedAt: new Date(), ...create };
        this.nodes.push(row!);
      }
      return structuredClone(row!);
    },
  } as any;

  playerAction = {
    create: async ({ data }: any) => {
      if (this.actions.some((item) => item.idempotencyKey === data.idempotencyKey || item.id === data.id)) {
        throw Object.assign(new Error("duplicate action"), { code: "P2002" });
      }
      const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
      this.actions.push(row);
      return structuredClone(row);
    },
    updateMany: async ({ where, data }: any) => {
      const rows = this.actions.filter((item) => this.matches(item, where));
      for (const row of rows) this.apply(row, data);
      return { count: rows.length };
    },
  } as any;

  narrativeEntry = {
    create: async ({ data }: any) => {
      const row = { id: `entry-${this.entries.length + 1}`, createdAt: new Date(), ...data };
      this.entries.push(row);
      return structuredClone(row);
    },
  } as any;

  async $transaction<T>(operation: (tx: this) => Promise<T>): Promise<T> {
    return operation(this);
  }

  private apply(row: Row, data: Row) {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && !Array.isArray(value) && "increment" in value) {
        row[key] = Number(row[key] || 0) + Number((value as any).increment || 0);
      } else {
        row[key] = structuredClone(value);
      }
    }
  }

  private matches(row: Row, where: any): boolean {
    return Object.entries(where || {}).every(([key, expected]) => {
      const actual = row[key];
      if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        if ("in" in expected) return (expected as any).in.includes(actual);
      }
      return actual === expected;
    });
  }
}

const user = { id: "user-1", openid: "openid-1" } as any;
const game = getGameDefinition("sangtian");

function runtimeRun(turnNumber = 0): OpenNovelPublicRun {
  return {
    runId: "solo-ovl-maneuver-1",
    worldId: "sangtian",
    roleId: "zhejiang_governor",
    runtimeMode: OPENOVEL_RUNTIME_MODE,
    turnNumber,
    status: "READY",
    canon: turnNumber > 0 ? "前一回合已经落定。" : "开场。",
    recentCanon: turnNumber > 0 ? "新的局势已经展开。" : "档房封条有异。",
    options: [{ id: `T${turnNumber + 1}_A`, label: "继续核查。" }],
    updatedAt: `2026-08-05T0${turnNumber}:00:00.000Z`,
  };
}

function productRun(version = 1, stateJson: unknown = {}): OpenNovelManeuverRunV1 & Row {
  return {
    id: "solo-ovl-maneuver-1",
    title: "桑田诏",
    templateKey: "sangtian",
    status: "active",
    billingPolicyVersion: "world_unlock_v1",
    billingPriceJson: {},
    selectedRoleKey: "zhejiang_governor",
    ownerUserId: user.id,
    version,
    stateJson,
    currentNodeId: null,
    players: [{
      userId: user.id,
      role: {
        id: "role-governor",
        roleKey: "zhejiang_governor",
        roleName: "浙江总督",
        identity: "浙江总督",
        personalGoal: "保住民田并留下可追索证据",
      },
    }],
  };
}

function previewCommand(capability: any, runtime: OpenNovelPublicRun, draft: Row, key = "preview-openovel-001") {
  return {
    idempotencyKey: key,
    turnRevision: runtime.turnNumber,
    expectedStateRevision: runtime.turnNumber,
    expectedManeuverWindowVersion: capability.window.version,
    controlEpoch: 1,
    draft: { schemaVersion: "maneuver_draft_v1", ...draft },
  };
}

function commitCommand(capability: any, runtime: OpenNovelPublicRun, previewToken: string, key = "commit-openovel-001") {
  return {
    idempotencyKey: key,
    previewToken,
    expectedTurnRevision: runtime.turnNumber,
    expectedStateRevision: runtime.turnNumber,
    expectedManeuverWindowVersion: capability.window.version,
    controlEpoch: 1,
  };
}

function exceptionCode(error: any) {
  return String(error?.response?.code || error?.response?.message?.code || error?.code || "");
}

test("OpenNovel Solo projects exactly four bounded maneuver forms and a server-owned 2/2 window", () => {
  const db = new OpenNovelManeuverMemoryPrisma(productRun());
  const service = new OpenNovelSoloManeuverService(db as any);
  const projection: any = service.projection({ user, run: db.run, runtimeRun: runtimeRun(), game });
  assert.ok(projection?.enabled);
  assert.equal(projection.window.totalOpportunities, 2);
  assert.equal(projection.window.remainingOpportunities, 2);
  assert.equal(projection.window.formLimits.conversationRemaining, 1);
  assert.equal(projection.window.formLimits.investigationRemaining, 1);
  assert.ok(projection.contacts.length >= 2);
  assert.ok(projection.investigationLeads.length >= 2);
  assert.ok(projection.ruleCards.length >= 3);
  assert.deepEqual(projection.reactions, [], "应变不是第五个永久入口");
});

test("OpenNovel preview is side-effect free; confirming an immediate investigation creates one private evidence card", async () => {
  const previousSecret = process.env.MANEUVER_PREVIEW_SECRET;
  process.env.MANEUVER_PREVIEW_SECRET = "openovel-maneuver-preview-test-secret-20260805";
  try {
    const db = new OpenNovelManeuverMemoryPrisma(productRun());
    const service = new OpenNovelSoloManeuverService(db as any);
    const runtime = runtimeRun();
    const capability: any = service.projection({ user, run: db.run, runtimeRun: runtime, game });
    const lead = capability.investigationLeads.find((item: any) => item.traceId === "trace.register.amended_pages");
    const route = lead.routes.find((item: any) => item.routeId === "route.compare_paper_and_seal");
    assert.ok(route);

    const before = JSON.stringify({ run: db.run, actions: db.actions, nodes: db.nodes, entries: db.entries });
    const preview: any = await service.preview({
      user,
      run: db.run,
      runtimeRun: runtime,
      game,
      turnId: "T01",
      command: previewCommand(capability, runtime, {
        kind: "INVESTIGATION",
        traceId: lead.traceId,
        routeId: route.routeId,
        executorAssetKey: "staff.shen_yan",
        attachmentAssetKeys: [],
      }),
    });
    assert.equal(preview.decision, "READY");
    assert.ok(preview.previewToken);
    assert.equal(JSON.stringify({ run: db.run, actions: db.actions, nodes: db.nodes, entries: db.entries }), before, "预演不得写入世界或扣次数");

    const committed: any = await service.commit({
      user,
      run: db.run,
      runtimeRun: runtime,
      game,
      previewId: preview.previewId,
      command: commitCommand(capability, runtime, preview.previewToken),
    });
    assert.equal(committed.accepted, true);
    assert.equal(committed.action.kind, "INVESTIGATION");
    assert.equal(committed.action.status, "RESOLVED");
    assert.equal(db.actions.length, 1);
    assert.equal(db.run.version, 2);
    assert.equal(committed.maneuverRulesV1.window.remainingOpportunities, 1);
    assert.equal(committed.maneuverRulesV1.evidenceCards.length, 1);
    assert.equal(committed.maneuverRulesV1.evidenceCards[0].visibility, "PRIVATE");
    assert.ok(committed.maneuverRulesV1.evidenceCards[0].supports.length > 0);
    assert.ok(committed.maneuverRulesV1.evidenceCards[0].cannotProve.length > 0);

    const replay: any = await service.commit({
      user,
      run: { ...db.run, stateJson: db.run.stateJson },
      runtimeRun: runtime,
      game,
      previewId: preview.previewId,
      command: commitCommand(committed.maneuverRulesV1, runtime, preview.previewToken),
    });
    assert.equal(replay.idempotentReplay, true);
    assert.equal(db.actions.length, 1);
  } finally {
    if (previousSecret === undefined) delete process.env.MANEUVER_PREVIEW_SECRET;
    else process.env.MANEUVER_PREVIEW_SECRET = previousSecret;
  }
});

test("OpenNovel rejects a stale preview after the authoritative product version changes", async () => {
  const previousSecret = process.env.MANEUVER_PREVIEW_SECRET;
  process.env.MANEUVER_PREVIEW_SECRET = "openovel-maneuver-preview-test-secret-20260805";
  try {
    const db = new OpenNovelManeuverMemoryPrisma(productRun());
    const service = new OpenNovelSoloManeuverService(db as any);
    const runtime = runtimeRun();
    const capability: any = service.projection({ user, run: db.run, runtimeRun: runtime, game });
    const preview: any = await service.preview({
      user,
      run: db.run,
      runtimeRun: runtime,
      game,
      turnId: "T01",
      command: previewCommand(capability, runtime, {
        kind: "CUSTOM_PLAN",
        rawText: "命一队兵丁封锁巡抚衙门档房。",
        attachmentAssetKeys: [],
        visibilityPreference: "PUBLIC",
      }, "preview-openovel-stale-001"),
    });
    assert.equal(preview.decision, "READY");
    db.run.version += 1;
    await assert.rejects(
      service.commit({
        user,
        run: db.run,
        runtimeRun: runtime,
        game,
        previewId: preview.previewId,
        command: commitCommand(capability, runtime, preview.previewToken, "commit-openovel-stale-001"),
      }),
      (error: any) => exceptionCode(error) === "ACTION_PREVIEW_STALE",
    );
    assert.equal(db.actions.length, 0);
  } finally {
    if (previousSecret === undefined) delete process.env.MANEUVER_PREVIEW_SECRET;
    else process.env.MANEUVER_PREVIEW_SECRET = previousSecret;
  }
});

test("OpenNovel main-decision context states confirmed starts without inventing contested success", async () => {
  const previousSecret = process.env.MANEUVER_PREVIEW_SECRET;
  process.env.MANEUVER_PREVIEW_SECRET = "openovel-maneuver-preview-test-secret-20260805";
  try {
    const db = new OpenNovelManeuverMemoryPrisma(productRun());
    const service = new OpenNovelSoloManeuverService(db as any);
    const runtime = runtimeRun();
    const capability: any = service.projection({ user, run: db.run, runtimeRun: runtime, game });
    const preview: any = await service.preview({
      user,
      run: db.run,
      runtimeRun: runtime,
      game,
      turnId: "T01",
      command: previewCommand(capability, runtime, {
        kind: "CUSTOM_PLAN",
        rawText: "命一队兵丁封锁巡抚衙门档房。",
        attachmentAssetKeys: [],
        visibilityPreference: "PUBLIC",
      }, "preview-openovel-context-001"),
    });
    await service.commit({
      user,
      run: db.run,
      runtimeRun: runtime,
      game,
      previewId: preview.previewId,
      command: commitCommand(capability, runtime, preview.previewToken, "commit-openovel-context-001"),
    });
    const context = service.mainDecisionContext({ user, run: db.run, runtimeRun: runtime, game });
    assert.match(context, /已确认开始/u);
    assert.match(context, /仍不得视为已发生/u);
    assert.match(context, /不得把尚未结算的结果写成既成事实/u);
    assert.doesNotMatch(context, /底册已经被封锁|已经拿回全部底册/u);
  } finally {
    if (previousSecret === undefined) delete process.env.MANEUVER_PREVIEW_SECRET;
    else process.env.MANEUVER_PREVIEW_SECRET = previousSecret;
  }
});

test("OpenNovel game projection carries the narrative maneuver timeline on the real continuous projection contract", () => {
  const db = new OpenNovelManeuverMemoryPrisma(productRun());
  const service = new OpenNovelSoloManeuverService(db as any);
  const runtime = runtimeRun();
  const capability: any = service.projection({ user, run: db.run, runtimeRun: runtime, game });
  const projection: any = openNovelGameProjection({
    userId: user.id,
    run: db.run as any,
    runtimeRun: runtime,
    game,
    nodes: [],
    maneuverRulesV1: capability,
    maneuverTimeline: [{
      id: "maneuver:one",
      kind: "MANEUVER_ACTION",
      title: "沈砚已经离开内厅",
      content: "他沿出入簿追查昨夜的封箱车。",
      worldSequence: 0,
      createdAt: "2026-08-05T00:00:00.000Z",
      decisionForm: "INVESTIGATION",
    }],
    credits: {
      policyVersion: "world_unlock_v1",
      meteringMode: "OFF",
      available: 100,
      personalAvailable: 100,
      runAllowanceAvailable: 0,
      standardActionCost: 1,
      customActionCost: 2,
    },
  });
  assert.equal(projection.capabilities.maneuverRulesV1.enabled, true);
  assert.ok(projection.timeline.some((item: any) => item.id === "maneuver:one"));
  assert.equal(projection.capabilities.maneuverRulesV1.window.remainingOpportunities, 2);
});

test("OpenNovel delayed investigation resolves exactly once when the next actor turn opens", async () => {
  const previousSecret = process.env.MANEUVER_PREVIEW_SECRET;
  process.env.MANEUVER_PREVIEW_SECRET = "openovel-maneuver-preview-test-secret-20260805";
  try {
    const db = new OpenNovelManeuverMemoryPrisma(productRun());
    const service = new OpenNovelSoloManeuverService(db as any);
    const runtime0 = runtimeRun(0);
    const capability: any = service.projection({ user, run: db.run, runtimeRun: runtime0, game });
    const lead = capability.investigationLeads.find((item: any) => item.traceId === "trace.xunfu.messenger");
    const route = lead.routes.find((item: any) => item.routeId === "route.follow_messenger");
    const preview: any = await service.preview({
      user,
      run: db.run,
      runtimeRun: runtime0,
      game,
      turnId: "T01",
      command: previewCommand(capability, runtime0, {
        kind: "INVESTIGATION",
        traceId: lead.traceId,
        routeId: route.routeId,
        attachmentAssetKeys: [],
      }, "preview-openovel-delayed-001"),
    });
    const committed: any = await service.commit({
      user,
      run: db.run,
      runtimeRun: runtime0,
      game,
      previewId: preview.previewId,
      command: commitCommand(capability, runtime0, preview.previewToken, "commit-openovel-delayed-001"),
    });
    assert.equal(committed.action.status, "PENDING");
    assert.equal(committed.maneuverRulesV1.evidenceCards.length, 0);

    const runtime1 = runtimeRun(1);
    const fresh = await service.settleOnProjection({ user, run: db.run, runtimeRun: runtime1, game });
    const projected: any = service.projection({ user, run: fresh, runtimeRun: runtime1, game });
    assert.equal(projected.evidenceCards.length, 1);
    assert.equal(projected.evidenceCards[0].visibility, "PRIVATE");
    assert.equal(projected.window.remainingOpportunities, 2);
    assert.equal(db.actions[0].status, "RESOLVED");
    const versionAfterSettlement = db.run.version;
    const entryCount = db.entries.length;

    await service.settleOnProjection({ user, run: db.run, runtimeRun: runtime1, game });
    assert.equal(db.run.version, versionAfterSettlement);
    assert.equal(db.entries.length, entryCount, "a delayed investigation must not create a duplicate result entry");
  } finally {
    if (previousSecret === undefined) delete process.env.MANEUVER_PREVIEW_SECRET;
    else process.env.MANEUVER_PREVIEW_SECRET = previousSecret;
  }
});

test("OpenNovel does not expose reaction as a permanent fifth action", async () => {
  const previousSecret = process.env.MANEUVER_PREVIEW_SECRET;
  process.env.MANEUVER_PREVIEW_SECRET = "openovel-maneuver-preview-test-secret-20260805";
  try {
    const db = new OpenNovelManeuverMemoryPrisma(productRun());
    const service = new OpenNovelSoloManeuverService(db as any);
    const runtime = runtimeRun();
    const capability: any = service.projection({ user, run: db.run, runtimeRun: runtime, game });
    await assert.rejects(
      service.preview({
        user,
        run: db.run,
        runtimeRun: runtime,
        game,
        turnId: "T01",
        command: previewCommand(capability, runtime, {
          kind: "REACTION",
          reactionId: "reaction-not-visible",
          hold: true,
        }, "preview-openovel-reaction-001"),
      }),
      (error: any) => exceptionCode(error) === "REACTION_WINDOW_CLOSED",
    );
    assert.equal(db.actions.length, 0);
  } finally {
    if (previousSecret === undefined) delete process.env.MANEUVER_PREVIEW_SECRET;
    else process.env.MANEUVER_PREVIEW_SECRET = previousSecret;
  }
});

test("OpenNovel maneuver feature gate also requires explicit production opt-in", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    enabled: process.env.MANEUVER_RULES_V1_ENABLED,
    allowlist: process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST,
  };
  const db = new OpenNovelManeuverMemoryPrisma(productRun()) as any;
  const service = new OpenNovelSoloManeuverService(db);
  try {
    process.env.NODE_ENV = "production";
    delete process.env.MANEUVER_RULES_V1_ENABLED;
    process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST = "sangtian";
    assert.equal(service.enabledForRun("sangtian"), false);

    process.env.MANEUVER_RULES_V1_ENABLED = "enabled";
    assert.equal(service.enabledForRun("sangtian"), true);
    assert.equal(service.enabledForRun("caesar"), false);
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.enabled === undefined) delete process.env.MANEUVER_RULES_V1_ENABLED;
    else process.env.MANEUVER_RULES_V1_ENABLED = previous.enabled;
    if (previous.allowlist === undefined) delete process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST;
    else process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST = previous.allowlist;
  }
});
