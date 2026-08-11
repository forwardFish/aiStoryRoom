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
import { AEmotionM5Service } from "./a-emotion-m5.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M5_TEST_DATABASE_URL);
const previous = Object.fromEntries(["A_EMOTION_M1_ENABLED", "A_EMOTION_M2_ENABLED", "A_EMOTION_M4_ENABLED", "A_EMOTION_SIMPLE_PROMISE_ENABLED", "A_EMOTION_M5_ENABLED", "A_EMOTION_STAGE_MILESTONES_ENABLED", "A_EMOTION_INTERACTION_HISTORY_ENABLED", "A_EMOTION_KEY_MODALS_ENABLED"].map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  A_EMOTION_M1_ENABLED: "true", A_EMOTION_M2_ENABLED: "true", A_EMOTION_M4_ENABLED: "true",
  A_EMOTION_SIMPLE_PROMISE_ENABLED: "true", A_EMOTION_M5_ENABLED: "true",
  A_EMOTION_STAGE_MILESTONES_ENABLED: "true", A_EMOTION_INTERACTION_HISTORY_ENABLED: "true",
  A_EMOTION_KEY_MODALS_ENABLED: "true"
});
test.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });

@Module({
  controllers: [RoomsController],
  providers: [
    PrismaService, ContinuousEventDeliveryService, AEmotionKeyModalService, AEmotionM5Service, PresenceHeartbeatRateLimitGuard, AuthGuard,
    {
      provide: RoomsService,
      inject: [PrismaService, ContinuousEventDeliveryService, AEmotionKeyModalService, AEmotionM5Service],
      useFactory: (prisma: PrismaService, events: ContinuousEventDeliveryService, modals: AEmotionKeyModalService, m5: AEmotionM5Service) => new RoomsService(
        prisma, null as never, null as never, null as never, null as never, null as never, null as never, null as never,
        events, null as never, null as never, null as never, null as never, null as never, null as never, modals, m5
      )
    }
  ]
})
class M5ProductionHttpTestModule {}

test("production AuthGuard → RoomsController interaction-summary is viewer-safe and role-scoped", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M5_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  process.env.DATABASE_URL = isolatedDatabaseUrl!;
  const suffix = randomUUID().replaceAll("-", "");
  const ids = { template: `m5h-template-${suffix}`, run: `m5h-run-${suffix}`, user: `m5h-user-${suffix}`, outsider: `m5h-outsider-${suffix}`, role: `m5h-role-${suffix}`, node: `m5h-node-${suffix}` };
  let app: Awaited<ReturnType<typeof NestFactory.create>> | null = null;
  let cleanup: PrismaService | null = null;
  try {
    app = await NestFactory.create(M5ProductionHttpTestModule, { logger: false });
    configureApiTransport(app); app.setGlobalPrefix("api");
    const prisma = app.get(PrismaService); cleanup = prisma; await prisma.$connect(); await seed(prisma, ids); await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address(); const port = typeof address === "object" && address ? address.port : 0;
    const token = issueAccessToken({ id: ids.user, openid: `openid-${ids.user}`, status: "active" } as never);
    const outsider = issueAccessToken({ id: ids.outsider, openid: `openid-${ids.outsider}`, status: "active" } as never);
    const request = (userToken: string, roomId = ids.run) => fetch(`http://127.0.0.1:${port}/api/v4/rooms/${roomId}/a-emotion/interaction-summary`, { headers: { authorization: `Bearer ${userToken}`, accept: "application/json" } });
    const response = await request(token); assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.schemaVersion, "a_emotion_m5_interaction_summary_v1"); assert.equal(body.viewerRoleId, ids.role); assert.equal(body.milestones.length, 1);
    const text = JSON.stringify(body); assert.doesNotMatch(text, /sourceRoleId|sourceActionId|playerActionId|dedupeKey|rawAudience|canonicalPayload/u);
    assert.equal((await request(outsider)).status, 403);
    // Membership is checked before room existence to preserve the established
    // anti-enumeration contract for private room-scoped endpoints.
    assert.equal((await request(token, `${ids.run}-missing`)).status, 403);
  } finally {
    if (cleanup) {
      await cleanup.storyRun.deleteMany({ where: { id: ids.run } }).catch(() => undefined);
      await cleanup.user.deleteMany({ where: { id: { in: [ids.user, ids.outsider] } } }).catch(() => undefined);
      await cleanup.worldTemplate.deleteMany({ where: { id: ids.template } }).catch(() => undefined);
    }
    if (app) await app.close(); else if (cleanup) await cleanup.$disconnect();
  }
});

async function seed(prisma: PrismaService, ids: Record<string, string>) {
  await prisma.worldTemplate.create({ data: { id: ids.template, name: "M5", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
  await prisma.user.createMany({ data: [
    { id: ids.user, openid: `openid-${ids.user}`, email: `${ids.user}@example.test`, emailVerifiedAt: new Date(), status: "active" },
    { id: ids.outsider, openid: `openid-${ids.outsider}`, email: `${ids.outsider}@example.test`, emailVerifiedAt: new Date(), status: "active" }
  ] });
  await prisma.storyRun.create({ data: { id: ids.run, templateId: ids.template, ownerUserId: ids.user, title: "M5", hook: "M5", mode: "room", templateKey: "sangtian", status: "playing", maxPlayers: 3, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM4: true, aEmotionSimplePromise: true, aEmotionM5: true, aEmotionStageMilestones: true, aEmotionInteractionHistory: true } }, visibility: "private", inviteCode: `M5H${ids.run.slice(-6)}`, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2" } });
  await prisma.sceneNode.create({ data: { id: ids.node, runId: ids.run, chapterIndex: 1, nodeIndex: 1, title: "M5", publicNarration: "M5", nodeGoal: "M5", actionOptionsJson: [] } });
  await prisma.storyRole.create({ data: { id: ids.role, runId: ids.run, roleKey: "governor", roleName: "Governor", identity: "Governor", publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], status: "active" } });
  await prisma.storyPlayer.create({ data: { runId: ids.run, userId: ids.user, roleId: ids.role, playerType: "human", status: "active" } });
  await prisma.aEmotionStageMilestone.create({ data: { id: `ms_${"a".repeat(32)}`, roomId: ids.run, runId: ids.run, stageId: "stage-4", milestoneCode: "CONTROL_ORIGINAL_LEDGER", beneficiaryRoleId: ids.role, status: "ACHIEVED", stateVersion: 1, evidenceRefsJson: ["fact-code:ORIGINAL_DOCUMENT_CONTROL_CONFIRMED"], rewardJson: { metricKey: "reform_progress", metricDelta: 12, metricBefore: 0, metricAfter: 12, capabilityCodes: ["QUESTION_AUTHORITY"], restrictionCodes: ["OPPONENT_REPORT_CONTROL_RESTRICTED"] }, achievedAt: new Date() } });
}
function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
