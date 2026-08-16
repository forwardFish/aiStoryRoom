import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical } from "@ai-story/shared";
import {
  PressureTurnPresentationServiceV1,
  compilePressureTurnPresentationContextV1,
  type PressureTurnPresentationContextV1,
  type PressureTurnPresentationInputV1,
} from "./decision-presentation";

test("AI rewrites scene and three option expressions without changing action bindings", async () => {
  let calls = 0;
  const service = new PressureTurnPresentationServiceV1({
    async renderTurnPresentation(context) {
      calls += 1;
      assert.equal(context.legalActionContracts.length, 3);
      assert.equal(context.pressureGuidance, "赈济奏疏必须说明灾情与请求。");
      return candidate(context, {
        sceneText: literaryScene("长案上的灾情簿还没有合拢"),
        question: "这道回令，你准备先保住什么？",
        options: context.legalActionContracts.map((action, index) => ({
          actionType: action.actionType,
          label: `动态行动${index + 1}`,
          description: `这是由当前现场生成的行动表达${index + 1}，只描述尝试与眼前取舍。`,
        })),
      });
    },
  });
  const input = continuationFixture();
  const first = await service.present(input);
  const second = await service.present(input);
  assert.equal(calls, 1);
  assert.match(first.summary, /长案上的灾情簿/u);
  assert.equal(first.title, "这道回令，你准备先保住什么？");
  assert.deepEqual(
    first.options.map(({ code, actionType, preferredEntry }) => ({ code, actionType, preferredEntry })),
    input.decision.options.map(({ code, actionType, preferredEntry }) => ({ code, actionType, preferredEntry })),
  );
  assert.deepEqual(second, first);
});

test("continuation generates a new literary scene and ignores non-authoritative option metadata", async () => {
  const input = continuationFixture();
  const service = new PressureTurnPresentationServiceV1({
    async renderTurnPresentation(context) {
      return candidate(context, {
        sceneText: literaryScene("奏疏房里刚换过一轮灯油"),
        question: "这道奏疏，你准备先写清哪一件事？",
        options: context.legalActionContracts.map((action, index) => ({
          actionType: action.actionType,
          label: `行动${index + 1}`,
          description: `根据当前现场提出第${index + 1}项具体行动，并只说明它的直接目的。`,
          rationale: "presentation-only metadata",
        })),
      });
    },
  });

  const result = await service.present(input);
  const context = compilePressureTurnPresentationContextV1(input);
  assert.match(result.summary, /奏疏房里刚换过一轮灯油/u);
  assert.notEqual(result.summary, context.continuityExcerpt);
  assert.deepEqual(
    result.options.map((option) => option.actionType),
    input.decision.options.map((option) => option.actionType),
  );
});

test("unknown AI action rejects the whole candidate and keeps the authored fallback", async () => {
  const input = continuationFixture();
  const service = new PressureTurnPresentationServiceV1({
    async renderTurnPresentation(context) {
      return candidate(context, {
        sceneText: literaryScene("签押房的门刚刚合上"),
        question: "现在怎么办？",
        options: [
          { actionType: "INVENTED_ACTION", label: "虚构行动", description: "模型无权创造这种规则行动，所以整份输出必须回退。" },
          ...input.decision.options.slice(1).map((option) => ({
            actionType: option.actionType,
            label: option.label,
            description: option.description,
          })),
        ],
      });
    },
  });
  const result = await service.present(input);
  assert.deepEqual(result, {
    ...input.decision,
    title: "你准备如何应对？",
    summary: input.narrative.text,
  });
});

test("Provider absence keeps the published narrative as the safe story fallback", async () => {
  const input = continuationFixture();
  const service = new PressureTurnPresentationServiceV1(null);

  const result = await service.present(input);

  assert.equal(result.summary, input.narrative.text);
  assert.notEqual(result.summary, input.decision.summary);
  assert.deepEqual(result.options, input.decision.options);
});

test("pending Narrative uses the authored scene frame so the next story does not wait for a worker", async () => {
  const input = continuationFixture();
  input.narrative.status = "PENDING";
  input.narrative.text = null;
  input.narrative.contentHash = null;
  input.narrative.renderMode = null;
  let calls = 0;
  const service = new PressureTurnPresentationServiceV1({
    async renderTurnPresentation(context) {
      calls += 1;
      assert.equal(context.previousNarrative.text, context.currentScene.text);
      assert.notEqual(context.previousNarrative.text, input.decision.summary);
      return candidate(context, {
        sceneText: literaryScene("河图旁的灯芯忽然爆了一声"),
        question: "现在必须先解决哪一项？",
        options: context.legalActionContracts.map((action) => ({
          actionType: action.actionType,
          label: action.fallbackLabel,
          description: action.intendedAction,
        })),
      });
    },
  });

  const result = await service.present(input);
  assert.equal(calls, 1);
  assert.notEqual(result.summary, input.decision.summary);
  assert.equal(result.title, "现在必须先解决哪一项？");
});

test("pending Narrative fallback never exposes internal decision purpose as player copy", async () => {
  const input = continuationFixture();
  input.narrative.status = "PENDING";
  input.narrative.text = null;
  input.narrative.contentHash = null;
  input.narrative.renderMode = null;
  input.decision.title = "INTERNAL DECISION PURPOSE";
  input.decision.summary = "为继续执行或更正命令留下具名责任，禁止用含混措辞把代价推回现场。";

  const result = await new PressureTurnPresentationServiceV1(null).present(input);

  assert.equal(result.title, "你准备如何应对？");
  assert.ok(result.summary.trim().length > 30);
  assert.notEqual(result.summary, input.decision.summary);
  assert.doesNotMatch(result.summary, /禁止用含混措辞|INTERNAL DECISION PURPOSE/u);
  assert.deepEqual(result.options, input.decision.options);
});

test("frozen Genesis uses the authored first scene without calling the Provider", async () => {
  const input = fixture();
  let calls = 0;
  const service = new PressureTurnPresentationServiceV1({
    async renderTurnPresentation() {
      calls += 1;
      throw new Error("Genesis must remain authored");
    },
  });

  const result = await service.present(input);
  assert.equal(calls, 0);
  assert.match(result.summary, /驿卒刚跨进总督府内厅/u);
  assert.match(result.summary, /第一道令先下给谁/u);
  assert.deepEqual(result.options, input.decision.options);
});

test("compiled context is hash-bound and contains only the three visible Catalog actions", () => {
  const context = compilePressureTurnPresentationContextV1(fixture());
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
  assert.equal(context.factBoundary.legalActionsAreNotCompletedResults, true);
  assert.deepEqual(context.factBoundary.durableStateSources, ["TURN_AUTHORITY_DRAFT"]);
  assert.equal(
    context.authorityDraft.authorityHash,
    sha256Canonical((({ authorityHash: _authorityHash, ...draft }) => draft)(context.authorityDraft)),
  );
  assert.deepEqual(
    context.authorityDraft.currentAuthorityState.map((fact) => fact.factId),
    ["situation.goal", "situation.risk", "situation.judgment"],
  );
  assert.match(context.factBoundary.forbiddenInferences.join("\n"), /临时文学细节不等于下一轮权威事实/u);
  assert.match(context.playerIdentity.hardLimit, /不能/u);
  assert.match(context.characterRules.privatePressure, /海防/u);
  assert.doesNotMatch(JSON.stringify(context), /otherSeatSecret|providerRaw|DEFAULT_PASS/u);
});

test("unknown fact refs and non-empty claims reject the whole generated turn", async () => {
  const input = continuationFixture();
  let mode: "UNKNOWN_REF" | "CLAIM" = "UNKNOWN_REF";
  const service = new PressureTurnPresentationServiceV1({
    async renderTurnPresentation(context) {
      return candidate(context, mode === "UNKNOWN_REF"
        ? { usedFactRefs: ["private.other-seat.secret"] }
        : { claims: [{ kind: "FACT", refId: "invented", statement: "虚构事实" }] });
    },
  });
  assert.deepEqual(await service.present(input), {
    ...input.decision,
    title: "你准备如何应对？",
    summary: input.narrative.text,
  });
  mode = "CLAIM";
  assert.deepEqual(await service.present(input), {
    ...input.decision,
    title: "你准备如何应对？",
    summary: input.narrative.text,
  });
});

function fixture(): PressureTurnPresentationInputV1 {
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

function continuationFixture(): PressureTurnPresentationInputV1 {
  const input = fixture();
  input.chapter = {
    ...input.chapter,
    chapterRuntimeId: "chapter-runtime-n2",
    chapterId: "N2",
    chapterNumber: 2,
    title: "奏疏措辞",
  };
  input.narrative = {
    ...input.narrative,
    projectionKind: "CHAPTER_NARRATIVE",
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: "chapter-n1-settlement",
    text: "胡宗宪下令先撤低洼处百姓。差役领命奔出，总督府门前仍有人追问，奏疏究竟如何说明这场灾情。",
  };
  input.decision = {
    ...input.decision,
    decisionPointId: "N2.memorial_draft",
    summary: "赈济奏疏必须说明灾情与请求。",
  };
  return input;
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

function candidate(
  context: PressureTurnPresentationContextV1,
  overrides: Record<string, unknown> = {},
) {
  return {
    sceneText: literaryScene("总督府签押房的灯火仍亮着"),
    question: "案上这道文书，现在先从哪一项落笔？",
    options: context.legalActionContracts.map((action) => ({
      actionType: action.actionType,
      label: action.fallbackLabel,
      description: action.intendedAction,
    })),
    usedFactRefs: ["situation.goal", "situation.risk"],
    claims: [],
    ...overrides,
  };
}

function literaryScene(opening: string): string {
  return [
    `${opening}。胡宗宪把刚送来的文书压在河图边，先看落款，再看其中写得最含混的几行。门外脚步来回，没有人敢越过门槛，却都在等他给出一句能真正执行的话。`,
    `书办低声报出眼前仍未解决的压力。胡宗宪没有立刻接笔，只追问哪些话已经核验，哪些还只是催促。屋里短暂安静下来，纸页被夜风吹得轻轻作响。`,
    `他把几份材料重新排开，合法的方向都摆在案前，但任何一个都还没有成为命令。众人的目光落到那支笔上，现场已经逼到必须由他本人作出选择的时刻。`,
  ].join("\n\n");
}
