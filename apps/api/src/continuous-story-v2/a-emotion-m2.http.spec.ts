import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  A_EMOTION_M1_EVENT_TYPE,
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_EVENT_FAMILY,
  A_EMOTION_M2_EVENT_TYPE,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_SHARED_OBJECT_ID,
  CONTINUOUS_STORY_ENGINE_VERSION,
  isOpaqueAEmotionM2EventId
} from "@ai-story/shared";
import { configureApiTransport, PresenceHeartbeatRateLimitGuard } from "../api-transport";
import { AuthGuard } from "../auth/auth.guard";
import { issueAccessToken } from "../auth/auth.service";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { RoomsController } from "../rooms.controller";
import { RoomsService } from "../rooms.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M2_TEST_DATABASE_URL);
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
class M2ProductionEventsTestModule {}

test("real publish → PostgreSQL → production RoomsController M2 feed/detail/receipts is viewer-scoped", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M2_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  process.env.DATABASE_URL = isolatedDatabaseUrl!;
  const suffix = randomUUID().replaceAll("-", "");
  const ids = identifiers(suffix);
  let app: Awaited<ReturnType<typeof NestFactory.create>> | null = null;
  let cleanupPrisma: PrismaService | null = null;
  try {
    app = await NestFactory.create(M2ProductionEventsTestModule, { logger: false });
    configureApiTransport(app);
    app.setGlobalPrefix("api");
    const prisma = app.get(PrismaService);
    cleanupPrisma = prisma;
    await prisma.$connect();
    await app.listen(0, "127.0.0.1");
    await seed(prisma, ids);

    const deliveryService = app.get(ContinuousEventDeliveryService);
    const cursorSeedAggregate = {
      ...aggregateMetadata(ids, 1, "HIDDEN", "RELATED"),
      aggregateId: `agg_${"c".repeat(32)}`,
      aggregateKey: `aemotion:m2:${ids.runId}:${ids.governorRoleId}:cursor-seed`,
      stageId: "stage-1"
    } as const;
    const cursorSeed = await prisma.$transaction((tx) => deliveryService.publishProjected(tx, {
      runId: ids.runId,
      nodeId: ids.nodeId,
      day: 1,
      type: A_EMOTION_M1_EVENT_TYPE,
      messageType: "system",
      roleKey: "zhejiang_governor",
      visibility: "LIMITED",
      audienceType: "ROLE",
      audienceRoleIds: [ids.governorRoleId],
      canonicalPayload: { schemaVersion: "a_emotion_m1_canonical_impact_v1", resolutionId: `${ids.baseResolutionId}-cursor`, sharedObjectKey: A_EMOTION_M2_SHARED_OBJECT_ID, stateVersion: 1 },
      deliveries: [{ userId: ids.governorUserId, roleId: ids.governorRoleId, aggregate: cursorSeedAggregate, buildPayload: (eventSequence) => hiddenProjection(eventSequence) }],
      dedupeKey: `A_EMOTION_M1:${ids.baseResolutionId}:cursor:${ids.governorRoleId}`,
      sourceActionId: ids.sourceActionId
    }));
    await prisma.eventDelivery.updateMany({ where: { eventId: cursorSeed.id, userId: ids.governorUserId }, data: { resolvedAt: new Date("2026-08-10T05:00:30.000Z") } });

    const aggregate = aggregateMetadata(ids, 1, "HIDDEN", "RELATED");
    const hidden = await prisma.$transaction((tx) => deliveryService.publishProjected(tx, {
      runId: ids.runId,
      nodeId: ids.nodeId,
      day: 2,
      type: A_EMOTION_M1_EVENT_TYPE,
      messageType: "system",
      roleKey: "zhejiang_governor",
      visibility: "LIMITED",
      audienceType: "ROLE",
      audienceRoleIds: [ids.governorRoleId],
      canonicalPayload: { schemaVersion: "a_emotion_m1_canonical_impact_v1", resolutionId: ids.baseResolutionId, sharedObjectKey: A_EMOTION_M2_SHARED_OBJECT_ID, stateVersion: 1 },
      deliveries: [{ userId: ids.governorUserId, roleId: ids.governorRoleId, aggregate, buildPayload: (eventSequence) => hiddenProjection(eventSequence) }],
      dedupeKey: `A_EMOTION_M1:${ids.baseResolutionId}:${ids.governorRoleId}`,
      sourceActionId: ids.sourceActionId
    }));
    const suspected = await prisma.$transaction((tx) => deliveryService.publishProjected(tx, {
      runId: ids.runId,
      nodeId: ids.nodeId,
      day: 2,
      type: A_EMOTION_M2_EVENT_TYPE,
      messageType: "system",
      roleKey: "zhejiang_governor",
      visibility: "LIMITED",
      audienceType: "ROLE",
      audienceRoleIds: [ids.governorRoleId],
      canonicalPayload: {
        schemaVersion: "a_emotion_m2_canonical_upgrade_v1",
        resolutionId: ids.upgradeResolutionId,
        baseEventId: hidden.id,
        sourceRoleId: ids.sourceRoleId,
        aggregateKey: aggregate.aggregateKey,
        projectionVersion: 2,
        stateVersion: 2,
        nextDisclosure: "SUSPECTED",
        evidenceFactId: ids.evidenceFactId
      },
      deliveries: [{ userId: ids.governorUserId, roleId: ids.governorRoleId, aggregate: aggregateMetadata(ids, 2, "SUSPECTED", "SUSPICIOUS"), buildPayload: (eventSequence) => suspectedProjection(ids, eventSequence) }],
      dedupeKey: `A_EMOTION_M2:${ids.upgradeResolutionId}:${ids.governorRoleId}:2`,
      sourceActionId: ids.investigationActionId
    }));

    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}/api/v4/rooms`;
    const eventsUrl = (roomId: string, extra = "") => `${base}/${encodeURIComponent(roomId)}/events?afterDeliverySequence=0&interactionLimit=10${extra}`;

    const governorResponse = await fetch(eventsUrl(ids.runId), { headers: authHeaders(ids.governorUserId) });
    assert.equal(governorResponse.status, 200);
    const governorText = await governorResponse.text();
    assertNetworkSafe(governorText, ids);
    const governorJson = JSON.parse(governorText);
    assert.equal(governorJson.deliveries.length, 3);
    assert.equal(governorJson.interactionFeed.items.length, 2);
    assert.equal(governorJson.interactionFeed.items[0].eventId, suspected.id);
    assert.equal(governorJson.interactionFeed.items[0].projectionVersion, 2);
    assert.equal(governorJson.interactionFeed.items[0].disclosure, "SUSPECTED");
    assert.equal(isOpaqueAEmotionM2EventId(governorJson.interactionFeed.items[0].eventId), true);

    const cursorPageResponse = await fetch(`${base}/${encodeURIComponent(ids.runId)}/events?afterDeliverySequence=0&interactionLimit=1`, { headers: authHeaders(ids.governorUserId) });
    assert.equal(cursorPageResponse.status, 200);
    const cursorPage = await cursorPageResponse.json();
    assert.ok(cursorPage.interactionFeed?.nextCursor);
    assert.equal(cursorPage.interactionFeed.items[0].eventId, suspected.id);
    const suspectedDelivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId: suspected.id, userId: ids.governorUserId } });
    await prisma.eventDelivery.update({ where: { id: suspectedDelivery.id }, data: { projectionVersion: 3 } });
    const staleCursorResponse = await fetch(`${base}/${encodeURIComponent(ids.runId)}/events?afterDeliverySequence=0&interactionLimit=1&interactionCursor=${encodeURIComponent(cursorPage.interactionFeed.nextCursor)}`, { headers: authHeaders(ids.governorUserId) });
    assert.equal(staleCursorResponse.status, 409);
    const staleCursorBody = await staleCursorResponse.json();
    assert.equal(staleCursorBody.code, "STALE_OR_SCOPED_INTERACTION_CURSOR");
    assertNetworkSafe(JSON.stringify(staleCursorBody), ids);
    await prisma.eventDelivery.update({ where: { id: suspectedDelivery.id }, data: { projectionVersion: 2 } });

    const countyResponse = await fetch(eventsUrl(ids.runId), { headers: authHeaders(ids.countyUserId) });
    assert.equal(countyResponse.status, 200);
    const countyJson = await countyResponse.json();
    assert.deepEqual(countyJson.deliveries, []);
    assert.equal(countyJson.interactionFeed, undefined);

    const outsiderResponse = await fetch(eventsUrl(ids.runId), { headers: authHeaders(ids.outsiderUserId) });
    assert.equal(outsiderResponse.status, 403);
    assertNetworkSafe(await outsiderResponse.text(), ids);
    const missingResponse = await fetch(eventsUrl(`missing-${ids.runId}`), { headers: authHeaders(ids.governorUserId) });
    assert.equal(missingResponse.status, 404);
    const invalidLimit = await fetch(`${base}/${encodeURIComponent(ids.runId)}/events?afterDeliverySequence=0&interactionLimit=11`, { headers: authHeaders(ids.governorUserId) });
    assert.equal(invalidLimit.status, 400);
    const malformedLimit = await fetch(`${base}/${encodeURIComponent(ids.runId)}/events?afterDeliverySequence=0&interactionLimit=not-a-number`, { headers: authHeaders(ids.governorUserId) });
    assert.equal(malformedLimit.status, 400);

    const detailUrl = `${base}/${encodeURIComponent(ids.runId)}/events/${encodeURIComponent(suspected.id)}?projectionVersion=2`;
    const detailResponse = await fetch(detailUrl, { headers: authHeaders(ids.governorUserId) });
    assert.equal(detailResponse.status, 200);
    const detailText = await detailResponse.text();
    assertNetworkSafe(detailText, ids);
    assert.equal(JSON.parse(detailText).eventId, suspected.id);
    const countyDetail = await fetch(detailUrl, { headers: authHeaders(ids.countyUserId) });
    assert.equal(countyDetail.status, 404);
    const staleDetail = await fetch(`${base}/${encodeURIComponent(ids.runId)}/events/${encodeURIComponent(hidden.id)}?projectionVersion=1`, { headers: authHeaders(ids.governorUserId) });
    assert.equal(staleDetail.status, 409);

    const crossRunDetailUrl = `${base}/${encodeURIComponent(ids.otherRunId)}/events/${encodeURIComponent(suspected.id)}?projectionVersion=2`;
    const crossRunDetail = await fetch(crossRunDetailUrl, { headers: authHeaders(ids.governorUserId) });
    assert.equal(crossRunDetail.status, 404, "a valid event from another run must not be discoverable");
    assertNetworkSafe(await crossRunDetail.text(), ids);
    for (const endpoint of ["seen", "ack", "resolved"]) {
      const crossRunReceipt = await fetch(`${base}/${encodeURIComponent(ids.otherRunId)}/events/${encodeURIComponent(suspected.id)}/${endpoint}`, {
        method: "POST",
        headers: { ...authHeaders(ids.governorUserId), "content-type": "application/json" },
        body: JSON.stringify({ projectionVersion: 2 })
      });
      assert.equal(crossRunReceipt.status, 404, `${endpoint} must reject an event from another run`);
      assertNetworkSafe(await crossRunReceipt.text(), ids);
    }

    const receiptByEndpoint = new Map<string, Record<string, unknown>>();
    for (const endpoint of ["seen", "ack", "resolved"]) {
      const receiptUrl = `${base}/${encodeURIComponent(ids.runId)}/events/${encodeURIComponent(suspected.id)}/${endpoint}`;
      const firstReceiptResponse = await fetch(receiptUrl, {
        method: "POST",
        headers: { ...authHeaders(ids.governorUserId), "content-type": "application/json" },
        body: JSON.stringify({ projectionVersion: 2 })
      });
      assert.equal(firstReceiptResponse.status, 201);
      const firstReceiptText = await firstReceiptResponse.text();
      assertNetworkSafe(firstReceiptText, ids);
      const firstReceipt = JSON.parse(firstReceiptText) as Record<string, unknown>;

      const repeatedReceiptResponse = await fetch(receiptUrl, {
        method: "POST",
        headers: { ...authHeaders(ids.governorUserId), "content-type": "application/json" },
        body: JSON.stringify({ projectionVersion: 2 })
      });
      assert.equal(repeatedReceiptResponse.status, 201);
      const repeatedReceiptText = await repeatedReceiptResponse.text();
      assertNetworkSafe(repeatedReceiptText, ids);
      const repeatedReceipt = JSON.parse(repeatedReceiptText) as Record<string, unknown>;
      assert.deepEqual(repeatedReceipt, firstReceipt, `${endpoint} must be independently idempotent and preserve timestamps`);
      receiptByEndpoint.set(endpoint, firstReceipt);
    }
    assert.equal(receiptByEndpoint.get("seen")?.acknowledgedAt, null);
    assert.equal(receiptByEndpoint.get("seen")?.resolvedAt, null);
    assert.ok(receiptByEndpoint.get("ack")?.acknowledgedAt);
    assert.equal(receiptByEndpoint.get("ack")?.resolvedAt, null);
    assert.ok(receiptByEndpoint.get("resolved")?.resolvedAt);
    const receiptPage = await fetch(eventsUrl(ids.runId), { headers: authHeaders(ids.governorUserId) }).then((response) => response.json());
    assert.equal(receiptPage.interactionFeed.items[0].isUnread, false);
    assert.equal(receiptPage.interactionFeed.items[0].isAcknowledged, true);
    assert.equal(receiptPage.interactionFeed.items[0].isResolved, true);

    const latestDelivery = await prisma.eventDelivery.findFirstOrThrow({ where: { eventId: suspected.id, userId: ids.governorUserId } });
    await prisma.eventDelivery.update({ where: { id: latestDelivery.id }, data: { roleId: ids.countyRoleId } });
    const wrongRole = await fetch(eventsUrl(ids.runId), { headers: authHeaders(ids.governorUserId) });
    assert.equal(wrongRole.status, 403);
    await prisma.eventDelivery.update({ where: { id: latestDelivery.id }, data: { roleId: ids.governorRoleId } });

    await prisma.eventDelivery.update({ where: { id: latestDelivery.id }, data: { projectionVersion: 3 } });
    const versionMismatch = await fetch(eventsUrl(ids.runId), { headers: authHeaders(ids.governorUserId) });
    assert.equal(versionMismatch.status, 503);
  } finally {
    const prisma = cleanupPrisma;
    try {
      if (prisma) await cleanup(prisma, ids);
    } finally {
      if (app) await app.close();
      else if (prisma) await prisma.$disconnect();
    }
  }
});

function identifiers(suffix: string) {
  return {
    templateId: `m2-template-${suffix}`,
    runId: `m2-run-${suffix}`,
    otherRunId: `m2-other-run-${suffix}`,
    nodeId: `m2-node-${suffix}`,
    governorUserId: `m2-user-governor-${suffix}`,
    countyUserId: `m2-user-county-${suffix}`,
    outsiderUserId: `m2-user-outsider-${suffix}`,
    governorRoleId: `m2-role-governor-${suffix}`,
    otherGovernorRoleId: `m2-role-other-governor-${suffix}`,
    sourceRoleId: `m2-role-source-${suffix}`,
    countyRoleId: `m2-role-county-${suffix}`,
    sourceActionId: `m2-action-source-${suffix}`,
    investigationActionId: `m2-action-investigation-${suffix}`,
    aggregateId: `agg_${suffix.slice(0, 32)}`,
    baseResolutionId: `m2-base-resolution-${suffix}`,
    upgradeResolutionId: `m2-upgrade-resolution-${suffix}`,
    evidenceFactId: `m2-evidence-${suffix}`
  };
}

async function seed(prisma: PrismaService, ids: ReturnType<typeof identifiers>) {
  await prisma.worldTemplate.create({ data: { id: ids.templateId, name: "M2 Test", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
  await prisma.user.createMany({ data: [verifiedUser(ids.governorUserId), verifiedUser(ids.countyUserId), verifiedUser(ids.outsiderUserId)] });
  await prisma.storyRun.createMany({ data: [runData(ids.runId, ids, ids.governorUserId, `M2${ids.runId.slice(-8)}`), runData(ids.otherRunId, ids, ids.governorUserId, `M2O${ids.runId.slice(-7)}`)] });
  await prisma.sceneNode.create({ data: { id: ids.nodeId, runId: ids.runId, chapterIndex: 1, nodeIndex: 2, title: "M2", publicNarration: "M2", nodeGoal: "M2", actionOptionsJson: [] } });
  await prisma.storyRun.update({ where: { id: ids.runId }, data: { currentNodeId: ids.nodeId } });
  await prisma.storyRole.createMany({ data: [
    roleData(ids.runId, ids.governorRoleId, "zhejiang_governor", "浙江总督"),
    roleData(ids.runId, ids.sourceRoleId, "xunfu", "浙江巡抚"),
    roleData(ids.runId, ids.countyRoleId, "county_magistrate", "县令"),
    roleData(ids.otherRunId, ids.otherGovernorRoleId, "zhejiang_governor", "浙江总督")
  ] });
  await prisma.storyPlayer.createMany({ data: [
    { runId: ids.runId, userId: ids.governorUserId, roleId: ids.governorRoleId, playerType: "human", status: "active" },
    { runId: ids.runId, userId: ids.countyUserId, roleId: ids.countyRoleId, playerType: "human", status: "active" },
    { runId: ids.otherRunId, userId: ids.governorUserId, roleId: ids.otherGovernorRoleId, playerType: "human", status: "active" }
  ] });
  await prisma.playerAction.createMany({ data: [
    actionData(ids.sourceActionId, ids.runId, ids.nodeId, ids.sourceRoleId, ids.governorRoleId, "main_s2_xunfu_seize_drafts"),
    actionData(ids.investigationActionId, ids.runId, ids.nodeId, ids.governorRoleId, ids.sourceRoleId, "main_s2_governor_dual_verification")
  ] });
}
function runData(runId: string, ids: ReturnType<typeof identifiers>, ownerUserId: string, inviteCode: string) {
  return { id: runId, templateId: ids.templateId, ownerUserId, title: "M2", hook: "M2", mode: "room", templateKey: "sangtian", status: "playing", currentDay: 2, totalDays: 7, maxPlayers: 3, activeHumanCount: 2, aiPlayerCount: 0, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true } }, visibility: "private", inviteCode, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2", worldSequence: 17, reservedWorldSequence: 17 };
}
function roleData(runId: string, id: string, roleKey: string, roleName: string) { return { id, runId, roleKey, roleName, identity: roleName, publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], isAiControlled: false, status: "active" }; }
function actionData(id: string, runId: string, nodeId: string, roleId: string, targetRoleId: string, actionKey: string) { return { id, runId, nodeId, chapterIndex: 1, roleId, playerType: "human", actionType: "main", method: "structured", intent: "structured", riskLevel: "normal", status: "resolved", actionSlot: "MAIN", actionKey, visibility: "LIMITED", targetRoleId, immediateJson: {}, resolvedJson: {} }; }
function verifiedUser(id: string) { return { id, openid: `openid-${id}`, email: `${id}@example.test`, emailVerifiedAt: new Date("2026-08-10T00:00:00.000Z"), status: "active" }; }
async function cleanup(prisma: PrismaService, ids: ReturnType<typeof identifiers>) { await prisma.storyRun.deleteMany({ where: { id: { in: [ids.runId, ids.otherRunId] } } }); await prisma.user.deleteMany({ where: { id: { in: [ids.governorUserId, ids.countyUserId, ids.outsiderUserId] } } }); await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } }); }
function authHeaders(userId: string) { return { authorization: `Bearer ${issueAccessToken({ id: userId, openid: `openid-${userId}` })}`, accept: "application/json" }; }
function aggregateMetadata(ids: ReturnType<typeof identifiers>, projectionVersion: number, disclosure: "HIDDEN" | "SUSPECTED", category: "RELATED" | "SUSPICIOUS") { return { aggregateKey: `aemotion:m2:${ids.runId}:${ids.governorRoleId}:stage-2`, aggregateId: ids.aggregateId, stageId: "stage-2", sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID, eventFamily: A_EMOTION_M2_EVENT_FAMILY, category, disclosure, projectionVersion, stateVersion: projectionVersion } as const; }
function hiddenProjection(eventSequence: number) { return { schemaVersion: A_EMOTION_M1_PROJECTION_SCHEMA_VERSION, projectionVersion: 1, stateVersion: 1, eventSequence, category: "RELATED", disclosure: "HIDDEN", severity: "MAJOR", centerCardType: "CROSS_IMPACT", title: "他人的行动改变了你的处境", summary: "送达总督府的账册出现异常，原始材料尚未按登记到位。", sourceStatus: "来源未知", knownFacts: ["递送编号存在断档", "多个经手环节都接触过材料"], visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 52, after: 46, delta: -6, suffix: "", safeReason: "粮册异常引发朝廷质疑" }], responseOptions: [{ code: "INVESTIGATE_LEDGER_ANOMALY", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_ledger_delivery", prefillText: "核对递送、封签和经手记录。" }, { code: "QUESTION_DELIVERY_PUBLICLY", label: "公开质问", preferredEntry: "TALK", intentKey: "question_ledger_delivery", prefillText: "请相关经手方说明递送记录为何不一致。" }, { code: "DEFER_RESPONSE", label: "暂不回应", preferredEntry: "DEFER", intentKey: null, prefillText: null }], occurredAt: "2026-08-10T05:00:00.000Z" }; }
function suspectedProjection(ids: ReturnType<typeof identifiers>, eventSequence: number) { return { schemaVersion: A_EMOTION_M2_PROJECTION_SCHEMA_VERSION, projectionVersion: 2, stateVersion: 2, eventSequence, aggregateId: ids.aggregateId, stageId: "stage-2", sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID, eventFamily: A_EMOTION_M2_EVENT_FAMILY, category: "SUSPICIOUS", disclosure: "SUSPECTED", severity: "MAJOR", centerCardType: "SUSPICIOUS_TRACE", title: "粮册流转留下了可疑迹象", summary: "递送记录与复核时序存在冲突，但现有证据仍不足以确认由哪一名经手角色授意。", sourceStatus: "两名经手角色均有嫌疑", knownFacts: ["递送时间晚于原定登记", "异常发生在一次临时复核之后"], visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 52, after: 46, delta: -6, suffix: "", safeReason: "粮册异常引发朝廷质疑" }], responseOptions: [{ code: "CONTINUE_LEDGER_EVIDENCE_SEARCH", label: "继续追查", preferredEntry: "INVESTIGATE", targetRoleKey: null, intentKey: "inspect_ledger_authority_chain", prefillText: "继续核对复核手令、递送登记、装订编号和实际经手记录。" }, { code: "QUESTION_LEDGER_HANDLERS", label: "公开质问", preferredEntry: "TALK", targetRoleKey: null, intentKey: "question_ledger_handlers", prefillText: "请相关经手方说明复核与递送记录为何不一致。" }, { code: "DEFER_RESPONSE", label: "保留证据", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }], visibleSuspectRoleIds: [ids.sourceRoleId, ids.countyRoleId], occurredAt: "2026-08-10T05:10:00.000Z" }; }
function assertNetworkSafe(body: string, ids: ReturnType<typeof identifiers>) { const forbidden = [ids.sourceActionId, ids.investigationActionId, "sourceRoleId", "sourceRoleKey", "sourceActionId", "targetRoleId", "rawAudience", "audienceRoleIds", "audienceUserIds", "internalDedupeKey", "dedupeKey", "xunfu", "巡抚"]; assert.doesNotMatch(body, new RegExp(forbidden.map(escapeRegex).join("|"), "iu")); }
function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
