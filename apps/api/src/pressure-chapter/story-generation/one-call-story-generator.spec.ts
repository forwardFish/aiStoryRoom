import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical } from "@ai-story/shared";
import { PressureOneCallStoryGeneratorV1 } from "./one-call-story-generator";
import type { PressureViewerStoryPackV1 } from "../production-config/viewer-story-pack";

const longScene = "雨线压在签押房外，传令脚步一阵紧过一阵。案上已经核验的回报和仍待执行的命令被重新分开，所有人都看着最后一处空白签押。胡宗宪没有替任何人预写结果，只把当前能够采取的两条路径推到灯下，要求这一次选择必须说清去向、经手和眼前代价。";

test("ordinary Beat uses exactly one Provider call and preserves the legal action set", async () => {
  let calls = 0;
  const service = new PressureOneCallStoryGeneratorV1({
    async renderOneCallStory(context) {
      calls += 1;
      assert.equal(context.mode, "TURN");
      return {
        sceneText: longScene,
        question: "这道命令先送往哪一处？",
        options: [
          { actionRef: "N1.dispatch_route#CONFIRM_DISPATCH_ROUTE", label: "确认主路", description: "核对收件人和传令路线后送出命令。" },
          { actionRef: "N1.dispatch_route#REDIRECT_DISPATCH_ROUTE", label: "改走备路", description: "撤回原路线并指定可核验的替代送达链。" },
        ],
      };
    },
  });
  const result = await service.generate({
    mode: "TURN",
    storyPack: pack(),
    turnFallback: { sceneText: "冻结剧情回退。", question: "冻结问题？" },
  });
  assert.equal(calls, 1);
  assert.equal(result.mode, "TURN");
  assert.equal(result.renderMode, "PROVIDER");
  assert.deepEqual(result.options.map((item) => item.actionType), ["CONFIRM_DISPATCH_ROUTE", "REDIRECT_DISPATCH_ROUTE"]);
});

test("last Beat uses exactly one Provider call for narrative and structured summary", async () => {
  let calls = 0;
  const authority = summaryAuthority();
  const service = new PressureOneCallStoryGeneratorV1({
    async renderOneCallStory(context) {
      calls += 1;
      assert.equal(context.mode, "CHAPTER_SUMMARY");
      return {
        closingNarrative: longScene,
        playerActions: authority.playerActions.map((item) => ({ actionId: item.actionId, text: item.text })),
        actualResults: authority.actualResults.map((item) => ({ resultRef: item.resultRef, text: item.text })),
        completedObjectives: authority.completedObjectives.map((item) => ({ objectiveRef: item.objectiveRef, text: item.text })),
        incompleteObjectives: authority.incompleteObjectives.map((item) => ({ objectiveRef: item.objectiveRef, text: item.text })),
        metricChanges: authority.metricChanges.map((item) => ({ metricRef: item.metricRef, label: item.label, before: item.before, delta: item.delta, after: item.after })),
        remainingPressures: authority.remainingPressures.map((item) => ({ pressureRef: item.pressureRef, text: item.text })),
        nextChapterHook: "第一道奏疏必须解释九堰之夜留下的责任链。",
      };
    },
  });
  const result = await service.generate({ mode: "CHAPTER_SUMMARY", storyPack: pack(), summaryAuthority: authority });
  assert.equal(calls, 1);
  assert.equal(result.mode, "CHAPTER_SUMMARY");
  assert.equal(result.renderMode, "PROVIDER");
  assert.equal(result.metricChanges[0]!.delta, 2);
});

test("Provider failure or invalid authority data falls back completely without another call", async () => {
  for (const mode of ["THROW", "MUTATE"] as const) {
    let calls = 0;
    const service = new PressureOneCallStoryGeneratorV1({
      async renderOneCallStory() {
        calls += 1;
        if (mode === "THROW") throw new Error("offline");
        const authority = summaryAuthority();
        return {
          closingNarrative: longScene,
          playerActions: authority.playerActions.map((item) => ({ actionId: item.actionId, text: item.text })),
          actualResults: authority.actualResults.map((item) => ({ resultRef: item.resultRef, text: item.text })),
          completedObjectives: [], incompleteObjectives: [], remainingPressures: [],
          metricChanges: [{ metricRef: "civilian_land", label: "民生", before: 50, delta: 99, after: 149 }],
          nextChapterHook: "错误输出。",
        };
      },
    });
    const result = await service.generate({ mode: "CHAPTER_SUMMARY", storyPack: pack(), summaryAuthority: summaryAuthority() });
    assert.equal(calls, 1);
    assert.equal(result.mode, "CHAPTER_SUMMARY");
    assert.equal(result.renderMode, "DETERMINISTIC_FALLBACK");
    assert.equal(result.metricChanges[0]!.delta, 2);
  }
});

function pack(): PressureViewerStoryPackV1 {
  const body = {
    schemaVersion: "pressure_viewer_story_pack_v1" as const,
    identity: { runId: "run", routeHash: "a".repeat(64), chapterRuntimeId: "runtime", chapterId: "N1", beatId: "N1.B02", previousBeatId: "N1.B01", viewerSeatId: "zhejiang_governor" as const, authorityRevision: 1, stateAfterHash: "b".repeat(64) },
    previousAction: { actionId: "action-1", actionType: "EVACUATE_WEIRS", summary: "先行疏散。" },
    visibleSeatResults: [],
    authority: { facts: [{ factRef: "working.N1.intake.evacuation_ordered", text: "疏散令已送出。", source: "WORKING_LEDGER" }], metrics: [], allowedClaims: [] },
    authorialMaterials: [{ materialRef: "publicMainline.afterPrepareCommon", title: "回报", text: "第一批回报抵达。", factRefs: ["working.N1.intake.evacuation_ordered"], stopCondition: null }],
    decision: {
      decisionContractRef: "N1.weir_crisis.prepare.dispatch",
      decisionPointRef: "N1.dispatch_route",
      legalActionRefs: ["N1.dispatch_route#CONFIRM_DISPATCH_ROUTE", "N1.dispatch_route#REDIRECT_DISPATCH_ROUTE"],
      catalogActions: [
        { actionRef: "N1.dispatch_route#CONFIRM_DISPATCH_ROUTE", actionType: "CONFIRM_DISPATCH_ROUTE", label: "确认主路", description: "沿已核验路线送出。", preferredEntry: "PLAN" },
        { actionRef: "N1.dispatch_route#REDIRECT_DISPATCH_ROUTE", actionType: "REDIRECT_DISPATCH_ROUTE", label: "改走备路", description: "撤回原路改走备路。", preferredEntry: "PLAN" },
      ],
    },
    cacheKey: "c".repeat(64),
  };
  return { ...body, packHash: sha256Canonical(body) };
}

function summaryAuthority() {
  return {
    chapterId: "N1", title: "九堰将决", sourceCommitHash: "d".repeat(64),
    closingNarrativeFallback: "诸令已经封缄，堰口、疏散和责任记录都进入冻结结算。",
    playerActions: [{ actionId: "action-1", text: "你下令先撤低洼处百姓。" }],
    actualResults: [{ resultRef: "result.evacuation", text: "多数低洼处百姓完成撤离。" }],
    completedObjectives: [{ objectiveRef: "objective.evacuation", text: "完成紧急疏散。" }],
    incompleteObjectives: [{ objectiveRef: "objective.all-weirs", text: "仍有堰口缺少增援。" }],
    metricChanges: [{ metricRef: "civilian_land", label: "民生", before: 50, delta: 2, after: 52, displayBefore: "50", displayDelta: "+2", displayAfter: "52" }],
    remainingPressures: [{ pressureRef: "pressure.memorial", text: "朝廷仍等待第一道奏疏。" }],
    nextChapterId: "N2", nextChapterHookFallback: "下一章将进入灾后第一道奏疏。",
  };
}
