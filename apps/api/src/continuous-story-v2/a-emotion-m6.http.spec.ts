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
import { buildAEmotionM6RoomPolicy } from "../config/a-emotion-m6.config";
import { defaultPauseState } from "../config/a-emotion-room-flags";
import { AEmotionM6Service } from "./a-emotion-m6.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M6_TEST_DATABASE_URL);
const previous = Object.fromEntries(["A_EMOTION_M6_ENABLED", "A_EMOTION_M6_RECOVERY_ENABLED"].map((key) => [key, process.env[key]]));
Object.assign(process.env, { A_EMOTION_M6_ENABLED: "true", A_EMOTION_M6_RECOVERY_ENABLED: "true" });
test.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });

@Module({
  controllers: [RoomsController],
  providers: [
    PrismaService, ContinuousEventDeliveryService, AEmotionM6Service, PresenceHeartbeatRateLimitGuard, AuthGuard,
    {
      provide: RoomsService,
      inject: [PrismaService, ContinuousEventDeliveryService, AEmotionM6Service],
      useFactory: (prisma: PrismaService, events: ContinuousEventDeliveryService, m6: AEmotionM6Service) => new RoomsService(
        prisma, null as never, null as never, null as never, null as never, null as never, null as never, null as never,
        events, null as never, null as never, null as never, null as never, null as never, null as never, undefined, undefined, m6
      )
    }
  ]
})
class M6ProductionHttpTestModule {}

test("production AuthGuard recovery status pause and resume are host-only and version-fenced", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M6_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  process.env.DATABASE_URL = isolatedDatabaseUrl!;
  const suffix = randomUUID().replaceAll("-", "");
  const ids = { template: `m6h-template-${suffix}`, run: `m6h-run-${suffix}`, host: `m6h-host-${suffix}`, member: `m6h-member-${suffix}`, outsider: `m6h-outsider-${suffix}`, hostRole: `m6h-role-host-${suffix}`, memberRole: `m6h-role-member-${suffix}` };
  let app: Awaited<ReturnType<typeof NestFactory.create>> | null = null;
  let cleanup: PrismaService | null = null;
  try {
    app = await NestFactory.create(M6ProductionHttpTestModule, { logger: false });
    configureApiTransport(app); app.setGlobalPrefix("api");
    const prisma = app.get(PrismaService); cleanup = prisma; await prisma.$connect(); await seed(prisma, ids); await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address(); const port = typeof address === "object" && address ? address.port : 0;
    const tokens = Object.fromEntries([ids.host, ids.member, ids.outsider].map((id) => [id, issueAccessToken({ id, openid: `openid-${id}`, status: "active" } as never)]));
    const request = (userId: string, method: string, path: string, body?: unknown) => fetch(`http://127.0.0.1:${port}/api/v4/rooms/${ids.run}${path}`, { method, headers: { authorization: `Bearer ${tokens[userId]}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const status = await request(ids.member, "GET", "/a-emotion/recovery/status"); assert.equal(status.status, 200); const initial = await status.json(); assert.equal(initial.enabled, true); assert.equal(initial.paused, false);
    assert.equal((await request(ids.outsider, "GET", "/a-emotion/recovery/status")).status, 403);
    assert.equal((await request(ids.member, "POST", "/a-emotion/recovery/pause", { expectedVersion: initial.version, reason: "test" })).status, 403);
    const pausedResponse = await request(ids.host, "POST", "/a-emotion/recovery/pause", { expectedVersion: initial.version, reason: "test-pause" }); assert.equal(pausedResponse.status, 201); const paused = await pausedResponse.json(); assert.equal(paused.paused, true);
    const stale = await request(ids.host, "POST", "/a-emotion/recovery/resume", { expectedVersion: initial.version, reason: "stale" }); assert.equal(stale.status, 409); const staleBody = await stale.json(); assert.equal(staleBody.code, "A_EMOTION_M6_RUN_VERSION_MISMATCH");
    const resumedResponse = await request(ids.host, "POST", "/a-emotion/recovery/resume", { expectedVersion: paused.runVersion, reason: "test-resume" }); assert.equal(resumedResponse.status, 201); const resumed = await resumedResponse.json(); assert.equal(resumed.paused, false);
    const final = await request(ids.member, "GET", "/a-emotion/recovery/status"); assert.equal(final.status, 200); assert.equal((await final.json()).paused, false);
  } finally {
    if (cleanup) {
      await cleanup.storyRun.deleteMany({ where: { id: ids.run } }).catch(() => undefined);
      await cleanup.user.deleteMany({ where: { id: { in: [ids.host, ids.member, ids.outsider] } } }).catch(() => undefined);
      await cleanup.worldTemplate.deleteMany({ where: { id: ids.template } }).catch(() => undefined);
    }
    if (app) await app.close(); else if (cleanup) await cleanup.$disconnect();
  }
});

async function seed(prisma: PrismaService, ids: Record<string, string>) {
  await prisma.worldTemplate.create({ data: { id: ids.template, name: "M6", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
  await prisma.user.createMany({ data: [ids.host, ids.member, ids.outsider].map((id) => ({ id, openid: `openid-${id}`, email: `${id}@example.test`, emailVerifiedAt: new Date(), status: "active" })) });
  const frozenAt = new Date("2026-08-10T00:00:00.000Z");
  await prisma.storyRun.create({ data: { id: ids.run, templateId: ids.template, ownerUserId: ids.host, title: "M6", hook: "M6", mode: "room", templateKey: "sangtian", status: "playing", maxPlayers: 3, stateJson: { aEmotionRuleset: buildAEmotionM6RoomPolicy({ m1Enabled: true, m2Enabled: true, m3Enabled: true, m4Enabled: true, m5Enabled: true, m6Enabled: true, pollIntervalMs: 7_000, frozenAt }), aEmotionM6Recovery: defaultPauseState(frozenAt), featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM3: true, aEmotionKeyModals: true, aEmotionM4: true, aEmotionSimplePromise: true, aEmotionM5: true, aEmotionStageMilestones: true, aEmotionInteractionHistory: true, aEmotionM6: true, aEmotionRecovery: true, aEmotionPollIntervalMs: 7000 } }, visibility: "private", inviteCode: `M6H${ids.run.slice(-6)}`, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2" } });
  await prisma.storyRole.createMany({ data: [
    { id: ids.hostRole, runId: ids.run, roleKey: "host", roleName: "Host", identity: "Host", publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], status: "active" },
    { id: ids.memberRole, runId: ids.run, roleKey: "member", roleName: "Member", identity: "Member", publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], status: "active" }
  ] });
  await prisma.storyPlayer.createMany({ data: [
    { runId: ids.run, userId: ids.host, roleId: ids.hostRole, playerType: "human", status: "active" },
    { runId: ids.run, userId: ids.member, roleId: ids.memberRole, playerType: "human", status: "active" }
  ] });
}
function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
