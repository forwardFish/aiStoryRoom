import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  A_EMOTION_M1_EVENT_TYPE,
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  CONTINUOUS_STORY_ENGINE_VERSION,
  isOpaqueAEmotionM1EventId
} from "@ai-story/shared";
import { configureApiTransport, PresenceHeartbeatRateLimitGuard } from "../api-transport";
import { AuthGuard } from "../auth/auth.guard";
import { issueAccessToken } from "../auth/auth.service";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { RoomsController } from "../rooms.controller";
import { RoomsService } from "../rooms.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M1_TEST_DATABASE_URL);

@Module({
  controllers: [RoomsController],
  providers: [
    PrismaService,
    ContinuousEventDeliveryService,
    PresenceHeartbeatRateLimitGuard,
    AuthGuard,
    {
      provide: RoomsService,
      inject: [PrismaService, ContinuousEventDeliveryService],
      useFactory: (prisma: PrismaService, continuousEvents: ContinuousEventDeliveryService) => new RoomsService(
        prisma,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        continuousEvents,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never
      )
    }
  ]
})
class M1ProductionEventsTestModule {}

test("real publish → PostgreSQL delivery → production RoomsController GET /events is viewer-safe and role-scoped", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M1_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  process.env.DATABASE_URL = isolatedDatabaseUrl!;
  const suffix = randomUUID().replaceAll("-", "");
  const templateId = `m1-template-${suffix}`;
  const runId = `m1-run-${suffix}`;
  const otherRunId = `m1-other-run-${suffix}`;
  const nodeId = `m1-node-${suffix}`;
  const governorUserId = `m1-user-governor-${suffix}`;
  const countyUserId = `m1-user-county-${suffix}`;
  const outsiderUserId = `m1-user-outsider-${suffix}`;
  const governorRoleId = `m1-role-governor-${suffix}`;
  const sourceRoleId = `m1-role-source-${suffix}`;
  const countyRoleId = `m1-role-county-${suffix}`;
  const sourceActionId = `m1-action-source-${suffix}`;

  let app: Awaited<ReturnType<typeof NestFactory.create>> | null = null;
  let cleanupPrisma: PrismaService | null = null;
  try {
    app = await NestFactory.create(M1ProductionEventsTestModule, { logger: false });
    configureApiTransport(app);
    app.setGlobalPrefix("api");
    const prisma = app.get(PrismaService);
    cleanupPrisma = prisma;
    await prisma.$connect();
    await app.listen(0, "127.0.0.1");

    await prisma.worldTemplate.create({
      data: { id: templateId, name: "M1 Test", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} }
    });
    await prisma.user.createMany({
      data: [
        verifiedUserData(governorUserId),
        verifiedUserData(countyUserId),
        verifiedUserData(outsiderUserId)
      ]
    });
    await prisma.storyRun.createMany({
      data: [
        runData({ id: runId, templateId, ownerUserId: governorUserId, inviteCode: `M1${suffix.slice(0, 8)}` }),
        runData({ id: otherRunId, templateId, ownerUserId: governorUserId, inviteCode: `M1O${suffix.slice(0, 7)}` })
      ]
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
        method: "structured M1 fixture",
        intent: "structured M1 fixture",
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

    const deliveryService = app.get(ContinuousEventDeliveryService);
    const canonical = {
      schemaVersion: "a_emotion_m1_canonical_impact_v1",
      resolutionId: `resolution-${suffix}`,
      sharedObjectKey: "original-grain-ledger",
      stateVersion: 1
    };
    const event = await prisma.$transaction((tx) => deliveryService.publishProjected(tx, {
      runId,
      nodeId,
      day: 2,
      type: A_EMOTION_M1_EVENT_TYPE,
      messageType: "system",
      roleKey: "zhejiang_governor",
      visibility: "LIMITED",
      audienceType: "ROLE",
      audienceRoleIds: [governorRoleId],
      canonicalPayload: canonical,
      deliveries: [{ userId: governorUserId, roleId: governorRoleId, buildPayload: (eventSequence) => safeProjection(eventSequence) }],
      dedupeKey: `A_EMOTION_M1:${suffix}:${governorRoleId}`,
      sourceActionId
    }));

    const durableEvent = await prisma.storyEvent.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal((durableEvent.payloadJson as any).sourceRoleId, undefined, "history-safe StoryEvent payload omits the hidden source");
    assert.equal(durableEvent.sourceActionId, sourceActionId, "canonical causality remains an internal relation");
    const durableDeliveries = await prisma.eventDelivery.findMany({ where: { roomId: runId } });
    assert.equal(durableDeliveries.length, 1, "the unrelated county user has no delivery row");
    assertViewerSafeBody(JSON.stringify(durableDeliveries[0].payloadJson), [sourceRoleId, governorRoleId, sourceActionId]);

    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const eventsUrl = (room: string) => `${base}/api/v4/rooms/${encodeURIComponent(room)}/events?afterDeliverySequence=0`;

    const governorResponse = await fetch(eventsUrl(runId), { headers: authHeaders(governorUserId) });
    assert.equal(governorResponse.status, 200);
    const governorText = await governorResponse.text();
    assertViewerSafeBody(governorText, [sourceRoleId, governorRoleId, sourceActionId]);
    const governorJson = JSON.parse(governorText);
    assert.equal(governorJson.deliveries.length, 1);
    assert.equal(governorJson.deliveries[0].eventType, A_EMOTION_M1_EVENT_TYPE);
    assert.equal(governorJson.deliveries[0].eventId, event.id);
    assert.equal(isOpaqueAEmotionM1EventId(governorJson.deliveries[0].eventId), true);
    assert.equal(governorJson.deliveries[0].payload.eventSequence, durableEvent.sequence);
    assert.equal(governorJson.deliveries[0].payload.stateVersion, canonical.stateVersion);
    assert.equal(governorJson.nextAfterDeliverySequence, durableDeliveries[0].deliverySequence);

    const countyResponse = await fetch(eventsUrl(runId), { headers: authHeaders(countyUserId) });
    assert.equal(countyResponse.status, 200);
    const countyText = await countyResponse.text();
    assertViewerSafeBody(countyText, [sourceRoleId, governorRoleId, sourceActionId]);
    assert.deepEqual(JSON.parse(countyText).deliveries, []);

    const outsiderResponse = await fetch(eventsUrl(runId), { headers: authHeaders(outsiderUserId) });
    assert.equal(outsiderResponse.status, 403);
    assertViewerSafeBody(await outsiderResponse.text(), [sourceRoleId, governorRoleId, sourceActionId]);

    const otherRoomResponse = await fetch(eventsUrl(`not-${runId}`), { headers: authHeaders(governorUserId) });
    assert.equal(otherRoomResponse.status, 404);
    assertViewerSafeBody(await otherRoomResponse.text(), [sourceRoleId, governorRoleId, sourceActionId]);

    await prisma.eventDelivery.update({ where: { id: durableDeliveries[0].id }, data: { roleId: countyRoleId } });
    const roleMismatchResponse = await fetch(eventsUrl(runId), { headers: authHeaders(governorUserId) });
    assert.equal(roleMismatchResponse.status, 403);
    assertViewerSafeBody(await roleMismatchResponse.text(), [sourceRoleId, governorRoleId, sourceActionId]);
    await prisma.eventDelivery.update({ where: { id: durableDeliveries[0].id }, data: { roleId: governorRoleId } });

    await prisma.storyEvent.update({ where: { id: event.id }, data: { runId: otherRunId } });
    const runMismatchResponse = await fetch(eventsUrl(runId), { headers: authHeaders(governorUserId) });
    assert.equal(runMismatchResponse.status, 403);
    assertViewerSafeBody(await runMismatchResponse.text(), [sourceRoleId, governorRoleId, sourceActionId]);
    await prisma.storyEvent.update({ where: { id: event.id }, data: { runId } });

    const storedEnvelope = durableDeliveries[0].payloadJson as Record<string, any>;
    await prisma.eventDelivery.update({
      where: { id: durableDeliveries[0].id },
      data: {
        payloadJson: {
          ...storedEnvelope,
          payload: { ...(storedEnvelope.payload || {}), projectionVersion: 2 }
        }
      }
    });
    const projectionMismatchResponse = await fetch(eventsUrl(runId), { headers: authHeaders(governorUserId) });
    assert.equal(projectionMismatchResponse.status, 503);
    assertViewerSafeBody(await projectionMismatchResponse.text(), [sourceRoleId, governorRoleId, sourceActionId]);

    await prisma.eventDelivery.update({
      where: { id: durableDeliveries[0].id },
      data: {
        payloadJson: {
          ...storedEnvelope,
          eventSequence: Number(storedEnvelope.eventSequence) + 1,
          payload: { ...(storedEnvelope.payload || {}), eventSequence: Number(storedEnvelope.eventSequence) + 1 }
        }
      }
    });
    const sequenceMismatchResponse = await fetch(eventsUrl(runId), { headers: authHeaders(governorUserId) });
    assert.equal(sequenceMismatchResponse.status, 503);
    assertViewerSafeBody(await sequenceMismatchResponse.text(), [sourceRoleId, governorRoleId, sourceActionId]);

    await prisma.eventDelivery.update({
      where: { id: durableDeliveries[0].id },
      data: {
        payloadJson: {
          ...storedEnvelope,
          payload: { ...(storedEnvelope.payload || {}), stateVersion: 2 }
        }
      }
    });
    const stateMismatchResponse = await fetch(eventsUrl(runId), { headers: authHeaders(governorUserId) });
    assert.equal(stateMismatchResponse.status, 503);
    assertViewerSafeBody(await stateMismatchResponse.text(), [sourceRoleId, governorRoleId, sourceActionId]);
  } finally {
    const cleanup = cleanupPrisma;
    try {
      if (cleanup) {
        await cleanup.storyRun.deleteMany({ where: { id: { in: [runId, otherRunId] } } });
        await cleanup.user.deleteMany({ where: { id: { in: [governorUserId, countyUserId, outsiderUserId] } } });
        await cleanup.worldTemplate.deleteMany({ where: { id: templateId } });
      }
    } finally {
      if (app) await app.close();
      else if (cleanup) await cleanup.$disconnect();
    }
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
    visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 52, after: 46, delta: -6, suffix: "", safeReason: "账册可信度受到质疑" }],
    responseOptions: [
      { code: "INVESTIGATE_LEDGER_ANOMALY", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_ledger_delivery", prefillText: "核对原始粮册的递送、编号和经手记录。" },
      { code: "QUESTION_DELIVERY_PUBLICLY", label: "公开质问", preferredEntry: "TALK", intentKey: "question_ledger_delivery", prefillText: "请相关经手方公开说明原始粮册为何未按登记送达。" },
      { code: "DEFER_RESPONSE", label: "暂不回应", preferredEntry: "DEFER", intentKey: null, prefillText: null }
    ],
    occurredAt: "2026-08-09T16:00:00.000Z"
  };
}

function runData(input: { id: string; templateId: string; ownerUserId: string; inviteCode: string }) {
  return {
    id: input.id,
    templateId: input.templateId,
    ownerUserId: input.ownerUserId,
    title: "M1 Integration",
    hook: "M1",
    mode: "room",
    templateKey: "sangtian",
    status: "playing",
    currentDay: 2,
    totalDays: 7,
    maxPlayers: 3,
    activeHumanCount: 2,
    aiPlayerCount: 0,
    stateJson: { featureFlags: { aEmotionM1: true } },
    visibility: "private",
    inviteCode: input.inviteCode,
    engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
    strategyVersion: "sangtian_v1_2",
    worldSequence: 17,
    reservedWorldSequence: 17
  };
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

function verifiedUserData(userId: string) {
  return {
    id: userId,
    openid: `openid-${userId}`,
    email: `${userId}@example.test`,
    emailVerifiedAt: new Date("2026-08-09T00:00:00.000Z"),
    status: "active"
  };
}

function authHeaders(userId: string) {
  const token = issueAccessToken({ id: userId, openid: `openid-${userId}` });
  return { authorization: `Bearer ${token}`, accept: "application/json" };
}

function assertViewerSafeBody(body: string, secretValues: string[]) {
  const forbidden = [
    "sourceRoleId",
    "sourceRoleKey",
    "sourceActionId",
    "targetRoleId",
    "targetRoleKey",
    "rawAudience",
    "audienceRoleIds",
    "audienceUserIds",
    "internalDedupeKey",
    "dedupeKey",
    "xunfu",
    "巡抚",
    ...secretValues
  ].filter(Boolean);
  assert.doesNotMatch(body, new RegExp(forbidden.map(escapeRegex).join("|"), "iu"));
}

function safeTestDatabaseUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const databaseName = parsed.pathname.replace(/^\//, "");
    const marker = `${parsed.hostname}/${databaseName}?${parsed.searchParams.toString()}`.toLowerCase();
    return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null;
  } catch {
    return null;
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
