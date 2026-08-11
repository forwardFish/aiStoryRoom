import assert from "node:assert/strict";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION, validateAEmotionM1ProjectionV1 } from "@ai-story/shared";
import {
  A_EMOTION_M1_ACTION_KEY,
  A_EMOTION_M1_EFFECT_KEY,
  A_EMOTION_M1_FACT_KEY,
  A_EMOTION_M1_SOURCE_ROLE_KEY,
  A_EMOTION_M1_TARGET_ROLE_KEY
} from "../config/a-emotion-m1.config";
import { AEmotionM1Service } from "./a-emotion-m1.service";
import { ContinuousStoryV2Service } from "./continuous-story-v2.service";

const previousFlag = process.env.A_EMOTION_M1_ENABLED;
process.env.A_EMOTION_M1_ENABLED = "true";

test.after(() => {
  if (previousFlag === undefined) delete process.env.A_EMOTION_M1_ENABLED;
  else process.env.A_EMOTION_M1_ENABLED = previousFlag;
});

function role(id: string, roleKey: string, roleName: string) {
  return {
    id,
    runId: "run-m1",
    roleKey,
    roleName,
    identity: roleName,
    publicInfo: "",
    hiddenSecret: null,
    personalGoal: "",
    currentState: "",
    abilityText: null,
    arcText: null,
    knownInfoJson: [],
    cannotDoJson: [],
    isAiControlled: false,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date()
  } as any;
}

function structuredAction() {
  return {
    actionKey: A_EMOTION_M1_ACTION_KEY,
    visibility: "LIMITED",
    effectFactKeys: [A_EMOTION_M1_FACT_KEY],
    influenceEdges: [{ affectedRoleKey: A_EMOTION_M1_TARGET_ROLE_KEY, effectKey: "influence_main_s2_xunfu_seize_drafts_to_governor", visibility: "LIMITED" }],
    normalizedIntent: {
      objective: "控制底稿",
      target: { type: "ROLE", id: "governor-role", label: "浙江总督" },
      method: "依照结构化行动卡收缴催办底稿",
      leverageKeys: [],
      visibility: "LIMITED",
      riskTolerance: "HIGH",
      fallback: null,
      condition: null
    }
  } as any;
}

function contentStub() {
  return {
    forGame: () => ({
      roleStage: () => ({
        mainCards: [{
          actionKey: A_EMOTION_M1_ACTION_KEY,
          targetRoleKey: A_EMOTION_M1_TARGET_ROLE_KEY,
          effect: {
            effectKey: A_EMOTION_M1_EFFECT_KEY,
            factKeys: [A_EMOTION_M1_FACT_KEY],
            influenceEdges: [{ affectedRoleKey: A_EMOTION_M1_TARGET_ROLE_KEY, visibility: "LIMITED" }]
          }
        }]
      })
    })
  } as any;
}

function enabledRun(stateJson: unknown = { featureFlags: { aEmotionM1: true } }) {
  return {
    id: "run-m1",
    mode: "room",
    maxPlayers: 3,
    templateKey: "sangtian",
    strategyVersion: "sangtian_v1_2",
    engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
    stateJson,
    currentNodeId: "node-m1",
    currentDay: 2
  };
}

test("authoritative M1 mutation derives from the exact structured card, persists a dynamic metric and queues compilation in the same transaction", async () => {
  const source = role("xunfu-role", A_EMOTION_M1_SOURCE_ROLE_KEY, "浙江巡抚");
  const target = role("governor-role", A_EMOTION_M1_TARGET_ROLE_KEY, "浙江总督");
  const writes: unknown[] = [];
  const tasks: unknown[] = [];
  let persistedState: any;
  const baseState = {
    featureFlags: { aEmotionM1: true },
    aEmotionM1: {
      schemaVersion: "a_emotion_m1_state_v1",
      stateVersion: 3,
      metrics: { [target.id]: { imperial_trust: 52 } },
      impacts: {}
    }
  };
  let persistedResolutionPatch: any = { schemaVersion: "pending_world_mutation_v1" };
  const tx = {
    storyPlayer: {
      findFirst: async ({ where }: any) => {
        assert.deepEqual(where, {
          runId: "run-m1",
          roleId: target.id,
          playerType: "human",
          status: "active",
          userId: { not: null }
        });
        return { id: "governor-player" };
      }
    },
    storyRun: {
      findUnique: async () => ({ stateJson: baseState }),
      update: async ({ data }: any) => {
        persistedState = data.stateJson;
        writes.push(data.stateJson);
        return data;
      }
    },
    actionResolution: {
      findUnique: async () => ({
        runId: "run-m1",
        playerActionId: "player-action-m1",
        appliedWorldSequence: 17,
        statePatchJson: persistedResolutionPatch
      }),
      update: async ({ data }: any) => { persistedResolutionPatch = data.statePatchJson; return data; }
    },
    storyTaskOutbox: {
      findUnique: async () => null,
      create: async ({ data }: any) => { tasks.push(data); return data; }
    }
  } as any;
  const service = new AEmotionM1Service({} as any, contentStub(), {} as any);
  const safeFact = service.safeCanonicalFactContent({
    run: enabledRun(), sourceRole: source, stageIndex: 2, action: structuredAction(), factKey: A_EMOTION_M1_FACT_KEY
  });
  assert.equal(safeFact, "与原始粮册有关的部分底稿已离开常规核验链，总督可见的原始材料减少。");
  assert.doesNotMatch(String(safeFact), /巡抚|xunfu/);
  const result = await service.applyAuthoritativeImpact(tx, {
    run: enabledRun(baseState),
    sourceRole: source,
    allRoles: [source, target, role("county-role", "county_magistrate", "县令")],
    resolutionId: "resolution-m1",
    playerActionId: "player-action-m1",
    stageIndex: 2,
    appliedWorldSequence: 17,
    action: structuredAction()
  });

  assert.deepEqual(result, { handledTargetRoleIds: [target.id], stateVersion: 4 });
  assert.equal(writes.length, 1);
  assert.equal(persistedState.aEmotionM1.metrics[target.id].imperial_trust, 46, "the rule applies -6 to the persisted current value instead of inventing 43 → 37");
  assert.equal(persistedState.aEmotionM1.impacts["resolution-m1"].imperialTrust.before, 52);
  assert.equal(persistedState.aEmotionM1.impacts["resolution-m1"].imperialTrust.after, 46);
  assert.equal(persistedResolutionPatch.aEmotionM1CanonicalImpact.imperialTrust.before, 52);
  assert.equal(persistedResolutionPatch.aEmotionM1CanonicalImpact.imperialTrust.after, 46);
  assert.equal(tasks.length, 1);
  assert.equal((tasks[0] as any).taskType, "INTERACTION_COMPILE_REQUESTED");
  assert.equal((tasks[0] as any).status, "PENDING");
  assert.equal((tasks[0] as any).inputRefId, "resolution-m1");
  assert.equal((tasks[0] as any).roleId, target.id);

  const runWithPersistedState = enabledRun(persistedState);
  const duplicateTx = {
    storyPlayer: { findFirst: async () => ({ id: "governor-player" }) },
    storyRun: {
      findUnique: async () => ({ stateJson: persistedState }),
      update: async () => { throw new Error("duplicate must not rewrite state"); }
    },
    actionResolution: {
      findUnique: async () => { throw new Error("duplicate must return before reloading resolution"); },
      update: async () => { throw new Error("duplicate must not rewrite resolution"); }
    },
    storyTaskOutbox: { findUnique: async () => ({ id: "existing" }), create: async () => { throw new Error("duplicate must not create a task"); } }
  } as any;
  const duplicate = await service.applyAuthoritativeImpact(duplicateTx, {
    run: runWithPersistedState,
    sourceRole: source,
    allRoles: [source, target],
    resolutionId: "resolution-m1",
    playerActionId: "player-action-m1",
    stageIndex: 2,
    appliedWorldSequence: 17,
    action: structuredAction()
  });
  assert.deepEqual(duplicate, { handledTargetRoleIds: [target.id], stateVersion: 4 });
});

test("reserved world mutation suppresses legacy impact only for an active human target and leaves AI or unoccupied targets on ACTOR_IMPACT_V2", async () => {
  const source = role("xunfu-role", A_EMOTION_M1_SOURCE_ROLE_KEY, "浙江巡抚");
  const target = role("governor-role", A_EMOTION_M1_TARGET_ROLE_KEY, "浙江总督");
  const county = role("county-role", "county_magistrate", "县令");

  for (const controller of ["human", "ai", "unoccupied"] as const) {
    const resolutionId = `resolution-boundary-${controller}`;
    const playerActionId = `player-action-boundary-${controller}`;
    const baseState = { featureFlags: { aEmotionM1: true } };
    let persistedResolutionPatch: any = {
      schemaVersion: "pending_world_mutation_v1",
      baseWorldSequence: 16,
      nextWorldSequence: 17
    };
    const m1CompileTasks: any[] = [];
    const legacyImpactTasks: any[] = [];
    const m1StateWrites: any[] = [];
    const canonicalFacts: any[] = [];
    let capturedHandledTargetRoleIds: string[] | null = null;

    const tx = {
      storyPlayer: {
        findFirst: async ({ where }: any) => {
          assert.deepEqual(where, {
            runId: "run-m1",
            roleId: target.id,
            playerType: "human",
            status: "active",
            userId: { not: null }
          });
          return controller === "human" ? { id: "governor-human-player" } : null;
        }
      },
      storyRun: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => ({ stateJson: m1StateWrites.at(-1) || baseState }),
        update: async ({ data }: any) => {
          m1StateWrites.push(data.stateJson);
          return data;
        }
      },
      actionResolution: {
        findUnique: async () => ({
          runId: "run-m1",
          playerActionId,
          appliedWorldSequence: 17,
          statePatchJson: persistedResolutionPatch
        }),
        update: async ({ data }: any) => {
          persistedResolutionPatch = data.statePatchJson;
          return data;
        }
      },
      storyTaskOutbox: {
        findUnique: async () => null,
        create: async ({ data }: any) => {
          m1CompileTasks.push(data);
          return data;
        }
      },
      interactionRequestV2: { updateMany: async () => ({ count: 1 }) },
      conditionalActionV2: {
        create: async () => { throw new Error("unexpected conditional action"); },
        updateMany: async () => ({ count: 0 })
      },
      commitmentV2: {
        create: async () => { throw new Error("unexpected commitment"); },
        updateMany: async () => ({ count: 0 })
      },
      canonFact: {
        findUnique: async () => null,
        create: async ({ data }: any) => {
          canonicalFacts.push(data);
          return data;
        },
        update: async () => { throw new Error("unexpected fact update"); }
      }
    } as any;

    const m1Service = new AEmotionM1Service({} as any, contentStub(), {} as any);
    const originalApply = m1Service.applyAuthoritativeImpact.bind(m1Service);
    m1Service.applyAuthoritativeImpact = async (...args: Parameters<AEmotionM1Service["applyAuthoritativeImpact"]>) => {
      const result = await originalApply(...args);
      capturedHandledTargetRoleIds = result.handledTargetRoleIds;
      return result;
    };
    const storyService = new ContinuousStoryV2Service(
      {} as any,
      contentStub(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      null as never,
      m1Service
    );
    (storyService as any).applyLeverageMutations = async () => undefined;
    (storyService as any).ensureStageAssets = async () => undefined;
    (storyService as any).enqueueMatchingConditionTasks = async () => undefined;
    (storyService as any).enqueueImpactTask = async (_tx: any, input: any) => {
      legacyImpactTasks.push(input);
    };

    const run = {
      ...enabledRun(baseState),
      currentDay: 2,
      totalDays: 7,
      worldSequence: 16,
      reservedWorldSequence: 17
    };
    await (storyService as any).applyReservedWorldMutation(tx, {
      resolution: {
        id: resolutionId,
        run,
        turn: { id: `turn-${controller}`, threadId: `thread-${controller}`, roleId: source.id, stageIndex: 2 },
        submission: { id: `submission-${controller}` },
        playerAction: { id: playerActionId },
        statePatchJson: persistedResolutionPatch,
        baseWorldSequence: 16,
        appliedWorldSequence: 17
      },
      context: {
        role: source,
        allRoles: [source, target, county],
        situationInput: {
          stage: {
            title: "县令密信",
            factCatalog: [{ factKey: A_EMOTION_M1_FACT_KEY, visibility: "LIMITED" }]
          }
        }
      },
      action: structuredAction(),
      stageProgress: { nextStageIndex: 2 }
    });

    assert.equal(canonicalFacts.length, 1, "the committed structured action keeps its canonical fact in every controller mode");
    if (controller === "human") {
      assert.deepEqual(capturedHandledTargetRoleIds, [target.id]);
      assert.equal(m1StateWrites.length, 1);
      assert.equal(m1CompileTasks.length, 1);
      assert.equal(m1CompileTasks[0].taskType, "INTERACTION_COMPILE_REQUESTED");
      assert.equal(legacyImpactTasks.length, 0, "the exact active-human M1 target suppresses its duplicate legacy impact");
    } else {
      assert.deepEqual(capturedHandledTargetRoleIds, []);
      assert.equal(m1StateWrites.length, 0, `${controller} target must not create M1 state`);
      assert.equal(m1CompileTasks.length, 0, `${controller} target must not create an orphan M1 compile task`);
      assert.equal(legacyImpactTasks.length, 1, `${controller} target must retain ACTOR_IMPACT_V2`);
      assert.equal(legacyImpactTasks[0].payload.targetRoleId, target.id);
      assert.equal(legacyImpactTasks[0].payload.playerActionId, playerActionId);
    }
  }
});

test("free text, the wrong card, Solo, other worlds and flag-off runs fail closed without state or outbox writes", async () => {
  const source = role("xunfu-role", A_EMOTION_M1_SOURCE_ROLE_KEY, "浙江巡抚");
  const target = role("governor-role", A_EMOTION_M1_TARGET_ROLE_KEY, "浙江总督");
  let writes = 0;
  const tx = {
    storyRun: { findUnique: async () => { writes += 1; return null; }, update: async () => { writes += 1; } },
    actionResolution: { findUnique: async () => { writes += 1; return null; }, update: async () => { writes += 1; } },
    storyTaskOutbox: { findUnique: async () => null, create: async () => { writes += 1; } }
  } as any;
  const service = new AEmotionM1Service({} as any, contentStub(), {} as any);
  assert.equal(service.safeCanonicalFactContent({
    run: enabledRun({}), sourceRole: source, stageIndex: 2, action: structuredAction(), factKey: A_EMOTION_M1_FACT_KEY
  }), null, "flag-off rooms keep their existing canonical receipt text");
  for (const run of [
    enabledRun({}),
    { ...enabledRun(), maxPlayers: 1 },
    { ...enabledRun(), templateKey: "caesar" }
  ]) {
    const result = await service.applyAuthoritativeImpact(tx, {
      run,
      sourceRole: source,
      allRoles: [source, target],
      resolutionId: `resolution-${Math.random()}`,
      playerActionId: "player-action",
      stageIndex: 2,
      appliedWorldSequence: 4,
      action: structuredAction()
    });
    assert.deepEqual(result, { handledTargetRoleIds: [], stateVersion: null });
  }
  const wrongAction = { ...structuredAction(), actionKey: "custom_free_text_action" };
  const result = await service.applyAuthoritativeImpact(tx, {
    run: enabledRun(), sourceRole: source, allRoles: [source, target], resolutionId: "wrong", playerActionId: "wrong-action", stageIndex: 2, appliedWorldSequence: 5, action: wrongAction
  });
  assert.deepEqual(result, { handledTargetRoleIds: [], stateVersion: null });
  assert.equal(writes, 0);
});

test("compile worker publishes only one viewer-safe governor delivery and rejects stale state/task ownership", async () => {
  const source = role("xunfu-role", A_EMOTION_M1_SOURCE_ROLE_KEY, "浙江巡抚");
  const target = role("governor-role", A_EMOTION_M1_TARGET_ROLE_KEY, "浙江总督");
  const county = role("county-role", "county_magistrate", "县令");
  const impact = {
    schemaVersion: "a_emotion_m1_canonical_impact_v1",
    resolutionId: "resolution-m1",
    runId: "run-m1",
    targetRoleId: target.id,
    actionKey: A_EMOTION_M1_ACTION_KEY,
    effectKey: A_EMOTION_M1_EFFECT_KEY,
    factKey: A_EMOTION_M1_FACT_KEY,
    sharedObjectKey: "original-grain-ledger",
    appliedWorldSequence: 17,
    stateVersion: 1,
    imperialTrust: { before: 43, after: 37, delta: -6 },
    createdAt: "2026-08-09T16:00:00.000Z"
  } as any;
  const task = {
    id: "task-m1",
    runId: "run-m1",
    nodeId: "node-m1",
    roleId: target.id,
    inputRefId: "resolution-m1",
    taskType: "INTERACTION_COMPILE_REQUESTED",
    status: "RUNNING",
    leaseOwner: "worker-1",
    leaseVersion: 3,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    resultJson: { schemaVersion: "interaction_compile_requested_v1", resolutionId: "resolution-m1", targetRoleId: target.id, stateVersion: 1 }
  };
  const run = {
    ...enabledRun({
      featureFlags: { aEmotionM1: true },
      aEmotionM1: { schemaVersion: "a_emotion_m1_state_v1", stateVersion: 1, metrics: { [target.id]: { imperial_trust: 37 } }, impacts: { [impact.resolutionId]: impact } }
    }),
    roles: [source, target, county],
    players: [
      { userId: "governor-user", roleId: target.id },
      { userId: "county-user", roleId: county.id }
    ]
  };
  const resolution = {
    id: "resolution-m1",
    runId: "run-m1",
    roleId: source.id,
    playerActionId: "player-action-m1",
    appliedWorldSequence: 17,
    qualityStatus: "PASS",
    statePatchJson: { aEmotionM1CanonicalImpact: impact },
    role: source,
    playerAction: { id: "player-action-m1", actionKey: A_EMOTION_M1_ACTION_KEY }
  };
  let published: any;
  const tx = {
    storyTaskOutbox: { findFirst: async () => task },
    storyRun: { findUnique: async () => run },
    actionResolution: { findUnique: async () => resolution },
    sceneNode: { findUnique: async () => ({ runId: "run-m1" }) },
    canonFact: {
      findUnique: async () => ({
        status: "confirmed",
        visibility: "limited",
        sourceActionIdsJson: ["player-action-m1"],
        knownByRoleIdsJson: [source.id, target.id],
        content: "与原始粮册有关的部分底稿已离开常规核验链，总督可见的原始材料减少。"
      })
    }
  } as any;
  const prisma = { $transaction: async (callback: any) => callback(tx) } as any;
  const deliveries = {
    publishProjected: async (_tx: any, input: any) => {
      published = input;
      const payload = input.deliveries[0].buildPayload(9);
      return { id: "evt_H4hJmUeXQ3aK7pT9vB2cD5fG", payload };
    }
  } as any;
  const service = new AEmotionM1Service(prisma, contentStub(), deliveries);
  const result = await service.executeCompileTask(task.id, { taskId: task.id, leaseOwner: "worker-1", leaseVersion: 3 });

  assert.equal(result.outcome, "PUBLISHED");
  assert.equal(published.deliveries.length, 1, "the unrelated county player receives no delivery");
  assert.equal(published.deliveries[0].userId, "governor-user");
  assert.equal(published.deliveries[0].roleId, target.id);
  assert.equal(published.canonicalPayload.sourceRoleId, undefined, "the StoryEvent payload does not retain hidden source identity");
  assert.equal(published.sourceActionId, "player-action-m1", "canonical causality stays on the server-side relation");
  const viewerPayload = published.deliveries[0].buildPayload(9);
  const validation = validateAEmotionM1ProjectionV1(viewerPayload);
  assert.equal(validation.ok, true, validation.ok ? "" : validation.errors.join("\n"));
  assert.doesNotMatch(JSON.stringify(viewerPayload), /xunfu|巡抚|sourceRole|playerAction|targetRole|dedupe/i);
  const question = viewerPayload.responseOptions.find((item: any) => item.code === "QUESTION_DELIVERY_PUBLICLY");
  assert.equal(question.preferredEntry, "TALK");
  assert.doesNotMatch(String(question.prefillText), /xunfu|巡抚/);
  assert.equal(Object.hasOwn(question, "targetRoleId"), false);

  const advancedRun: any = structuredClone(run);
  advancedRun.stateJson.aEmotionM1.stateVersion = 2;
  advancedRun.stateJson.aEmotionM1.metrics[target.id].imperial_trust = 35;
  const advancedPrisma = {
    $transaction: async (callback: any) => callback({
      ...tx,
      storyRun: { findUnique: async () => advancedRun }
    })
  } as any;
  const advancedService = new AEmotionM1Service(advancedPrisma, contentStub(), deliveries);
  assert.equal(
    (await advancedService.executeCompileTask(task.id, { taskId: task.id, leaseOwner: "worker-1", leaseVersion: 3 })).outcome,
    "PUBLISHED",
    "a later authoritative state must not strand an earlier committed interaction task"
  );

  const staleTask = { ...task, resultJson: { ...task.resultJson, stateVersion: 2 } };
  const stalePrisma = {
    $transaction: async (callback: any) => callback({
      ...tx,
      storyTaskOutbox: { findFirst: async () => staleTask }
    })
  } as any;
  const staleService = new AEmotionM1Service(stalePrisma, contentStub(), deliveries);
  await assert.rejects(
    staleService.executeCompileTask(task.id, { taskId: task.id, leaseOwner: "worker-1", leaseVersion: 3 }),
    /A_EMOTION_M1_STATE_VERSION_MISMATCH/
  );

  const leakingPrisma = {
    $transaction: async (callback: any) => callback({
      ...tx,
      canonFact: { findUnique: async () => ({
        status: "confirmed", visibility: "limited",
        sourceActionIdsJson: ["player-action-m1"], knownByRoleIdsJson: [source.id, target.id],
        content: "巡抚要求县令隐藏原始粮册"
      }) }
    })
  } as any;
  const leakingService = new AEmotionM1Service(leakingPrisma, contentStub(), deliveries);
  await assert.rejects(
    leakingService.executeCompileTask(task.id, { taskId: task.id, leaseOwner: "worker-1", leaseVersion: 3 }),
    /A_EMOTION_M1_STATE_VERSION_MISMATCH/
  );
});

test("game projection reads the persisted authoritative metric only while the exact M1 gate is enabled", () => {
  const target = role("governor-role", A_EMOTION_M1_TARGET_ROLE_KEY, "浙江总督");
  const service = new AEmotionM1Service({} as any, contentStub(), {} as any);
  const world = {
    presentation: { statusMetrics: [{ key: "imperial_trust", label: "皇帝信任", value: 43 }] }
  } as any;
  const enabled = enabledRun({
    featureFlags: { aEmotionM1: true },
    aEmotionM1: { schemaVersion: "a_emotion_m1_state_v1", stateVersion: 1, metrics: { [target.id]: { imperial_trust: 37 } }, impacts: {} }
  });
  assert.equal(service.applyMetricProjection(enabled, target.id, world).presentation.statusMetrics[0].value, 37);
  assert.equal(service.applyMetricProjection({
    ...enabled,
    stateJson: { ...(enabled.stateJson as Record<string, unknown>), featureFlags: {} }
  }, target.id, world).presentation.statusMetrics[0].value, 43);
});
