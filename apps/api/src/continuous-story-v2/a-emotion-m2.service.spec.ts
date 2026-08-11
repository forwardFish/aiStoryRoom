import assert from "node:assert/strict";
import test from "node:test";
import {
  A_EMOTION_M1_EVENT_TYPE,
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  CONTINUOUS_STORY_ENGINE_VERSION,
  aEmotionM2ForbiddenPaths,
  aEmotionM2SemanticLeaks,
  validateAEmotionM2ProjectionV1,
  type AEmotionM1ProjectionV1
} from "@ai-story/shared";
import {
  A_EMOTION_M2_SUSPECT_ACTION_KEY,
  A_EMOTION_M2_SUSPECT_EFFECT_KEY,
  A_EMOTION_M2_SUSPECT_FACT_KEY
} from "../config/a-emotion-m2.config";
import {
  AEmotionM2Service,
  aEmotionM2AggregateIdentity,
  aEmotionM2StageId,
  normalizePreviousProjection,
  type AEmotionM2CanonicalUpgrade
} from "./a-emotion-m2.service";

const previousM1 = process.env.A_EMOTION_M1_ENABLED;
const previousM2 = process.env.A_EMOTION_M2_ENABLED;
process.env.A_EMOTION_M1_ENABLED = "true";
process.env.A_EMOTION_M2_ENABLED = "true";

test.after(() => {
  if (previousM1 === undefined) delete process.env.A_EMOTION_M1_ENABLED;
  else process.env.A_EMOTION_M1_ENABLED = previousM1;
  if (previousM2 === undefined) delete process.env.A_EMOTION_M2_ENABLED;
  else process.env.A_EMOTION_M2_ENABLED = previousM2;
});

function role(id: string, roleKey: string) {
  return {
    id,
    runId: "run-m2",
    roleKey,
    roleName: roleKey,
    identity: roleKey,
    publicInfo: "",
    hiddenSecret: null,
    personalGoal: "",
    currentState: "",
    abilityText: null,
    arcText: null,
    knownInfoJson: [],
    cannotDoJson: [],
    isAiControlled: false,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date()
  } as any;
}

function hiddenProjection(eventSequence = 8): AEmotionM1ProjectionV1 {
  return {
    schemaVersion: A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
    projectionVersion: 1,
    stateVersion: 3,
    eventSequence,
    category: "RELATED",
    disclosure: "HIDDEN",
    severity: "MAJOR",
    centerCardType: "CROSS_IMPACT",
    title: "他人的行动改变了你的处境",
    summary: "送达总督府的账册出现异常，原始材料尚未按登记到位。",
    sourceStatus: "来源未知",
    knownFacts: ["递送编号存在断档", "多个经手环节都接触过材料"],
    visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 52, after: 46, delta: -6, suffix: "", safeReason: "粮册异常引发朝廷质疑" }],
    responseOptions: [
      { code: "INVESTIGATE_LEDGER_ANOMALY", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_ledger_delivery", prefillText: "核对递送、封签和经手记录。" },
      { code: "QUESTION_DELIVERY_PUBLICLY", label: "公开质问", preferredEntry: "TALK", intentKey: "question_ledger_delivery", prefillText: "请相关经手方说明递送记录为何不一致。" },
      { code: "DEFER_RESPONSE", label: "暂不回应", preferredEntry: "DEFER", intentKey: null, prefillText: null }
    ],
    occurredAt: "2026-08-10T05:00:00.000Z"
  };
}

function run(stateJson: unknown = { featureFlags: { aEmotionM1: true, aEmotionM2: true } }) {
  return {
    id: "run-m2",
    mode: "room",
    maxPlayers: 3,
    templateKey: "sangtian",
    strategyVersion: "sangtian_v1_2",
    engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
    stateJson,
    currentNodeId: "node-m2"
  };
}

function action(actionKey = A_EMOTION_M2_SUSPECT_ACTION_KEY) {
  return {
    actionKey,
    visibility: "LIMITED",
    effectFactKeys: [A_EMOTION_M2_SUSPECT_FACT_KEY],
    influenceEdges: [],
    normalizedIntent: {
      objective: "核验权威记录",
      target: { type: "DOCUMENT", id: "ledger", label: "账册" },
      method: "依照结构化行动卡进行双重核验",
      leverageKeys: [],
      visibility: "LIMITED",
      riskTolerance: "MEDIUM",
      fallback: null,
      condition: null
    }
  } as any;
}

type AuthoritativeUpgradeAction = Parameters<AEmotionM2Service["applyAuthoritativeUpgrade"]>[1]["action"];

function malformedUpgradeAction(value: unknown): AuthoritativeUpgradeAction {
  return value as AuthoritativeUpgradeAction;
}

function contentStub() {
  return {
    forGame: () => ({
      roleStage: () => ({
        mainCards: [{
          actionKey: A_EMOTION_M2_SUSPECT_ACTION_KEY,
          visibility: "LIMITED",
          effect: { effectKey: A_EMOTION_M2_SUSPECT_EFFECT_KEY, factKeys: [A_EMOTION_M2_SUSPECT_FACT_KEY] }
        }]
      })
    })
  } as any;
}

test("aggregate identity binds room, run, viewer, stage, object and family without exposing them", () => {
  const first = aEmotionM2AggregateIdentity({ roomId: "room-a", runId: "run-a", viewerRoleId: "role-a", stageId: "stage-2" });
  const replay = aEmotionM2AggregateIdentity({ roomId: "room-a", runId: "run-a", viewerRoleId: "role-a", stageId: "stage-2" });
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first, aEmotionM2AggregateIdentity({ roomId: "room-b", runId: "run-a", viewerRoleId: "role-a", stageId: "stage-2" }));
  assert.notDeepEqual(first, aEmotionM2AggregateIdentity({ roomId: "room-a", runId: "run-b", viewerRoleId: "role-a", stageId: "stage-2" }));
  assert.notDeepEqual(first, aEmotionM2AggregateIdentity({ roomId: "room-a", runId: "run-a", viewerRoleId: "role-b", stageId: "stage-2" }));
  assert.match(first.aggregateId, /^agg_[0-9a-f]{32}$/u);
  assert.doesNotMatch(first.aggregateId, /room|run|role|stage/iu);
});

test("authoritative exact structured investigation queues HIDDEN to SUSPECTED once in the existing transaction", async () => {
  const governor = role("role-governor", "zhejiang_governor");
  const source = role("role-source", "xunfu");
  const county = role("role-county", "county_magistrate");
  const identity = aEmotionM2AggregateIdentity({ roomId: "run-m2", runId: "run-m2", viewerRoleId: governor.id, stageId: "stage-2" });
  const baseState = { featureFlags: { aEmotionM1: true, aEmotionM2: true } };
  let persistedState: any = baseState;
  let resolutionPatch: any = { schemaVersion: "pending_world_mutation_v1" };
  const tasks: any[] = [];
  const tx = {
    storyPlayer: { findFirst: async () => ({ userId: "user-governor" }) },
    eventDelivery: {
      findFirst: async () => ({
        eventId: "evt_0123456789abcdef0123456789abcdef",
        aggregateKey: identity.aggregateKey,
        aggregateId: identity.aggregateId,
        stageId: "stage-2",
        sharedObjectId: "original-grain-ledger",
        eventFamily: "LEDGER_DELIVERY",
        disclosure: "HIDDEN",
        projectionVersion: 1,
        stateVersion: 3,
        payloadJson: { type: A_EMOTION_M1_EVENT_TYPE, eventSequence: 8, payload: hiddenProjection(8) },
        event: { id: "evt_0123456789abcdef0123456789abcdef", runId: "run-m2", type: A_EMOTION_M1_EVENT_TYPE, sequence: 8 }
      })
    },
    storyRun: {
      findUnique: async () => ({ stateJson: persistedState }),
      update: async ({ data }: any) => { persistedState = data.stateJson; return data; }
    },
    actionResolution: {
      findUnique: async () => ({ runId: "run-m2", playerActionId: "action-m2", appliedWorldSequence: 22, statePatchJson: resolutionPatch }),
      update: async ({ data }: any) => { resolutionPatch = data.statePatchJson; return data; }
    },
    storyTaskOutbox: {
      findUnique: async () => null,
      create: async ({ data }: any) => { tasks.push(data); return data; }
    }
  } as any;
  const service = new AEmotionM2Service({} as any, contentStub(), {} as any);
  const result = await service.applyAuthoritativeUpgrade(tx, {
    run: run(baseState),
    sourceRole: governor,
    allRoles: [governor, source, county],
    resolutionId: "resolution-m2",
    playerActionId: "action-m2",
    stageIndex: 2,
    appliedWorldSequence: 22,
    action: action()
  });

  assert.deepEqual(result, { queued: true, nextDisclosure: "SUSPECTED" });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].taskType, "INTERACTION_DISCLOSURE_COMPILE_REQUESTED");
  assert.equal(tasks[0].status, "PENDING");
  assert.equal(resolutionPatch.aEmotionM2CanonicalUpgrade.previousDisclosure, "HIDDEN");
  assert.equal(resolutionPatch.aEmotionM2CanonicalUpgrade.nextDisclosure, "SUSPECTED");
  assert.equal(persistedState.aEmotionM2.stateVersion, 4);

  const duplicateTx = {
    ...tx,
    storyRun: { findUnique: async () => ({ stateJson: persistedState }), update: async () => { throw new Error("duplicate must not rewrite state"); } },
    actionResolution: { findUnique: async () => { throw new Error("duplicate must return before re-reading the resolution"); }, update: async () => { throw new Error("duplicate must not rewrite resolution"); } }
  } as any;
  const duplicate = await service.applyAuthoritativeUpgrade(duplicateTx, {
    run: run(persistedState),
    sourceRole: governor,
    allRoles: [governor, source, county],
    resolutionId: "resolution-m2",
    playerActionId: "action-m2",
    stageIndex: 2,
    appliedWorldSequence: 22,
    action: action()
  });
  assert.deepEqual(duplicate, { queued: true, nextDisclosure: "SUSPECTED" });
});


test("authoritative upgrade selects the current stage aggregate even when an older stage has a higher projection version", async () => {
  const governor = role("role-governor", "zhejiang_governor");
  const source = role("role-source", "xunfu");
  const county = role("role-county", "county_magistrate");
  const oldIdentity = aEmotionM2AggregateIdentity({ roomId: "run-m2", runId: "run-m2", viewerRoleId: governor.id, stageId: "stage-1" });
  const currentIdentity = aEmotionM2AggregateIdentity({ roomId: "run-m2", runId: "run-m2", viewerRoleId: governor.id, stageId: "stage-2" });
  const rows = [
    {
      eventId: "evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      aggregateKey: oldIdentity.aggregateKey,
      aggregateId: oldIdentity.aggregateId,
      stageId: "stage-1",
      sharedObjectId: "original-grain-ledger",
      eventFamily: "LEDGER_DELIVERY",
      disclosure: "SUSPECTED",
      projectionVersion: 9,
      stateVersion: 9,
      payloadJson: {},
      event: { id: "evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", runId: "run-m2", type: "A_EMOTION_M2_DISCLOSURE", sequence: 9 }
    },
    {
      eventId: "evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      aggregateKey: currentIdentity.aggregateKey,
      aggregateId: currentIdentity.aggregateId,
      stageId: "stage-2",
      sharedObjectId: "original-grain-ledger",
      eventFamily: "LEDGER_DELIVERY",
      disclosure: "HIDDEN",
      projectionVersion: 1,
      stateVersion: 3,
      payloadJson: { type: A_EMOTION_M1_EVENT_TYPE, eventSequence: 8, payload: hiddenProjection(8) },
      event: { id: "evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", runId: "run-m2", type: A_EMOTION_M1_EVENT_TYPE, sequence: 8 }
    }
  ];
  let persistedState: any = { featureFlags: { aEmotionM1: true, aEmotionM2: true } };
  let resolutionPatch: any = {};
  const tasks: any[] = [];
  const seenWhere: any[] = [];
  const tx = {
    storyPlayer: { findFirst: async () => ({ userId: "user-governor" }) },
    eventDelivery: {
      findFirst: async ({ where }: any) => {
        seenWhere.push(where);
        return rows
          .filter((row) => row.aggregateKey === where.aggregateKey && row.aggregateId === where.aggregateId && row.stageId === where.stageId)
          .sort((left, right) => right.projectionVersion - left.projectionVersion)[0] || null;
      }
    },
    storyRun: {
      findUnique: async () => ({ stateJson: persistedState }),
      update: async ({ data }: any) => { persistedState = data.stateJson; return data; }
    },
    actionResolution: {
      findUnique: async () => ({ runId: "run-m2", playerActionId: "action-m2", appliedWorldSequence: 22, statePatchJson: resolutionPatch }),
      update: async ({ data }: any) => { resolutionPatch = data.statePatchJson; return data; }
    },
    storyTaskOutbox: {
      findUnique: async () => null,
      create: async ({ data }: any) => { tasks.push(data); return data; }
    }
  } as any;
  const service = new AEmotionM2Service({} as any, contentStub(), {} as any);
  const result = await service.applyAuthoritativeUpgrade(tx, {
    run: run(), sourceRole: governor, allRoles: [governor, source, county], resolutionId: "resolution-stage-2",
    playerActionId: "action-m2", stageIndex: 2, appliedWorldSequence: 22, action: action()
  });

  assert.deepEqual(result, { queued: true, nextDisclosure: "SUSPECTED" });
  assert.equal(seenWhere.length, 1);
  assert.equal(seenWhere[0].stageId, "stage-2");
  assert.equal(seenWhere[0].aggregateKey, currentIdentity.aggregateKey);
  assert.equal(resolutionPatch.aEmotionM2CanonicalUpgrade.baseEventId, rows[1].eventId);
  assert.equal(resolutionPatch.aEmotionM2CanonicalUpgrade.stageId, "stage-2");
  assert.equal(tasks[0].resultJson.stageId, "stage-2");
  assert.equal(tasks[0].resultJson.aggregateKey, currentIdentity.aggregateKey);
});

test("M2 does not use prose matching and fails closed for wrong cards, roles, flags or non-human viewers", async () => {
  const governor = role("role-governor", "zhejiang_governor");
  const source = role("role-source", "xunfu");
  const county = role("role-county", "county_magistrate");
  let touched = false;
  const tx = {
    storyPlayer: { findFirst: async () => { touched = true; return null; } }
  } as any;
  const service = new AEmotionM2Service({} as any, contentStub(), {} as any);

  assert.deepEqual(await service.applyAuthoritativeUpgrade(tx, {
    run: run(), sourceRole: source, allRoles: [governor, source, county], resolutionId: "r", playerActionId: "a", stageIndex: 2, appliedWorldSequence: 1, action: action()
  }), { queued: false, nextDisclosure: null });
  assert.equal(touched, false, "wrong source role exits before any database write or viewer lookup");

  assert.deepEqual(await service.applyAuthoritativeUpgrade(tx, {
    run: run({ featureFlags: { aEmotionM1: true, aEmotionM2: false } }), sourceRole: governor, allRoles: [governor, source, county], resolutionId: "r", playerActionId: "a", stageIndex: 2, appliedWorldSequence: 1, action: action()
  }), { queued: false, nextDisclosure: null });

  const noHumanTx = { storyPlayer: { findFirst: async () => null } } as any;
  assert.deepEqual(await service.applyAuthoritativeUpgrade(noHumanTx, {
    run: run(), sourceRole: governor, allRoles: [governor, source, county], resolutionId: "r", playerActionId: "a", stageIndex: 2, appliedWorldSequence: 1,
    action: malformedUpgradeAction({
      ...action(),
      actionKey: "wrong-action",
      normalizedIntent: { ...action().normalizedIntent, method: "不管自由文本写得多像调查都不能触发" }
    })
  }), { queued: false, nextDisclosure: null });
});


test("worker publishes the current stage aggregate even when an older stage has a higher version", async () => {
  const governor = role("role-governor", "zhejiang_governor");
  const source = role("role-source", "xunfu");
  const county = role("role-county", "county_magistrate");
  const currentIdentity = aEmotionM2AggregateIdentity({ roomId: "run-m2", runId: "run-m2", viewerRoleId: governor.id, stageId: aEmotionM2StageId(2) });
  const oldIdentity = aEmotionM2AggregateIdentity({ roomId: "run-m2", runId: "run-m2", viewerRoleId: governor.id, stageId: aEmotionM2StageId(1) });
  const upgrade: AEmotionM2CanonicalUpgrade = {
    schemaVersion: "a_emotion_m2_canonical_upgrade_v1",
    resolutionId: "resolution-worker-current-stage",
    runId: "run-m2",
    viewerRoleId: governor.id,
    baseEventId: "evt_dddddddddddddddddddddddddddddddd",
    aggregateKey: currentIdentity.aggregateKey,
    aggregateId: currentIdentity.aggregateId,
    stageId: "stage-2",
    previousDisclosure: "HIDDEN",
    nextDisclosure: "SUSPECTED",
    projectionVersion: 2,
    stateVersion: 4,
    actionKey: A_EMOTION_M2_SUSPECT_ACTION_KEY,
    effectKey: A_EMOTION_M2_SUSPECT_EFFECT_KEY,
    factKey: A_EMOTION_M2_SUSPECT_FACT_KEY,
    createdAt: "2026-08-10T05:10:00.000Z"
  };
  const currentRow = {
    eventId: upgrade.baseEventId,
    aggregateKey: currentIdentity.aggregateKey,
    aggregateId: currentIdentity.aggregateId,
    stageId: "stage-2",
    sharedObjectId: "original-grain-ledger",
    eventFamily: "LEDGER_DELIVERY",
    disclosure: "HIDDEN",
    projectionVersion: 1,
    stateVersion: 3,
    payloadJson: { type: A_EMOTION_M1_EVENT_TYPE, eventSequence: 8, payload: hiddenProjection(8) },
    event: { id: upgrade.baseEventId, runId: "run-m2", type: A_EMOTION_M1_EVENT_TYPE, sequence: 8 }
  };
  const oldRow = {
    ...currentRow,
    eventId: "evt_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    aggregateKey: oldIdentity.aggregateKey,
    aggregateId: oldIdentity.aggregateId,
    stageId: "stage-1",
    disclosure: "SUSPECTED",
    projectionVersion: 9,
    stateVersion: 9,
    event: { id: "evt_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", runId: "run-m2", type: "A_EMOTION_M2_DISCLOSURE", sequence: 9 }
  };
  const aggregateQueries: any[] = [];
  const publications: any[] = [];
  const tx = {
    storyTaskOutbox: { findFirst: async () => ({
      id: "task-worker-current-stage", runId: "run-m2", nodeId: "node-m2", roleId: governor.id, inputRefId: upgrade.resolutionId,
      taskType: "INTERACTION_DISCLOSURE_COMPILE_REQUESTED", status: "RUNNING", leaseOwner: "worker",
      leaseVersion: 1, leaseExpiresAt: new Date(Date.now() + 60_000),
      resultJson: {
        schemaVersion: "interaction_disclosure_compile_requested_v1",
        resolutionId: upgrade.resolutionId,
        viewerRoleId: governor.id,
        stageId: "stage-2",
        aggregateKey: currentIdentity.aggregateKey,
        aggregateId: currentIdentity.aggregateId,
        projectionVersion: 2,
        stateVersion: 4
      }
    }) },
    storyRun: { findUnique: async () => ({
      ...run({
        featureFlags: { aEmotionM1: true, aEmotionM2: true },
        aEmotionM2: { schemaVersion: "a_emotion_m2_state_v1", stateVersion: 4, upgrades: { [upgrade.resolutionId]: upgrade } }
      }),
      currentDay: 2,
      roles: [governor, source, county],
      players: [{ userId: "user-governor", roleId: governor.id }]
    }) },
    actionResolution: { findUnique: async () => ({
      id: upgrade.resolutionId,
      runId: "run-m2",
      qualityStatus: "PASS",
      playerActionId: "action-worker-current-stage",
      statePatchJson: { aEmotionM2CanonicalUpgrade: upgrade },
      role: governor,
      playerAction: { id: "action-worker-current-stage", actionKey: A_EMOTION_M2_SUSPECT_ACTION_KEY },
      turn: { stageIndex: 2 }
    }) },
    sceneNode: { findUnique: async () => ({ runId: "run-m2" }) },
    eventDelivery: {
      findFirst: async ({ where }: any) => {
        aggregateQueries.push(where);
        const rows = [oldRow, currentRow];
        return rows.find((row) => row.stageId === where.stageId && row.aggregateKey === where.aggregateKey && row.aggregateId === where.aggregateId) || null;
      }
    },
    canonFact: { findUnique: async () => ({
      id: "fact-current-stage",
      status: "confirmed",
      sourceActionIdsJson: ["action-worker-current-stage"],
      knownByRoleIdsJson: [governor.id]
    }) }
  } as any;
  const prisma = { $transaction: async (callback: any) => callback(tx) } as any;
  const deliveries = {
    publishProjected: async (_tx: any, input: any) => {
      publications.push(input);
      const payload = input.deliveries[0].buildPayload(10);
      assert.equal(payload.stageId, "stage-2");
      assert.equal(payload.aggregateId, currentIdentity.aggregateId);
      return { id: "evt_ffffffffffffffffffffffffffffffff" };
    }
  } as any;
  const service = new AEmotionM2Service(prisma, contentStub(), deliveries);
  const result = await service.executeCompileTask("task-worker-current-stage", {
    taskId: "task-worker-current-stage",
    leaseOwner: "worker",
    leaseVersion: 1
  });

  assert.deepEqual(result, { outcome: "PUBLISHED", eventId: "evt_ffffffffffffffffffffffffffffffff", projectionVersion: 2 });
  assert.equal(aggregateQueries.length, 1);
  assert.equal(aggregateQueries[0].stageId, "stage-2");
  assert.equal(aggregateQueries[0].aggregateKey, currentIdentity.aggregateKey);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].deliveries[0].aggregate.stageId, "stage-2");
  assert.equal(publications[0].deliveries[0].aggregate.aggregateId, currentIdentity.aggregateId);
});

test("worker fails closed when task stage or aggregate identity does not match the authoritative resolution stage", async () => {
  const governor = role("role-governor", "zhejiang_governor");
  const source = role("role-source", "xunfu");
  const county = role("role-county", "county_magistrate");
  const currentIdentity = aEmotionM2AggregateIdentity({ roomId: "run-m2", runId: "run-m2", viewerRoleId: governor.id, stageId: aEmotionM2StageId(2) });
  const wrongIdentity = aEmotionM2AggregateIdentity({ roomId: "run-m2", runId: "run-m2", viewerRoleId: governor.id, stageId: aEmotionM2StageId(1) });
  const upgrade: AEmotionM2CanonicalUpgrade = {
    schemaVersion: "a_emotion_m2_canonical_upgrade_v1",
    resolutionId: "resolution-worker",
    runId: "run-m2",
    viewerRoleId: governor.id,
    baseEventId: "evt_cccccccccccccccccccccccccccccccc",
    aggregateKey: currentIdentity.aggregateKey,
    aggregateId: currentIdentity.aggregateId,
    stageId: "stage-2",
    previousDisclosure: "HIDDEN",
    nextDisclosure: "SUSPECTED",
    projectionVersion: 2,
    stateVersion: 4,
    actionKey: A_EMOTION_M2_SUSPECT_ACTION_KEY,
    effectKey: A_EMOTION_M2_SUSPECT_EFFECT_KEY,
    factKey: A_EMOTION_M2_SUSPECT_FACT_KEY,
    createdAt: "2026-08-10T05:10:00.000Z"
  };
  const tx = {
    storyTaskOutbox: { findFirst: async () => ({
      id: "task-worker", runId: "run-m2", nodeId: "node-m2", roleId: governor.id, inputRefId: upgrade.resolutionId,
      taskType: "INTERACTION_DISCLOSURE_COMPILE_REQUESTED", status: "RUNNING", leaseOwner: "worker",
      leaseVersion: 1, leaseExpiresAt: new Date(Date.now() + 60_000),
      resultJson: {
        schemaVersion: "interaction_disclosure_compile_requested_v1",
        resolutionId: upgrade.resolutionId,
        viewerRoleId: governor.id,
        stageId: "stage-1",
        aggregateKey: wrongIdentity.aggregateKey,
        aggregateId: wrongIdentity.aggregateId,
        projectionVersion: 2,
        stateVersion: 4
      }
    }) },
    storyRun: { findUnique: async () => ({
      ...run({
        featureFlags: { aEmotionM1: true, aEmotionM2: true },
        aEmotionM2: { schemaVersion: "a_emotion_m2_state_v1", stateVersion: 4, upgrades: { [upgrade.resolutionId]: upgrade } }
      }),
      currentDay: 2,
      roles: [governor, source, county],
      players: [{ userId: "user-governor", roleId: governor.id }]
    }) },
    actionResolution: { findUnique: async () => ({
      id: upgrade.resolutionId,
      runId: "run-m2",
      qualityStatus: "PASS",
      playerActionId: "action-worker",
      statePatchJson: { aEmotionM2CanonicalUpgrade: upgrade },
      role: governor,
      playerAction: { id: "action-worker", actionKey: A_EMOTION_M2_SUSPECT_ACTION_KEY },
      turn: { stageIndex: 2 }
    }) },
    sceneNode: { findUnique: async () => ({ runId: "run-m2" }) }
  } as any;
  const prisma = { $transaction: async (callback: any) => callback(tx) } as any;
  const service = new AEmotionM2Service(prisma, contentStub(), {} as any);
  await assert.rejects(
    () => service.executeCompileTask("task-worker", { taskId: "task-worker", leaseOwner: "worker", leaseVersion: 1 }),
    /A_EMOTION_M2_TASK_AGGREGATE_MISMATCH/
  );
});

test("viewer projection upgrades monotonically and preserves source safety until confirmed evidence", () => {
  const service = new AEmotionM2Service({} as any, contentStub(), {} as any);
  const previous = normalizePreviousProjection({
    eventId: "evt_0123456789abcdef0123456789abcdef",
    aggregateKey: "aemotion:m2:internal",
    aggregateId: "agg_0123456789abcdef0123456789abcdef",
    stageId: "stage-2",
    sharedObjectId: "original-grain-ledger",
    eventFamily: "LEDGER_DELIVERY",
    disclosure: "HIDDEN",
    projectionVersion: 1,
    stateVersion: 3,
    payloadJson: { type: A_EMOTION_M1_EVENT_TYPE, eventSequence: 8, payload: hiddenProjection(8) },
    event: { id: "evt_0123456789abcdef0123456789abcdef", runId: "run-m2", type: A_EMOTION_M1_EVENT_TYPE, sequence: 8 }
  });
  const baseUpgrade: AEmotionM2CanonicalUpgrade = {
    schemaVersion: "a_emotion_m2_canonical_upgrade_v1",
    resolutionId: "resolution-2",
    runId: "run-m2",
    viewerRoleId: "role-governor",
    baseEventId: "evt_0123456789abcdef0123456789abcdef",
    aggregateKey: "aemotion:m2:internal",
    aggregateId: previous.aggregateId,
    stageId: "stage-2",
    previousDisclosure: "HIDDEN",
    nextDisclosure: "SUSPECTED",
    projectionVersion: 2,
    stateVersion: 4,
    actionKey: A_EMOTION_M2_SUSPECT_ACTION_KEY,
    effectKey: A_EMOTION_M2_SUSPECT_EFFECT_KEY,
    factKey: A_EMOTION_M2_SUSPECT_FACT_KEY,
    createdAt: "2026-08-10T05:10:00.000Z"
  };
  const suspected = service.viewerProjection({ previous, upgrade: baseUpgrade, eventSequence: 9, sourceRoleId: "role-source", suspectRoleIds: ["role-source", "role-county"], evidenceFactId: "fact-suspect" });
  assert.equal(suspected.disclosure, "SUSPECTED");
  assert.equal(suspected.category, "SUSPICIOUS");
  assert.equal("visibleSourceRoleId" in suspected, false);
  assert.equal(suspected.responseOptions.some((option) => option.targetRoleKey), false);
  assert.deepEqual(aEmotionM2ForbiddenPaths(suspected), []);
  assert.deepEqual(aEmotionM2SemanticLeaks(suspected), []);

  const confirmed = service.viewerProjection({
    previous: suspected,
    upgrade: {
      ...baseUpgrade,
      resolutionId: "resolution-3",
      previousDisclosure: "SUSPECTED",
      nextDisclosure: "CONFIRMED",
      projectionVersion: 3,
      stateVersion: 5,
      actionKey: "main_s4_governor_seal_evidence",
      effectKey: "effect_main_s4_governor_seal_evidence",
      factKey: "fact_s4_governor_seal_evidence",
      createdAt: "2026-08-10T05:20:00.000Z"
    },
    eventSequence: 10,
    sourceRoleId: "role-source",
    suspectRoleIds: ["role-source", "role-county"],
    evidenceFactId: "fact-confirmed"
  });
  assert.equal(confirmed.schemaVersion, A_EMOTION_M2_PROJECTION_SCHEMA_VERSION);
  assert.equal(confirmed.disclosure, "CONFIRMED");
  assert.equal(confirmed.visibleSourceRoleId, "role-source");
  assert.deepEqual(confirmed.evidenceRefs, ["canon-fact:fact-confirmed"]);
  const validation = validateAEmotionM2ProjectionV1(confirmed);
  assert.equal(validation.ok, true, validation.ok ? "" : validation.errors.join("\n"));
});
