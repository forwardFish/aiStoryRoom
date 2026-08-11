import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { aEmotionM5Rules } from "../config/a-emotion-m5.config";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { AEmotionM5Service, evaluateAEmotionStageMilestone, stageMilestoneIdentity } from "./a-emotion-m5.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M5_TEST_DATABASE_URL);

const enabledEnv = {
  A_EMOTION_M1_ENABLED: "true",
  A_EMOTION_M2_ENABLED: "true",
  A_EMOTION_M4_ENABLED: "true",
  A_EMOTION_SIMPLE_PROMISE_ENABLED: "true",
  A_EMOTION_M5_ENABLED: "true",
  A_EMOTION_STAGE_MILESTONES_ENABLED: "true",
  A_EMOTION_INTERACTION_HISTORY_ENABLED: "true"
};

test("M5 original-ledger control ignores synthetic codes and other milestones remain exact-code deterministic", () => {
  const control = aEmotionM5Rules().find((item) => item.milestoneCode === "CONTROL_ORIGINAL_LEDGER");
  const momentum = aEmotionM5Rules().find((item) => item.milestoneCode === "RESTORE_REFORM_MOMENTUM");
  assert.ok(control);
  assert.ok(momentum);
  assert.equal(evaluateAEmotionStageMilestone(control, {
    actionCodes: ["CONTROL_ORIGINAL_DOCUMENT"],
    effectCodes: ["ORIGINAL_DOCUMENT_CONTROL_ESTABLISHED"],
    factCodes: ["ORIGINAL_DOCUMENT_CONTROL_CONFIRMED"]
  }), "UNCHANGED");
  assert.equal(evaluateAEmotionStageMilestone(control, {
    actionCodes: ["SURRENDER_ORIGINAL_DOCUMENT_CONTROL"],
    effectCodes: ["ORIGINAL_DOCUMENT_CONTROL_LOST"],
    factCodes: ["ORIGINAL_DOCUMENT_CONTROL_REVOKED"]
  }), "UNCHANGED");
  assert.equal(evaluateAEmotionStageMilestone(momentum, {
    actionCodes: ["RESTORE_REFORM_MOMENTUM"],
    effectCodes: ["REFORM_MOMENTUM_RESTORED"],
    factCodes: ["REFORM_MOMENTUM_RESTORATION_CONFIRMED"]
  }), "ACHIEVE");
  assert.equal(evaluateAEmotionStageMilestone(control, {
    actionCodes: ["自由文本说我控制了原册"], effectCodes: [], factCodes: []
  }), "UNCHANGED");
});

test("M5 milestone identity is deterministic, stage-scoped and opaque", () => {
  const first = stageMilestoneIdentity("run-1", "stage-4", "CONTROL_ORIGINAL_LEDGER", "role-1");
  assert.deepEqual(first, stageMilestoneIdentity("run-1", "stage-4", "CONTROL_ORIGINAL_LEDGER", "role-1"));
  assert.notEqual(first.milestoneId, stageMilestoneIdentity("run-1", "stage-5", "CONTROL_ORIGINAL_LEDGER", "role-1").milestoneId);
  assert.match(first.milestoneId, /^ms_[A-Za-z0-9_-]{24,}$/u);
  assert.match(first.aggregateId, /^agg_[A-Za-z0-9_-]{24,}$/u);
  assert.doesNotMatch(first.milestoneId, /run-1|role-1|CONTROL_ORIGINAL_LEDGER/u);
});

test("real PostgreSQL M5 achieves once, persists reward, publishes one viewer event and revokes without replaying victory", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M5_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  Object.assign(process.env, enabledEnv, { DATABASE_URL: isolatedDatabaseUrl! });
  const suffix = randomUUID().replaceAll("-", "");
  const ids = {
    templateId: `m5-template-${suffix}`, runId: `m5-run-${suffix}`, nodeId: `m5-node-${suffix}`,
    userId: `m5-user-${suffix}`, roleId: `m5-role-${suffix}`, otherRoleId: `m5-other-role-${suffix}`, actionId: `m5-action-${suffix}`,
    assetId: `m5-custody-asset-${suffix}`, threadId: `thread-${suffix}`, turnId: `turn-${suffix}`, revokeTurnId: `turn-revoke-${suffix}`, revokeNodeId: `m5-node-revoke-${suffix}`,
    resolutionId: `m5-resolution-${suffix}`
  };
  const prisma = new PrismaService();
  const service = new AEmotionM5Service(prisma, new ContinuousEventDeliveryService(prisma));
  try {
    await prisma.$connect();
    await prisma.worldTemplate.create({ data: { id: ids.templateId, name: "M5", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
    await prisma.user.create({ data: { id: ids.userId, openid: `openid-${ids.userId}`, email: `${ids.userId}@example.test`, emailVerifiedAt: new Date(), status: "active" } });
    await prisma.storyRun.create({ data: { id: ids.runId, templateId: ids.templateId, ownerUserId: ids.userId, title: "M5", hook: "M5", mode: "room", templateKey: "sangtian", status: "playing", maxPlayers: 3, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM4: true, aEmotionSimplePromise: true, aEmotionM5: true, aEmotionStageMilestones: true, aEmotionInteractionHistory: true }, aEmotionM5: { stateVersion: 0, metrics: { [ids.roleId]: { reform_progress: 0 } }, capabilities: {}, restrictions: {} } }, visibility: "private", inviteCode: `M5${suffix.slice(0, 8)}`, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2" } });
    await prisma.sceneNode.create({ data: { id: ids.nodeId, runId: ids.runId, chapterIndex: 2, nodeIndex: 1, title: "M5", publicNarration: "M5", nodeGoal: "M5", actionOptionsJson: [] } });
    await prisma.storyRun.update({ where: { id: ids.runId }, data: { currentNodeId: ids.nodeId } });
    await prisma.storyRole.createMany({ data: [
      { id: ids.roleId, runId: ids.runId, roleKey: "zhejiang_governor", roleName: "Governor", identity: "Governor", publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], status: "active" },
      { id: ids.otherRoleId, runId: ids.runId, roleKey: "xunfu", roleName: "Xunfu", identity: "Xunfu", publicInfo: "test", personalGoal: "test", currentState: "test", knownInfoJson: [], cannotDoJson: [], status: "active" }
    ] });
    await prisma.storyPlayer.create({ data: { runId: ids.runId, userId: ids.userId, roleId: ids.roleId, playerType: "human", status: "active" } });
    await prisma.playerAction.create({ data: { id: ids.actionId, runId: ids.runId, nodeId: ids.nodeId, chapterIndex: 2, roleId: ids.roleId, playerType: "human", actionType: "main", method: "structured", intent: "structured", riskLevel: "normal", status: "resolved", actionSlot: "MAIN", actionKey: "main_s2_governor_dual_verification", visibility: "LIMITED", immediateJson: {}, resolvedJson: {} } });
    await prisma.actorThread.create({ data: { id: ids.threadId, runId: ids.runId, roleId: ids.roleId, status: "ACTIVE" } });
    await prisma.actorTurn.create({ data: { id: ids.turnId, runId: ids.runId, threadId: ids.threadId, roleId: ids.roleId, stageIndex: 2, turnIndex: 2, status: "RESOLVED", baseWorldSequence: 0, situationTitle: "M5", situationNarrative: "M5", visibleFactKeysJson: [], activeThreadKeysJson: [], contextJson: {}, qualityStatus: "PASS", dedupeKey: `turn:${suffix}` } });
    await prisma.decisionSubmission.create({ data: { id: `submission-${suffix}`, runId: ids.runId, threadId: ids.threadId, turnId: ids.turnId, roleId: ids.roleId, userId: ids.userId, playerActionId: ids.actionId, normalizedActionJson: {}, controlEpoch: 1, idempotencyKey: `submission:${suffix}`, requestHash: `hash-${suffix}`, status: "COMMITTED", resolvedAt: new Date() } });
    await prisma.actionResolution.create({ data: { id: ids.resolutionId, runId: ids.runId, threadId: ids.threadId, turnId: ids.turnId, submissionId: `submission-${suffix}`, playerActionId: ids.actionId, roleId: ids.roleId, baseWorldSequence: 0, appliedWorldSequence: 1, outcomeJson: {}, statePatchJson: {}, resultNarrative: "done", nextHook: "continue", qualityStatus: "PASS" } });
    await prisma.roleAsset.create({ data: { id: ids.assetId, runId: ids.runId, assetKey: "asset_s2_document_custody", kind: "CONTESTED_AUTHORITY", ownerRoleId: ids.roleId, quantity: 1, status: "ACTIVE", visibility: "PRIVATE", stateJson: { stageIndex: 2 } } });
    await prisma.roleAssetMutation.create({ data: { assetId: ids.assetId, actionId: ids.actionId, mutationType: "CLAIM", delta: 1, fromRoleId: null, toRoleId: ids.roleId, beforeJson: { ownerRoleId: null, quantity: 0, status: "AVAILABLE" }, afterJson: { ownerRoleId: ids.roleId, quantity: 1, status: "ACTIVE" }, idempotencyKey: `m5-custody-claim:${suffix}` } });
    const run = await prisma.storyRun.findUniqueOrThrow({ where: { id: ids.runId } });
    const achieve = () => prisma.$transaction((tx) => service.applyAuthoritativeMilestones(tx, { run: { ...run, currentNodeId: ids.nodeId }, beneficiaryRoleId: ids.roleId, sourceResolutionId: ids.resolutionId, sourceActionId: ids.actionId, stageIndex: 2, actionCodes: ["main_s2_governor_dual_verification"], effectCodes: ["effect_main_s2_governor_dual_verification"], factCodes: ["fact_s2_governor_dual_verification"] }));
    assert.equal((await achieve()).outcome, "UPDATED");
    assert.equal((await achieve()).updated[0]?.status, "ACHIEVED");
    assert.equal(await prisma.aEmotionStageMilestone.count({ where: { runId: ids.runId } }), 1);
    assert.equal(await prisma.storyTaskOutbox.count({ where: { runId: ids.runId, taskType: "A_EMOTION_M5_STAGE_MILESTONE_COMPILE" } }), 1);
    const task = await prisma.storyTaskOutbox.findFirstOrThrow({ where: { runId: ids.runId, taskType: "A_EMOTION_M5_STAGE_MILESTONE_COMPILE" } });
    await prisma.storyTaskOutbox.update({ where: { id: task.id }, data: { status: "RUNNING", leaseOwner: "m5-test", leaseVersion: 1, leaseExpiresAt: new Date(Date.now() + 60_000) } });
    const published = await service.executeCompileTask(task.id, { taskId: task.id, leaseOwner: "m5-test", leaseVersion: 1 });
    assert.equal(published.outcome, "PUBLISHED");
    assert.equal(await prisma.eventDelivery.count({ where: { roomId: ids.runId, userId: ids.userId } }), 1);
    assert.equal(await prisma.aEmotionKeyModal.count({ where: { runId: ids.runId, modalType: "STAGE_VICTORY" } }), 1);
    const state = await prisma.storyRun.findUniqueOrThrow({ where: { id: ids.runId }, select: { stateJson: true } });
    assert.equal(Number((state.stateJson as any).aEmotionM5.metrics[ids.roleId].reform_progress), 12);
    const revokeResolution = `${ids.resolutionId}-revoke`;
    const revokeAction = `${ids.actionId}-revoke`;
    assert.notEqual(ids.revokeNodeId, ids.nodeId);
    await prisma.sceneNode.create({ data: { id: ids.revokeNodeId, runId: ids.runId, chapterIndex: 2, nodeIndex: 2, title: "M5 revoke", publicNarration: "M5 revoke", nodeGoal: "M5 revoke", actionOptionsJson: [] } });
    await prisma.storyRun.update({ where: { id: ids.runId }, data: { currentNodeId: ids.revokeNodeId } });
    await prisma.playerAction.create({ data: { id: revokeAction, runId: ids.runId, nodeId: ids.revokeNodeId, chapterIndex: 2, roleId: ids.roleId, playerType: "human", actionType: "main", method: "structured", intent: "structured", riskLevel: "normal", status: "resolved", actionSlot: "MAIN", actionKey: "custom:transfer-original-ledger-custody", visibility: "LIMITED", immediateJson: {}, resolvedJson: {} } });
    await prisma.actorTurn.create({ data: { id: ids.revokeTurnId, runId: ids.runId, threadId: ids.threadId, roleId: ids.roleId, stageIndex: 2, turnIndex: 3, status: "RESOLVED", baseWorldSequence: 1, situationTitle: "M5 revoke", situationNarrative: "M5 revoke", visibleFactKeysJson: [], activeThreadKeysJson: [], contextJson: {}, qualityStatus: "PASS", dedupeKey: `turn-revoke:${suffix}` } });
    await prisma.decisionSubmission.create({ data: { id: `submission-revoke-${suffix}`, runId: ids.runId, threadId: ids.threadId, turnId: ids.revokeTurnId, roleId: ids.roleId, userId: ids.userId, playerActionId: revokeAction, normalizedActionJson: {}, controlEpoch: 1, idempotencyKey: `submission-revoke:${suffix}`, requestHash: `hash-revoke-${suffix}`, status: "COMMITTED", resolvedAt: new Date() } });
    await prisma.actionResolution.create({ data: { id: revokeResolution, runId: ids.runId, threadId: ids.threadId, turnId: ids.revokeTurnId, submissionId: `submission-revoke-${suffix}`, playerActionId: revokeAction, roleId: ids.roleId, baseWorldSequence: 1, appliedWorldSequence: 2, outcomeJson: {}, statePatchJson: {}, resultNarrative: "revoked", nextHook: "continue", qualityStatus: "PASS" } });
    const actionContexts = await prisma.playerAction.findMany({
      where: { id: { in: [ids.actionId, revokeAction] } },
      select: { id: true, nodeId: true, roleId: true, actionSlot: true },
      orderBy: { id: "asc" }
    });
    assert.equal(actionContexts.length, 2);
    assert.notEqual(actionContexts[0]?.nodeId, actionContexts[1]?.nodeId);
    assert.equal(actionContexts.every((item) => item.roleId === ids.roleId && item.actionSlot === "MAIN"), true);
    const custodyBeforeTransfer = await prisma.roleAsset.findUniqueOrThrow({ where: { id: ids.assetId } });
    await prisma.roleAsset.update({ where: { id: ids.assetId }, data: { ownerRoleId: ids.otherRoleId, stateJson: { stageIndex: 2, lastDisposition: "TRANSFER", lastUsedByActionId: revokeAction }, version: { increment: 1 } } });
    await prisma.roleAssetMutation.create({ data: { assetId: ids.assetId, actionId: revokeAction, mutationType: "TRANSFER", delta: 0, fromRoleId: ids.roleId, toRoleId: ids.otherRoleId, beforeJson: { ownerRoleId: ids.roleId, quantity: custodyBeforeTransfer.quantity, status: custodyBeforeTransfer.status }, afterJson: { ownerRoleId: ids.otherRoleId, quantity: custodyBeforeTransfer.quantity, status: custodyBeforeTransfer.status }, idempotencyKey: `m5-custody-transfer:${suffix}` } });
    const revoked = await prisma.$transaction((tx) => service.applyAuthoritativeMilestones(tx, { run: { ...run, currentNodeId: ids.revokeNodeId }, beneficiaryRoleId: ids.roleId, sourceResolutionId: revokeResolution, sourceActionId: revokeAction, stageIndex: 2, actionCodes: ["custom:transfer-original-ledger-custody"], effectCodes: ["intent:transfer-custody"], factCodes: ["custom_fact_transfer_original_ledger_custody"] }));
    assert.equal(revoked.updated.some((item) => item.beneficiaryRoleId === ids.roleId && item.status === "REVOKED"), true);
    assert.equal(revoked.updated.some((item) => item.beneficiaryRoleId === ids.otherRoleId && item.status === "ACHIEVED"), true);
    assert.equal(await prisma.aEmotionKeyModal.count({ where: { runId: ids.runId, modalType: "STAGE_VICTORY" } }), 1);
  } finally {
    await prisma.storyRun.deleteMany({ where: { id: ids.runId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: ids.userId } }).catch(() => undefined);
    await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
