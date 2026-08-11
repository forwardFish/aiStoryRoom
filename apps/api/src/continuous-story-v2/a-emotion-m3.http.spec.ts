import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { configureApiTransport, PresenceHeartbeatRateLimitGuard } from "../api-transport";
import { AuthGuard } from "../auth/auth.guard";
import { issueAccessToken } from "../auth/auth.service";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { RoomsController } from "../rooms.controller";
import { RoomsService } from "../rooms.service";
import { AEmotionKeyModalService } from "./a-emotion-key-modal.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M3_TEST_DATABASE_URL);
const previous = {
  m1: process.env.A_EMOTION_M1_ENABLED,
  m2: process.env.A_EMOTION_M2_ENABLED,
  m3: process.env.A_EMOTION_M3_ENABLED,
  modals: process.env.A_EMOTION_KEY_MODALS_ENABLED
};
process.env.A_EMOTION_M1_ENABLED = "true";
process.env.A_EMOTION_M2_ENABLED = "true";
process.env.A_EMOTION_M3_ENABLED = "true";
process.env.A_EMOTION_KEY_MODALS_ENABLED = "true";

test.after(() => {
  restore("A_EMOTION_M1_ENABLED", previous.m1);
  restore("A_EMOTION_M2_ENABLED", previous.m2);
  restore("A_EMOTION_M3_ENABLED", previous.m3);
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
class M3ProductionEventsTestModule {}

test("production AuthGuard → RoomsController exposes one viewer-safe CRISIS modal with durable shown/ack receipts", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M3_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  process.env.DATABASE_URL = isolatedDatabaseUrl!;
  const suffix = randomUUID().replaceAll("-", "");
  const ids = identifiers(suffix);
  let app: Awaited<ReturnType<typeof NestFactory.create>> | null = null;
  let cleanupPrisma: PrismaService | null = null;
  try {
    app = await NestFactory.create(M3ProductionEventsTestModule, { logger: false });
    configureApiTransport(app);
    app.setGlobalPrefix("api");
    const prisma = app.get(PrismaService);
    cleanupPrisma = prisma;
    await prisma.$connect();
    await app.listen(0, "127.0.0.1");
    await seed(prisma, ids);

    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}/api/v4/rooms/${encodeURIComponent(ids.runId)}`;

    const governor = await fetch(`${base}/events?afterDeliverySequence=0&interactionLimit=10`, { headers: authHeaders(ids.governorUserId) });
    assert.equal(governor.status, 200);
    const governorText = await governor.text();
    assertNetworkSafe(governorText, ids);
    const governorJson = JSON.parse(governorText);
    assert.equal(governorJson.keyModals.length, 1);
    assert.equal(governorJson.keyModals[0].modalId, ids.modalId);
    assert.equal(governorJson.keyModals[0].modalType, "CRISIS");
    assert.equal(governorJson.keyModals[0].ariaLive, "assertive");

    const county = await fetch(`${base}/events?afterDeliverySequence=0&interactionLimit=10`, { headers: authHeaders(ids.countyUserId) });
    assert.equal(county.status, 200);
    const countyJson = await county.json();
    assert.equal(countyJson.keyModals, undefined);

    const outsider = await fetch(`${base}/events?afterDeliverySequence=0&interactionLimit=10`, { headers: authHeaders(ids.outsiderUserId) });
    assert.equal(outsider.status, 403);

    const shownUrl = `${base}/a-emotion/modals/${encodeURIComponent(ids.modalId)}/shown`;
    const shownFirst = await post(shownUrl, ids.governorUserId, { projectionVersion: 1, triggerVersion: 1 });
    assert.equal(shownFirst.response.status, 201);
    assertNetworkSafe(shownFirst.text, ids);
    const shownFirstJson = JSON.parse(shownFirst.text);
    assert.ok(shownFirstJson.shownAt);
    assert.equal(shownFirstJson.acknowledgedAt, null);
    const shownSecond = await post(shownUrl, ids.governorUserId, { projectionVersion: 1, triggerVersion: 1 });
    assert.equal(shownSecond.response.status, 201);
    assert.equal(JSON.parse(shownSecond.text).shownAt, shownFirstJson.shownAt);

    const afterShown = await fetch(`${base}/events?afterDeliverySequence=0&interactionLimit=10`, { headers: authHeaders(ids.governorUserId) });
    assert.equal(afterShown.status, 200);
    assert.equal((await afterShown.json()).keyModals, undefined, "shown modal is not replayed on refresh");

    const ackUrl = `${base}/a-emotion/modals/${encodeURIComponent(ids.modalId)}/ack`;
    const ackFirst = await post(ackUrl, ids.governorUserId, { projectionVersion: 1, triggerVersion: 1 });
    assert.equal(ackFirst.response.status, 201);
    const ackFirstJson = JSON.parse(ackFirst.text);
    assert.ok(ackFirstJson.acknowledgedAt);
    const ackSecond = await post(ackUrl, ids.governorUserId, { projectionVersion: 1, triggerVersion: 1 });
    assert.equal(ackSecond.response.status, 201);
    assert.equal(JSON.parse(ackSecond.text).acknowledgedAt, ackFirstJson.acknowledgedAt);

    const stale = await post(ackUrl, ids.governorUserId, { projectionVersion: 2, triggerVersion: 1 });
    assert.equal(stale.response.status, 409);
    assert.equal(JSON.parse(stale.text).code, "STALE_KEY_MODAL_VERSION");
    const crossViewer = await post(ackUrl, ids.countyUserId, { projectionVersion: 1, triggerVersion: 1 });
    assert.equal(crossViewer.response.status, 404);
    assertNetworkSafe(crossViewer.text, ids);
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
    templateId: `m3-template-${suffix}`,
    runId: `m3-run-${suffix}`,
    governorUserId: `m3-governor-user-${suffix}`,
    countyUserId: `m3-county-user-${suffix}`,
    outsiderUserId: `m3-outsider-user-${suffix}`,
    governorRoleId: `m3-governor-role-${suffix}`,
    countyRoleId: `m3-county-role-${suffix}`,
    eventId: `evt_${"e".repeat(24)}${suffix.slice(0, 8)}`,
    modalId: `mdl_${"m".repeat(24)}${suffix.slice(0, 8)}`
  };
}

async function seed(prisma: PrismaService, ids: ReturnType<typeof identifiers>) {
  await prisma.worldTemplate.create({ data: { id: ids.templateId, name: "M3 Test", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
  await prisma.user.createMany({ data: [verifiedUser(ids.governorUserId), verifiedUser(ids.countyUserId), verifiedUser(ids.outsiderUserId)] });
  await prisma.storyRun.create({ data: {
    id: ids.runId, templateId: ids.templateId, ownerUserId: ids.governorUserId, title: "M3", hook: "M3", mode: "room",
    templateKey: "sangtian", status: "playing", currentDay: 2, totalDays: 7, maxPlayers: 3, activeHumanCount: 2,
    stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM3: true, aEmotionKeyModals: true } },
    visibility: "private", inviteCode: `M3${ids.runId.slice(-8)}`, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2"
  } });
  await prisma.storyRole.createMany({ data: [roleData(ids.runId, ids.governorRoleId, "zhejiang_governor", "浙江总督"), roleData(ids.runId, ids.countyRoleId, "county_magistrate", "县令")] });
  await prisma.storyPlayer.createMany({ data: [
    { runId: ids.runId, userId: ids.governorUserId, roleId: ids.governorRoleId, playerType: "human", status: "active" },
    { runId: ids.runId, userId: ids.countyUserId, roleId: ids.countyRoleId, playerType: "human", status: "active" }
  ] });
  await prisma.aEmotionKeyModal.create({ data: {
    id: ids.modalId, roomId: ids.runId, runId: ids.runId, viewerUserId: ids.governorUserId, viewerRoleId: ids.governorRoleId,
    eventId: ids.eventId, modalType: "CRISIS", triggerCode: "LOSE_REFORM_AUTHORITY_RISK", triggerVersion: 1,
    projectionVersion: 1, stateVersion: 9, priority: 300, projectionJson: modalProjection(ids)
  } });
}
function modalProjection(ids: ReturnType<typeof identifiers>) { return {
  schemaVersion: "a_emotion_key_modal_v1", modalId: ids.modalId, eventId: ids.eventId, modalType: "CRISIS",
  triggerCode: "LOSE_REFORM_AUTHORITY_RISK", triggerVersion: 1, projectionVersion: 1, stateVersion: 9,
  priority: 300, title: "你正在失去主持权", summary: "皇帝信任已进入危险区。",
  facts: ["皇帝信任当前为 18", "危险线为 20"],
  responseOptions: [{ code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", intentKey: null, prefillText: null }],
  ariaLive: "assertive", occurredAt: "2026-08-10T00:00:00.000Z",
  isShown: false, isAcknowledged: false
}; }
function roleData(runId: string, id: string, roleKey: string, roleName: string) { return { id, runId, roleKey, roleName, identity: roleName, publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], isAiControlled: false, status: "active" }; }
function verifiedUser(id: string) { return { id, openid: `openid-${id}`, email: `${id}@example.test`, emailVerifiedAt: new Date("2026-08-10T00:00:00.000Z"), status: "active" }; }
async function cleanup(prisma: PrismaService, ids: ReturnType<typeof identifiers>) { await prisma.storyRun.deleteMany({ where: { id: ids.runId } }); await prisma.user.deleteMany({ where: { id: { in: [ids.governorUserId, ids.countyUserId, ids.outsiderUserId] } } }); await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } }); }
function authHeaders(userId: string) { return { authorization: `Bearer ${issueAccessToken({ id: userId, openid: `openid-${userId}` })}`, accept: "application/json" }; }
async function post(url: string, userId: string, body: unknown) { const response = await fetch(url, { method: "POST", headers: { ...authHeaders(userId), "content-type": "application/json" }, body: JSON.stringify(body) }); return { response, text: await response.text() }; }
function assertNetworkSafe(body: string, ids: ReturnType<typeof identifiers>) { assert.doesNotMatch(body, new RegExp(["sourceRoleId", "sourceRoleKey", "sourceActionId", "playerActionId", "rawAudience", "dedupeKey", "canonicalPayload", ids.countyRoleId].map(escapeRegex).join("|"), "iu")); }
function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
