import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical } from "@ai-story/shared";
import {
  PressureDecisionPresentationServiceV1,
  compilePressureDecisionPresentationContextV1,
  type PressureDecisionPresentationInputV1,
} from "./decision-presentation";

test("AI rewrites scene and three option expressions without changing action bindings", async () => {
  let calls = 0;
  const service = new PressureDecisionPresentationServiceV1({
    async renderDecisionPresentation(context) {
      calls += 1;
      assert.equal(context.legalActionContracts.length, 3);
      assert.equal(context.pressureGuidance, "九堰水势正在逼近总督府的最后回令时限。");
      return {
        sceneText: context.continuityExcerpt,
        question: "这道回令，你准备先保住什么？",
        options: context.legalActionContracts.map((action, index) => ({
          actionType: action.actionType,
          label: `动态行动${index + 1}`,
          description: `这是由当前现场生成的行动表达${index + 1}，只描述尝试与眼前取舍。`,
        })),
      };
    },
  });
  const input = fixture();
  const first = await service.present(input);
  const second = await service.present(input);
  assert.equal(calls, 1);
  assert.equal(first.summary, compilePressureDecisionPresentationContextV1(input).continuityExcerpt);
  assert.equal(first.title, "这道回令，你准备先保住什么？");
  assert.deepEqual(
    first.options.map(({ code, actionType, preferredEntry }) => ({ code, actionType, preferredEntry })),
    input.decision.options.map(({ code, actionType, preferredEntry }) => ({ code, actionType, preferredEntry })),
  );
  assert.deepEqual(second, first);
});

test("unknown AI action rejects the whole candidate and keeps the authored fallback", async () => {
  const input = fixture();
  const service = new PressureDecisionPresentationServiceV1({
    async renderDecisionPresentation(context) {
      return {
        sceneText: context.continuityExcerpt,
        question: "现在怎么办？",
        options: [
          { actionType: "INVENTED_ACTION", label: "虚构行动", description: "模型无权创造这种规则行动，所以整份输出必须回退。" },
          ...input.decision.options.slice(1).map((option) => ({
            actionType: option.actionType,
            label: option.label,
            description: option.description,
          })),
        ],
      };
    },
  });
  assert.deepEqual(await service.present(input), input.decision);
});

test("compiled context is hash-bound and contains only the three visible Catalog actions", () => {
  const context = compilePressureDecisionPresentationContextV1(fixture());
  const { contextHash, ...body } = context;
  assert.equal(contextHash, sha256Canonical(body));
  assert.deepEqual(context.legalActionContracts.map((item) => item.actionType), [
    "EVACUATE_WEIRS",
    "SEAL_BREACH_RECORD",
    "SUPPORT_WEIR",
  ]);
  assert.equal(context.playerIdentity.actorName, "胡宗宪");
  assert.equal(context.currentScene.phase, "OPENING");
  assert.match(context.currentScene.text, /驿卒/u);
  assert.equal(context.dialogueExamples.length, 6);
  assert.ok(context.legalActionContracts.every((contract) => contract.realTradeoff === null));
  assert.deepEqual(
    context.outputExample.options.map((option) => option.actionType),
    context.legalActionContracts.map((option) => option.actionType),
  );
  assert.match(context.factBoundary.forbiddenInferences.join("\n"), /合法行动方向/u);
  assert.equal(context.previousNarrative.authority, "CONTINUITY_ONLY");
  assert.equal(context.factBoundary.previousNarrativeIsNotAuthority, true);
  assert.deepEqual(context.factBoundary.durableStateSources, [
    "CURRENT_STATE",
    "SITUATION",
    "LEGAL_ACTION_CONTRACTS",
  ]);
  assert.match(context.factBoundary.forbiddenInferences.join("\n"), /临时文学细节不等于下一轮权威事实/u);
  assert.match(context.playerIdentity.hardLimit, /不能/u);
  assert.match(context.characterRules.privatePressure, /海防/u);
  assert.doesNotMatch(JSON.stringify(context), /otherSeatSecret|providerRaw|DEFAULT_PASS/u);
});

function fixture(): PressureDecisionPresentationInputV1 {
  return {
    chapter: {
      chapterRuntimeId: "chapter-runtime-n1",
      chapterId: "N1",
      chapterNumber: 1,
      title: "九堰将决",
      phase: "ACTIVE",
      workingRevision: 0,
    },
    viewer: {
      seatId: "zhejiang_governor",
      roleName: "浙江总督",
      control: {
        mode: "HUMAN_ACTIVE",
        controlEpoch: 1,
        canSubmit: true,
        canReclaim: false,
        submissionFenceToken: "a".repeat(64),
        reclaimFenceToken: null,
      },
    },
    situation: { goal: "守住九堰", risk: "水势继续上涨", judgment: "必须下令" },
    metrics: [],
    resources: [],
    narrative: {
      status: "FALLBACK_PUBLISHED",
      projectionKind: "GENESIS_NARRATIVE",
      sourceAuthority: "GENESIS_FROZEN",
      sourceId: "genesis-source",
      sourceCommitHash: "b".repeat(64),
      text: "驿卒把第三封水报按在案上，门外催令声又起。胡宗宪看见百姓、堰口和记录三件事同时逼到眼前。",
      contentHash: "c".repeat(64),
      renderMode: "AUTHORED_FALLBACK",
    },
    decision: {
      decisionPointId: "N1.weir_crisis",
      mode: "SOLO_BEAT",
      requirement: "REQUIRED",
      title: "你先下哪一道命令？",
      summary: "九堰水势正在逼近总督府的最后回令时限。",
      expectedWorkingRevision: 0,
      options: [
        option("EVACUATE_WEIRS", "PLAN", "组织疏散"),
        option("SEAL_BREACH_RECORD", "INVESTIGATE", "封存记录"),
        option("SUPPORT_WEIR", "TOKEN", "增援堰口"),
      ],
      submitLabel: "确认正式行动",
      customActionAllowed: true,
    },
  };
}

function option(
  actionType: string,
  preferredEntry: "PLAN" | "INVESTIGATE" | "TOKEN",
  label: string,
) {
  return {
    code: actionType,
    actionType,
    preferredEntry,
    label,
    description: `${label}的冻结回退说明。`,
  };
}
