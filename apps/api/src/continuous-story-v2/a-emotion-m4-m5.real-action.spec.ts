import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { A_EMOTION_M4_EVENT_TYPE, A_EMOTION_M5_EVENT_TYPE, CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import type { Prisma } from "@prisma/client";
import { aEmotionM4Terms } from "../config/a-emotion-m4.config";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { applyAuthoritativeAEmotionLifecycle, authoritativeLifecycleCodes } from "./a-emotion-authoritative-lifecycle";
import { plannedSangtianCatalogAction, realActionRole, type RealActionRole } from "./a-emotion-real-action-fixtures";
import { AEmotionM4Service, evaluateAEmotionPromiseLifecycle } from "./a-emotion-m4.service";
import { AEmotionM5Service } from "./a-emotion-m5.service";
import type { PlannedIntentAction } from "./player-intent";

const isolatedDatabaseUrl = safeTestDatabaseUrl(
  process.env.A_EMOTION_REAL_ACTION_TEST_DATABASE_URL
  || process.env.A_EMOTION_M5_TEST_DATABASE_URL
  || process.env.A_EMOTION_M4_TEST_DATABASE_URL
);

const enabledState = {
  featureFlags: {
    aEmotionM1: true,
    aEmotionM2: true,
    aEmotionM4: true,
    aEmotionSimplePromise: true,
    aEmotionKeyModals: true,
    aEmotionM5: true,
    aEmotionStageMilestones: true,
    aEmotionInteractionHistory: true
  },
  aEmotionM5: { stateVersion: 0, metrics: {}, capabilities: {}, restrictions: {} }
};

const roleKeys = ["zhejiang_governor", "xunfu", "county_magistrate", "clerk"] as const;
type RealActionRoleKey = (typeof roleKeys)[number];

test("real Sangtian cards preserve exact author action/effect/fact lifecycle identifiers", () => {
  const roles = roleKeys.map((roleKey) => realActionRole(`role-${roleKey}`, roleKey));
  const seize = plan(roles, 2, "xunfu", "main_s2_xunfu_seize_drafts");
  const seizeCodes = authoritativeLifecycleCodes(seize, "sangtian");
  assert.deepEqual(seizeCodes.actionCodes, ["main_s2_xunfu_seize_drafts"]);
  assert.ok(seizeCodes.effectCodes.includes("effect_main_s2_xunfu_seize_drafts"));
  assert.ok(seizeCodes.factCodes.includes("fact_s2_xunfu_seize_drafts"));
  assert.equal(evaluateAEmotionPromiseLifecycle(aEmotionM4Terms("DELIVER_ORIGINAL_LEDGER"), seizeCodes), "BROKEN");

  const unrelated = plan(roles, 2, "xunfu", "main_s2_xunfu_trace_leak");
  assert.equal(
    evaluateAEmotionPromiseLifecycle(
      aEmotionM4Terms("DELIVER_ORIGINAL_LEDGER"),
      authoritativeLifecycleCodes(unrelated, "sangtian")
    ),
    "UNCHANGED"
  );

  const custody = plan(roles, 2, "zhejiang_governor", "main_s2_governor_dual_verification");
  assert.ok(custody.leverageDispositions.some((item) => item.assetKey === "asset_s2_document_custody" && item.disposition === "CLAIM"));
  assert.equal(
    evaluateAEmotionPromiseLifecycle(
      aEmotionM4Terms("DELIVER_ORIGINAL_LEDGER"),
      authoritativeLifecycleCodes(custody, "sangtian")
    ),
    "UNCHANGED",
    "fulfillment must come from authoritative custody state, not a synthetic code"
  );
});

test("real Sangtian copy-only action breaks and real evidence reveals one promise exactly once", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_REAL_ACTION_TEST_DATABASE_URL is not configured for an isolated database"
}, async () => {
  Object.assign(process.env, enabledEnv(isolatedDatabaseUrl!));
  const fixture = await createFixture("break");
  const prisma = fixture.prisma;
  const delivery = new ContinuousEventDeliveryService(prisma);
  const m4 = new AEmotionM4Service(prisma, delivery);
  try {
    const promise = await createFormalPromise(fixture, m4, "xunfu", "zhejiang_governor", 2);
    const seize = plan(fixture.roles, 2, "xunfu", "main_s2_xunfu_seize_drafts");
    const committed = await createCommittedAction(fixture, "xunfu", seize, 2, 2);
    await persistAssetDisposition(fixture, committed.actionId, "xunfu", seize, 2);
    const broken = await prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
      run: fixture.run,
      sourceRoleId: fixture.roleId("xunfu"),
      sourceResolutionId: committed.resolutionId,
      sourceActionId: committed.actionId,
      stageIndex: 2,
      action: seize,
      m4,
      m5: null
    }));
    assert.equal(broken.m4?.updated.find((item) => item.promiseId === promise.promiseId)?.status, "BROKEN");
    const replay = await prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
      run: fixture.run,
      sourceRoleId: fixture.roleId("xunfu"),
      sourceResolutionId: committed.resolutionId,
      sourceActionId: committed.actionId,
      stageIndex: 2,
      action: seize,
      m4,
      m5: null
    }));
    assert.equal(replay.m4?.updated.length, 0);

    const evidenceAction = plan(fixture.roles, 4, "clerk", "main_s4_clerk_certify_transfer_chain");
    const evidence = await createCommittedAction(fixture, "clerk", evidenceAction, 4, 3);
    await createCanonicalFacts(fixture, evidence.actionId, evidenceAction.effectFactKeys);
    const revealed = await prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
      run: fixture.run,
      sourceRoleId: fixture.roleId("clerk"),
      sourceResolutionId: evidence.resolutionId,
      sourceActionId: evidence.actionId,
      stageIndex: 4,
      action: evidenceAction,
      m4,
      m5: null
    }));
    const persistedReveal = await prisma.commitmentV2.findUniqueOrThrow({ where: { id: promise.promiseId } });
    assert.equal(persistedReveal.status, "REVEALED");
    const revealReplay = await prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
      run: fixture.run,
      sourceRoleId: fixture.roleId("clerk"),
      sourceResolutionId: evidence.resolutionId,
      sourceActionId: evidence.actionId,
      stageIndex: 4,
      action: evidenceAction,
      m4,
      m5: null
    }));
    assert.equal(revealReplay.m4?.updated.length, 0);
    assert.equal(await prisma.commitmentV2.count({ where: { id: promise.promiseId, status: "REVEALED" } }), 1);
    assert.equal(await prisma.storyTaskOutbox.count({ where: { runId: fixture.run.id, taskType: "A_EMOTION_M4_PROMISE_REVEAL_COMPILE" } }), 1);
    const revealTask = await prisma.storyTaskOutbox.findFirstOrThrow({ where: { runId: fixture.run.id, taskType: "A_EMOTION_M4_PROMISE_REVEAL_COMPILE" } });
    await prisma.storyTaskOutbox.update({ where: { id: revealTask.id }, data: { status: "RUNNING", leaseOwner: "real-action-m4", leaseVersion: 1, leaseExpiresAt: new Date(Date.now() + 60_000) } });
    assert.equal((await m4.executeCompileTask(revealTask.id, { taskId: revealTask.id, leaseOwner: "real-action-m4", leaseVersion: 1 })).outcome, "PUBLISHED");
    assert.equal((await m4.executeCompileTask(revealTask.id, { taskId: revealTask.id, leaseOwner: "real-action-m4", leaseVersion: 1 })).outcome, "PUBLISHED");
    assert.equal(await prisma.storyEvent.count({ where: { runId: fixture.run.id, type: A_EMOTION_M4_EVENT_TYPE } }), 1);
    assert.equal(await prisma.eventDelivery.count({ where: { roomId: fixture.run.id, userId: fixture.userId("zhejiang_governor")! } }), 1);
    assert.equal(await prisma.aEmotionKeyModal.count({ where: { runId: fixture.run.id, modalType: "PROMISE_BROKEN" } }), 1);
    const receiverView = await m4.listForViewer(authUser(fixture.userId("zhejiang_governor")!), fixture.run.id);
    const unrelatedView = await m4.listForViewer(authUser(fixture.userId("county_magistrate")!), fixture.run.id);
    assert.equal(receiverView.items.some((item) => item.promiseId === promise.promiseId && item.status === "REVEALED"), true);
    assert.equal(unrelatedView.items.some((item) => item.promiseId === promise.promiseId), false);
  } finally {
    await fixture.cleanup();
  }
});

test("authoritative custody fulfills the promise and achieves/revokes CONTROL_ORIGINAL_LEDGER without duplicate rewards", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_REAL_ACTION_TEST_DATABASE_URL is not configured for an isolated database"
}, async () => {
  Object.assign(process.env, enabledEnv(isolatedDatabaseUrl!));
  const fixture = await createFixture("custody");
  const prisma = fixture.prisma;
  const delivery = new ContinuousEventDeliveryService(prisma);
  const m4 = new AEmotionM4Service(prisma, delivery);
  const m5 = new AEmotionM5Service(prisma, delivery);
  try {
    const promise = await createFormalPromise(fixture, m4, "xunfu", "zhejiang_governor", 2);
    const control = plan(fixture.roles, 2, "zhejiang_governor", "main_s2_governor_dual_verification");
    const committed = await createCommittedAction(fixture, "zhejiang_governor", control, 2, 2);
    await persistAssetDisposition(fixture, committed.actionId, "zhejiang_governor", control, 2);
    const codes = authoritativeLifecycleCodes(control, "sangtian");

    const lifecycle = await prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
      run: fixture.run,
      sourceRoleId: fixture.roleId("zhejiang_governor"),
      sourceResolutionId: committed.resolutionId,
      sourceActionId: committed.actionId,
      stageIndex: 2,
      action: control,
      m4,
      m5
    }));
    assert.equal(lifecycle.m4?.updated.find((item) => item.promiseId === promise.promiseId)?.status, "FULFILLED");
    assert.equal(lifecycle.m5?.updated.find((item) => item.milestoneCode === "CONTROL_ORIGINAL_LEDGER")?.status, "ACHIEVED");
    const repeated = await prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
      run: fixture.run,
      sourceRoleId: fixture.roleId("zhejiang_governor"),
      sourceResolutionId: committed.resolutionId,
      sourceActionId: committed.actionId,
      stageIndex: 2,
      action: control,
      m4,
      m5
    }));
    assert.equal(repeated.m5?.updated.filter((item) => item.milestoneCode === "CONTROL_ORIGINAL_LEDGER").length, 1);
    assert.equal(await prisma.aEmotionStageMilestone.count({ where: { runId: fixture.run.id, milestoneCode: "CONTROL_ORIGINAL_LEDGER" } }), 1);
    assert.equal(await prisma.storyTaskOutbox.count({ where: { runId: fixture.run.id, taskType: "A_EMOTION_M5_STAGE_MILESTONE_COMPILE" } }), 1);
    const milestoneTask = await prisma.storyTaskOutbox.findFirstOrThrow({ where: { runId: fixture.run.id, taskType: "A_EMOTION_M5_STAGE_MILESTONE_COMPILE" } });
    await prisma.storyTaskOutbox.update({ where: { id: milestoneTask.id }, data: { status: "RUNNING", leaseOwner: "real-action-m5", leaseVersion: 1, leaseExpiresAt: new Date(Date.now() + 60_000) } });
    assert.equal((await m5.executeCompileTask(milestoneTask.id, { taskId: milestoneTask.id, leaseOwner: "real-action-m5", leaseVersion: 1 })).outcome, "PUBLISHED");
    assert.equal((await m5.executeCompileTask(milestoneTask.id, { taskId: milestoneTask.id, leaseOwner: "real-action-m5", leaseVersion: 1 })).outcome, "PUBLISHED");
    assert.equal(await prisma.storyEvent.count({ where: { runId: fixture.run.id, type: A_EMOTION_M5_EVENT_TYPE } }), 1);
    assert.equal(await prisma.eventDelivery.count({ where: { roomId: fixture.run.id, userId: fixture.userId("zhejiang_governor")! } }), 1);
    assert.equal(await prisma.aEmotionKeyModal.count({ where: { runId: fixture.run.id, modalType: "STAGE_VICTORY" } }), 1);
    const governorSummary = await m5.interactionSummary(authUser(fixture.userId("zhejiang_governor")!), fixture.run.id);
    const unrelatedSummary = await m5.interactionSummary(authUser(fixture.userId("county_magistrate")!), fixture.run.id);
    assert.equal(governorSummary.milestones.some((item) => item.milestoneCode === "CONTROL_ORIGINAL_LEDGER"), true);
    assert.equal(unrelatedSummary.milestones.some((item) => item.milestoneCode === "CONTROL_ORIGINAL_LEDGER"), false);
    const runState = await prisma.storyRun.findUniqueOrThrow({ where: { id: fixture.run.id }, select: { stateJson: true } });
    assert.equal(Number((runState.stateJson as any).aEmotionM5.metrics[fixture.roleId("zhejiang_governor")].reform_progress), 12);

    const unrelatedAction = plan(fixture.roles, 2, "xunfu", "main_s2_xunfu_trace_leak");
    const unrelated = await createCommittedAction(fixture, "xunfu", unrelatedAction, 2, 3);
    const unchanged = await prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
      run: fixture.run,
      sourceRoleId: fixture.roleId("xunfu"),
      sourceResolutionId: unrelated.resolutionId,
      sourceActionId: unrelated.actionId,
      stageIndex: 2,
      action: unrelatedAction,
      m4,
      m5
    }));
    assert.equal(unchanged.m4?.outcome, "UNCHANGED");
    assert.equal(unchanged.m5?.outcome, "NO_MATCH");

    const transfer = customTransferAction(fixture.roles, fixture.roleId("xunfu"));
    const transferCommitted = await createCommittedAction(fixture, "zhejiang_governor", transfer, 2, 4);
    await persistAssetTransfer(fixture, transferCommitted.actionId, fixture.roleId("zhejiang_governor"), fixture.roleId("xunfu"));
    const revoked = await prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
      run: fixture.run,
      sourceRoleId: fixture.roleId("zhejiang_governor"),
      sourceResolutionId: transferCommitted.resolutionId,
      sourceActionId: transferCommitted.actionId,
      stageIndex: 2,
      action: transfer,
      m4,
      m5
    }));
    assert.equal(revoked.m5?.updated.some((item) => item.beneficiaryRoleId === fixture.roleId("zhejiang_governor") && item.status === "REVOKED"), true);
    assert.equal(revoked.m5?.updated.some((item) => item.beneficiaryRoleId === fixture.roleId("xunfu") && item.status === "ACHIEVED"), true);
    assert.equal(await prisma.aEmotionStageMilestone.count({ where: { runId: fixture.run.id, milestoneCode: "CONTROL_ORIGINAL_LEDGER" } }), 2);

    await assert.rejects(
      prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
        run: fixture.run,
        sourceRoleId: fixture.roleId("xunfu"),
        sourceResolutionId: committed.resolutionId,
        sourceActionId: committed.actionId,
        stageIndex: 2,
        action: control,
        m4,
        m5
      })),
      /committed canonical result/u
    );
    await assert.rejects(
      prisma.$transaction((tx) => applyAuthoritativeAEmotionLifecycle(tx, {
        run: { ...fixture.run, id: `${fixture.run.id}-wrong` },
        sourceRoleId: fixture.roleId("zhejiang_governor"),
        sourceResolutionId: committed.resolutionId,
        sourceActionId: committed.actionId,
        stageIndex: 2,
        action: control,
        m4: null,
        m5
      })),
      /Milestone basis is not a committed canonical result/u
    );
  } finally {
    await fixture.cleanup();
  }
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(label: string) {
  const suffix = `${label}-${randomUUID().replaceAll("-", "")}`;
  const prisma = new PrismaService();
  await prisma.$connect();
  const templateId = `real-action-template-${suffix}`;
  const runId = `real-action-run-${suffix}`;
  const nodeId = `real-action-node-${suffix}`;
  const roles = roleKeys.map((roleKey) => realActionRole(`real-action-role-${roleKey}-${suffix}`, roleKey));
  const roleByKey = new Map(roles.map((role) => [role.roleKey, role]));
  const userByRole = new Map(roleKeys.map((roleKey) => [roleKey, `real-action-user-${roleKey}-${suffix}`]));
  await prisma.worldTemplate.create({ data: { id: templateId, name: "Real action", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
  await prisma.user.createMany({ data: roleKeys.map((roleKey) => ({ id: userByRole.get(roleKey)!, openid: `openid-${userByRole.get(roleKey)!}`, email: `${userByRole.get(roleKey)!}@example.test`, emailVerifiedAt: new Date(), status: "active" })) });
  await prisma.storyRun.create({ data: {
    id: runId,
    templateId,
    ownerUserId: userByRole.get("zhejiang_governor")!,
    title: "Real action",
    hook: "Real action",
    mode: "room",
    templateKey: "sangtian",
    status: "playing",
    currentDay: 2,
    maxPlayers: 3,
    stateJson: structuredClone(enabledState),
    visibility: "private",
    inviteCode: `RA${suffix.slice(-10)}`,
    engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
    strategyVersion: "sangtian_v1_2"
  } });
  await prisma.sceneNode.create({ data: { id: nodeId, runId, chapterIndex: 1, nodeIndex: 1, title: "Real action", publicNarration: "Real action", nodeGoal: "Real action", actionOptionsJson: [] } });
  await prisma.storyRun.update({ where: { id: runId }, data: { currentNodeId: nodeId } });
  await prisma.storyRole.createMany({ data: roles.map((role) => ({ id: role.id, runId, roleKey: role.roleKey, roleName: role.roleName, identity: role.identity, publicInfo: role.publicInfo, personalGoal: role.personalGoal, currentState: role.currentState, abilityText: role.abilityText, knownInfoJson: [], cannotDoJson: [], status: "active" })) });
  await prisma.storyPlayer.createMany({ data: roleKeys.map((roleKey) => ({ runId, userId: userByRole.get(roleKey)!, roleId: roleByKey.get(roleKey)!.id, playerType: "human", status: "active" })) });
  for (const role of roles) await prisma.actorThread.create({ data: { id: `thread-${role.roleKey}-${suffix}`, runId, roleId: role.id, status: "ACTIVE" } });
  const storedRun = await prisma.storyRun.findUniqueOrThrow({ where: { id: runId } });
  return {
    prisma,
    templateId,
    nodeId,
    roles,
    run: { ...storedRun, currentNodeId: nodeId },
    roleId: (roleKey: RealActionRoleKey) => {
      const role = roleByKey.get(roleKey);
      if (!role) throw new Error(`ROLE_NOT_FOUND:${roleKey}`);
      return role.id;
    },
    userId: (roleKey: RealActionRoleKey) => userByRole.get(roleKey) || null,
    threadId: (roleKey: RealActionRoleKey) => `thread-${roleKey}-${suffix}`,
    suffix,
    cleanup: async () => {
      await prisma.storyRun.deleteMany({ where: { id: runId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: [...userByRole.values()] } } }).catch(() => undefined);
      await prisma.worldTemplate.deleteMany({ where: { id: templateId } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  };
}

async function createFormalPromise(
  fixture: Fixture,
  service: AEmotionM4Service,
  issuerRoleKey: RealActionRoleKey,
  receiverRoleKey: RealActionRoleKey,
  stageIndex: number
) {
  const action = formalPromiseAction(fixture.roles, fixture.roleId(receiverRoleKey));
  const committed = await createCommittedAction(fixture, issuerRoleKey, action, stageIndex, 1);
  const result = await fixture.prisma.$transaction((tx) => service.createFromCommittedAction(tx, {
    run: fixture.run,
    sourceResolutionId: committed.resolutionId,
    sourceActionId: committed.actionId,
    issuerRoleId: fixture.roleId(issuerRoleKey),
    receiverRoleId: fixture.roleId(receiverRoleKey),
    stageIndex,
    command: {
      schemaVersion: "a_emotion_m4_simple_promise_command_v1",
      idempotencyKey: `promise:${fixture.suffix}:${issuerRoleKey}`,
      promiseCode: "DELIVER_ORIGINAL_LEDGER",
      targetRoleKey: receiverRoleKey,
      expectedStage: stageIndex
    }
  }));
  assert.equal(result.outcome, "CREATED");
  return result.promise!;
}

async function createCommittedAction(
  fixture: Fixture,
  roleKey: RealActionRoleKey,
  action: PlannedIntentAction,
  stageIndex: number,
  ordinal: number
) {
  const roleId = fixture.roleId(roleKey);
  const userId = fixture.userId(roleKey);
  const actionId = `action-${roleKey}-${ordinal}-${fixture.suffix}`;
  const actionNodeId = `real-action-node-s${stageIndex}-${roleKey}-${ordinal}-${fixture.suffix}`;
  const roleOrdinal = roleKeys.indexOf(roleKey) + 1;
  const actionNodeIndex = ordinal * 10 + roleOrdinal;
  const turnId = `turn-${roleKey}-${ordinal}-${fixture.suffix}`;
  const submissionId = `submission-${roleKey}-${ordinal}-${fixture.suffix}`;
  const resolutionId = `resolution-${roleKey}-${ordinal}-${fixture.suffix}`;
  await fixture.prisma.sceneNode.create({ data: {
    id: actionNodeId,
    runId: fixture.run.id,
    chapterIndex: stageIndex,
    nodeIndex: actionNodeIndex,
    title: action.label,
    publicNarration: action.description,
    nodeGoal: action.intent,
    actionOptionsJson: []
  } });
  await fixture.prisma.storyRun.update({
    where: { id: fixture.run.id },
    data: { currentNodeId: actionNodeId }
  });
  fixture.run.currentNodeId = actionNodeId;
  await fixture.prisma.actorTurn.create({ data: {
    id: turnId,
    runId: fixture.run.id,
    threadId: fixture.threadId(roleKey),
    roleId,
    stageIndex,
    turnIndex: ordinal,
    status: "RESOLVED",
    baseWorldSequence: ordinal - 1,
    situationTitle: action.label,
    situationNarrative: action.description,
    visibleFactKeysJson: [],
    activeThreadKeysJson: [],
    contextJson: {},
    qualityStatus: "PASS",
    dedupeKey: `turn:${turnId}`
  } });
  await fixture.prisma.playerAction.create({ data: {
    id: actionId,
    runId: fixture.run.id,
    nodeId: actionNodeId,
    chapterIndex: stageIndex,
    userId,
    roleId,
    playerType: userId ? "human" : "ai",
    actionType: "main",
    method: action.description,
    intent: action.intent,
    riskLevel: action.risk.toLowerCase(),
    status: "resolved",
    actionSlot: "MAIN",
    actionKey: action.actionKey,
    visibility: action.visibility,
    normalizedJson: action as unknown as Prisma.InputJsonValue,
    immediateJson: {},
    resolvedJson: {}
  } });
  await fixture.prisma.decisionSubmission.create({ data: {
    id: submissionId,
    runId: fixture.run.id,
    threadId: fixture.threadId(roleKey),
    turnId,
    roleId,
    userId,
    playerActionId: actionId,
    normalizedActionJson: action as unknown as Prisma.InputJsonValue,
    rawIntentJson: action.normalizedIntent as unknown as Prisma.InputJsonValue,
    normalizedIntentJson: action.normalizedIntent as unknown as Prisma.InputJsonValue,
    guardDecisionJson: action.guardDecision as unknown as Prisma.InputJsonValue,
    selectedLeverageKeysJson: action.requiredAssetKeys as unknown as Prisma.InputJsonValue,
    controlEpoch: 1,
    idempotencyKey: `submission:${submissionId}`,
    requestHash: submissionId,
    status: "RESOLVED",
    resolvedAt: new Date()
  } });
  await fixture.prisma.actionResolution.create({ data: {
    id: resolutionId,
    runId: fixture.run.id,
    threadId: fixture.threadId(roleKey),
    turnId,
    submissionId,
    roleId,
    playerActionId: actionId,
    baseWorldSequence: ordinal - 1,
    appliedWorldSequence: ordinal,
    outcomeJson: { factKeys: action.effectFactKeys } as Prisma.InputJsonValue,
    statePatchJson: { lifecycleCodes: authoritativeLifecycleCodes(action, "sangtian") } as Prisma.InputJsonValue,
    resultNarrative: action.receiptText,
    nextHook: action.nextStateKey,
    qualityStatus: "PASS"
  } });
  return { actionId, resolutionId };
}

async function createCanonicalFacts(fixture: Fixture, actionId: string, factKeys: string[]) {
  for (const factKey of factKeys) {
    await fixture.prisma.canonFact.upsert({
      where: { runId_factKey: { runId: fixture.run.id, factKey } },
      update: { status: "confirmed", sourceActionIdsJson: [actionId] },
      create: {
        runId: fixture.run.id,
        sourceNodeId: fixture.nodeId,
        factKey,
        content: factKey,
        status: "confirmed",
        visibility: "limited",
        sourceEventIdsJson: [],
        sourceActionIdsJson: [actionId],
        knownByRoleIdsJson: fixture.roles.map((role) => role.id)
      }
    });
  }
}

async function persistAssetDisposition(
  fixture: Fixture,
  actionId: string,
  actorRoleKey: RealActionRoleKey,
  action: PlannedIntentAction,
  stageIndex: number
) {
  for (const disposition of action.leverageDispositions) {
    const initialOwner = disposition.assetKey === "asset_s4_clerk_document_index" ? fixture.roleId(actorRoleKey) : null;
    const existing = await fixture.prisma.roleAsset.findUnique({ where: { runId_assetKey: { runId: fixture.run.id, assetKey: disposition.assetKey } } });
    const asset = existing || await fixture.prisma.roleAsset.create({ data: {
      runId: fixture.run.id,
      assetKey: disposition.assetKey,
      kind: disposition.assetKey === "asset_s2_document_custody" ? "CONTESTED_AUTHORITY" : "ROLE_LEVERAGE",
      ownerRoleId: initialOwner,
      quantity: 1,
      status: "ACTIVE",
      visibility: "PRIVATE",
      stateJson: { stageIndex }
    } });
    const fromRoleId = asset.ownerRoleId;
    const toRoleId = disposition.disposition === "CLAIM" ? fixture.roleId(actorRoleKey) : asset.ownerRoleId;
    const quantity = disposition.disposition === "CONSUME" ? Math.max(0, asset.quantity - 1) : asset.quantity;
    const status = quantity > 0 ? "ACTIVE" : "SPENT";
    const updated = await fixture.prisma.roleAsset.update({ where: { id: asset.id }, data: { ownerRoleId: toRoleId, quantity, status, stateJson: { stageIndex, lastUsedByActionId: actionId, lastDisposition: disposition.disposition }, version: { increment: 1 } } });
    await fixture.prisma.roleAssetMutation.create({ data: {
      assetId: asset.id,
      actionId,
      mutationType: disposition.disposition,
      delta: quantity - asset.quantity,
      fromRoleId,
      toRoleId,
      beforeJson: { ownerRoleId: fromRoleId, quantity: asset.quantity, status: asset.status },
      afterJson: { ownerRoleId: toRoleId, quantity, status },
      idempotencyKey: `real-action:${actionId}:${disposition.assetKey}`
    } });
    assert.equal(updated.ownerRoleId, toRoleId);
  }
}

async function persistAssetTransfer(fixture: Fixture, actionId: string, fromRoleId: string, toRoleId: string) {
  const asset = await fixture.prisma.roleAsset.findUniqueOrThrow({ where: { runId_assetKey: { runId: fixture.run.id, assetKey: "asset_s2_document_custody" } } });
  assert.equal(asset.ownerRoleId, fromRoleId);
  await fixture.prisma.roleAsset.update({ where: { id: asset.id }, data: { ownerRoleId: toRoleId, stateJson: { lastUsedByActionId: actionId, lastDisposition: "TRANSFER" }, version: { increment: 1 } } });
  await fixture.prisma.roleAssetMutation.create({ data: {
    assetId: asset.id,
    actionId,
    mutationType: "TRANSFER",
    delta: 0,
    fromRoleId,
    toRoleId,
    beforeJson: { ownerRoleId: fromRoleId, quantity: asset.quantity, status: asset.status },
    afterJson: { ownerRoleId: toRoleId, quantity: asset.quantity, status: asset.status },
    idempotencyKey: `real-action:${actionId}:asset_s2_document_custody`
  } });
}

function plan(roles: RealActionRole[], stageIndex: number, actorRoleKey: RealActionRoleKey, actionKey: string) {
  return plannedSangtianCatalogAction({ stageIndex, actorRoleKey, actionKey, roles });
}

function formalPromiseAction(roles: RealActionRole[], targetRoleId: string): PlannedIntentAction {
  const actor = roles.find((role) => role.roleKey === "xunfu") || roles[0];
  return {
    actionKey: "formal-promise:deliver-original-ledger",
    source: "CUSTOM",
    visibility: "LIMITED",
    label: "Formal promise",
    description: "Structured promise",
    intent: "Promise delivery",
    risk: "NORMAL",
    targetRoleId,
    targetRoleName: roles.find((role) => role.id === targetRoleId)?.roleName || null,
    basisFactKeys: [],
    requiredAssetKeys: [],
    receiptText: "Promise recorded",
    effectFactKeys: [],
    influenceEdges: [],
    nextStateKey: "promise-recorded",
    normalizedIntent: { objective: "Promise delivery", target: { type: "ROLE", id: targetRoleId, label: "target" }, method: "Record a formal promise", leverageKeys: [], visibility: "LIMITED", riskTolerance: "MEDIUM", fallback: null, condition: null },
    immutableIntentHash: `promise-${actor.id}`,
    guardDecision: { decision: "ACCEPT", reason: "structured", matchedRules: [], riskFlags: [], normalizedIntent: { objective: "Promise delivery", target: { type: "ROLE", id: targetRoleId, label: "target" }, method: "Record a formal promise", leverageKeys: [], visibility: "LIMITED", riskTolerance: "MEDIUM", fallback: null, condition: null }, suggestedRewrite: null },
    effectHooks: [],
    observableTraceText: null,
    requiresTargetResponse: false,
    interactionRequestKind: null,
    leverageDispositions: []
  };
}

function customTransferAction(roles: RealActionRole[], targetRoleId: string): PlannedIntentAction {
  const target = roles.find((role) => role.id === targetRoleId);
  const intent = { objective: "Transfer authoritative custody", target: { type: "ROLE" as const, id: targetRoleId, label: target?.roleName || "target" }, method: "Transfer the registered original-ledger custody through the existing authoritative asset channel", leverageKeys: ["asset_s2_document_custody"], visibility: "LIMITED" as const, riskTolerance: "MEDIUM" as const, fallback: null, condition: null };
  return {
    actionKey: "custom:transfer-original-ledger-custody",
    source: "CUSTOM",
    visibility: "LIMITED",
    label: "Transfer custody",
    description: intent.method,
    intent: intent.objective,
    risk: "NORMAL",
    targetRoleId,
    targetRoleName: target?.roleName || null,
    basisFactKeys: [],
    requiredAssetKeys: ["asset_s2_document_custody"],
    receiptText: "Custody transfer recorded",
    effectFactKeys: ["custom_fact_transfer_original_ledger_custody"],
    influenceEdges: target ? [{ affectedRoleKey: target.roleKey, effectKey: "intent:transfer-custody", visibility: "LIMITED" }] : [],
    nextStateKey: "custom:transfer-custody",
    normalizedIntent: intent,
    immutableIntentHash: "transfer-original-ledger-custody",
    guardDecision: { decision: "ACCEPT", reason: "structured", matchedRules: [], riskFlags: [], normalizedIntent: intent, suggestedRewrite: null },
    effectHooks: ["WORLD_FACT:custom_fact_transfer_original_ledger_custody"],
    observableTraceText: null,
    requiresTargetResponse: false,
    interactionRequestKind: null,
    leverageDispositions: [{ assetKey: "asset_s2_document_custody", disposition: "TRANSFER" }]
  };
}

function authUser(id: string) {
  return { id, openid: `openid-${id}`, email: `${id}@example.test`, emailVerifiedAt: new Date(), nickname: null, authMethod: "PASSWORD" as const, authIdentityId: null };
}

function enabledEnv(databaseUrl: string) {
  return {
    DATABASE_URL: databaseUrl,
    A_EMOTION_M1_ENABLED: "true",
    A_EMOTION_M2_ENABLED: "true",
    A_EMOTION_M4_ENABLED: "true",
    A_EMOTION_SIMPLE_PROMISE_ENABLED: "true",
    A_EMOTION_M5_ENABLED: "true",
    A_EMOTION_STAGE_MILESTONES_ENABLED: "true",
    A_EMOTION_INTERACTION_HISTORY_ENABLED: "true"
  };
}

function safeTestDatabaseUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase();
    return /(?:^|[-_.])test(?:[-_.]|$)|aemotion|supabase/u.test(marker) ? value : null;
  } catch {
    return null;
  }
}
