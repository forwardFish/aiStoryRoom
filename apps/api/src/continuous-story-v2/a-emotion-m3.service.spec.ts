import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION, isDangerEntry, metricThresholdState } from "@ai-story/shared";
import { A_EMOTION_M3_IMPERIAL_TRUST_RULE } from "../config/a-emotion-m3.config";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { AEmotionM3Service, crisisAggregateIdentity } from "./a-emotion-m3.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M3_TEST_DATABASE_URL);

test("M3 23->18 enters danger once while 18->16 does not retrigger", () => {
  const rule = A_EMOTION_M3_IMPERIAL_TRUST_RULE;
  assert.equal(isDangerEntry(metricThresholdState(rule, 23), metricThresholdState(rule, 18)), true);
  assert.equal(isDangerEntry(metricThresholdState(rule, 18), metricThresholdState(rule, 16)), false);
  assert.equal(isDangerEntry(metricThresholdState(rule, 18), metricThresholdState(rule, 25)), false);
  assert.equal(isDangerEntry(metricThresholdState(rule, 25), metricThresholdState(rule, 18)), true);
});

test("M3 aggregate identity is deterministic and trigger-version scoped", () => {
  const first = crisisAggregateIdentity("run-1", "role-1", "imperial_trust", 1);
  assert.deepEqual(first, crisisAggregateIdentity("run-1", "role-1", "imperial_trust", 1));
  const second = crisisAggregateIdentity("run-1", "role-1", "imperial_trust", 2);
  assert.notEqual(first.aggregateId, second.aggregateId);
  assert.notEqual(first.aggregateKey, second.aggregateKey);
  assert.match(first.aggregateId, /^agg_[A-Za-z0-9_-]{24,}$/u);
});

test("real PostgreSQL M3 ledger records crossing, no-repeat, exit and re-entry atomically", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M3_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  process.env.DATABASE_URL = isolatedDatabaseUrl!;
  process.env.A_EMOTION_M1_ENABLED = "true";
  process.env.A_EMOTION_M2_ENABLED = "true";
  process.env.A_EMOTION_M3_ENABLED = "true";
  process.env.A_EMOTION_KEY_MODALS_ENABLED = "true";
  const suffix = randomUUID().replaceAll("-", "");
  const ids = {
    templateId: `m3s-template-${suffix}`, runId: `m3s-run-${suffix}`, nodeId: `m3s-node-${suffix}`,
    userId: `m3s-user-${suffix}`, roleId: `m3s-role-${suffix}`, actionId: `m3s-action-${suffix}`
  };
  const prisma = new PrismaService();
  const service = new AEmotionM3Service(prisma, new ContinuousEventDeliveryService(prisma));
  try {
    await prisma.$connect();
    await prisma.worldTemplate.create({ data: { id: ids.templateId, name: "M3", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
    await prisma.user.create({ data: { id: ids.userId, openid: `openid-${ids.userId}`, email: `${ids.userId}@example.test`, emailVerifiedAt: new Date(), status: "active" } });
    await prisma.storyRun.create({ data: { id: ids.runId, templateId: ids.templateId, ownerUserId: ids.userId, title: "M3", hook: "M3", mode: "room", templateKey: "sangtian", status: "playing", maxPlayers: 3, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM3: true, aEmotionKeyModals: true } }, visibility: "private", inviteCode: `M3S${suffix.slice(0, 8)}`, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2" } });
    await prisma.sceneNode.create({ data: { id: ids.nodeId, runId: ids.runId, chapterIndex: 1, nodeIndex: 1, title: "M3", publicNarration: "M3", nodeGoal: "M3", actionOptionsJson: [] } });
    await prisma.storyRun.update({ where: { id: ids.runId }, data: { currentNodeId: ids.nodeId } });
    await prisma.storyRole.create({ data: { id: ids.roleId, runId: ids.runId, roleKey: "governor", roleName: "Governor", identity: "Governor", publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], status: "active" } });
    await prisma.storyPlayer.create({ data: { runId: ids.runId, userId: ids.userId, roleId: ids.roleId, playerType: "human", status: "active" } });
    await prisma.playerAction.create({ data: { id: ids.actionId, runId: ids.runId, nodeId: ids.nodeId, chapterIndex: 1, roleId: ids.roleId, playerType: "human", actionType: "main", method: "structured", intent: "structured", riskLevel: "normal", status: "resolved", actionSlot: "MAIN", actionKey: "metric-mutation", visibility: "LIMITED", immediateJson: {}, resolvedJson: {} } });
    const run = { id: ids.runId, currentNodeId: ids.nodeId, mode: "room", maxPlayers: 3, templateKey: "sangtian", engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM3: true, aEmotionKeyModals: true } } };
    const record = (resolution: string, before: number, after: number, stateVersion: number) => prisma.$transaction((tx) => service.recordMetricTransition(tx, { run, targetRoleId: ids.roleId, targetUserId: ids.userId, sourceResolutionId: resolution, sourceActionId: ids.actionId, stageIndex: 2, before, after, stateVersion }));
    const first = await record(`resolution-a-${suffix}`, 23, 18, 1);
    assert.equal(first.outcome, "TRIGGERED");
    assert.ok(first.taskId);
    const replay = await record(`resolution-a-${suffix}`, 23, 18, 1);
    assert.equal(replay.outcome, "REPLAY");
    assert.equal((await record(`resolution-b-${suffix}`, 18, 16, 2)).outcome, "RECORDED");
    assert.equal((await record(`resolution-c-${suffix}`, 16, 25, 3)).outcome, "RECORDED");
    const second = await record(`resolution-d-${suffix}`, 25, 18, 4);
    assert.equal(second.outcome, "TRIGGERED");
    const rows = await prisma.aEmotionMetricTransition.findMany({ where: { runId: ids.runId }, orderBy: { stateVersion: "asc" } });
    assert.deepEqual(rows.map((row) => row.triggerVersion), [1, null, null, 2]);
    assert.equal(await prisma.storyTaskOutbox.count({ where: { runId: ids.runId, taskType: "A_EMOTION_M3_CRISIS_COMPILE" } }), 2);
  } finally {
    await prisma.storyRun.deleteMany({ where: { id: ids.runId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: ids.userId } }).catch(() => undefined);
    await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
