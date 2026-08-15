import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeContextV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import {
  compilePressureDecisionStoryPackV1,
  pressureStoryPackDiagnosticLogV1,
} from "./decision-story-pack";
import { DeepSeekPressureNarrativeProviderV1 } from "./narrative-provider";

const HASH = "a".repeat(64);

test("generic story pack joins N1 authored scene with viewer-safe actions and real result", () => {
  const pack = compilePressureDecisionStoryPackV1(context());
  assert.ok(pack);
  assert.equal(pack.schemaVersion, "pressure_decision_story_pack_v1");
  assert.equal(pack.chapterId, "N1");
  assert.match(pack.worldAndStyle.narrativeStyle, /第三人称限知叙事/);
  assert.equal(pack.promptTemplate.mode, "SIMULATION");
  assert.match(pack.openingSetting.sceneFrame.join("\n"), /第一轮命令发出半日后/);
  assert.doesNotMatch(pack.openingSetting.sceneFrame.join("\n"), /驿卒刚跨进总督府内厅/);
  assert.equal(pack.playerIdentity.actorName, "胡宗宪");
  assert.equal(pack.playerAction.sealedActionSummary, "浙江总督选择了“组织堰区疏散”。");
  assert.equal(pack.dialogueExamples.length, 6);
  assert.match(pack.dialogueExamples.join("\n"), /与幕僚商议/u);
  assert.match(pack.dialogueExamples.join("\n"), /动怒但不失身份/u);
  assert.match(pack.dialogueExamples.join("\n"), /调侃、讥讽或疲惫/u);
  assert.equal(pack.previousNarrative.authority, "CONTINUITY_ONLY");
  assert.match(pack.previousNarrative.text, /驿卒/u);
  assert.match(pack.creativeLicense.allowed.join("\n"), /相对时间过渡/u);
  assert.match(pack.creativeLicense.allowed.join("\n"), /普通工具、物资与执行动作/u);
  assert.match(pack.creativeLicense.forbidden.join("\n"), /被跟踪资源增减/u);
  assert.deepEqual(pack.currentState.visibleOtherSeatActions, ["清流法度已下令“封存毁堤记录”。"]);
  assert.deepEqual(pack.currentState.settledResult, [
    "堰区多数百姓已经撤离。",
    "毁堤命令已留下可核验记录。",
    "九堰水势已经缓和。",
    "关键堰口已有足够增援。",
  ]);
  assert.deepEqual(pack.unresolvedPressure, ["沿河粮路仍有中断风险。"]);
  assert.match(pack.nextDirection, /下一道真实决策/);
  assert.equal(pack.requiredClaims.length, 3);
  assert.ok(new TextEncoder().encode(JSON.stringify(pack)).byteLength <= 8_192);
  assert.doesNotMatch(JSON.stringify(pack), /PRIVATE_OTHER_ACTION|apiKey|sourceCommitHash/);
});

test("DeepSeek request carries the same generic story pack and one sanitized diagnostic log", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const originalInfo = console.info;
  const originalLogMode = process.env.PRESSURE_DECISION_STORY_PACK_LOG;
  process.env.PRESSURE_DECISION_STORY_PACK_LOG = "full";
  console.info = (message?: unknown) => logs.push(String(message));
  try {
    const provider = new DeepSeekPressureNarrativeProviderV1({
      apiKey: "test-secret",
      endpoint: "https://api.example.test/chat/completions",
      model: "test-model",
      fetchImpl: async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ text: "测试正文", usedFactRefs: [], claims: [] }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    await provider.render(context());
  } finally {
    console.info = originalInfo;
    if (originalLogMode == null) delete process.env.PRESSURE_DECISION_STORY_PACK_LOG;
    else process.env.PRESSURE_DECISION_STORY_PACK_LOG = originalLogMode;
  }
  const capturedRequest = requestBodies[0] as Record<string, unknown> | undefined;
  assert.ok(capturedRequest);
  const messages = capturedRequest.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(capturedRequest.thinking, { type: "disabled" });
  assert.equal(capturedRequest.max_tokens, 2_048);
  const userPayload = JSON.parse(messages.find((item) => item.role === "user")!.content);
  assert.equal(userPayload.storyPack.playerAction.sealedActionSummary, "浙江总督选择了“组织堰区疏散”。");
  assert.equal(userPayload.storyPack.promptTemplate.mode, "SIMULATION");
  assert.equal(userPayload.authority.projectionKind, "BEAT_NARRATIVE");
  assert.equal(userPayload.authority.contextCompilerVersion, undefined);
  assert.equal(requestBodies.length, 1);
  assert.equal(logs.length, 1);
  const diagnostic = JSON.parse(logs[0]!);
  assert.equal(diagnostic.event, "PRESSURE_DECISION_STORY_PACK");
  assert.equal(diagnostic.chapterId, "N1");
  assert.equal(diagnostic.sources.playerAction, "SEALED_ACTION");
  assert.deepEqual(diagnostic.storyPack.currentState.settledResult, userPayload.storyPack.currentState.settledResult);
  assert.doesNotMatch(logs[0]!, /test-secret/);
});

test("the generic compiler is enabled only for private N1 beat contexts", () => {
  const publicContext = context();
  publicContext.audience = { kind: "PUBLIC", seatId: null };
  assert.equal(compilePressureDecisionStoryPackV1(publicContext), null);

  const chapterContext = context();
  chapterContext.projectionKind = "CHAPTER_NARRATIVE";
  assert.equal(compilePressureDecisionStoryPackV1(chapterContext), null);

  const n2Context = context();
  n2Context.variant = { kind: "BEAT", chapterId: "N2", workingRevision: 1, temporalBoundary: "WORKING_NOT_FROZEN" };
  assert.equal(compilePressureDecisionStoryPackV1(n2Context), null);
});

function context(): NarrativeContextV1 {
  const required = [
    ["story.player_action.zhejiang_governor", "浙江总督选择了“组织堰区疏散”。"],
    ["story.result.evacuation", "堰区多数百姓已经撤离。"],
    ["story.result.weirs", "关键堰口已有足够增援。"],
    ["story.unresolved_pressure.01", "沿河粮路仍有中断风险。"],
  ] as const;
  return {
    schemaVersion: "pressure_narrative_context_v1",
    contextCompilerVersion: "test",
    projectionKind: "BEAT_NARRATIVE",
    audience: { kind: "SEAT", seatId: "zhejiang_governor" },
    sourceId: HASH,
    sourceCommitHash: HASH,
    sourceContentHash: HASH,
    temporalInstruction: "Working only",
    facts: [
      ...required.map(([factId, text]) => ({ factId, text, temporalStatus: "COMMITTED_WORKING" as const })),
      { factId: "story.result.records", text: "毁堤命令已留下可核验记录。", temporalStatus: "COMMITTED_WORKING" },
      { factId: "story.result.severity", text: "九堰水势已经缓和。", temporalStatus: "COMMITTED_WORKING" },
      { factId: "story.visible_action.qingliu_law", text: "清流法度已下令“封存毁堤记录”。", temporalStatus: "COMMITTED_WORKING" },
      { factId: "story.next_direction", text: "下一道真实决策是“确认是否封存章末行动”，可行动方向为：确认、暂缓。", temporalStatus: "COMMITTED_WORKING" },
    ],
    objects: [],
    knowledge: [],
    allowedClaims: required.map(([refId, statement]) => ({
      kind: "FACT",
      refId,
      statement,
      required: !refId.startsWith("story.player_action."),
    })),
    variant: { kind: "BEAT", chapterId: "N1", workingRevision: 1, temporalBoundary: "WORKING_NOT_FROZEN" },
    contextHash: HASH,
  };
}
