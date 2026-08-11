import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { PrismaService } from "../prisma.service";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { aEmotionM4Terms } from "../config/a-emotion-m4.config";
import { AEmotionM4Service, evaluateAEmotionPromiseLifecycle, promiseAggregateIdentity } from "./a-emotion-m4.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M4_TEST_DATABASE_URL);

test("M4 lifecycle is deterministic over canonical codes", () => {
  const terms = aEmotionM4Terms("DELIVER_ORIGINAL_LEDGER");
  assert.equal(evaluateAEmotionPromiseLifecycle(terms, { actionCodes: ["DELIVER_ORIGINAL_LEDGER"], effectCodes: [], factCodes: [] }), "FULFILLED");
  assert.equal(evaluateAEmotionPromiseLifecycle(terms, { actionCodes: [], effectCodes: ["ORIGINAL_LEDGER_WITHHELD"], factCodes: [] }), "BROKEN");
  assert.equal(evaluateAEmotionPromiseLifecycle(terms, { actionCodes: ["UNRELATED"], effectCodes: [], factCodes: [] }), "UNCHANGED");
});

test("M4 aggregate identity is receiver and lifecycle-version scoped", () => {
  const first = promiseAggregateIdentity("run-1", "role-b", `prm_${"a".repeat(32)}`, 2);
  assert.deepEqual(first, promiseAggregateIdentity("run-1", "role-b", `prm_${"a".repeat(32)}`, 2));
  assert.notEqual(first.aggregateId, promiseAggregateIdentity("run-1", "role-b", `prm_${"a".repeat(32)}`, 3).aggregateId);
  assert.match(first.aggregateId, /^agg_[A-Za-z0-9_-]{24,}$/u);
});

test("real PostgreSQL M4 stores one formal promise, breaks on exact codes and reveals only after evidence", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M4_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  process.env.DATABASE_URL = isolatedDatabaseUrl!;
  process.env.A_EMOTION_M1_ENABLED = "true";
  process.env.A_EMOTION_M2_ENABLED = "true";
  process.env.A_EMOTION_M4_ENABLED = "true";
  process.env.A_EMOTION_SIMPLE_PROMISE_ENABLED = "true";
  const suffix = randomUUID().replaceAll("-", "");
  const ids = fixtureIds(suffix);
  const prisma = new PrismaService();
  const service = new AEmotionM4Service(prisma, new ContinuousEventDeliveryService(prisma));
  try {
    await prisma.$connect();
    await seedAuthority(prisma, ids);
    const run = runGate(ids.runId, ids.nodeId);
    const command = {
      schemaVersion: "a_emotion_m4_simple_promise_command_v1",
      idempotencyKey: `promise:${suffix}`,
      promiseCode: "DELIVER_ORIGINAL_LEDGER",
      targetRoleKey: "receiver",
      expectedStage: 2
    };
    const created = await prisma.$transaction((tx) => service.createFromCommittedAction(tx, {
      run,
      sourceResolutionId: ids.resolutionId,
      sourceActionId: ids.actionId,
      issuerRoleId: ids.issuerRoleId,
      receiverRoleId: ids.receiverRoleId,
      stageIndex: 2,
      command
    }));
    assert.equal(created.outcome, "CREATED");
    const replay = await prisma.$transaction((tx) => service.createFromCommittedAction(tx, {
      run,
      sourceResolutionId: ids.resolutionId,
      sourceActionId: ids.actionId,
      issuerRoleId: ids.issuerRoleId,
      receiverRoleId: ids.receiverRoleId,
      stageIndex: 2,
      command
    }));
    assert.equal(replay.outcome, "REPLAY");
    assert.equal(await prisma.commitmentV2.count({ where: { runId: ids.runId, promiseCode: { not: null } } }), 1);

    const broken = await prisma.$transaction((tx) => service.applyAuthoritativeLifecycle(tx, {
      run,
      sourceRoleId: ids.issuerRoleId,
      sourceResolutionId: ids.resolutionId,
      sourceActionId: ids.actionId,
      stageIndex: 3,
      actionCodes: ["WITHHOLD_ORIGINAL_LEDGER"],
      effectCodes: ["ORIGINAL_LEDGER_WITHHELD"],
      factCodes: []
    }));
    assert.equal(broken.updated[0]?.status, "BROKEN");
    assert.equal(await prisma.storyTaskOutbox.count({ where: { runId: ids.runId, taskType: "A_EMOTION_M4_PROMISE_REVEAL_COMPILE" } }), 0);

    await prisma.canonFact.create({ data: {
      id: ids.factId,
      runId: ids.runId,
      sourceNodeId: ids.nodeId,
      factKey: "PROMISE_LEDGER_BREACH_CONFIRMED",
      content: "verified",
      status: "confirmed",
      visibility: "limited",
      sourceEventIdsJson: [],
      sourceActionIdsJson: [ids.actionId],
      knownByRoleIdsJson: [ids.receiverRoleId]
    } });
    const revealed = await prisma.$transaction((tx) => service.revealFromEvidence(tx, {
      run,
      sourceRoleId: ids.receiverRoleId,
      sourceResolutionId: ids.resolutionId,
      sourceActionId: ids.actionId,
      stageIndex: 3,
      factCodes: ["PROMISE_LEDGER_BREACH_CONFIRMED"]
    }));
    assert.equal(revealed[0]?.status, "REVEALED");
    assert.equal(await prisma.storyTaskOutbox.count({ where: { runId: ids.runId, taskType: "A_EMOTION_M4_PROMISE_REVEAL_COMPILE" } }), 1);
  } finally {
    await prisma.storyRun.deleteMany({ where: { id: ids.runId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [ids.issuerUserId, ids.receiverUserId] } } }).catch(() => undefined);
    await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

function fixtureIds(suffix: string) { return {
  templateId: `m4-template-${suffix}`, runId: `m4-run-${suffix}`, nodeId: `m4-node-${suffix}`,
  issuerUserId: `m4-issuer-user-${suffix}`, receiverUserId: `m4-receiver-user-${suffix}`,
  issuerRoleId: `m4-issuer-role-${suffix}`, receiverRoleId: `m4-receiver-role-${suffix}`,
  threadId: `m4-thread-${suffix}`, turnId: `m4-turn-${suffix}`, actionId: `m4-action-${suffix}`,
  submissionId: `m4-submission-${suffix}`, resolutionId: `m4-resolution-${suffix}`, factId: `m4-fact-${suffix}`
}; }
function runGate(runId: string, nodeId: string) { return { id: runId, currentNodeId: nodeId, templateKey: "sangtian", mode: "room", maxPlayers: 3, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM4: true, aEmotionSimplePromise: true, aEmotionKeyModals: true } } }; }
async function seedAuthority(prisma: PrismaService, ids: ReturnType<typeof fixtureIds>) {
  await prisma.worldTemplate.create({ data: { id: ids.templateId, name: "M4", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
  await prisma.user.createMany({ data: [verifiedUser(ids.issuerUserId), verifiedUser(ids.receiverUserId)] });
  await prisma.storyRun.create({ data: { id: ids.runId, templateId: ids.templateId, ownerUserId: ids.issuerUserId, title: "M4", hook: "M4", mode: "room", templateKey: "sangtian", status: "playing", currentDay: 2, maxPlayers: 3, stateJson: runGate(ids.runId, ids.nodeId).stateJson, visibility: "private", inviteCode: `M4${ids.runId.slice(-8)}`, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2" } });
  await prisma.sceneNode.create({ data: { id: ids.nodeId, runId: ids.runId, chapterIndex: 1, nodeIndex: 1, title: "M4", publicNarration: "M4", nodeGoal: "M4", actionOptionsJson: [] } });
  await prisma.storyRun.update({ where: { id: ids.runId }, data: { currentNodeId: ids.nodeId } });
  await prisma.storyRole.createMany({ data: [role(ids.runId, ids.issuerRoleId, "issuer"), role(ids.runId, ids.receiverRoleId, "receiver")] });
  await prisma.storyPlayer.createMany({ data: [
    { runId: ids.runId, userId: ids.issuerUserId, roleId: ids.issuerRoleId, playerType: "human", status: "active" },
    { runId: ids.runId, userId: ids.receiverUserId, roleId: ids.receiverRoleId, playerType: "human", status: "active" }
  ] });
  await prisma.actorThread.create({ data: { id: ids.threadId, runId: ids.runId, roleId: ids.issuerRoleId } });
  await prisma.actorTurn.create({ data: { id: ids.turnId, runId: ids.runId, threadId: ids.threadId, roleId: ids.issuerRoleId, stageIndex: 2, turnIndex: 1, status: "RESOLVED", baseWorldSequence: 0, situationTitle: "M4", situationNarrative: "M4", visibleFactKeysJson: [], activeThreadKeysJson: [], contextJson: {}, qualityStatus: "PASS", dedupeKey: `turn:${ids.turnId}` } });
  await prisma.playerAction.create({ data: { id: ids.actionId, runId: ids.runId, nodeId: ids.nodeId, chapterIndex: 1, userId: ids.issuerUserId, roleId: ids.issuerRoleId, playerType: "human", actionType: "conversation", method: "structured", intent: "structured", riskLevel: "normal", status: "resolved", actionSlot: "TURN", actionKey: "FORMAL_PROMISE", visibility: "LIMITED", immediateJson: {}, resolvedJson: {} } });
  await prisma.decisionSubmission.create({ data: { id: ids.submissionId, runId: ids.runId, threadId: ids.threadId, turnId: ids.turnId, roleId: ids.issuerRoleId, userId: ids.issuerUserId, playerActionId: ids.actionId, normalizedActionJson: { decisionForm: "CONVERSATION" }, rawIntentJson: {}, normalizedIntentJson: {}, guardDecisionJson: {}, selectedLeverageKeysJson: [], controlEpoch: 1, idempotencyKey: `submission:${ids.submissionId}`, requestHash: ids.submissionId, status: "RESOLVED", resolvedAt: new Date() } });
  await prisma.actionResolution.create({ data: { id: ids.resolutionId, runId: ids.runId, threadId: ids.threadId, turnId: ids.turnId, submissionId: ids.submissionId, roleId: ids.issuerRoleId, playerActionId: ids.actionId, baseWorldSequence: 0, appliedWorldSequence: 1, outcomeJson: {}, statePatchJson: {}, resultNarrative: "result", nextHook: "next", qualityStatus: "PASS" } });
}
function role(runId: string, id: string, roleKey: string) { return { id, runId, roleKey, roleName: roleKey, identity: roleKey, publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], status: "active" }; }
function verifiedUser(id: string) { return { id, openid: `openid-${id}`, email: `${id}@example.test`, emailVerifiedAt: new Date("2026-08-10T00:00:00.000Z"), status: "active" }; }
function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
