import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assetsThroughCommittedResolution,
  bindOldestOpenInteraction,
  ContinuousStoryV2Service,
  findEarlierUnfinishedRoleImpact,
  interactionSourceSequenceFilter,
  isAgentRoleObservationCurrent,
  isImpactTargetTurnEligible,
  isRoleGenerationTaskRelevant,
  isRoleResultEventInWindow,
  readStoredOpenNovelRoleContext,
  shouldResumeAiAfterFailedAction,
  standingPolicyDecisionCandidate,
  visibleFactsThroughCommittedResolution,
  wouldRecompileAfterFutureWorldAdvance
} from "./continuous-story-v2.service";
import { boundaryAccepted, guardPlayerIntentV2 } from "./player-intent";
import { canonFactIsSafeAtSequence } from "./story-context.composer";

test("AI interaction binding chooses the oldest OPEN request targeting this role only", () => {
  const command = { idempotencyKey: "agent-v2:task-a", turnRevision: 2, controlEpoch: 1, candidateId: "candidate-a" } as any;
  const interactions = [
    { id: "interaction-non-target", targetRoleId: "role-b", createdAt: new Date("2026-08-03T00:00:00Z") },
    { id: "interaction-target-b", targetRoleId: "role-a", createdAt: new Date("2026-08-03T00:00:01Z") },
    { id: "interaction-target-a", targetRoleId: "role-a", createdAt: new Date("2026-08-03T00:00:01Z") }
  ];
  assert.equal(bindOldestOpenInteraction(command, "role-a", interactions).interactionId, "interaction-target-a");
  assert.equal(bindOldestOpenInteraction(command, "role-c", interactions).interactionId, undefined);
  assert.deepEqual(interactionSourceSequenceFilter(7), {
    sourceResolution: { appliedWorldSequence: { lte: 7 } }
  }, "the post-freshness query must exclude interactions created by later resolutions");
});

test("AI takeover gets one reversible Standing Policy when OpenNovel publishes no options", () => {
  const role = {
    id: "role-a",
    roleKey: "county_magistrate",
    roleName: "清流县令",
    identity: "负责县内文书、查验与执行边界",
    publicInfo: "地方官",
    hiddenSecret: null,
    personalGoal: "避免越权",
    currentState: "在任",
    abilityText: "可登记公文并核验经手人",
    cannotDo: []
  };
  const stage = {
    stageKey: "stage-a",
    title: "限期催办",
    commonContest: {
      contestKey: "document-review",
      title: "文书边界与复核",
      assetKey: "review-record",
      description: "各方对执行边界仍有争议"
    }
  } as any;
  const candidate = standingPolicyDecisionCandidate({ role, stage });
  assert.equal(candidate.actionKey, null);
  assert.equal(candidate.risk, "LOW");
  assert.deepEqual(candidate.intentDraft.leverageKeys, []);
  assert.equal(candidate.intentDraft.target.type, "PUBLIC_FRAME");
  assert.equal(candidate.effectHooks.includes("STANDING_POLICY:DEFER_IRREVERSIBLE"), true);
  const guarded = guardPlayerIntentV2(candidate.intentDraft, {
    role,
    stage,
    allRoles: [{ id: role.id, roleKey: role.roleKey, roleName: role.roleName }],
    visibleFacts: [],
    allFacts: [],
    assets: []
  });
  assert.equal(boundaryAccepted(guarded.decision), true, guarded.reason);
});

test("OpenNovel result projection includes only the newly applied world-sequence window", () => {
  assert.equal(isRoleResultEventInWindow(null, 7, 8), false);
  assert.equal(isRoleResultEventInWindow(0, 0, 1), false, "opening narration is outside the result window");
  assert.equal(isRoleResultEventInWindow(7, 7, 8), false, "the base sequence is already in role canon");
  assert.equal(isRoleResultEventInWindow(8, 7, 8), true, "the newly applied sequence is visible");
  assert.equal(isRoleResultEventInWindow(9, 7, 8), false, "future events cannot enter an earlier result");
});

test("an earlier OpenNovel impact can drain while the target turn waits in RESOLVING", () => {
  assert.equal(isImpactTargetTurnEligible("OPEN", true), true);
  assert.equal(isImpactTargetTurnEligible("RESOLVING", true), true, "the result waits for this earlier impact, so rejecting it would deadlock");
  assert.equal(isImpactTargetTurnEligible("RESOLVING", false), false, "the legacy structured pipeline still rewrites an open decision set");
  assert.equal(isImpactTargetTurnEligible("RESOLVED", true), false);
});

test("projection ignores superseded opening failures but keeps the unresolved result failure", () => {
  const unresolved = new Set(["resolution-pending"]);
  assert.equal(isRoleGenerationTaskRelevant({ taskType: "ACTOR_OPENING_V2", inputRefId: "old-turn" }, true, unresolved), false);
  assert.equal(isRoleGenerationTaskRelevant({ taskType: "ACTOR_OPENING_V2", inputRefId: "opening-turn" }, false, unresolved), true);
  assert.equal(isRoleGenerationTaskRelevant({ taskType: "ACTOR_RESULT_V2", inputRefId: "resolution-pass" }, true, unresolved), false);
  assert.equal(isRoleGenerationTaskRelevant({ taskType: "ACTOR_RESULT_V2", inputRefId: "resolution-pending" }, true, unresolved), true);
});

test("an opening worker race completes idempotently after synchronous opening moved the turn", async () => {
  const prisma = { storyTaskOutbox: { findFirst: async () => ({ inputRefId: "turn-a" }) } };
  const service = new ContinuousStoryV2Service(prisma as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
  (service as any).generateOpeningForTurn = async () => {
    throw { getResponse: () => ({ code: "OPENING_TURN_MOVED" }) };
  };
  assert.deepEqual(await service.executeOpeningTask("task-a", { taskId: "task-a", leaseOwner: "worker-a", leaseVersion: 1 }), { outcome: "TURN_ALREADY_MOVED" });
});

test("role impact ordering waits only for a lower unfinished sequence of the same role", () => {
  const tasks = [
    { id: "same-lower", roleId: "role-a", status: "PENDING", resultJson: { appliedWorldSequence: 4 } },
    { id: "other-lower", roleId: "role-b", status: "RUNNING", resultJson: { appliedWorldSequence: 1 } },
    { id: "same-finished", roleId: "role-a", status: "COMPLETED", resultJson: { appliedWorldSequence: 2 } },
    { id: "same-higher", roleId: "role-a", status: "PENDING", resultJson: { appliedWorldSequence: 8 } }
  ];
  assert.deepEqual(findEarlierUnfinishedRoleImpact("current", "role-a", 7, tasks), {
    taskId: "same-lower",
    appliedWorldSequence: 4
  });
  assert.equal(findEarlierUnfinishedRoleImpact("current", "role-c", 7, tasks), null, "global sequence gaps must not block another role");
});

test("historical fact filtering rejects content updated by any future or unknown action", () => {
  const applied = new Set(["action-old"]);
  assert.equal(canonFactIsSafeAtSequence(["action-old"], applied), true);
  assert.equal(canonFactIsSafeAtSequence(["action-old", "action-future"], applied), false);
  assert.equal(canonFactIsSafeAtSequence([], applied), true);
});

test("durable OpenNovel context snapshot is reusable and future-world recompilation is fenced", () => {
  const snapshot = {
    identity: { runId: "run-a", roleId: "role-a", actorTurnId: "turn-a", worldSequence: 2, snapshotHash: "hash-a" },
    contextReport: { snapshotHash: "hash-a" },
    items: []
  } as any;
  const stored = readStoredOpenNovelRoleContext({
    openNovelRoleContext: {
      schemaVersion: "openovel_role_context_v2",
      recordId: "context-a",
      snapshot,
      previousCanonHash: "canon-before",
      finalization: { visibleFacts: [], incomingImpacts: [], assets: [] }
    }
  });
  assert.equal(stored?.recordId, "context-a");
  assert.equal(stored?.compilation.ok, true);
  assert.equal(stored?.previousCanonHash, "canon-before");
  assert.equal(wouldRecompileAfterFutureWorldAdvance(5, 3), true);
  assert.equal(wouldRecompileAfterFutureWorldAdvance(3, 3), false);
  assert.deepEqual(interactionSourceSequenceFilter(3), {
    sourceResolution: { appliedWorldSequence: { lte: 3 } }
  }, "dynamic pending interactions must also be bounded to the historical result sequence");
});

test("OpenNovel role context is compiled at the reserved base sequence and persisted before commit", async () => {
  const events: string[] = [];
  let persistedPatch: any;
  const snapshot = {
    identity: {
      runId: "run-a",
      roleId: "role-a",
      actorTurnId: "turn-a",
      worldSequence: 2,
      snapshotHash: "hash-a"
    },
    contextReport: { snapshotHash: "hash-a" },
    items: [
      { itemId: "fact:fact-row-a", sourceType: "VISIBLE_FACT", content: "冻结事实" },
      { itemId: "asset:asset-row-a", sourceType: "ASSET_OR_EVIDENCE", content: "冻结资产" },
      { itemId: "impact:0", sourceType: "INCOMING_IMPACT", content: "冻结影响" }
    ]
  } as any;
  const prisma = {
    actionResolution: {
      updateMany: async ({ data }: any) => {
        persistedPatch = data.statePatchJson;
        events.push(`persist:${data.statePatchJson.openNovelRoleContext.recordId}`);
        return { count: 1 };
      }
    }
  };
  const storyContexts = {
    compileForResolution: async ({ run }: any) => {
      events.push(`compile:${run.worldSequence}`);
      return { recordId: "context-a", compilation: { ok: true, snapshot, report: snapshot.contextReport } };
    }
  };
  const service = new ContinuousStoryV2Service(prisma as never, null as never, null as never, null as never, storyContexts as never, null as never, null as never, null as never);
  const result = await (service as any).prepareOpenNovelRoleContext({
    context: {
      run: { id: "run-a", worldSequence: 3 },
      role: { id: "role-a" },
      turn: { id: "turn-a", contextJson: { roleCanonHash: "canon-before" } },
      control: { epoch: 1 },
      situationInput: {},
      visibleFacts: [{ factKey: "fact-a", content: "冻结事实" }],
      incomingImpacts: [{ sourceRoleName: "role-b", content: "冻结影响" }],
      assets: [{ id: "asset-row-a", assetKey: "asset-a", ownerRoleId: "role-a", ownerActorKey: null, quantity: 1, status: "ACTIVE", visibility: "PRIVATE" }]
    },
    action: { receiptText: "confirmed" },
    resolution: {
      id: "resolution-a",
      qualityStatus: "GENERATING",
      baseWorldSequence: 2,
      appliedWorldSequence: 3,
      statePatchJson: { schemaVersion: "pending_world_mutation_v1" },
      run: { worldSequence: 2 }
    },
    historicalFacts: [{ id: "fact-row-a", factKey: "fact-a", content: "冻结事实", visibility: "private", knownByRoleIdsJson: ["role-a"] }]
  });
  assert.equal(result.recordId, "context-a");
  assert.deepEqual(events, ["compile:2", "persist:context-a"]);
  assert.equal(persistedPatch.openNovelRoleContext.schemaVersion, "openovel_role_context_v2");
  assert.equal(persistedPatch.openNovelRoleContext.previousCanonHash, "canon-before");
  assert.deepEqual(persistedPatch.openNovelRoleContext.finalization, {
    visibleFacts: [{ factKey: "fact-a", content: "冻结事实" }],
    incomingImpacts: [{ sourceRoleName: "role-b", content: "冻结影响" }],
    assets: [{ assetKey: "asset-a", ownerRoleId: "role-a", ownerActorKey: null, quantity: 1, status: "ACTIVE", visibility: "PRIVATE" }]
  });
});

test("WORLD_COMMITTED retry reuses its durable role context even after the run advances", async () => {
  const snapshot = {
    identity: {
      runId: "run-a",
      roleId: "role-a",
      actorTurnId: "turn-a",
      worldSequence: 2,
      snapshotHash: "hash-a"
    },
    contextReport: { snapshotHash: "hash-a" },
    items: []
  } as any;
  const storyContexts = { compileForResolution: async () => { throw new Error("must not recompile"); } };
  const service = new ContinuousStoryV2Service({} as never, null as never, null as never, null as never, storyContexts as never, null as never, null as never, null as never);
  const result = await (service as any).prepareOpenNovelRoleContext({
    context: {
      run: { id: "run-a", worldSequence: 3 },
      role: { id: "role-a" },
      turn: { id: "turn-a" },
      control: { epoch: 1 },
      situationInput: {}
    },
    action: {},
    resolution: {
      id: "resolution-a",
      qualityStatus: "WORLD_COMMITTED",
      baseWorldSequence: 2,
      appliedWorldSequence: 3,
      statePatchJson: {
        frozenRoleContext: { observedWorldSequence: 2 },
        openNovelRoleContext: {
          schemaVersion: "openovel_role_context_v2",
          recordId: "context-a",
          snapshot,
          previousCanonHash: "canon-before",
          finalization: { visibleFacts: [], incomingImpacts: [], assets: [] }
        }
      },
      run: { worldSequence: 8 }
    },
    historicalFacts: []
  });
  assert.equal(result.recordId, "context-a");
});

test("WORLD_COMMITTED multiplayer retry validates the frozen observation sequence rather than the later commit base", async () => {
  const snapshot = {
    identity: {
      runId: "run-a",
      roleId: "role-a",
      actorTurnId: "turn-a",
      worldSequence: 2,
      snapshotHash: "hash-a"
    },
    contextReport: { snapshotHash: "hash-a" },
    items: []
  } as any;
  const storyContexts = { compileForResolution: async () => { throw new Error("must not recompile"); } };
  const service = new ContinuousStoryV2Service({} as never, null as never, null as never, null as never, storyContexts as never, null as never, null as never, null as never);
  const result = await (service as any).prepareOpenNovelRoleContext({
    context: {
      run: { id: "run-a", worldSequence: 8 },
      role: { id: "role-a" },
      turn: { id: "turn-a" },
      control: { epoch: 1 },
      situationInput: {}
    },
    action: {},
    resolution: {
      id: "resolution-a",
      qualityStatus: "WORLD_COMMITTED",
      baseWorldSequence: 6,
      appliedWorldSequence: 7,
      statePatchJson: {
        frozenRoleContext: { observedWorldSequence: 2 },
        openNovelRoleContext: {
          schemaVersion: "openovel_role_context_v2",
          recordId: "context-a",
          snapshot,
          previousCanonHash: "canon-before",
          finalization: { visibleFacts: [], incomingImpacts: [], assets: [] }
        }
      },
      run: { worldSequence: 8 }
    },
    historicalFacts: []
  });
  assert.equal(result.recordId, "context-a");
});

test("next-turn working set uses frozen facts/assets plus only this committed resolution", () => {
  const action = {
    visibility: "PRIVATE",
    receiptText: "本角色已提交并确认的结果",
    observableTraceText: null,
    effectFactKeys: ["fact-own"],
    targetRoleId: "role-b",
    leverageDispositions: [{ assetKey: "token-a", disposition: "TRANSFER" }]
  } as any;
  const facts = visibleFactsThroughCommittedResolution(
    [{ factKey: "fact-old", content: "冻结事实" }],
    action,
    [{ factKey: "fact-own", visibility: "PRIVATE" }]
  );
  assert.deepEqual(facts, [
    { factKey: "fact-old", content: "冻结事实" },
    { factKey: "fact-own", content: "本角色已提交并确认的结果" }
  ]);
  assert.equal(facts.some((fact) => fact.factKey === "fact-future"), false);

  const assets = assetsThroughCommittedResolution([{
    assetKey: "token-a",
    ownerRoleId: "role-a",
    ownerActorKey: null,
    quantity: 1,
    status: "ACTIVE",
    visibility: "PRIVATE"
  }], action, "role-a");
  assert.equal(assets[0].ownerRoleId, "role-b");
});

test("OpenNovel nextInput and finalize are wired to the immutable working set", () => {
  const source = readFileSync(join(process.cwd(), "src/continuous-story-v2/continuous-story-v2.service.ts"), "utf8");
  assert.match(source, /targetRoleId: context\.role\.id,[\s\S]{0,160}interactionSourceSequenceFilter\(context\.run\.worldSequence\)/);
  assert.match(source, /finalizationVisibleFacts = visibleFactsThroughCommittedResolution/);
  assert.match(source, /visibleFactKeysJson: input\.nextInput\.visibleFacts\.map/);
  assert.match(source, /factKeysJson: input\.nextInput\.visibleFacts\.map/);
  assert.match(source, /openNovelWorkingSet: input\.openNovelWorkingSet/);
  assert.match(source, /useOpenNovel && openNovelWorldCommitted\s*\? Promise\.resolve\(\[\]\)/);
});

test("OpenNovel production state machine marks WORLD_COMMITTED after the authoritative mutation", async () => {
  const order: string[] = [];
  const resolution = {
    id: "resolution-a",
    runId: "run-a",
    roleId: "role-a",
    playerActionId: "action-a",
    appliedWorldSequence: 3,
    qualityStatus: "GENERATING",
    turn: { id: "turn-a", status: "RESOLVING", thread: {} },
    run: {},
    submission: {},
    playerAction: {}
  };
  const tx = {
    storyTaskOutbox: { findFirst: async () => ({ id: "task-a" }), findMany: async () => [] },
    actionResolution: {
      findUnique: async () => resolution,
      update: async ({ data }: any) => { order.push(`resolution:${data.qualityStatus}`); return {}; }
    },
    playerAction: {
      update: async ({ data }: any) => { order.push(`action:${data.resolvedJson.storyGenerationStatus}`); return {}; }
    }
  };
  const prisma = { $transaction: async (operation: (client: any) => unknown) => operation(tx) };
  const service = new ContinuousStoryV2Service(prisma as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
  (service as any).applyReservedWorldMutation = async () => { order.push("world-mutation"); };
  const result = await (service as any).commitReservedWorldForRoleRuntime({
    context: {},
    action: {},
    stageProgress: {},
    resolutionId: resolution.id,
    resultFence: { taskId: "task-a", leaseOwner: "worker-a", leaseVersion: 1 }
  });
  assert.deepEqual(order, ["world-mutation", "resolution:WORLD_COMMITTED", "action:PENDING_ROLE_RUNTIME"]);
  assert.deepEqual(result, { resolutionId: "resolution-a", appliedWorldSequence: 3 });
});

test("OpenNovel world commit refuses to overtake an earlier failed impact", async () => {
  let mutated = false;
  const resolution = {
    id: "resolution-a",
    runId: "run-a",
    roleId: "role-a",
    playerActionId: "action-a",
    appliedWorldSequence: 5,
    qualityStatus: "GENERATING",
    turn: { id: "turn-a", status: "RESOLVING", thread: {} },
    run: {},
    submission: {},
    playerAction: {}
  };
  const tx = {
    storyTaskOutbox: {
      findFirst: async () => ({ id: "result-task" }),
      findMany: async () => [{ id: "failed-impact", roleId: "role-a", status: "FAILED", resultJson: { appliedWorldSequence: 4 } }]
    },
    actionResolution: { findUnique: async () => resolution }
  };
  const prisma = { $transaction: async (operation: (client: any) => unknown) => operation(tx) };
  const service = new ContinuousStoryV2Service(prisma as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
  (service as any).applyReservedWorldMutation = async () => { mutated = true; };
  await assert.rejects((service as any).commitReservedWorldForRoleRuntime({
    context: {},
    action: {},
    stageProgress: {},
    resolutionId: resolution.id,
    resultFence: { taskId: "result-task", leaseOwner: "worker-a", leaseVersion: 1 }
  }), /earlier impact/i);
  assert.equal(mutated, false);
});

test("OpenNovel impact input is based on the impact sequence, not the stale turn base", () => {
  const source = readFileSync(join(process.cwd(), "src/continuous-story-v2/continuous-story-v2.service.ts"), "utf8");
  assert.match(source, /baseWorldSequence: payload\.appliedWorldSequence - 1/);
  assert.doesNotMatch(source, /turnKind: "RESULT",[\s\S]{0,180}baseWorldSequence: turn\.baseWorldSequence/);
});

test("runtime-before-database crack replays the original impact identity and repairs its receipt", () => {
  const source = readFileSync(join(process.cwd(), "src/continuous-story-v2/continuous-story-v2.service.ts"), "utf8");
  const impactMethod = source.slice(source.indexOf("async executeImpactTask"), source.indexOf("async executeResultTask"));
  assert.match(impactMethod, /status: \{ in: \["OPEN", "RESOLVING"\] \}/);
  assert.match(impactMethod, /isImpactTargetTurnEligible\(latestTurn\.status, true\)/);
  assert.match(source, /const previousCanonHash = typeof turnRuntimeContext\.roleCanonHash === "string"/);
  assert.match(source, /previousCanonHash,[\s\S]{0,200}status\.appliedWorldSequence > payload\.appliedWorldSequence/);
  assert.doesNotMatch(source, /status\.appliedWorldSequence >= payload\.appliedWorldSequence/);
  assert.ok(impactMethod.indexOf("syncImpacts(") >= 0);
  assert.ok(impactMethod.indexOf("publishOpenNovelImpactReceipt") > impactMethod.indexOf("syncImpacts("));
});

test("AI role turns are event-driven instead of opening or self-continuation loops", () => {
  const source = readFileSync(join(process.cwd(), "src/continuous-story-v2/continuous-story-v2.service.ts"), "utf8");
  const openingMethod = source.slice(source.indexOf("private async generateOpeningForTurn"), source.indexOf("async executeAgentTask"));
  const impactMethod = source.slice(source.indexOf("async executeImpactTask"), source.indexOf("async executeResultTask"));
  const reservedFinalizer = source.slice(source.indexOf("private async finalizeReservedResolution"), source.indexOf("private async applyResolution"));
  const legacyFinalizer = source.slice(source.indexOf("private async applyResolution"), source.indexOf("private async publishCrossImpacts"));

  assert.doesNotMatch(openingMethod, /taskType: "ACTOR_AGENT_TURN_V2"/, "an unclaimed AI role opening must not immediately act");
  assert.doesNotMatch(reservedFinalizer, /input\.actorKind === "AI" && postActionControl\?\.mode === "AI_ACTIVE"[\s\S]{0,800}taskType: "ACTOR_AGENT_TURN_V2"/, "an AI result must not create an endless next-agent loop");
  assert.doesNotMatch(legacyFinalizer, /if \(input\.actorKind === "AI"\) \{[\s\S]{0,800}taskType: "ACTOR_AGENT_TURN_V2"/, "the legacy finalizer must not create an endless next-agent loop");
  assert.match(impactMethod, /reconcileImpactTriggeredAgentTask/, "a relevant cross-role impact must be durably reconciled as the normal AI action trigger");
});

test("impact-triggered AI scheduling is fenced to AI control and one turn epoch", async () => {
  const calls: any[] = [];
  const tx = {
    storyTaskOutbox: {
      createMany: async (args: any) => {
        calls.push(args);
        return { count: 1 };
      }
    }
  };
  const service = new ContinuousStoryV2Service({} as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
  const common = {
    runId: "run-a",
    nodeId: "node-a",
    turnId: "turn-a",
    roleId: "role-a",
    playerActionId: "impact-action-a",
    appliedWorldSequence: 9
  };

  const human = await (service as any).enqueueImpactTriggeredAgentTask(tx, {
    ...common,
    control: { mode: "HUMAN_ACTIVE", epoch: 4 }
  });
  assert.deepEqual(human, { enqueued: false, reason: "ROLE_NOT_AI_CONTROLLED" });
  assert.equal(calls.length, 0);

  const ai = await (service as any).enqueueImpactTriggeredAgentTask(tx, {
    ...common,
    control: { mode: "AI_ACTIVE", epoch: 5 }
  });
  assert.deepEqual(ai, { enqueued: true, reason: "WORLD_IMPACT_TRIGGER" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].skipDuplicates, true);
  assert.deepEqual(calls[0].data.map((item: any) => ({
    taskType: item.taskType,
    status: item.status,
    dedupeKey: item.dedupeKey,
    controlEpoch: item.controlEpoch,
    controlReason: item.identityJson.controlReason,
    triggerKind: item.identityJson.triggerKind,
    triggerPlayerActionId: item.identityJson.triggerPlayerActionId,
    triggerWorldSequence: item.identityJson.triggerWorldSequence
  })), [{
    taskType: "ACTOR_AGENT_TURN_V2",
    status: "PENDING",
    dedupeKey: "ACTOR_AGENT_TURN_V2:turn-a:5",
    controlEpoch: 5,
    controlReason: "WORLD_IMPACT_TRIGGER",
    triggerKind: "CROSS_ROLE_IMPACT",
    triggerPlayerActionId: "impact-action-a",
    triggerWorldSequence: 9
  }]);
});

test("impact wake reconciliation is durable, decision-only, and resolving-safe", async () => {
  const created: any[] = [];
  const updated: any[] = [];
  const tx = {
    storyTaskOutbox: {
      createMany: async (args: any) => {
        created.push(args);
        return { count: 1 };
      }
    },
    actorTurn: {
      update: async (args: any) => {
        updated.push(args);
        return { id: args.where.id, status: "OPEN", contextJson: args.data.contextJson };
      }
    }
  };
  const service = new ContinuousStoryV2Service({} as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
  const common = {
    runId: "run-a",
    nodeId: "node-a",
    roleId: "role-a",
    control: { mode: "AI_ACTIVE", epoch: 7 },
    payload: { mode: "FULL", playerActionId: "impact-a", appliedWorldSequence: 11 }
  };

  const trace = await (service as any).reconcileImpactTriggeredAgentTask(tx, {
    ...common,
    turn: { id: "turn-a", status: "OPEN", contextJson: {} },
    payload: { ...common.payload, mode: "TRACE" }
  });
  assert.deepEqual(trace, { enqueued: false, reason: "TRACE_SYNC_ONLY" });

  const resolving = await (service as any).reconcileImpactTriggeredAgentTask(tx, {
    ...common,
    turn: { id: "turn-a", status: "RESOLVING", contextJson: {} }
  });
  assert.deepEqual(resolving, { enqueued: false, reason: "DEFERRED_TO_RESULT_FINALIZER" });

  const scheduled = await (service as any).reconcileImpactTriggeredAgentTask(tx, {
    ...common,
    turn: { id: "turn-a", status: "OPEN", contextJson: { preserved: true } }
  });
  assert.deepEqual(scheduled, { enqueued: true, reason: "WORLD_IMPACT_TRIGGER" });
  assert.equal(created.length, 1);
  assert.deepEqual(updated[0].data.contextJson, { preserved: true, agentWakeHandledThroughSequence: 11 });

  const replay = await (service as any).reconcileImpactTriggeredAgentTask(tx, {
    ...common,
    turn: { id: "turn-a", status: "OPEN", contextJson: { agentWakeHandledThroughSequence: 11 } }
  });
  assert.deepEqual(replay, { enqueued: false, reason: "IMPACT_ALREADY_RECONCILED" });
  assert.equal(created.length, 1);
  assert.equal(updated.length, 1);
});

test("AI result finalization preserves newer impact cursors and reconciles late decision impacts", () => {
  const source = readFileSync(join(process.cwd(), "src/continuous-story-v2/continuous-story-v2.service.ts"), "utf8");
  const agentMethod = source.slice(source.indexOf("async executeAgentTask"), source.indexOf("async executeConditionalTask"));
  const finalizer = source.slice(source.indexOf("private async finalizeReservedResolution"), source.indexOf("private async applyResolution"));
  const replayPath = source.slice(source.indexOf("if (existingReceipt)"), source.indexOf("if (actorThread.lastAppliedSequence"));
  assert.match(agentMethod, /latestRoleCursor\.lastAppliedSequence > context\.observedRoleAppliedSequence/);
  assert.match(agentMethod, /observedRoleAppliedSequence: context\.observedRoleAppliedSequence/);
  assert.match(finalizer, /Math\.max\(turn\.thread\.lastAppliedSequence, resolution\.appliedWorldSequence\)/);
  assert.match(finalizer, /entryType: "V2_CROSS_IMPACT"/);
  assert.match(finalizer, /reconcileImpactTriggeredAgentTask/);
  assert.match(replayPath, /reconcileImpactTriggeredAgentTask/, "receipt replay must repair a crash between the receipt and AI wake creation");
});

test("failure recovery resumes only an AI-originated or explicitly queued takeover action", () => {
  assert.equal(shouldResumeAiAfterFailedAction({ originalActorKind: "AI_TAKEOVER", sourceAgentTaskExists: false }), true);
  assert.equal(shouldResumeAiAfterFailedAction({ originalActorKind: "HUMAN", sourceAgentTaskExists: true }), true);
  assert.equal(shouldResumeAiAfterFailedAction({ originalActorKind: "HUMAN", sourceAgentTaskExists: false }), false);
});

test("the reservation transaction rejects an AI decision after the role impact cursor moves", () => {
  assert.equal(isAgentRoleObservationCurrent(12, 12), true);
  assert.equal(isAgentRoleObservationCurrent(13, 12), false);
  assert.equal(isAgentRoleObservationCurrent(12, undefined), false);
  const source = readFileSync(join(process.cwd(), "src/continuous-story-v2/continuous-story-v2.service.ts"), "utf8");
  const reservation = source.slice(source.indexOf("private async reserveResolution"), source.indexOf("private async commitMultiplayerEntry"));
  assert.match(reservation, /turn\.thread\.lastAppliedSequence, reservedAgentObservation/);
  assert.ok(
    reservation.indexOf("isAgentRoleObservationCurrent") < reservation.indexOf("reserveMultiplayerCommand"),
    "the role cursor fence must run inside the reservation transaction before durable command reservation"
  );
});

test("runtime-before-database result retry reuses the frozen pre-result canon hash", () => {
  const source = readFileSync(join(process.cwd(), "src/continuous-story-v2/continuous-story-v2.service.ts"), "utf8");
  const resultMethod = source.slice(source.indexOf("private async generateRealNarrative"), source.indexOf("private async finalizeGeneratedResult"));
  assert.match(source, /schemaVersion: "openovel_role_context_v2"/);
  assert.match(source, /previousCanonHash: typeof jsonRecord\(context\.turn\.contextJson\)\.roleCanonHash === "string"/);
  assert.match(resultMethod, /previousCanonHash: immutableRoleContext!\.previousCanonHash \|\| undefined/);
  assert.doesNotMatch(resultMethod, /previousCanonHash: status\.canonHash/);
});

test("the durable outbox vocabulary accepts both OpenNovel impact success outcomes", () => {
  const migration = readFileSync(join(process.cwd(), "../../prisma/migrations/20260803105500_openovel_impact_outcomes/migration.sql"), "utf8");
  assert.match(migration, /'ACTOR_IMPACT_SYNCED'/);
  assert.match(migration, /'ACTOR_IMPACT_ALREADY_SYNCED'/);
});

test("the durable control-transition vocabulary accepts continuous and Solo turn slots", () => {
  const migration = readFileSync(join(process.cwd(), "../../prisma/migrations/20260803111500_continuous_role_control_slots/migration.sql"), "utf8");
  assert.match(migration, /'NEXT_ACTOR_TURN'/);
  assert.match(migration, /'STORY_COMPLETED'/);
  assert.match(migration, /\^TURN:/);
  assert.match(migration, /\^SOLO:/);
});

test("the durable role-control vocabulary accepts scheduled reclaim completion reasons", () => {
  const migration = readFileSync(join(process.cwd(), "../../prisma/migrations/20260803120000_continuous_role_control_reasons/migration.sql"), "utf8");
  assert.match(migration, /'RECLAIM_EFFECTIVE_NEXT_ACTOR_TURN'/);
  assert.match(migration, /'RECLAIM_EFFECTIVE_NEXT_SOLO_TURN'/);
  assert.match(migration, /'RECLAIM_EFFECTIVE_NEXT_WINDOW'/);
});

test("terminal role-runtime failure does not park or undo a WORLD_COMMITTED resolution", async () => {
  const mutations: string[] = [];
  const tx = {
    storyTaskOutbox: { findUnique: async () => ({ id: "task-a", taskType: "ACTOR_RESULT_V2", inputRefId: "resolution-a" }) },
    actionResolution: {
      findUnique: async () => ({
        id: "resolution-a",
        qualityStatus: "WORLD_COMMITTED",
        playerActionId: "action-a",
        run: {},
        playerAction: {},
        submission: {},
        turn: { decisionSet: null }
      }),
      update: async () => { mutations.push("resolution-update"); }
    },
    creditCharge: { findUnique: async () => null }
  };
  const prisma = { $transaction: async (operation: (client: any) => unknown) => operation(tx) };
  const service = new ContinuousStoryV2Service(prisma as never, null as never, null as never, null as never, null as never, null as never, null as never, { commitCharge: async () => {} } as never);
  const result = await service.failReservedResultTask("task-a", "GENERATION_RETRY_EXHAUSTED");
  assert.deepEqual(result, { released: false, reason: "WORLD_ALREADY_COMMITTED_ROLE_RUNTIME_RETRY_REQUIRED" });
  assert.deepEqual(mutations, []);
});
