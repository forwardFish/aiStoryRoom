import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { SoloDeepSeekTransport } from "../../apps/api/src/solo-story-engine/deepseek-transport";
import { executeSoloStoryTurn } from "../../apps/api/src/solo-story-engine/two-stage-executor";
import { buildExecuteInput } from "../../apps/api/src/solo-story-engine/__tests__/helpers";
import type { RawPlayerAction } from "../../apps/api/src/solo-story-engine/types";

const actionKey = String(process.env.LIVE_SOLO_ACTION || "CUSTOM").toUpperCase();
const actions: Record<string, RawPlayerAction> = {
  RECOMMENDED: {
    source: "RECOMMENDED",
    decisionId: "live-recommended-1",
    label: "召巡抚当面对照公文",
    targetId: "xunfu",
    targetLabel: "浙江巡抚",
    actionText: "请浙江巡抚留在总督府，当面对照两份催办公文的笔迹、递送时间和经手人。"
  },
  TALK: {
    source: "TALK",
    personId: "xunfu",
    personName: "浙江巡抚",
    prompt: "请你当面说明两份催办公文为何笔迹不同，昨夜又是谁从巡抚衙门调阅清流县旧契。"
  },
  INVESTIGATE: {
    source: "INVESTIGATE",
    locationId: "archive_room",
    locationName: "清流县田契档房",
    task: "封存昨夜门簿、原始田册和空白契纸，分别询问值守书吏，查明谁在官差抵达前动过档案。"
  },
  USE_LEVERAGE: {
    source: "USE_LEVERAGE",
    leverageKey: "asset:governor_seal",
    leverageLabel: "总督令牌",
    targetId: "xunfu",
    targetLabel: "浙江巡抚",
    task: "用总督令牌要求巡抚衙门暂缓转移清流县契册，并在今夜交出调阅旧契的经手名册。"
  },
  CUSTOM: {
    source: "CUSTOM",
    text: "派亲随携总督令牌赶赴清流县田契档房，先封存门簿和原始田册，再分别询问昨夜值守书吏，查清谁在官差到来前动过档案。"
  }
};

async function main() {
  const transport = SoloDeepSeekTransport.fromEnv();
  let providerCalls = 0;
  let firstDeltaAtMs: number | null = null;
  let streamedChunkCount = 0;
  let streamedCharacterCount = 0;
  const startedAt = performance.now();
  const action = actions[actionKey];
  assert.ok(action, `unknown LIVE_SOLO_ACTION: ${actionKey}`);
  const result = await executeSoloStoryTurn({
    ...buildExecuteInput(
      action,
      transport
    ),
    attemptId: `live-two-stage-${Date.now()}`,
    onBeforeProviderCall: async () => {
      providerCalls += 1;
    },
    onProviderTextDelta: async (delta) => {
      if (firstDeltaAtMs === null) firstDeltaAtMs = Math.round(performance.now() - startedAt);
      streamedChunkCount += 1;
      streamedCharacterCount += delta.length;
    }
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  if (!result.ok) {
    console.error(JSON.stringify({
      status: "FAIL",
      failedStage: result.failedStage || null,
      providerCalls,
      auditedProviderCalls: result.attempt.providerCallCount,
      elapsedMs,
      issues: result.issues,
      narratorRawText: result.narratorProvider?.rawText || null,
      decisionRawText: result.decisionProvider?.rawText || null
    }, null, 2));
    throw new Error(`live two-stage generation failed at ${result.failedStage || "pre-provider"}`);
  }
  assert.equal(providerCalls, 2, "a valid Solo action must call DeepSeek once per stage");
  assert.equal(result.attempt.providerCallCount, 2, "attempt audit must record two provider calls");
  assert.equal(result.attempt.narrationProviderCallCount, 1);
  assert.equal(result.attempt.decisionProviderCallCount, 1);
  assert.ok(result.output.story.resultNarrative.length >= 120, "result story must be substantive");
  assert.ok(result.output.story.nextSituationNarrative.length >= 8, "next situation must contain a visible live beat");
  assert.equal(result.output.decisions.length, 2, "the decision stage must contain exactly two next decisions");
  assert.equal(
    `${result.output.story.resultNarrative}\n\n${result.output.story.nextSituationNarrative}`,
    result.narratorProvider.rawText,
    "published story must be byte-equivalent to the accepted narrator prose"
  );

  console.log(JSON.stringify({
    status: "PASS",
    actionKey,
    providerCalls,
    auditedProviderCalls: result.attempt.providerCallCount,
    firstDeltaAtMs,
    streamedChunkCount,
    streamedCharacterCount,
    elapsedMs,
    narratorModel: result.narratorProvider.model,
    decisionModel: result.decisionProvider.model,
    narratorInputTokens: result.narratorProvider.usage.inputTokens,
    narratorOutputTokens: result.narratorProvider.usage.outputTokens,
    decisionInputTokens: result.decisionProvider.usage.inputTokens,
    decisionOutputTokens: result.decisionProvider.usage.outputTokens,
    resultTitle: result.output.story.title,
    resultNarrative: result.output.story.resultNarrative,
    nextSituationNarrative: result.output.story.nextSituationNarrative,
    decisions: result.output.decisions.map((decision) => ({
      label: decision.label,
      description: decision.description,
      target: decision.targetRef.label,
      method: decision.method
    }))
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
