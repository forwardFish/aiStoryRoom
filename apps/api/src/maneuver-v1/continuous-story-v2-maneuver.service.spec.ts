import assert from "node:assert/strict";
import test from "node:test";
import { ContinuousStoryV2ManeuverService } from "./continuous-story-v2-maneuver.service";

type Row = Record<string, any>;

class MemoryPrismaForManeuver {
  readonly run: Row = {
    id: "run-1",
    templateKey: "sangtian",
    worldSequence: 1,
    reservedWorldSequence: 1,
    currentNodeId: "node-1",
    currentDay: 1,
    version: 1,
  };
  readonly roles: Row[] = [
    {
      id: "role-governor",
      runId: "run-1",
      roleKey: "zhejiang_governor",
      roleName: "浙江总督",
      identity: "总督",
      publicInfo: "统筹地方政务",
      createdAt: new Date("2026-08-05T00:00:00Z"),
    },
    {
      id: "role-xunfu",
      runId: "run-1",
      roleKey: "xunfu",
      roleName: "浙江巡抚",
      identity: "巡抚",
      publicInfo: "负责地方执行",
      createdAt: new Date("2026-08-05T00:00:01Z"),
    },
  ];
  readonly turns: Row[] = [
    {
      id: "turn-governor-1",
      runId: "run-1",
      roleId: "role-governor",
      status: "OPEN",
      turnIndex: 1,
      stageIndex: 1,
      revision: 1,
      situationTitle: "巡抚衙门档房",
    },
    {
      id: "turn-xunfu-1",
      runId: "run-1",
      roleId: "role-xunfu",
      status: "OPEN",
      turnIndex: 1,
      stageIndex: 1,
      revision: 1,
      situationTitle: "巡抚衙门档房",
    },
  ];
  readonly players: Row[] = [
    { id: "player-1", runId: "run-1", userId: "user-1", roleId: "role-governor", status: "active" },
    { id: "player-2", runId: "run-1", userId: "user-2", roleId: "role-xunfu", status: "active" },
  ];
  readonly controls: Row[] = [
    { runId: "run-1", roleId: "role-governor", epoch: 1, mode: "HUMAN_ACTIVE" },
    { runId: "run-1", roleId: "role-xunfu", epoch: 1, mode: "HUMAN_ACTIVE" },
  ];
  readonly facts: Row[] = [
    {
      id: "fact-1",
      runId: "run-1",
      factKey: "fact.archive.seal_broken",
      content: "档房封条在昨夜被人动过。",
      status: "confirmed",
      visibility: "public",
      knownByRoleIdsJson: ["role-governor", "role-xunfu"],
      createdAt: new Date("2026-08-05T00:01:00Z"),
    },
  ];
  readonly entries: Row[] = [];
  readonly assets: Row[] = [
    {
      id: "asset-seal",
      runId: "run-1",
      assetKey: "governor_seal_authority",
      kind: "AUTHORITY",
      ownerRoleId: "role-governor",
      quantity: 1,
      status: "ACTIVE",
      visibility: "PRIVATE",
      stateJson: {},
      version: 1,
      createdAt: new Date("2026-08-05T00:02:00Z"),
      updatedAt: new Date("2026-08-05T00:02:00Z"),
    },
  ];
  readonly actions: Row[] = [];
  readonly events: Row[] = [];
  readonly mutations: Row[] = [];

  storyPlayer = {
    findFirst: async (_args: any) => null,
    findMany: async (_args: any) => [],
  } as any;

  constructor() {
    this.storyPlayer.findFirst = async ({ where, include, select }: any) => {
      const row = this.players.find((item) => this.matches(item, where));
      if (!row) return null;
      if (select) return this.pick(row, select);
      return include?.role ? { ...row, role: this.roles.find((role) => role.id === row.roleId) || null } : { ...row };
    };
    this.storyPlayer.findMany = async ({ where, select }: any = {}) => this.players
      .filter((row) => this.matches(row, where || {}))
      .map((row) => select ? this.pick(row, select) : { ...row });
  }

  actorTurn = {
    findUnique: async ({ where, include }: any) => {
      const row = this.turns.find((item) => item.id === where.id);
      if (!row) return null;
      return include
        ? { ...row, run: this.run, role: this.roles.find((role) => role.id === row.roleId) }
        : { ...row };
    },
    findFirst: async ({ where }: any) => {
      const rows = this.turns.filter((row) => this.matches(row, where));
      return rows.sort((a, b) => b.turnIndex - a.turnIndex)[0] || null;
    },
    update: async ({ where, data }: any) => {
      const row = this.turns.find((item) => item.id === where.id);
      if (!row) throw new Error("TURN_NOT_FOUND");
      this.applyData(row, data);
      return { ...row };
    },
  } as any;

  roleControl = {
    findUnique: async ({ where }: any) => {
      const key = where.runId_roleId;
      return this.controls.find((row) => row.runId === key.runId && row.roleId === key.roleId) || null;
    },
  } as any;

  storyRole = {
    findMany: async ({ where }: any) => this.roles.filter((row) => this.matches(row, where)).map((row) => ({ ...row })),
  } as any;

  canonFact = {
    findMany: async ({ where }: any) => this.facts.filter((row) => this.matches(row, where)).map((row) => ({ ...row })),
    create: async ({ data }: any) => {
      const row = { id: `fact-${this.facts.length + 1}`, createdAt: new Date(), ...data };
      this.facts.push(row);
      return { ...row };
    },
  } as any;

  narrativeEntry = {
    findMany: async ({ where, take }: any) => {
      let rows = this.entries.filter((row) => this.matches(row, where));
      if (take) rows = rows.slice(-take);
      return rows.map((row) => ({ ...row }));
    },
    create: async ({ data }: any) => {
      const row = { id: `entry-${this.entries.length + 1}`, createdAt: new Date(), ...data };
      this.entries.push(row);
      return { ...row };
    },
  } as any;

  roleAsset = {
    findMany: async ({ where }: any = {}) => this.assets.filter((row) => this.matches(row, where || {})).map((row) => ({ ...row })),
    findUnique: async ({ where }: any) => {
      if (where.id) return this.assets.find((row) => row.id === where.id) || null;
      const key = where.runId_assetKey;
      return this.assets.find((row) => row.runId === key.runId && row.assetKey === key.assetKey) || null;
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const row = this.assets.find((item) => item.id === where.id);
      if (!row) throw new Error("ASSET_NOT_FOUND");
      return { ...row };
    },
    create: async ({ data }: any) => {
      if (this.assets.some((row) => row.runId === data.runId && row.assetKey === data.assetKey)) {
        throw Object.assign(new Error("duplicate role asset"), { code: "P2002" });
      }
      const row = {
        id: `asset-${this.assets.length + 1}`,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      this.assets.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = this.assets.find((item) => item.id === where.id);
      if (!row) throw new Error("ASSET_NOT_FOUND");
      this.applyData(row, data);
      row.updatedAt = new Date();
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const rows = this.assets.filter((row) => this.matches(row, where));
      for (const row of rows) this.applyData(row, data);
      return { count: rows.length };
    },
  } as any;

  roleAssetMutation = {
    create: async ({ data }: any) => {
      const row = { id: `mutation-${this.mutations.length + 1}`, createdAt: new Date(), ...data };
      this.mutations.push(row);
      return row;
    },
  } as any;

  playerAction = {
    findMany: async ({ where, include, take }: any = {}) => {
      let rows = this.actions.filter((row) => this.matches(row, where || {}));
      if (take) rows = rows.slice(0, take);
      return rows.map((row) => include?.role
        ? { ...row, role: this.roles.find((role) => role.id === row.roleId) || null }
        : { ...row });
    },
    findUnique: async ({ where }: any) => {
      if (where.id) return this.actions.find((row) => row.id === where.id) || null;
      if (where.idempotencyKey) return this.actions.find((row) => row.idempotencyKey === where.idempotencyKey) || null;
      return null;
    },
    create: async ({ data }: any) => {
      if (this.actions.some((row) => row.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error("duplicate action"), { code: "P2002" });
      }
      const row = {
        id: `action-${this.actions.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        immediateJson: {},
        resolvedJson: {},
        ...data,
      };
      this.actions.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = this.actions.find((item) => item.id === where.id);
      if (!row) throw new Error("ACTION_NOT_FOUND");
      this.applyData(row, data);
      row.updatedAt = new Date();
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const rows = this.actions.filter((row) => this.matches(row, where));
      for (const row of rows) {
        this.applyData(row, data);
        row.updatedAt = new Date();
      }
      return { count: rows.length };
    },
  } as any;

  storyRun = {
    updateMany: async ({ where, data }: any) => {
      if (!this.matches(this.run, where)) return { count: 0 };
      this.applyData(this.run, data);
      return { count: 1 };
    },
    update: async ({ where, data }: any) => {
      if (where.id !== this.run.id) throw new Error("RUN_NOT_FOUND");
      this.applyData(this.run, data);
      return { ...this.run };
    },
  } as any;

  storyEvent = {
    upsert: async ({ where, create }: any) => {
      const existing = this.events.find((row) => row.dedupeKey === where.dedupeKey);
      if (existing) return { ...existing };
      this.events.push({ ...create });
      return { ...create };
    },
  } as any;

  async $transaction<T>(operation: (tx: this) => Promise<T>): Promise<T> {
    return operation(this);
  }

  private pick(row: Row, select: Row) {
    return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
  }

  private matches(row: Row, where: any): boolean {
    if (!where) return true;
    if (Array.isArray(where.OR)) return where.OR.some((clause: any) => this.matches(row, clause))
      && Object.entries(where).filter(([key]) => key !== "OR").every(([key, value]) => this.fieldMatches(row[key], value));
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return (value as any[]).some((clause) => this.matches(row, clause));
      return this.fieldMatches(row[key], value);
    });
  }

  private fieldMatches(actual: any, expected: any): boolean {
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("not" in expected) return actual !== expected.not;
      if ("in" in expected) return expected.in.includes(actual);
      if ("startsWith" in expected) return typeof actual === "string" && actual.startsWith(expected.startsWith);
      if ("path" in expected && "array_contains" in expected) {
        return Array.isArray(actual?.sharedWithRoleIds) && actual.sharedWithRoleIds.includes(expected.array_contains);
      }
    }
    return actual === expected;
  }

  private applyData(row: Row, data: Row) {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && !Array.isArray(value) && "increment" in value) {
        row[key] = Number(row[key] || 0) + Number((value as any).increment || 0);
      } else {
        row[key] = value;
      }
    }
  }
}

const userOne = { id: "user-1", openid: "openid-1" } as any;
const userTwo = { id: "user-2", openid: "openid-2" } as any;
const noOpDeliveries = { publish: async () => undefined } as any;

function previewCommand(capability: any, turn: Row, run: Row, draft: Row, idempotencyKey: string) {
  return {
    idempotencyKey,
    turnRevision: turn.revision,
    expectedStateRevision: run.worldSequence,
    expectedManeuverWindowVersion: capability.window.version,
    controlEpoch: 1,
    draft: { schemaVersion: "maneuver_draft_v1", ...draft },
  };
}

test("V2 preview is side-effect free and commit is authoritative, bounded and idempotent", async () => {
  const db = new MemoryPrismaForManeuver();
  const service = new ContinuousStoryV2ManeuverService(db as any, noOpDeliveries);
  const capability: any = await service.projection(userOne, db.run.id);
  assert.ok(capability);
  assert.equal(capability.window.remainingOpportunities, 2);

  const before = JSON.stringify({
    worldSequence: db.run.worldSequence,
    turnRevision: db.turns[0].revision,
    actions: db.actions,
    facts: db.facts,
    entries: db.entries,
    assets: db.assets,
  });
  const preview: any = await service.preview(userOne, db.run.id, db.turns[0].id, previewCommand(
    capability,
    db.turns[0],
    db.run,
    {
      kind: "CUSTOM_PLAN",
      rawText: "调人封锁巡抚衙门档房",
      attachmentAssetKeys: [],
      visibilityPreference: "PUBLIC",
    },
    "preview-custom-0001",
  ));
  assert.equal(preview.decision, "READY");
  assert.ok(preview.previewToken);
  assert.equal(preview.compiledAction, undefined, "compiled action must stay server-owned");
  assert.equal(JSON.stringify({
    worldSequence: db.run.worldSequence,
    turnRevision: db.turns[0].revision,
    actions: db.actions,
    facts: db.facts,
    entries: db.entries,
    assets: db.assets,
  }), before, "preview must not mutate the world");

  const committed: any = await service.commit(userOne, db.run.id, preview.previewId, {
    idempotencyKey: "commit-custom-0001",
    previewToken: preview.previewToken,
  });
  assert.equal(committed.accepted, true);
  assert.equal(committed.action.slot, "MANEUVER_1");
  assert.equal(db.actions.length, 1);
  assert.equal(db.run.worldSequence, 2);
  assert.equal(db.turns[0].revision, 2);
  assert.ok(db.facts.some((fact) => String(fact.factKey).startsWith("maneuver.started.")));

  const replay: any = await service.commit(userOne, db.run.id, preview.previewId, {
    idempotencyKey: "commit-custom-0001",
    previewToken: preview.previewToken,
  });
  assert.equal(replay.replayed, true);
  assert.equal(db.actions.length, 1, "idempotent replay must not create a second action");
});

test("an immediate investigation creates a private evidence card that does not project to another role", async () => {
  const db = new MemoryPrismaForManeuver();
  const service = new ContinuousStoryV2ManeuverService(db as any, noOpDeliveries);
  const governorCapability: any = await service.projection(userOne, db.run.id);
  const lead = governorCapability.investigationLeads[0];
  assert.ok(lead);
  const route = lead.routes.find((item: any) => item.returnLabel.includes("提交后")) || lead.routes[0];

  const preview: any = await service.preview(userOne, db.run.id, db.turns[0].id, previewCommand(
    governorCapability,
    db.turns[0],
    db.run,
    {
      kind: "INVESTIGATION",
      traceId: lead.traceId,
      routeId: route.routeId,
      attachmentAssetKeys: [],
    },
    "preview-investigation-0001",
  ));
  assert.equal(preview.decision, "READY");
  const commit: any = await service.commit(userOne, db.run.id, preview.previewId, {
    idempotencyKey: "commit-investigation-0001",
    previewToken: preview.previewToken,
  });
  assert.equal(commit.action.status, "RESOLVED");
  const evidence = db.assets.find((asset) => asset.kind === "EVIDENCE_CARD_V1");
  assert.ok(evidence);
  assert.equal(evidence!.ownerRoleId, "role-governor");
  assert.equal(evidence!.visibility, "PRIVATE");

  const governorAfter: any = await service.projection(userOne, db.run.id);
  assert.equal(governorAfter.evidenceCards.length, 1);
  assert.ok(governorAfter.evidenceCards[0].cannotProve.length > 0);

  const xunfuAfter: any = await service.projection(userTwo, db.run.id);
  assert.equal(xunfuAfter.evidenceCards.length, 0, "private evidence must not cross the role boundary");
});

test("a preview becomes stale when the authoritative sequence changes", async () => {
  const db = new MemoryPrismaForManeuver();
  const service = new ContinuousStoryV2ManeuverService(db as any, noOpDeliveries);
  const capability: any = await service.projection(userOne, db.run.id);
  const preview: any = await service.preview(userOne, db.run.id, db.turns[0].id, previewCommand(
    capability,
    db.turns[0],
    db.run,
    {
      kind: "CUSTOM_PLAN",
      rawText: "调人封锁巡抚衙门档房",
      attachmentAssetKeys: [],
      visibilityPreference: "NORMAL",
    },
    "preview-stale-0001",
  ));
  db.run.worldSequence += 1;
  db.run.reservedWorldSequence += 1;

  await assert.rejects(
    () => service.commit(userOne, db.run.id, preview.previewId, {
      idempotencyKey: "commit-stale-0001",
      previewToken: preview.previewToken,
    }),
    (error: any) => error?.response?.code === "ACTION_PREVIEW_STALE" || error?.response?.code === "WORLD_SETTLEMENT_IN_PROGRESS",
  );
  assert.equal(db.actions.length, 0);
});

test("conversation opens a role-scoped reaction and holding it consumes no active maneuver", async () => {
  const db = new MemoryPrismaForManeuver();
  const service = new ContinuousStoryV2ManeuverService(db as any, noOpDeliveries);
  const governorCapability: any = await service.projection(userOne, db.run.id);
  const conversationPreview: any = await service.preview(userOne, db.run.id, db.turns[0].id, previewCommand(
    governorCapability,
    db.turns[0],
    db.run,
    {
      kind: "CONVERSATION",
      targetActorId: "role-xunfu",
      message: "今晚前把经手人与时辰交来，我暂不公开追责。",
      purpose: "PROPOSE_TERM",
      visibility: "LIMITED",
      attachmentAssetKeys: [],
      formalAgreementRequested: false,
    },
    "preview-conversation-0001",
  ));
  const conversationCommit: any = await service.commit(userOne, db.run.id, conversationPreview.previewId, {
    idempotencyKey: "commit-conversation-0001",
    previewToken: conversationPreview.previewToken,
  });
  assert.equal(conversationCommit.action.status, "OPEN");

  const xunfuCapability: any = await service.projection(userTwo, db.run.id);
  assert.equal(xunfuCapability.reactions.length, 1);
  assert.match(xunfuCapability.reactions[0].storyNotice.narrative, /经手人/u);
  assert.equal(xunfuCapability.window.remainingOpportunities, 2);

  const holdPreview: any = await service.preview(userTwo, db.run.id, db.turns[1].id, previewCommand(
    xunfuCapability,
    db.turns[1],
    db.run,
    {
      kind: "REACTION",
      reactionId: xunfuCapability.reactions[0].reactionId,
      hold: true,
    },
    "preview-reaction-hold-0001",
  ));
  assert.equal(holdPreview.decision, "READY");
  const actionCountBeforeHold = db.actions.length;
  const sequenceBeforeHold = db.run.worldSequence;
  const holdCommit: any = await service.commit(userTwo, db.run.id, holdPreview.previewId, {
    idempotencyKey: "commit-reaction-hold-0001",
    previewToken: holdPreview.previewToken,
  });
  assert.equal(holdCommit.action.kind, "REACTION");
  assert.equal(db.actions.length, actionCountBeforeHold, "hold must not create a fifth active-action record");
  assert.equal(db.run.worldSequence, sequenceBeforeHold, "hold must not advance the shared world");

  const xunfuAfter: any = await service.projection(userTwo, db.run.id);
  assert.equal(xunfuAfter.reactions.length, 0);
  assert.equal(xunfuAfter.window.remainingOpportunities, 2);
});

test("a set rule card triggers once while preserving the affected role reaction window", async () => {
  const db = new MemoryPrismaForManeuver();
  const service = new ContinuousStoryV2ManeuverService(db as any, noOpDeliveries);
  const governorCapability: any = await service.projection(userOne, db.run.id);
  const card = governorCapability.ruleCards.find((item: any) => item.timing.includes("SET"));
  assert.ok(card);
  const target = card.legalTargets.find((item: any) => item.id === "role-xunfu");
  assert.ok(target);
  const trigger = card.triggerOptions.find((item: any) => item.triggerPatternId === "target_action_detected");
  assert.ok(trigger);

  const setPreview: any = await service.preview(userOne, db.run.id, db.turns[0].id, previewCommand(
    governorCapability,
    db.turns[0],
    db.run,
    {
      kind: "CARD_LAYOUT",
      cardAssetKey: card.cardAssetKey,
      playMode: "SET",
      targetId: target.id,
      triggerPatternId: trigger.triggerPatternId,
    },
    "preview-set-card-0001",
  ));
  const setCommit: any = await service.commit(userOne, db.run.id, setPreview.previewId, {
    idempotencyKey: "commit-set-card-0001",
    previewToken: setPreview.previewToken,
  });
  assert.equal(setCommit.action.status, "ARMED");
  assert.equal(db.assets.find((item) => item.id === "asset-seal")?.status, "LOCKED");

  const xunfuCapability: any = await service.projection(userTwo, db.run.id);
  const actionPreview: any = await service.preview(userTwo, db.run.id, db.turns[1].id, previewCommand(
    xunfuCapability,
    db.turns[1],
    db.run,
    {
      kind: "CUSTOM_PLAN",
      rawText: "保护浙江巡抚",
      attachmentAssetKeys: [],
      visibilityPreference: "NORMAL",
    },
    "preview-triggering-action-0001",
  ));
  assert.equal(actionPreview.decision, "READY");
  const actionCommit: any = await service.commit(userTwo, db.run.id, actionPreview.previewId, {
    idempotencyKey: "commit-triggering-action-0001",
    previewToken: actionPreview.previewToken,
  });
  assert.equal(actionCommit.action.status, "OPEN", "the affected role still receives its reaction window");
  const triggeringAction = db.actions.find((item) => item.id === actionCommit.action.actionId);
  assert.deepEqual(triggeringAction?.resolvedJson?.triggeredCardActionIds, [setCommit.action.actionId]);
  assert.equal(db.actions.find((item) => item.id === setCommit.action.actionId)?.status, "RESOLVED");
  assert.equal(db.assets.find((item) => item.id === "asset-seal")?.status, "ACTIVE");
  const triggerFacts = db.facts.filter((fact) => String(fact.factKey).startsWith("maneuver.card.trigger."));
  assert.equal(triggerFacts.length, 1);

  // Replaying the same commit cannot trigger or consume the card a second time.
  const replay: any = await service.commit(userTwo, db.run.id, actionPreview.previewId, {
    idempotencyKey: "commit-triggering-action-0001",
    previewToken: actionPreview.previewToken,
  });
  assert.equal(replay.replayed, true);
  assert.equal(db.facts.filter((fact) => String(fact.factKey).startsWith("maneuver.card.trigger.")).length, 1);
});

test("maneuver feature gate is fail-closed in production unless explicitly enabled", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    enabled: process.env.MANEUVER_RULES_V1_ENABLED,
    allowlist: process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST,
  };
  const db = new MemoryPrismaForManeuver();
  const service = new ContinuousStoryV2ManeuverService(db as any, noOpDeliveries);
  try {
    process.env.NODE_ENV = "production";
    delete process.env.MANEUVER_RULES_V1_ENABLED;
    process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST = "sangtian";
    assert.equal(service.enabledForRun("sangtian"), false);

    process.env.MANEUVER_RULES_V1_ENABLED = "true";
    assert.equal(service.enabledForRun("sangtian"), true);
    assert.equal(service.enabledForRun("caesar"), false);

    process.env.MANEUVER_RULES_V1_ENABLED = "definitely-not-a-valid-flag";
    assert.equal(service.enabledForRun("sangtian"), false);
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.enabled === undefined) delete process.env.MANEUVER_RULES_V1_ENABLED;
    else process.env.MANEUVER_RULES_V1_ENABLED = previous.enabled;
    if (previous.allowlist === undefined) delete process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST;
    else process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST = previous.allowlist;
  }
});
