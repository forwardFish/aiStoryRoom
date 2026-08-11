import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  A_EMOTION_M1_EVENT_TYPE,
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_EVENT_FAMILY,
  A_EMOTION_M2_EVENT_TYPE,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_SHARED_OBJECT_ID,
  CONTINUOUS_STORY_ENGINE_VERSION,
  isOpaqueAEmotionM2Cursor,
  isOpaqueAEmotionM2EventId
} from "@ai-story/shared";
import { ContinuousEventDeliveryService, aEmotionInteractionAggregateLockName } from "./event-delivery.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M2_TEST_DATABASE_URL);
const previousM1 = process.env.A_EMOTION_M1_ENABLED;
const previousM2 = process.env.A_EMOTION_M2_ENABLED;
process.env.A_EMOTION_M1_ENABLED = "true";
process.env.A_EMOTION_M2_ENABLED = "true";

const RECEIPT_RACE_TRANSACTION_MAX_WAIT_MS = 15_000;
const RECEIPT_RACE_TRANSACTION_TIMEOUT_MS = 30_000;

test.after(() => {
  if (previousM1 === undefined) delete process.env.A_EMOTION_M1_ENABLED;
  else process.env.A_EMOTION_M1_ENABLED = previousM1;
  if (previousM2 === undefined) delete process.env.A_EMOTION_M2_ENABLED;
  else process.env.A_EMOTION_M2_ENABLED = previousM2;
});

test("real PostgreSQL publication keeps canonical/private state separate, aggregates disclosure and persists receipts", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M2_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl! } } });
  const ids = await seedFixture(prisma);
  const service = new ContinuousEventDeliveryService(prisma as never);
  const aggregate = aggregateMetadata(ids, 1, "HIDDEN", "RELATED");
  try {
    const hidden = await prisma.$transaction((tx) => service.publishProjected(tx, {
      runId: ids.runId,
      nodeId: ids.nodeId,
      day: 2,
      type: A_EMOTION_M1_EVENT_TYPE,
      messageType: "system",
      roleKey: "zhejiang_governor",
      visibility: "LIMITED",
      audienceType: "ROLE",
      audienceRoleIds: [ids.governorRoleId],
      canonicalPayload: {
        schemaVersion: "a_emotion_m1_canonical_impact_v1",
        resolutionId: ids.m1ResolutionId,
        sharedObjectKey: A_EMOTION_M2_SHARED_OBJECT_ID,
        stateVersion: 1
      },
      deliveries: [{
        userId: ids.governorUserId,
        roleId: ids.governorRoleId,
        aggregate,
        buildPayload: (eventSequence) => hiddenProjection(eventSequence)
      }],
      dedupeKey: `A_EMOTION_M1:${ids.m1ResolutionId}:${ids.governorRoleId}`,
      sourceActionId: ids.sourceActionId
    }));

    const beforeM1Conflict = await Promise.all([
      prisma.storyEvent.count({ where: { runId: ids.runId } }),
      prisma.eventDelivery.count({ where: { roomId: ids.runId } }),
      prisma.storyEventCursor.findUnique({ where: { runId: ids.runId }, select: { nextSequence: true, version: true } }),
      prisma.eventDeliveryCursor.findUnique({
        where: { roomId_userId: { roomId: ids.runId, userId: ids.governorUserId } },
        select: { nextSequence: true, version: true }
      })
    ]);
    await assert.rejects(
      () => prisma.$transaction((tx) => service.publishProjected(tx, {
        runId: ids.runId,
        nodeId: ids.nodeId,
        day: 2,
        type: A_EMOTION_M1_EVENT_TYPE,
        messageType: "system",
        roleKey: "zhejiang_governor",
        visibility: "LIMITED",
        audienceType: "ROLE",
        audienceRoleIds: [ids.governorRoleId],
        canonicalPayload: {
          schemaVersion: "a_emotion_m1_canonical_impact_v1",
          resolutionId: ids.m1ResolutionId,
          sharedObjectKey: A_EMOTION_M2_SHARED_OBJECT_ID,
          stateVersion: 2
        },
        deliveries: [{
          userId: ids.governorUserId,
          roleId: ids.governorRoleId,
          aggregate: { ...aggregate, stateVersion: 2 },
          buildPayload: (eventSequence) => ({ ...hiddenProjection(eventSequence), stateVersion: 2 })
        }],
        dedupeKey: `A_EMOTION_M1:${ids.m1ResolutionId}:${ids.governorRoleId}`,
        sourceActionId: ids.sourceActionId
      })),
      (error: unknown) => exceptionCode(error) === "A_EMOTION_M1_IDEMPOTENCY_CONFLICT"
    );
    const afterM1Conflict = await Promise.all([
      prisma.storyEvent.count({ where: { runId: ids.runId } }),
      prisma.eventDelivery.count({ where: { roomId: ids.runId } }),
      prisma.storyEventCursor.findUnique({ where: { runId: ids.runId }, select: { nextSequence: true, version: true } }),
      prisma.eventDeliveryCursor.findUnique({
        where: { roomId_userId: { roomId: ids.runId, userId: ids.governorUserId } },
        select: { nextSequence: true, version: true }
      })
    ]);
    assert.deepEqual(afterM1Conflict, beforeM1Conflict, "M1 idempotency conflict must not advance event or delivery state");

    const suspectPublish = () => prisma.$transaction((tx) => service.publishProjected(tx, {
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
        resolutionId: ids.m2ResolutionId,
        baseEventId: hidden.id,
        sourceRoleId: ids.sourceRoleId,
        aggregateKey: aggregate.aggregateKey,
        projectionVersion: 2,
        stateVersion: 2,
        nextDisclosure: "SUSPECTED",
        evidenceFactId: ids.evidenceFactId
      },
      deliveries: [{
        userId: ids.governorUserId,
        roleId: ids.governorRoleId,
        aggregate: aggregateMetadata(ids, 2, "SUSPECTED", "SUSPICIOUS"),
        buildPayload: (eventSequence) => suspectedProjection(ids, eventSequence)
      }],
      dedupeKey: `A_EMOTION_M2:${ids.m2ResolutionId}:${ids.governorRoleId}:2`,
      sourceActionId: ids.investigationActionId
    }));

    const suspected = await suspectPublish();
    const replay = await suspectPublish();
    assert.equal(replay.id, suspected.id);
    assert.equal(isOpaqueAEmotionM2EventId(suspected.id), true);
    assert.doesNotMatch(suspected.id, /action|role|run|dedupe|:/iu);

    const [events, deliveries] = await Promise.all([
      prisma.storyEvent.findMany({ where: { runId: ids.runId }, orderBy: { sequence: "asc" } }),
      prisma.eventDelivery.findMany({ where: { roomId: ids.runId }, orderBy: { deliverySequence: "asc" } })
    ]);
    assert.equal(events.length, 2);
    assert.equal(deliveries.length, 2, "the unrelated county viewer receives no delivery");
    assert.equal(deliveries.every((delivery) => delivery.userId === ids.governorUserId && delivery.roleId === ids.governorRoleId), true);
    assert.notDeepEqual(events[1].payloadJson, deliveries[1].payloadJson);
    const viewerBody = JSON.stringify(deliveries[1].payloadJson);
    assertViewerSafe(viewerBody, ids);

    const governor = { id: ids.governorUserId, openid: `openid-${ids.governorUserId}` } as any;
    const county = { id: ids.countyUserId, openid: `openid-${ids.countyUserId}` } as any;
    const governorPage = await service.page(governor, ids.runId, 0, 100, { limit: 10 });
    assert.equal(governorPage.deliveries.length, 2);
    assert.ok(governorPage.interactionFeed);
    assert.equal(governorPage.interactionFeed.items.length, 1, "REVEAL/upgrade replaces the original aggregate feed row");
    assert.equal(governorPage.interactionFeed.items[0].eventId, suspected.id);
    assert.equal(governorPage.interactionFeed.items[0].projectionVersion, 2);
    assert.equal(governorPage.interactionFeed.items[0].disclosure, "SUSPECTED");
    assert.equal(governorPage.interactionFeed.items[0].isUnread, true);
    assertViewerSafe(JSON.stringify(governorPage), ids);

    const countyPage = await service.page(county, ids.runId, 0, 100, { limit: 10 });
    assert.deepEqual(countyPage.deliveries, []);
    assert.equal(countyPage.interactionFeed, undefined);

    const detail = await service.interactionDetail(governor, ids.runId, suspected.id, 2);
    assert.equal(detail.eventId, suspected.id);
    assert.equal(detail.disclosure, "SUSPECTED");
    assertViewerSafe(JSON.stringify(detail), ids);
    await assert.rejects(() => service.interactionDetail(county, ids.runId, suspected.id, 2), /Interaction event not found|INTERACTION_EVENT_NOT_FOUND/);
    await assert.rejects(() => service.interactionDetail(governor, ids.runId, hidden.id, 1), /stale/i);

    const seen = await service.markInteractionSeen(governor, ids.runId, suspected.id, 2);
    assert.ok(seen.seenAt);
    assert.equal(seen.acknowledgedAt, null);
    const repeatedSeen = await service.markInteractionSeen(governor, ids.runId, suspected.id, 2);
    assert.equal(repeatedSeen.seenAt, seen.seenAt, "repeated seen keeps the original timestamp");
    assert.equal(repeatedSeen.acknowledgedAt, null);

    const ack = await service.acknowledgeInteraction(governor, ids.runId, suspected.id, 2);
    assert.ok(ack.acknowledgedAt);
    assert.equal(ack.seenAt, seen.seenAt);
    const repeatedAck = await service.acknowledgeInteraction(governor, ids.runId, suspected.id, 2);
    assert.equal(repeatedAck.seenAt, ack.seenAt);
    assert.equal(repeatedAck.acknowledgedAt, ack.acknowledgedAt, "repeated ack keeps the original timestamp");

    const resolved = await service.resolveInteraction(governor, ids.runId, suspected.id, 2);
    assert.ok(resolved.resolvedAt);
    const repeated = await service.resolveInteraction(governor, ids.runId, suspected.id, 2);
    assert.equal(repeated.seenAt, resolved.seenAt);
    assert.equal(repeated.acknowledgedAt, resolved.acknowledgedAt);
    assert.equal(repeated.resolvedAt, resolved.resolvedAt, "repeated resolved keeps the original timestamp");

    const afterReceipts = await service.page(governor, ids.runId, 0, 100, { limit: 10 });
    assert.equal(afterReceipts.interactionFeed?.items[0].isUnread, false);
    assert.equal(afterReceipts.interactionFeed?.items[0].isAcknowledged, true);
    assert.equal(afterReceipts.interactionFeed?.items[0].isResolved, true);
  } finally {
    await cleanupFixture(prisma, ids);
    await prisma.$disconnect();
  }
});



test("real PostgreSQL receipts reject a concurrent newer projection atomically for seen, ack and resolved", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M2_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl! } } });
  const ids = await seedFixture(prisma);
  const service = new ContinuousEventDeliveryService(prisma as never);
  const governor = { id: ids.governorUserId, openid: `openid-${ids.governorUserId}` } as any;
  try {
    const receiptMethods = [
      ["seen", (eventId: string) => service.markInteractionSeen(governor, ids.runId, eventId, 1)],
      ["acknowledged", (eventId: string) => service.acknowledgeInteraction(governor, ids.runId, eventId, 1)],
      ["resolved", (eventId: string) => service.resolveInteraction(governor, ids.runId, eventId, 1)]
    ] as const;

    for (const [kind, mutate] of receiptMethods) {
      const suffix = `${kind}-${randomUUID().replaceAll("-", "")}`;
      const aggregateKey = `aemotion:m2:receipt-race:${suffix}`;
      const aggregateId = `agg_${randomUUID().replaceAll("-", "").slice(0, 32)}`;
      const baseEvent = await prisma.$transaction((tx) => service.publishProjected(tx, {
        runId: ids.runId,
        nodeId: ids.nodeId,
        day: 2,
        type: A_EMOTION_M1_EVENT_TYPE,
        messageType: "system",
        roleKey: "zhejiang_governor",
        visibility: "LIMITED",
        audienceType: "ROLE",
        audienceRoleIds: [ids.governorRoleId],
        canonicalPayload: { schemaVersion: "a_emotion_m1_canonical_impact_v1", resolutionId: suffix, sharedObjectKey: A_EMOTION_M2_SHARED_OBJECT_ID, stateVersion: 1 },
        deliveries: [{
          userId: ids.governorUserId,
          roleId: ids.governorRoleId,
          aggregate: {
            aggregateKey,
            aggregateId,
            stageId: "stage-2",
            sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
            eventFamily: A_EMOTION_M2_EVENT_FAMILY,
            category: "RELATED",
            disclosure: "HIDDEN",
            projectionVersion: 1,
            stateVersion: 1
          },
          buildPayload: (eventSequence) => hiddenProjection(eventSequence)
        }],
        dedupeKey: `A_EMOTION_RECEIPT_RACE_BASE:${suffix}`,
        sourceActionId: ids.sourceActionId
      }));

      let receiptPromise: Promise<unknown> | null = null;
      await prisma.$transaction(async (tx) => {
        const lockName = aEmotionInteractionAggregateLockName(aggregateKey);
        await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))) AS acquired`;
        receiptPromise = mutate(baseEvent.id);
        await waitForAdvisoryWaiter(prisma, lockName);
        await service.publishProjected(tx, {
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
            resolutionId: `${suffix}-upgrade`,
            baseEventId: baseEvent.id,
            sourceRoleId: ids.sourceRoleId,
            aggregateKey,
            projectionVersion: 2,
            stateVersion: 2,
            nextDisclosure: "SUSPECTED",
            evidenceFactId: ids.evidenceFactId
          },
          deliveries: [{
            userId: ids.governorUserId,
            roleId: ids.governorRoleId,
            aggregate: {
              aggregateKey,
              aggregateId,
              stageId: "stage-2",
              sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
              eventFamily: A_EMOTION_M2_EVENT_FAMILY,
              category: "SUSPICIOUS",
              disclosure: "SUSPECTED",
              projectionVersion: 2,
              stateVersion: 2
            },
            buildPayload: (eventSequence) => ({ ...suspectedProjection(ids, eventSequence), aggregateId })
          }],
          dedupeKey: `A_EMOTION_RECEIPT_RACE_UPGRADE:${suffix}`,
          sourceActionId: ids.investigationActionId
        });
      }, {
        maxWait: RECEIPT_RACE_TRANSACTION_MAX_WAIT_MS,
        timeout: RECEIPT_RACE_TRANSACTION_TIMEOUT_MS
      });
      if (!receiptPromise) throw new Error("receipt request did not start while the aggregate lock was held");
      await assert.rejects(
        receiptPromise,
        (error: unknown) => exceptionCode(error) === "STALE_INTERACTION_PROJECTION"
      );
      const oldRow = await prisma.eventDelivery.findUniqueOrThrow({ where: { eventId_userId: { eventId: baseEvent.id, userId: ids.governorUserId } } });
      assert.equal(oldRow.seenAt, null, `${kind} stale race must not write seenAt`);
      assert.equal(oldRow.acknowledgedAt, null, `${kind} stale race must not write acknowledgedAt`);
      assert.equal(oldRow.resolvedAt, null, `${kind} stale race must not write resolvedAt`);
      const latest = await prisma.eventDelivery.findFirstOrThrow({ where: { roomId: ids.runId, userId: ids.governorUserId, aggregateKey }, orderBy: { projectionVersion: "desc" } });
      assert.equal(latest.projectionVersion, 2);
    }
  } finally {
    await cleanupFixture(prisma, ids);
    await prisma.$disconnect();
  }
});

test("real PostgreSQL M2 cursor is opaque, viewer-bound and stale after an aggregate version changes", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M2_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl! } } });
  const ids = await seedFixture(prisma);
  const service = new ContinuousEventDeliveryService(prisma as never);
  try {
    for (let index = 0; index < 3; index += 1) {
      const aggregateId = `agg_${String(index + 1).padStart(32, "a")}`;
      const aggregateKey = `aemotion:m2:test:${index}`;
      await prisma.$transaction((tx) => service.publishProjected(tx, {
        runId: ids.runId,
        nodeId: ids.nodeId,
        day: 2,
        type: A_EMOTION_M1_EVENT_TYPE,
        messageType: "system",
        roleKey: "zhejiang_governor",
        visibility: "LIMITED",
        audienceType: "ROLE",
        audienceRoleIds: [ids.governorRoleId],
        canonicalPayload: { schemaVersion: "a_emotion_m1_canonical_impact_v1", resolutionId: `cursor-${index}`, sharedObjectKey: A_EMOTION_M2_SHARED_OBJECT_ID, stateVersion: index + 1 },
        deliveries: [{
          userId: ids.governorUserId,
          roleId: ids.governorRoleId,
          aggregate: { ...aggregateMetadata(ids, 1, "HIDDEN", "RELATED"), aggregateId, aggregateKey, stageId: `stage-${index + 1}`, stateVersion: index + 1 },
          buildPayload: (eventSequence) => ({ ...hiddenProjection(eventSequence), stateVersion: index + 1, occurredAt: `2026-08-10T05:0${index}:00.000Z` })
        }],
        dedupeKey: `A_EMOTION_CURSOR:${ids.runId}:${index}`,
        sourceActionId: ids.sourceActionId
      }));
    }
    const governor = { id: ids.governorUserId } as any;
    const county = { id: ids.countyUserId } as any;
    const first = await service.page(governor, ids.runId, 0, 100, { limit: 1 });
    assert.ok(first.interactionFeed?.hasMore);
    assert.ok(first.interactionFeed?.nextCursor);
    assert.equal(isOpaqueAEmotionM2Cursor(first.interactionFeed?.nextCursor), true);
    assert.doesNotMatch(String(first.interactionFeed?.nextCursor), new RegExp([ids.runId, ids.governorUserId, ids.governorRoleId].map(escapeRegex).join("|")));
    const second = await service.page(governor, ids.runId, 0, 100, { limit: 1, cursor: first.interactionFeed!.nextCursor! });
    assert.equal(second.interactionFeed?.items.length, 1);
    assert.notEqual(second.interactionFeed?.items[0].aggregateId, first.interactionFeed?.items[0].aggregateId);
    await assert.rejects(() => service.page(county, ids.runId, 0, 100, { limit: 1, cursor: first.interactionFeed!.nextCursor! }), /stale or belongs to another viewer|STALE_OR_SCOPED_INTERACTION_CURSOR/);
    await assert.rejects(() => service.page(county, ids.runId, 0, 100, { limit: 1, cursor: "not-an-opaque-cursor" }), /Interaction cursor is invalid|INTERACTION_CURSOR_INVALID/);

    const boundary = first.interactionFeed!.items[0];
    await prisma.eventDelivery.updateMany({ where: { eventId: boundary.eventId }, data: { projectionVersion: boundary.projectionVersion + 1 } });
    await assert.rejects(
      () => service.page(governor, ids.runId, 0, 100, { limit: 1, cursor: first.interactionFeed!.nextCursor! }),
      (error: any) => {
        const response = typeof error?.getResponse === "function" ? error.getResponse() : null;
        assert.equal(response?.code, "STALE_OR_SCOPED_INTERACTION_CURSOR");
        assert.equal(error?.getStatus?.(), 409);
        return true;
      }
    );
  } finally {
    await cleanupFixture(prisma, ids);
    await prisma.$disconnect();
  }
});

function aggregateMetadata(ids: Awaited<ReturnType<typeof seedFixture>>, projectionVersion: number, disclosure: "HIDDEN" | "SUSPECTED" | "CONFIRMED", category: "RELATED" | "SUSPICIOUS" | "PUBLIC") {
  return {
    aggregateKey: `aemotion:m2:${ids.runId}:${ids.governorRoleId}:stage-2`,
    aggregateId: ids.aggregateId,
    stageId: "stage-2",
    sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
    eventFamily: A_EMOTION_M2_EVENT_FAMILY,
    category,
    disclosure,
    projectionVersion,
    stateVersion: projectionVersion
  } as const;
}

function hiddenProjection(eventSequence: number) {
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

function suspectedProjection(ids: Awaited<ReturnType<typeof seedFixture>>, eventSequence: number) {
  return {
    schemaVersion: A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
    projectionVersion: 2,
    stateVersion: 2,
    eventSequence,
    aggregateId: ids.aggregateId,
    stageId: "stage-2",
    sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
    eventFamily: A_EMOTION_M2_EVENT_FAMILY,
    category: "SUSPICIOUS",
    disclosure: "SUSPECTED",
    severity: "MAJOR",
    centerCardType: "SUSPICIOUS_TRACE",
    title: "粮册流转留下了可疑迹象",
    summary: "递送记录与复核时序存在冲突，但现有证据仍不足以确认由哪一名经手角色授意。",
    sourceStatus: "两名经手角色均有嫌疑",
    knownFacts: ["递送时间晚于原定登记", "异常发生在一次临时复核之后"],
    visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 52, after: 46, delta: -6, suffix: "", safeReason: "粮册异常引发朝廷质疑" }],
    responseOptions: [
      { code: "CONTINUE_LEDGER_EVIDENCE_SEARCH", label: "继续追查", preferredEntry: "INVESTIGATE", targetRoleKey: null, intentKey: "inspect_ledger_authority_chain", prefillText: "继续核对复核手令、递送登记、装订编号和实际经手记录。" },
      { code: "QUESTION_LEDGER_HANDLERS", label: "公开质问", preferredEntry: "TALK", targetRoleKey: null, intentKey: "question_ledger_handlers", prefillText: "请相关经手方说明复核与递送记录为何不一致。" },
      { code: "DEFER_RESPONSE", label: "保留证据", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
    ],
    visibleSuspectRoleIds: [ids.sourceRoleId, ids.countyRoleId],
    occurredAt: "2026-08-10T05:10:00.000Z"
  };
}

async function seedFixture(prisma: PrismaClient) {
  const suffix = randomUUID().replaceAll("-", "");
  const templateId = `m2-template-${suffix}`;
  const runId = `m2-run-${suffix}`;
  const nodeId = `m2-node-${suffix}`;
  const governorUserId = `m2-user-governor-${suffix}`;
  const countyUserId = `m2-user-county-${suffix}`;
  const governorRoleId = `m2-role-governor-${suffix}`;
  const sourceRoleId = `m2-role-source-${suffix}`;
  const countyRoleId = `m2-role-county-${suffix}`;
  const sourceActionId = `m2-action-source-${suffix}`;
  const investigationActionId = `m2-action-investigation-${suffix}`;
  const aggregateId = `agg_${suffix.slice(0, 32)}`;
  const m1ResolutionId = `m2-base-resolution-${suffix}`;
  const m2ResolutionId = `m2-upgrade-resolution-${suffix}`;
  const evidenceFactId = `m2-evidence-${suffix}`;

  await prisma.worldTemplate.create({ data: { id: templateId, name: "M2 Test", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
  await prisma.user.createMany({ data: [
    { id: governorUserId, openid: `openid-${governorUserId}` },
    { id: countyUserId, openid: `openid-${countyUserId}` }
  ] });
  await prisma.storyRun.create({ data: {
    id: runId, templateId, ownerUserId: governorUserId, title: "M2 Integration", hook: "M2", mode: "room", templateKey: "sangtian", status: "playing",
    currentDay: 2, totalDays: 7, maxPlayers: 3, activeHumanCount: 2, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true } }, visibility: "private",
    inviteCode: `M2${suffix.slice(0, 8)}`, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2", worldSequence: 17, reservedWorldSequence: 17
  } });
  await prisma.sceneNode.create({ data: { id: nodeId, runId, chapterIndex: 1, nodeIndex: 2, title: "M2", publicNarration: "M2", nodeGoal: "M2", actionOptionsJson: [] } });
  await prisma.storyRun.update({ where: { id: runId }, data: { currentNodeId: nodeId } });
  await prisma.storyRole.createMany({ data: [
    roleData(runId, governorRoleId, "zhejiang_governor", "浙江总督"),
    roleData(runId, sourceRoleId, "xunfu", "浙江巡抚"),
    roleData(runId, countyRoleId, "county_magistrate", "县令")
  ] });
  await prisma.storyPlayer.createMany({ data: [
    { runId, userId: governorUserId, roleId: governorRoleId, playerType: "human", status: "active" },
    { runId, userId: countyUserId, roleId: countyRoleId, playerType: "human", status: "active" }
  ] });
  await prisma.playerAction.createMany({ data: [
    actionData({ id: sourceActionId, runId, nodeId, roleId: sourceRoleId, targetRoleId: governorRoleId, actionKey: "main_s2_xunfu_seize_drafts" }),
    actionData({ id: investigationActionId, runId, nodeId, roleId: governorRoleId, targetRoleId: sourceRoleId, actionKey: "main_s2_governor_dual_verification" })
  ] });
  return { templateId, runId, nodeId, governorUserId, countyUserId, governorRoleId, sourceRoleId, countyRoleId, sourceActionId, investigationActionId, aggregateId, m1ResolutionId, m2ResolutionId, evidenceFactId };
}

function roleData(runId: string, id: string, roleKey: string, roleName: string) {
  return { id, runId, roleKey, roleName, identity: roleName, publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], isAiControlled: false, status: "active" };
}
function actionData(input: { id: string; runId: string; nodeId: string; roleId: string; targetRoleId: string; actionKey: string }) {
  return { id: input.id, runId: input.runId, nodeId: input.nodeId, chapterIndex: 1, roleId: input.roleId, playerType: "human", actionType: "main", method: "structured", intent: "structured", riskLevel: "normal", status: "resolved", actionSlot: "MAIN", actionKey: input.actionKey, visibility: "LIMITED", targetRoleId: input.targetRoleId, immediateJson: {}, resolvedJson: {} };
}
async function cleanupFixture(prisma: PrismaClient, ids: Awaited<ReturnType<typeof seedFixture>>) {
  await prisma.storyRun.deleteMany({ where: { id: ids.runId } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.governorUserId, ids.countyUserId] } } });
  await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } });
}
function assertViewerSafe(body: string, ids: Awaited<ReturnType<typeof seedFixture>>) {
  assert.doesNotMatch(body, new RegExp([ids.sourceActionId, ids.investigationActionId, "sourceRoleId", "sourceRoleKey", "sourceActionId", "targetRoleId", "rawAudience", "audienceRoleIds", "dedupeKey", "internalDedupeKey", "xunfu", "巡抚"].map(escapeRegex).join("|"), "iu"));
}

async function waitForAdvisoryWaiter(prisma: PrismaClient, lockName: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT COUNT(*)::bigint AS waiting
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND granted = false
        AND objsubid = 1
        AND classid::bigint = ((hashtextextended(${lockName}, 0) >> 32) & 4294967295)
        AND objid::bigint = (hashtextextended(${lockName}, 0) & 4294967295)
    `;
    if (Number(rows[0]?.waiting || 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("A_EMOTION_M2_ADVISORY_BARRIER_TIMEOUT");
}

function exceptionCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const direct = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  if (direct) return direct;
  const getResponse = (error as { getResponse?: unknown }).getResponse;
  if (typeof getResponse !== "function") return "";
  const response = (getResponse as () => unknown).call(error);
  return response && typeof response === "object" && "code" in response
    ? String((response as { code?: unknown }).code || "")
    : "";
}

function safeTestDatabaseUrl(value: string | undefined) {
  if (!value) return null;
  try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; }
  catch { return null; }
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
