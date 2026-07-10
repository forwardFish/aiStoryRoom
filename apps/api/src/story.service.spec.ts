import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictException } from "@nestjs/common";
import {
  MvpStoryEngine,
  ROLE_DECISION_MODELS,
  SANGTIAN_DAYS,
  classifyMvpEnding,
  createFateSeedDefinition,
  evaluateFateSeedActivation,
  validateDecisionOutput
} from "./mvp-causal-runtime";
import { FileMvpStoryStorage, MemoryMvpStoryStorage } from "./mvp-storage";

const expectedDecisionTitles = [
  ["准许巡抚推进", "回应商会"],
  ["处理县令密信", "是否公开压巡抚"],
  ["处理巡抚急奏", "商会控粮"],
  ["使用暗账", "是否制止灭证"],
  ["回应内阁", "对待司礼监"],
  ["最终奏报", "最后见谁"]
];

async function expectConflict(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(error.getStatus(), 409);
    return true;
  });
}

async function playRoute(firstOptions: string[], secondOptions: string[]) {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });

  for (let dayIndex = 0; dayIndex < 6; dayIndex += 1) {
    assert.equal(view.run.currentDay, dayIndex + 1);
    assert.equal(view.activeDecision.title, expectedDecisionTitles[dayIndex][0]);
    view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
      version: view.run.version,
      optionKey: firstOptions[dayIndex]
    });
    assert.equal(view.activeDecision.title, expectedDecisionTitles[dayIndex][1]);
    view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
      version: view.run.version,
      optionKey: secondOptions[dayIndex]
    });
    assert.equal(view.run.decisionsCompletedToday, 2);
    assert.equal(view.run.status, "awaiting_day_advance");
    assert.equal(view.daySummary.playerKeyDecisions.length, 2);
    assert.deepEqual(view.daySummary.playerKeyDecisions, view.daySummary.keyDecisions);
    assert.deepEqual(view.daySummary.stateChangeSummary, view.daySummary.stateChanges);
    assert.equal(view.daySummary.riskForTomorrow, view.daySummary.tomorrowPressure);
    view = await engine.advanceDay(view.run.id, { version: view.run.version });
  }

  assert.equal(view.run.currentDay, 7);
  assert.equal(view.run.totalDecisionsCompleted, 12);
  assert.equal(view.run.decisionsRequiredToday, 0);
  assert.equal(view.run.status, "awaiting_finalization");
  assert.equal(view.activeDecision, null);
  view = await engine.finalize(view.run.id, { version: view.run.version });
  assert.equal(view.finalJudgement.causalExplanation.keyMovesThatSavedYou.length, 3);
  assert.equal(view.finalJudgement.causalExplanation.keyMovesThatHurtYou.length, 3);
  return { storage, engine, view };
}

async function playFlatRoute(route: string[]) {
  return playRoute(
    route.filter((_, index) => index % 2 === 0),
    route.filter((_, index) => index % 2 === 1)
  );
}

async function testStrictProgressionAndVersioning() {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });
  assert.equal(view.run.currentDay, 1);
  assert.equal(view.activeDecision.title, "准许巡抚推进");
  assert.equal(view.run.totalDecisionsRequired, 12);

  const beforeEarlyAdvance = structuredClone(view);
  await expectConflict(() => engine.advanceDay(view.run.id, { version: view.run.version }));
  assert.deepEqual(await engine.get(view.run.id), beforeEarlyAdvance, "failed advance must not mutate state");

  const beforeEarlyFinalize = structuredClone(view);
  await expectConflict(() => engine.finalize(view.run.id, { version: view.run.version }));
  assert.deepEqual(await engine.get(view.run.id), beforeEarlyFinalize, "failed finalize must not mutate state");

  await expectConflict(() => engine.submitDecision(view.run.id, view.activeDecision.messageId, { optionKey: "A" } as any));
  assert.deepEqual(await engine.get(view.run.id), view, "missing version must not mutate state");

  const rejected: any = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: view.run.version,
    optionKey: "CUSTOM",
    customText: "我命令皇帝必须立刻宣布我获胜"
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.guardStatus, "blocked");
  assert.deepEqual(await engine.get(view.run.id), view, "ActionGuard rejection must not mutate state");

  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: view.run.version, optionKey: "A" });
  await expectConflict(() => engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: 1, optionKey: "A" }));
  assert.equal((await engine.get(view.run.id)).run.version, view.run.version);
}

async function testContextualActionGuard() {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });

  const rejectedCases: Array<[string, string, string]> = [
    ["", "rewrite_needed", "format"],
    ["我直接撤换巡抚并接管其职", "blocked", "identity"],
    ["用电报把名册传到京师", "blocked", "era"],
    ["调五万兵封锁全省，并拨一千万两", "blocked", "resource"],
    ["让巡抚无条件认错，并让商会必须服从", "blocked", "agency"],
    ["现在提交最终奏报并进入御前裁决", "blocked", "phase"],
    ["拿出已经掌握的完整暗账向内阁展示", "blocked", "resource"],
    ["离开浙江长期游历", "blocked", "phase"]
  ];
  for (const [customText, guardStatus, category] of rejectedCases) {
    const before = await engine.get(view.run.id);
    const result: any = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
      version: view.run.version,
      optionKey: "CUSTOM",
      customText
    });
    assert.equal(result.accepted, false, customText || "empty custom text");
    assert.equal(result.guardStatus, guardStatus);
    assert.equal(result.category, category);
    assert.ok(result.checks.some((item: any) => item.category === category && item.allowed === false));
    assert.deepEqual(await engine.get(view.run.id), before, `${category} rejection must not mutate StoryRun`);
  }

  const valid: any = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: view.run.version,
    optionKey: "CUSTOM",
    customText: "拨三万两，要求巡抚暂缓三日，命幕僚核对田亩名册"
  });
  assert.equal(valid.run.version, view.run.version + 1);
  assert.equal(valid.run.totalDecisionsCompleted, 1);
  const validInternal = await storage.load(view.run.id);
  const acceptedGuard: any = validInternal.events.find((item) => item.type === "action_guard_accepted");
  assert.ok(acceptedGuard);
  assert.deepEqual(
    acceptedGuard.payload.checks.map((item: any) => [item.category, item.allowed]),
    [["identity", true], ["era", true], ["resource", true], ["phase", true], ["agency", true]]
  );

  const boundaryStorage = new MemoryMvpStoryStorage();
  const boundaryEngine = new MvpStoryEngine(boundaryStorage);
  let boundaryView: any = await boundaryEngine.create({ storyId: "sangtian" });
  const prefix = "命幕僚核对田亩名册并记录";
  const fiveHundred = `${prefix}${"核".repeat(500 - prefix.length)}`;
  const tooLong: any = await boundaryEngine.submitDecision(boundaryView.run.id, boundaryView.activeDecision.messageId, {
    version: boundaryView.run.version,
    optionKey: "CUSTOM",
    customText: `${fiveHundred}核`
  });
  assert.equal(tooLong.guardStatus, "rewrite_needed");
  assert.equal((await boundaryEngine.get(boundaryView.run.id)).run.version, boundaryView.run.version);
  boundaryView = await boundaryEngine.submitDecision(boundaryView.run.id, boundaryView.activeDecision.messageId, {
    version: boundaryView.run.version,
    optionKey: "CUSTOM",
    customText: fiveHundred
  });
  assert.equal(boundaryView.run.totalDecisionsCompleted, 1, "500 characters must continue through contextual checks");

  const phaseStorage = new MemoryMvpStoryStorage();
  const phaseEngine = new MvpStoryEngine(phaseStorage);
  let phaseView: any = await phaseEngine.create({ storyId: "sangtian" });
  for (let day = 1; day <= 5; day += 1) {
    phaseView = await phaseEngine.submitDecision(phaseView.run.id, phaseView.activeDecision.messageId, { version: phaseView.run.version, optionKey: "A" });
    phaseView = await phaseEngine.submitDecision(phaseView.run.id, phaseView.activeDecision.messageId, { version: phaseView.run.version, optionKey: "A" });
    phaseView = await phaseEngine.advanceDay(phaseView.run.id, { version: phaseView.run.version });
  }
  assert.equal(phaseView.run.currentDay, 6);
  assert.equal(phaseView.activeDecision.decisionKey, "d6_1");
  const finalReport: any = await phaseEngine.submitDecision(phaseView.run.id, phaseView.activeDecision.messageId, {
    version: phaseView.run.version,
    optionKey: "CUSTOM",
    customText: "拟定最终奏报，说明粮价、民心与责任"
  });
  assert.equal(finalReport.accepted, undefined);
  assert.equal(finalReport.run.totalDecisionsCompleted, 11, "the same phase-specific action must be allowed on day 6");
}

async function testFullRoutesAndCausalContracts() {
  const evidenceRoute = await playRoute(
    ["C", "A", "B", "C", "B", "B"],
    ["C", "C", "C", "B", "B", "B"]
  );
  const merchantRoute = await playRoute(
    ["A", "B", "B", "B", "C", "C"],
    ["A", "B", "B", "B", "C", "C"]
  );

  assert.equal(evidenceRoute.view.run.status, "finished");
  assert.equal(merchantRoute.view.run.status, "finished");
  assert.notEqual(
    evidenceRoute.view.finalJudgement.globalEnding.key,
    merchantRoute.view.finalJudgement.globalEnding.key,
    "materially different choices should produce different global endings"
  );
  for (const route of [evidenceRoute, merchantRoute]) {
    const judgement = route.view.finalJudgement;
    assert.ok(judgement.personalEnding.rank);
    assert.ok(judgement.personalEnding.narrative);
    assert.ok(judgement.emperorJudgement);
    assert.ok(judgement.futureAftermath);
    assert.ok(judgement.fateDebt.length > 0);
    assert.ok(judgement.causalExplanation.keyMovesThatSavedYou.every((item: any) => item.originEventId && item.text));
    assert.ok(judgement.causalExplanation.keyMovesThatHurtYou.every((item: any) => item.originEventId && item.text));
  }

  const internal = await evidenceRoute.storage.load(evidenceRoute.view.run.id);
  assert.equal(Object.keys(internal.causalLedger.roleDecisionModels).length, 6);
  assert.equal(Object.keys(ROLE_DECISION_MODELS).length, 6);
  assert.equal(internal.decisionHistory.length, 12);
  assert.equal(Object.keys(internal.daySummaries).length, 6);
  assert.ok(internal.causalLedger.fateSeeds.some((seed: any) => seed.status !== "dormant"), "conditions should trigger at least one FateSeed");
  assert.ok(internal.causalLedger.causalRecallMessages.every((recall: any) => recall.originEventIds.length > 0));
  for (const trace of internal.causalLedger.roleDecisionTraces) {
    for (const field of ["knownFacts", "unknownFacts", "currentFear", "currentDesire", "privateReasoningSummary", "chosenAction", "surfaceReason", "hiddenIntent", "messageToPlayer", "statePatch", "newFateSeeds", "sourceEventIds"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(trace, field), `role reaction missing ${field}`);
    }
  }

  const publicJson = JSON.stringify(evidenceRoute.view);
  assert.equal("events" in evidenceRoute.view, false);
  assert.equal("causalLedger" in evidenceRoute.view, false);
  assert.equal("roleDecisionModels" in evidenceRoute.view.dashboard, false);
  for (const hiddenField of ["privateReasoningSummary", "hiddenIntent", "unknownFacts", "hiddenMeaning", "backfireTriggers"]) {
    assert.equal(publicJson.includes(hiddenField), false, `public response leaked ${hiddenField}`);
  }
}

async function testFileStorageSurvivesEngineRestart() {
  const dir = await mkdtemp(join(tmpdir(), "mvp-storage-test-"));
  try {
    const firstEngine = new MvpStoryEngine(new FileMvpStoryStorage(dir));
    const created: any = await firstEngine.create({ storyId: "sangtian" });
    const secondEngine = new MvpStoryEngine(new FileMvpStoryStorage(dir));
    const restored: any = await secondEngine.get(created.run.id);
    assert.deepEqual(restored, created);
    const advancedDecision: any = await secondEngine.submitDecision(restored.run.id, restored.activeDecision.messageId, { version: restored.run.version, optionKey: "C" });
    const thirdEngine = new MvpStoryEngine(new FileMvpStoryStorage(dir));
    assert.deepEqual(await thirdEngine.get(created.run.id), advancedDecision);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testInvalidNarrativeProviderFallsBackToRules() {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage, {
    name: "invalid-test-provider",
    async generateDecisionCandidate() {
      return { immediateResult: { statePatch: { "皇帝信任": 100 } } };
    }
  });
  let view: any = await engine.create({ storyId: "sangtian" });
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: view.run.version, optionKey: "C" });
  assert.equal(view.runtime.narrativeProvider, "deterministic-rules");
  assert.equal(view.runtime.fallbackUsed, true);
  const internal = await storage.load(view.run.id);
  assert.ok(internal.events.some((item) => item.type === "ai_fallback"));
  assert.notEqual(internal.dashboard.worldState.find((item: any[]) => item[0] === "皇帝信任")?.[1], 100);
}

async function testRoleKnowledgeIsolation() {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });

  // "明准暗查" is covert: the巡抚 may observe pressure, but must not know the
  // exact choice or inherit unrelated private decision history.
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: view.run.version,
    optionKey: "C"
  });
  let internal = await storage.load(view.run.id);
  const covertReaction = internal.causalLedger.roleDecisionTraces.at(-1);
  assert.equal(covertReaction.roleKey, "xunfu");
  assert.equal(covertReaction.knownFacts.some((fact: string) => fact.includes("明准暗查")), false);
  assert.ok(covertReaction.unknownFacts.some((fact: string) => fact.includes("具体做法")));
  assert.equal(internal.decisionHistory.at(-1)?.knownByRoles?.includes("xunfu"), false);

  // A private meeting is still known to its direct participant.
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: view.run.version,
    optionKey: "B"
  });
  internal = await storage.load(view.run.id);
  const participantReaction = internal.causalLedger.roleDecisionTraces.at(-1);
  assert.equal(participantReaction.roleKey, "merchant");
  assert.ok(participantReaction.knownFacts.some((fact: string) => fact.includes("私下见商，只听不许")));
  assert.equal(internal.decisionHistory.at(-1)?.knownByRoles?.includes("merchant"), true);

  const publicJson = JSON.stringify(view);
  assert.equal(publicJson.includes("knownByRoles"), false);
  assert.equal(publicJson.includes("informationVisibility"), false);

  const aiStorage = new MemoryMvpStoryStorage();
  const aiEngine = new MvpStoryEngine(aiStorage, {
    name: "privacy-probe",
    async generateDecisionCandidate() {
      return {
        immediateResult: { resultMessage: { title: "规则内润色", narrative: "玩家可见的结果叙事。" } },
        visibleCausalCard: {
          decisionSummary: "玩家知道自己采取了暗查。",
          personalEcho: "玩家保留了一条后手。",
          worldEcho: "局势出现变化。",
          playerFacingHint: "这一步会在满足条件时回响。"
        },
        roleReactions: [{
          roleKey: "xunfu",
          messageToPlayer: { title: "LEAK_SENTINEL", narrative: "LEAK_SENTINEL" }
        }]
      };
    }
  });
  let aiView: any = await aiEngine.create({ storyId: "sangtian" });
  aiView = await aiEngine.submitDecision(aiView.run.id, aiView.activeDecision.messageId, {
    version: aiView.run.version,
    optionKey: "C"
  });
  assert.equal(aiView.runtime.fallbackUsed, false, "a valid narrator candidate should be accepted");
  assert.equal(JSON.stringify(aiView).includes("LEAK_SENTINEL"), false, "AI wording cannot leak a covert choice to an uninformed role");

  const customStorage = new MemoryMvpStoryStorage();
  const customEngine = new MvpStoryEngine(customStorage);
  let customView: any = await customEngine.create({ storyId: "sangtian" });
  customView = await customEngine.submitDecision(customView.run.id, customView.activeDecision.messageId, {
    version: customView.run.version,
    optionKey: "CUSTOM",
    customText: "暗中核对田亩账册 CUSTOM_SECRET_SENTINEL"
  });
  const customInternal = await customStorage.load(customView.run.id);
  const customReaction = customInternal.causalLedger.roleDecisionTraces.at(-1);
  assert.equal(customReaction.knowledgeMode, "observable_only");
  assert.equal(JSON.stringify(customReaction).includes("CUSTOM_SECRET_SENTINEL"), false);
  const roleMessages = customInternal.messages.filter((item: any) => item.type === "role_action");
  assert.equal(JSON.stringify(roleMessages).includes("CUSTOM_SECRET_SENTINEL"), false);
}

function testExplicitReactionRoleRouting() {
  const expected: Record<string, string[]> = {
    d1_1: ["xunfu", "xunfu", "xunfu"],
    d1_2: ["merchant", "merchant", "merchant"],
    d2_1: ["county_magistrate", "county_magistrate", "county_magistrate"],
    d2_2: ["xunfu", "xunfu", "xunfu"],
    d3_1: ["xunfu", "sili_jian", "xunfu"],
    d3_2: ["merchant", "merchant", "merchant"],
    d4_1: ["sili_jian", "merchant", "county_magistrate"],
    d4_2: ["xunfu", "xunfu", "xunfu"],
    d5_1: ["cabinet", "cabinet", "cabinet"],
    d5_2: ["sili_jian", "sili_jian", "sili_jian"],
    d6_1: ["emperor", "emperor", "emperor", "emperor"],
    d6_2: ["xunfu", "county_magistrate", "merchant", "emperor"]
  };
  for (const day of SANGTIAN_DAYS) {
    for (const decision of day.decisions) {
      assert.deepEqual(
        decision.options.map((item) => item.reactionRoleKey || decision.reactionRoleKey),
        expected[decision.key],
        `${decision.key} must route reactions to explicit participants`
      );
    }
  }
}

async function testEveryEndingIsReachable() {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage);
  const created: any = await engine.create({ storyId: "sangtian" });
  const initial = await storage.load(created.run.id);
  const stats: Record<string, number> = { ...initial.dashboard.roleState };
  for (const [key, value] of initial.dashboard.worldState) stats[String(key)] = Number(value);

  const decisions = SANGTIAN_DAYS.flatMap((day) => day.decisions);
  const route = Array<string>(decisions.length);
  const globalCounts = new Map<string, number>();
  const personalCounts = new Map<string, number>();
  const globalWitnesses = new Map<string, string[]>();
  const personalWitnesses = new Map<string, string[]>();

  function enumerate(index: number) {
    if (index === decisions.length) {
      const result = classifyMvpEnding(stats);
      globalCounts.set(result.globalKey, (globalCounts.get(result.globalKey) || 0) + 1);
      personalCounts.set(result.personalRank, (personalCounts.get(result.personalRank) || 0) + 1);
      if (!globalWitnesses.has(result.globalKey)) globalWitnesses.set(result.globalKey, [...route]);
      if (!personalWitnesses.has(result.personalRank)) personalWitnesses.set(result.personalRank, [...route]);
      return;
    }

    for (const selected of decisions[index].options) {
      const previous: Array<[string, number]> = [];
      for (const [key, delta] of Object.entries(selected.patch)) {
        previous.push([key, stats[key] || 0]);
        stats[key] = Math.max(0, Math.min(100, Math.round((stats[key] || 0) + Number(delta))));
      }
      route[index] = selected.key;
      enumerate(index + 1);
      for (const [key, value] of previous) stats[key] = value;
    }
  }

  enumerate(0);
  assert.deepEqual(
    [...globalCounts.keys()].sort(),
    ["merchant_control", "progress_without_people", "reform_and_audit", "scapegoat", "stable_but_watched"]
  );
  assert.deepEqual([...personalCounts.keys()].sort(), ["A", "B", "C", "D", "E", "S"]);
  for (const [key, count] of [...globalCounts, ...personalCounts]) {
    assert.ok(count > 100, `${key} must be reachable through more than 100 preset routes; got ${count}`);
  }

  const witnessExpectations = new Map<string, { globalKey?: string; personalRank?: string }>();
  for (const [globalKey, witness] of globalWitnesses) {
    witnessExpectations.set(witness.join(""), { ...(witnessExpectations.get(witness.join("")) || {}), globalKey });
  }
  for (const [personalRank, witness] of personalWitnesses) {
    witnessExpectations.set(witness.join(""), { ...(witnessExpectations.get(witness.join("")) || {}), personalRank });
  }
  for (const [witnessKey, expected] of witnessExpectations) {
    const result = await playFlatRoute([...witnessKey]);
    if (expected.globalKey) assert.equal(result.view.finalJudgement.globalEnding.key, expected.globalKey);
    if (expected.personalRank) assert.equal(result.view.finalJudgement.personalEnding.rank, expected.personalRank);
  }
}


async function testEveryPresetFateSeedHasBothFutures() {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage);
  const created: any = await engine.create({ storyId: "sangtian" });
  const initial = await storage.load(created.run.id);
  const stats: Record<string, number> = { ...initial.dashboard.roleState };
  for (const [key, value] of initial.dashboard.worldState) stats[String(key)] = Number(value);

  const decisions = SANGTIAN_DAYS.flatMap((day) => day.decisions);
  const suffixCounts = Array<number>(decisions.length + 1).fill(1);
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    suffixCounts[index] = suffixCounts[index + 1] * decisions[index].options.length;
  }

  const templates = decisions.map((decision, index) =>
    decision.options.map((selected) => ({
      optionId: `${decision.key}:${selected.key}`,
      seed: {
        ...createFateSeedDefinition(selected, `${decision.key}:${selected.key}`, Math.floor(index / 2) + 1),
        optionId: `${decision.key}:${selected.key}`
      }
    }))
  );
  const counts = new Map<string, { help: number; backfire: number }>();
  for (const choices of templates) {
    for (const { optionId } of choices) counts.set(optionId, { help: 0, backfire: 0 });
  }

  const seeds: any[] = [];
  function trigger(currentDay: number, weight: number) {
    const changed: any[] = [];
    for (const seed of seeds) {
      if (seed.status !== "dormant") continue;
      const activation = evaluateFateSeedActivation(seed, currentDay, stats);
      if (!activation) continue;
      seed.status = activation.kind === "help" ? "activated_help" : "activated_backfire";
      const optionCounts = counts.get(seed.optionId)!;
      optionCounts[activation.kind] += weight;
      changed.push(seed);
    }
    return changed;
  }

  function enumerate(index: number) {
    if (index === decisions.length) return;
    const currentDay = Math.floor(index / 2) + 1;
    for (let optionIndex = 0; optionIndex < decisions[index].options.length; optionIndex += 1) {
      const selected = decisions[index].options[optionIndex];
      const previous: Array<[string, number]> = [];
      for (const [key, delta] of Object.entries(selected.patch)) {
        previous.push([key, stats[key] || 0]);
        stats[key] = Math.max(0, Math.min(100, Math.round((stats[key] || 0) + Number(delta))));
      }
      const seed = structuredClone(templates[index][optionIndex].seed);
      seeds.push(seed);
      const changedAfterDecision = trigger(currentDay, suffixCounts[index + 1]);
      const changedAfterAdvance = index % 2 === 1
        ? trigger(currentDay + 1, suffixCounts[index + 1])
        : [];
      enumerate(index + 1);
      for (const changed of [...changedAfterAdvance, ...changedAfterDecision]) {
        changed.status = "dormant";
      }
      seeds.pop();
      for (const [key, value] of previous) stats[key] = value;
    }
  }

  enumerate(0);
  for (const [optionId, activationCounts] of counts) {
    assert.ok(activationCounts.help > 0, `${optionId} must retain a future help path`);
    assert.ok(activationCounts.backfire > 0, `${optionId} must retain a future backfire path`);
  }
}

function testSchemaValidationRejectsIncompleteCandidate() {
  assert.throws(() => validateDecisionOutput({ visibleCausalCard: null }), /invalid structured narrative output/);
}

async function main() {
  await testStrictProgressionAndVersioning();
  await testContextualActionGuard();
  await testFullRoutesAndCausalContracts();
  await testFileStorageSurvivesEngineRestart();
  await testInvalidNarrativeProviderFallsBackToRules();
  await testRoleKnowledgeIsolation();
  testExplicitReactionRoleRouting();
  await testEveryEndingIsReachable();
  await testEveryPresetFateSeedHasBothFutures();
  testSchemaValidationRejectsIncompleteCandidate();
  console.log("v4 causal MVP runtime assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
