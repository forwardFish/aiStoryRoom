import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M4_EVENT_FAMILY,
  A_EMOTION_M4_EVENT_TYPE,
  A_EMOTION_M4_SHARED_OBJECT_ID,
  CONTINUOUS_STORY_ENGINE_VERSION,
  validateAEmotionKeyModalV1,
  validateAEmotionM2ProjectionV1
} from "@ai-story/shared";
import { configureApiTransport, PresenceHeartbeatRateLimitGuard } from "../api-transport";
import { AuthGuard } from "../auth/auth.guard";
import { issueAccessToken } from "../auth/auth.service";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { RoomsController } from "../rooms.controller";
import { RoomsService } from "../rooms.service";
import { AEmotionKeyModalService } from "./a-emotion-key-modal.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M4_TEST_DATABASE_URL);
const previous = {
  m1: process.env.A_EMOTION_M1_ENABLED,
  m2: process.env.A_EMOTION_M2_ENABLED,
  m4: process.env.A_EMOTION_M4_ENABLED,
  promises: process.env.A_EMOTION_SIMPLE_PROMISE_ENABLED,
  modals: process.env.A_EMOTION_KEY_MODALS_ENABLED
};
process.env.A_EMOTION_M1_ENABLED = "true";
process.env.A_EMOTION_M2_ENABLED = "true";
process.env.A_EMOTION_M4_ENABLED = "true";
process.env.A_EMOTION_SIMPLE_PROMISE_ENABLED = "true";
process.env.A_EMOTION_KEY_MODALS_ENABLED = "true";

test.after(() => {
  restore("A_EMOTION_M1_ENABLED", previous.m1);
  restore("A_EMOTION_M2_ENABLED", previous.m2);
  restore("A_EMOTION_M4_ENABLED", previous.m4);
  restore("A_EMOTION_SIMPLE_PROMISE_ENABLED", previous.promises);
  restore("A_EMOTION_KEY_MODALS_ENABLED", previous.modals);
});

@Module({
  controllers: [RoomsController],
  providers: [
    PrismaService,
    ContinuousEventDeliveryService,
    AEmotionKeyModalService,
    PresenceHeartbeatRateLimitGuard,
    AuthGuard,
    {
      provide: RoomsService,
      inject: [PrismaService, ContinuousEventDeliveryService, AEmotionKeyModalService],
      useFactory: (prisma: PrismaService, events: ContinuousEventDeliveryService, modals: AEmotionKeyModalService) => new RoomsService(
        prisma,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        events,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        modals
      )
    }
  ]
})
class M4ProductionEventsTestModule {}

test("production AuthGuard → RoomsController exposes one viewer-safe PROMISE_BROKEN event and modal", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M4_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  process.env.DATABASE_URL = isolatedDatabaseUrl!;
  const suffix = randomUUID().replaceAll("-", "");
  const ids = identifiers(suffix);
  let app: Awaited<ReturnType<typeof NestFactory.create>> | null = null;
  let cleanupPrisma: PrismaService | null = null;
  try {
    app = await NestFactory.create(M4ProductionEventsTestModule, { logger: false });
    configureApiTransport(app);
    app.setGlobalPrefix("api");
    const prisma = app.get(PrismaService);
    const deliveries = app.get(ContinuousEventDeliveryService);
    cleanupPrisma = prisma;
    await prisma.$connect();
    await app.listen(0, "127.0.0.1");
    await seed(prisma, ids);
    await publishPromiseBroken(prisma, deliveries, ids);

    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}/api/v4/rooms/${encodeURIComponent(ids.runId)}`;

    const receiver = await fetch(`${base}/events?afterDeliverySequence=0&interactionLimit=10`, { headers: authHeaders(ids.receiverUserId) });
    assert.equal(receiver.status, 200);
    const receiverText = await receiver.text();
    assertNetworkSafe(receiverText, ids);
    const receiverJson = JSON.parse(receiverText);
    assert.equal(receiverJson.interactionFeed.items.length, 1);
    assert.equal(receiverJson.interactionFeed.items[0].eventId, ids.eventId);
    assert.equal(receiverJson.interactionFeed.items[0].centerCardType, "PROMISE_BROKEN");
    assert.equal(receiverJson.interactionFeed.items[0].visibleSourceRoleId, ids.issuerRoleId);
    assert.deepEqual(receiverJson.interactionFeed.items[0].evidenceRefs, [ids.evidenceRef]);
    assert.equal(receiverJson.keyModals.length, 1);
    assert.equal(receiverJson.keyModals[0].modalId, ids.modalId);
    assert.equal(receiverJson.keyModals[0].modalType, "PROMISE_BROKEN");
    assert.equal(receiverJson.keyModals[0].priority, 200);

    const issuer = await fetch(`${base}/events?afterDeliverySequence=0&interactionLimit=10`, { headers: authHeaders(ids.issuerUserId) });
    assert.equal(issuer.status, 200);
    const issuerJson = await issuer.json();
    assert.equal(issuerJson.interactionFeed?.items?.length || 0, 0, "private promise reveal is receiver-scoped");
    assert.equal(issuerJson.keyModals, undefined);

    const outsider = await fetch(`${base}/events?afterDeliverySequence=0&interactionLimit=10`, { headers: authHeaders(ids.outsiderUserId) });
    assert.equal(outsider.status, 403);

    const detail = await fetch(`${base}/events/${encodeURIComponent(ids.eventId)}?projectionVersion=2`, { headers: authHeaders(ids.receiverUserId) });
    assert.equal(detail.status, 200);
    const detailText = await detail.text();
    assertNetworkSafe(detailText, ids);
    assert.equal(JSON.parse(detailText).centerCardType, "PROMISE_BROKEN");

    const crossViewerDetail = await fetch(`${base}/events/${encodeURIComponent(ids.eventId)}?projectionVersion=2`, { headers: authHeaders(ids.issuerUserId) });
    assert.equal(crossViewerDetail.status, 404);

    const shownUrl = `${base}/a-emotion/modals/${encodeURIComponent(ids.modalId)}/shown`;
    const shownFirst = await post(shownUrl, ids.receiverUserId, { projectionVersion: 2, triggerVersion: 2 });
    const shownSecond = await post(shownUrl, ids.receiverUserId, { projectionVersion: 2, triggerVersion: 2 });
    assert.equal(shownFirst.response.status, 201);
    assert.equal(shownSecond.response.status, 201);
    assert.equal(JSON.parse(shownSecond.text).shownAt, JSON.parse(shownFirst.text).shownAt);

    const ackUrl = `${base}/a-emotion/modals/${encodeURIComponent(ids.modalId)}/ack`;
    const ackFirst = await post(ackUrl, ids.receiverUserId, { projectionVersion: 2, triggerVersion: 2 });
    const ackSecond = await post(ackUrl, ids.receiverUserId, { projectionVersion: 2, triggerVersion: 2 });
    assert.equal(ackFirst.response.status, 201);
    assert.equal(ackSecond.response.status, 201);
    assert.equal(JSON.parse(ackSecond.text).acknowledgedAt, JSON.parse(ackFirst.text).acknowledgedAt);

    const stale = await post(ackUrl, ids.receiverUserId, { projectionVersion: 1, triggerVersion: 2 });
    assert.equal(stale.response.status, 409);
    assert.equal(JSON.parse(stale.text).code, "STALE_KEY_MODAL_VERSION");
    const crossViewer = await post(ackUrl, ids.issuerUserId, { projectionVersion: 2, triggerVersion: 2 });
    assert.equal(crossViewer.response.status, 404);
  } finally {
    const prisma = cleanupPrisma;
    try { if (prisma) await cleanup(prisma, ids); }
    finally {
      if (app) await app.close();
      else if (prisma) await prisma.$disconnect();
    }
  }
});

function identifiers(suffix: string) {
  return {
    templateId: `m4-template-${suffix}`,
    runId: `m4-run-${suffix}`,
    nodeId: `m4-node-${suffix}`,
    issuerUserId: `m4-issuer-user-${suffix}`,
    receiverUserId: `m4-receiver-user-${suffix}`,
    outsiderUserId: `m4-outsider-user-${suffix}`,
    issuerRoleId: `m4-issuer-role-${suffix}`,
    receiverRoleId: `m4-receiver-role-${suffix}`,
    eventId: `evt_${"e".repeat(24)}${suffix.slice(0, 8)}`,
    aggregateId: `agg_${"a".repeat(24)}${suffix.slice(0, 8)}`,
    modalId: `mdl_${"m".repeat(24)}${suffix.slice(0, 8)}`,
    evidenceRef: `fact:promise-evidence:${suffix.slice(0, 8)}`
  };
}

async function seed(prisma: PrismaService, ids: ReturnType<typeof identifiers>) {
  await prisma.worldTemplate.create({ data: { id: ids.templateId, name: "M4 Test", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
  await prisma.user.createMany({ data: [verifiedUser(ids.issuerUserId), verifiedUser(ids.receiverUserId), verifiedUser(ids.outsiderUserId)] });
  await prisma.storyRun.create({ data: {
    id: ids.runId, templateId: ids.templateId, ownerUserId: ids.issuerUserId, title: "M4", hook: "M4", mode: "room",
    templateKey: "sangtian", status: "playing", currentDay: 3, totalDays: 7, maxPlayers: 3, activeHumanCount: 2,
    stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM4: true, aEmotionSimplePromise: true, aEmotionKeyModals: true } },
    visibility: "private", inviteCode: `M4${ids.runId.slice(-8)}`, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2"
  } });
  await prisma.sceneNode.create({ data: { id: ids.nodeId, runId: ids.runId, chapterIndex: 1, nodeIndex: 1, title: "M4", publicNarration: "M4", nodeGoal: "M4", actionOptionsJson: [] } });
  await prisma.storyRun.update({ where: { id: ids.runId }, data: { currentNodeId: ids.nodeId } });
  await prisma.storyRole.createMany({ data: [roleData(ids.runId, ids.issuerRoleId, "issuer", "Issuer"), roleData(ids.runId, ids.receiverRoleId, "receiver", "Receiver")] });
  await prisma.storyPlayer.createMany({ data: [
    { runId: ids.runId, userId: ids.issuerUserId, roleId: ids.issuerRoleId, playerType: "human", status: "active" },
    { runId: ids.runId, userId: ids.receiverUserId, roleId: ids.receiverRoleId, playerType: "human", status: "active" }
  ] });
}

async function publishPromiseBroken(prisma: PrismaService, deliveries: ContinuousEventDeliveryService, ids: ReturnType<typeof identifiers>) {
  await prisma.$transaction(async (tx) => {
    await deliveries.publishProjected(tx, {
      runId: ids.runId,
      nodeId: ids.nodeId,
      day: 3,
      type: A_EMOTION_M4_EVENT_TYPE,
      messageType: "a_emotion_promise_broken",
      visibility: "PRIVATE",
      audienceType: "MEMBER",
      audienceRoleIds: [ids.receiverRoleId],
      eventId: ids.eventId,
      canonicalPayload: {
        schemaVersion: "a_emotion_m4_promise_reveal_canonical_v1",
        promiseId: `prm_${"p".repeat(24)}${ids.eventId.slice(-8)}`,
        sourceResolutionId: `resolution-${ids.eventId.slice(-8)}`,
        brokenByActionId: `action-${ids.eventId.slice(-8)}`,
        lifecycleVersion: 2,
        stateVersion: 2
      },
      deliveries: [{
        userId: ids.receiverUserId,
        roleId: ids.receiverRoleId,
        aggregate: {
          aggregateKey: `aemotion:m4:${ids.runId}:${ids.receiverRoleId}:promise`,
          aggregateId: ids.aggregateId,
          stageId: "stage-3",
          sharedObjectId: A_EMOTION_M4_SHARED_OBJECT_ID,
          eventFamily: A_EMOTION_M4_EVENT_FAMILY,
          category: "RELATED",
          disclosure: "CONFIRMED",
          projectionVersion: 2,
          stateVersion: 2
        },
        buildPayload: (eventSequence, eventId) => promiseProjection(ids, eventSequence, eventId)
      }],
      dedupeKey: `A_EMOTION_M4_TEST:${ids.runId}`
    });
    const modal = promiseModal(ids);
    const validated = validateAEmotionKeyModalV1(modal);
    assert.equal(validated.ok, true, validated.ok ? "" : validated.errors.join("\n"));
    await tx.aEmotionKeyModal.create({ data: {
      id: ids.modalId,
      roomId: ids.runId,
      runId: ids.runId,
      viewerUserId: ids.receiverUserId,
      viewerRoleId: ids.receiverRoleId,
      eventId: ids.eventId,
      modalType: "PROMISE_BROKEN",
      triggerCode: "PROMISE_BROKEN_REVEALED",
      triggerVersion: 2,
      projectionVersion: 2,
      stateVersion: 2,
      priority: 200,
      projectionJson: validated.value
    } });
  });
}

function promiseProjection(ids: ReturnType<typeof identifiers>, eventSequence: number, eventId: string) {
  const projection = {
    schemaVersion: A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
    projectionVersion: 2,
    stateVersion: 2,
    eventSequence,
    aggregateId: ids.aggregateId,
    stageId: "stage-3",
    sharedObjectId: A_EMOTION_M4_SHARED_OBJECT_ID,
    eventFamily: A_EMOTION_M4_EVENT_FAMILY,
    category: "RELATED",
    disclosure: "CONFIRMED",
    severity: "CRITICAL",
    centerCardType: "PROMISE_BROKEN",
    title: "承诺破裂",
    summary: "一项正式承诺已被权威证据确认违背。",
    sourceStatus: "来源与违背事实已确认",
    knownFacts: ["正式承诺存在且仍在期限内", "权威证据确认了承诺违背"],
    visibleImpacts: [],
    responseOptions: [
      { code: "RESPOND_TO_REVEALED_PROMISE", label: "立即回应", preferredEntry: "TALK", targetRoleKey: "issuer", intentKey: "respond_to_revealed_promise", prefillText: "就已确认的承诺违背提出回应。" },
      { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
    ],
    visibleSourceRoleId: ids.issuerRoleId,
    visibleSourceRoleKey: "issuer",
    evidenceRefs: [ids.evidenceRef],
    keyModal: promiseModal(ids),
    occurredAt: "2026-08-10T00:00:00.000Z"
  };
  const validated = validateAEmotionM2ProjectionV1(projection);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.errors.join("\n"));
  assert.equal(eventId, ids.eventId);
  return validated.value;
}

function promiseModal(ids: ReturnType<typeof identifiers>) {
  return {
    schemaVersion: A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
    modalId: ids.modalId,
    eventId: ids.eventId,
    modalType: "PROMISE_BROKEN",
    triggerCode: "PROMISE_BROKEN_REVEALED",
    triggerVersion: 2,
    projectionVersion: 2,
    stateVersion: 2,
    priority: 200,
    title: "承诺破裂",
    summary: "权威证据确认一项正式承诺已被违背。",
    facts: ["承诺双方和期限已登记", "已确认一项有效证据"],
    responseOptions: [
      { code: "RESPOND_TO_REVEALED_PROMISE", label: "立即回应", preferredEntry: "TALK", intentKey: "respond_to_revealed_promise", prefillText: "就已确认的承诺违背提出回应。" },
      { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", intentKey: null, prefillText: null }
    ],
    ariaLive: "assertive",
    occurredAt: "2026-08-10T00:00:00.000Z",
    isShown: false,
    isAcknowledged: false
  } as const;
}

function roleData(runId: string, id: string, roleKey: string, roleName: string) { return { id, runId, roleKey, roleName, identity: roleName, publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], isAiControlled: false, status: "active" }; }
function verifiedUser(id: string) { return { id, openid: `openid-${id}`, email: `${id}@example.test`, emailVerifiedAt: new Date("2026-08-10T00:00:00.000Z"), status: "active" }; }
async function cleanup(prisma: PrismaService, ids: ReturnType<typeof identifiers>) { await prisma.storyRun.deleteMany({ where: { id: ids.runId } }); await prisma.user.deleteMany({ where: { id: { in: [ids.issuerUserId, ids.receiverUserId, ids.outsiderUserId] } } }); await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } }); }
function authHeaders(userId: string) { return { authorization: `Bearer ${issueAccessToken({ id: userId, openid: `openid-${userId}` })}`, accept: "application/json" }; }
async function post(url: string, userId: string, body: unknown) { const response = await fetch(url, { method: "POST", headers: { ...authHeaders(userId), "content-type": "application/json" }, body: JSON.stringify(body) }); return { response, text: await response.text() }; }
function assertNetworkSafe(body: string, ids: ReturnType<typeof identifiers>) { assert.doesNotMatch(body, new RegExp(["sourceActionId", "playerActionId", "rawAudience", "dedupeKey", "canonicalPayload", "sourceResolutionId", "brokenByActionId", ids.outsiderUserId].map(escapeRegex).join("|"), "iu")); }
function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
