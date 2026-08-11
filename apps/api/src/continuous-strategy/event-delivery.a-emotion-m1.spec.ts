import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  A_EMOTION_M1_EVENT_TYPE,
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  CONTINUOUS_STORY_ENGINE_VERSION,
  isOpaqueAEmotionM1EventId,
  validateAEmotionM1ProjectionV1
} from "@ai-story/shared";
import { ContinuousEventDeliveryService } from "./event-delivery.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M1_TEST_DATABASE_URL);

test("real Prisma transaction persists separate canonical and viewer payloads with opaque idempotent event IDs", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M1_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl! } } });
  const ids = await seedDeliveryFixture(prisma);
  const service = new ContinuousEventDeliveryService(prisma as never);
  try {
    const publish = () => prisma.$transaction((tx) => service.publishProjected(tx, {
      runId: ids.runId,
      nodeId: ids.nodeId,
      day: 2,
      type: A_EMOTION_M1_EVENT_TYPE,
      messageType: "a_emotion_interaction",
      roleKey: "zhejiang_governor",
      visibility: "LIMITED",
      audienceType: "ROLE",
      audienceRoleIds: [ids.governorRoleId],
      canonicalPayload: {
        schemaVersion: "a_emotion_m1_canonical_impact_v1",
        resolutionId: ids.resolutionRef,
        sharedObjectKey: "original-grain-ledger",
        stateVersion: 1
      },
      deliveries: [{
        userId: ids.governorUserId,
        roleId: ids.governorRoleId,
        buildPayload: (eventSequence) => safeProjection(eventSequence)
      }],
      dedupeKey: `A_EMOTION_M1:${ids.resolutionRef}:${ids.governorRoleId}`,
      sourceActionId: ids.sourceActionId
    }));

    const first = await publish();
    const replay = await publish();
    assert.equal(first.id, replay.id);
    const beforeConflict = await publicationState(prisma, ids);
    await assert.rejects(
      () => prisma.$transaction((tx) => service.publishProjected(tx, {
        runId: ids.runId,
        nodeId: ids.nodeId,
        day: 2,
        type: A_EMOTION_M1_EVENT_TYPE,
        messageType: "a_emotion_interaction",
        roleKey: "zhejiang_governor",
        visibility: "LIMITED",
        audienceType: "ROLE",
        audienceRoleIds: [ids.governorRoleId],
        canonicalPayload: {
          schemaVersion: "a_emotion_m1_canonical_impact_v1",
          resolutionId: ids.resolutionRef,
          sharedObjectKey: "original-grain-ledger",
          stateVersion: 2
        },
        deliveries: [{
          userId: ids.governorUserId,
          roleId: ids.governorRoleId,
          buildPayload: (eventSequence) => ({ ...safeProjection(eventSequence), stateVersion: 2 })
        }],
        dedupeKey: `A_EMOTION_M1:${ids.resolutionRef}:${ids.governorRoleId}`,
        sourceActionId: ids.sourceActionId
      })),
      (error: unknown) => {
        assert.ok(error && typeof error === "object", "idempotency conflict must be a structured Nest exception");
        const getResponse = (error as { getResponse?: unknown }).getResponse;
        assert.equal(typeof getResponse, "function", "idempotency conflict must expose getResponse()");
        const response = (getResponse as () => unknown).call(error);
        assert.ok(response && typeof response === "object" && !Array.isArray(response));
        const body = response as Record<string, unknown>;
        assert.equal(body.code, "A_EMOTION_M1_IDEMPOTENCY_CONFLICT");
        assert.equal(body.message, "Interaction event idempotency state is inconsistent");
        assert.doesNotMatch(String(body.message), /A_EMOTION_M1_IDEMPOTENCY_CONFLICT/);
        return true;
      }
    );
    const afterConflict = await publicationState(prisma, ids);
    assert.deepEqual(afterConflict, beforeConflict, "a conflicting replay must not advance events, deliveries, cursors, or authoritative run state");
    assert.equal(isOpaqueAEmotionM1EventId(first.id), true);
    assert.doesNotMatch(first.id, /action|role|xunfu|governor|:/iu);

    const events = await prisma.storyEvent.findMany({ where: { runId: ids.runId, type: A_EMOTION_M1_EVENT_TYPE } });
    const deliveries = await prisma.eventDelivery.findMany({ where: { roomId: ids.runId }, include: { event: true } });
    assert.equal(events.length, 1);
    assert.equal(deliveries.length, 1, "county magistrate receives no delivery row");
    assert.equal(deliveries[0].userId, ids.governorUserId);
    assert.equal(deliveries[0].roleId, ids.governorRoleId);
    assert.notDeepEqual(events[0].payloadJson, deliveries[0].payloadJson, "canonical and viewer payloads are distinct");
    assert.equal(events[0].sourceActionId, ids.sourceActionId, "internal canonical relation retains causality");

    const serializedDelivery = JSON.stringify(deliveries[0].payloadJson);
    assert.doesNotMatch(serializedDelivery, new RegExp([
      ids.sourceActionId,
      ids.sourceRoleId,
      ids.governorRoleId,
      "xunfu",
      "巡抚",
      "dedupeKey"
    ].map(escapeRegex).join("|"), "iu"));
    const envelope = deliveries[0].payloadJson as { payload?: unknown };
    const validation = validateAEmotionM1ProjectionV1(envelope.payload);
    assert.equal(validation.ok, true, validation.ok ? "" : validation.errors.join("\n"));
  } finally {
    await cleanupFixture(prisma, ids);
    await prisma.$disconnect();
  }
});

function safeProjection(eventSequence: number) {
  return {
    schemaVersion: A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
    projectionVersion: 1,
    stateVersion: 1,
    eventSequence,
    category: "RELATED",
    disclosure: "HIDDEN",
    severity: "MAJOR",
    centerCardType: "CROSS_IMPACT",
    title: "他人的行动改变了你的处境",
    summary: "原始粮册的递送出现异常，部分底稿已经离开常规核验链。",
    sourceStatus: "来源未知",
    knownFacts: ["送达材料的编号与此前登记不一致", "多个经手渠道都曾接触相关材料"],
    visibleImpacts: [{
      key: "imperial_trust",
      label: "皇帝信任",
      before: 52,
      after: 46,
      delta: -6,
      suffix: "",
      safeReason: "账册可信度受到质疑"
    }],
    responseOptions: [
      { code: "INVESTIGATE_LEDGER_ANOMALY", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_ledger_delivery", prefillText: "核对原始粮册的递送、编号和经手记录。" },
      { code: "QUESTION_DELIVERY_PUBLICLY", label: "公开质问", preferredEntry: "TALK", intentKey: "question_ledger_delivery", prefillText: "请相关经手方公开说明原始粮册为何未按登记送达。" },
      { code: "DEFER_RESPONSE", label: "暂不回应", preferredEntry: "DEFER", intentKey: null, prefillText: null }
    ],
    occurredAt: "2026-08-09T16:00:00.000Z"
  };
}

async function seedDeliveryFixture(prisma: PrismaClient) {
  const suffix = randomUUID().replaceAll("-", "");
  const templateId = `m1-template-${suffix}`;
  const runId = `m1-run-${suffix}`;
  const nodeId = `m1-node-${suffix}`;
  const governorUserId = `m1-user-governor-${suffix}`;
  const countyUserId = `m1-user-county-${suffix}`;
  const governorRoleId = `m1-role-governor-${suffix}`;
  const sourceRoleId = `m1-role-source-${suffix}`;
  const countyRoleId = `m1-role-county-${suffix}`;
  const sourceActionId = `m1-action-${suffix}`;
  const resolutionRef = `m1-resolution-${suffix}`;

  await prisma.worldTemplate.create({
    data: { id: templateId, name: "M1 Test", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} }
  });
  await prisma.user.createMany({
    data: [
      { id: governorUserId, openid: `openid-${governorUserId}` },
      { id: countyUserId, openid: `openid-${countyUserId}` }
    ]
  });
  await prisma.storyRun.create({
    data: {
      id: runId,
      templateId,
      ownerUserId: governorUserId,
      title: "M1 Integration",
      hook: "M1",
      mode: "room",
      templateKey: "sangtian",
      status: "playing",
      currentDay: 2,
      totalDays: 7,
      maxPlayers: 3,
      activeHumanCount: 2,
      stateJson: { featureFlags: { aEmotionM1: true } },
      visibility: "private",
      inviteCode: `M1${suffix.slice(0, 8)}`,
      engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
      strategyVersion: "sangtian_v1_2",
      worldSequence: 17,
      reservedWorldSequence: 17
    }
  });
  await prisma.sceneNode.create({
    data: { id: nodeId, runId, chapterIndex: 1, nodeIndex: 2, title: "M1", publicNarration: "M1", nodeGoal: "M1", actionOptionsJson: [] }
  });
  await prisma.storyRun.update({ where: { id: runId }, data: { currentNodeId: nodeId } });
  await prisma.storyRole.createMany({
    data: [
      roleData(runId, governorRoleId, "zhejiang_governor", "浙江总督"),
      roleData(runId, sourceRoleId, "xunfu", "浙江巡抚"),
      roleData(runId, countyRoleId, "county_magistrate", "县令")
    ]
  });
  await prisma.storyPlayer.createMany({
    data: [
      { runId, userId: governorUserId, roleId: governorRoleId, playerType: "human", status: "active" },
      { runId, userId: countyUserId, roleId: countyRoleId, playerType: "human", status: "active" }
    ]
  });
  await prisma.playerAction.create({
    data: {
      id: sourceActionId,
      runId,
      nodeId,
      chapterIndex: 1,
      roleId: sourceRoleId,
      playerType: "human",
      actionType: "main",
      method: "structured test action",
      intent: "structured test action",
      riskLevel: "high",
      status: "resolved",
      actionSlot: "MAIN",
      actionKey: "main_s2_xunfu_seize_drafts",
      visibility: "LIMITED",
      targetRoleId: governorRoleId,
      immediateJson: {},
      resolvedJson: {}
    }
  });
  return { templateId, runId, nodeId, governorUserId, countyUserId, governorRoleId, sourceRoleId, countyRoleId, sourceActionId, resolutionRef };
}

function roleData(runId: string, id: string, roleKey: string, roleName: string) {
  return {
    id,
    runId,
    roleKey,
    roleName,
    identity: roleName,
    publicInfo: "test",
    personalGoal: "test",
    currentState: "test",
    knownInfoJson: [],
    cannotDoJson: [],
    isAiControlled: false,
    status: "active"
  };
}

async function cleanupFixture(prisma: PrismaClient, ids: Awaited<ReturnType<typeof seedDeliveryFixture>>) {
  await prisma.storyRun.deleteMany({ where: { id: ids.runId } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.governorUserId, ids.countyUserId] } } });
  await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } });
}

async function publicationState(prisma: PrismaClient, ids: Awaited<ReturnType<typeof seedDeliveryFixture>>) {
  const [run, eventCount, deliveryCount, eventCursor, deliveryCursor] = await Promise.all([
    prisma.storyRun.findUniqueOrThrow({
      where: { id: ids.runId },
      select: {
        worldSequence: true,
        reservedWorldSequence: true,
        version: true,
        stateJson: true,
        updatedAt: true
      }
    }),
    prisma.storyEvent.count({ where: { runId: ids.runId, type: A_EMOTION_M1_EVENT_TYPE } }),
    prisma.eventDelivery.count({ where: { roomId: ids.runId } }),
    prisma.storyEventCursor.findUnique({
      where: { runId: ids.runId },
      select: { nextSequence: true, version: true }
    }),
    prisma.eventDeliveryCursor.findUnique({
      where: { roomId_userId: { roomId: ids.runId, userId: ids.governorUserId } },
      select: { nextSequence: true, version: true }
    })
  ]);
  return { run, eventCount, deliveryCount, eventCursor, deliveryCursor };
}

function safeTestDatabaseUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase();
    return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null;
  } catch {
    return null;
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
