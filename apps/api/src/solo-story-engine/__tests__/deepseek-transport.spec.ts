import assert from "node:assert/strict";
import { SoloDeepSeekTransport } from "../deepseek-transport";
import { compileSoloStoryContext } from "../context-compiler";
import { arbitratePlayerIntent } from "../rules-arbiter";
import { normalizePlayerIntent } from "../player-intent";
import { buildSoloNarratorPrompt } from "../narrator-prompt-builder";
import { buildSoloDecisionPrompt } from "../decision-prompt-builder";
import { parseNarratorDraft } from "../output-parser";
import {
  baseCanon,
  baseCards,
  baseFacts,
  basePending,
  basePressures,
  baseRole,
  baseScene,
  baseTargets,
  validDecisionOutput,
  validNarratorProse
} from "./helpers";

void (async () => {
  const normalized = normalizePlayerIntent({
    source: "CUSTOM",
    text: "派亲随去清流县档房封存现场并查勘潜入痕迹。"
  });
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("test action failed to normalize");
  const resolution = arbitratePlayerIntent({
    role: baseRole(),
    intent: normalized.intent,
    validation: { ok: true, decision: "ACCEPT", issues: [] }
  });
  const compiled = compileSoloStoryContext({
    role: baseRole(),
    scene: baseScene(),
    facts: baseFacts(),
    recentCanon: baseCanon(),
    pendingConsequences: basePending(),
    activePressures: basePressures(),
    relevantScriptCards: baseCards(),
    actionResolution: resolution,
    playerIntent: normalized.intent,
    availableTargets: baseTargets(),
    openingTrigger: null,
    maxTokenEstimate: 6_000
  });
  if (!compiled.ok) throw new Error(compiled.code);

  const requests: any[] = [];
  const outputs = [validNarratorProse(), validDecisionOutput()];
  const transport = new SoloDeepSeekTransport({
    apiKey: "test-secret",
    baseUrl: "https://provider.test/v1",
    model: "deepseek-chat",
    timeoutMs: 5_000,
    maxOutputTokens: 2_400,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      requests.push(body);
      return new Response(JSON.stringify({
        model: "deepseek-chat",
        choices: [{ message: { content: outputs[requests.length - 1] } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 200,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 0 }
        }
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": `req-${requests.length}`
        }
      });
    }
  });
  const narratorPrompt = buildSoloNarratorPrompt(compiled.context);
  const narrator = await transport.generate({
    attemptId: "attempt-1",
    stage: "NARRATOR",
    prompt: narratorPrompt,
    context: compiled.context
  });
  const draft = parseNarratorDraft(narrator.rawText);
  const decision = await transport.generate({
    attemptId: "attempt-1",
    stage: "DECISION",
    prompt: buildSoloDecisionPrompt(compiled.context, draft),
    context: compiled.context
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].messages.length, 2);
  assert.equal(requests[0].response_format, undefined);
  assert.equal(requests[0].temperature, 0.25);
  assert.equal(requests[0].stream, false);
  assert.equal(requests[1].response_format.type, "json_object");
  assert.equal(requests[1].temperature, 0.2);
  assert.equal(requests[1].stream, false);
  assert.equal(requests[0].thinking, undefined);
  assert.equal(narrator.stage, "NARRATOR");
  assert.equal(decision.stage, "DECISION");
  assert.equal(decision.providerRequestId, "req-2");
  assert.equal(decision.usage.promptCacheHitTokens, 80);

  let streamingBody: any = null;
  const completeOutput = validNarratorProse();
  const splitAt = Math.max(1, Math.floor(completeOutput.length / 2));
  const streamTransport = new SoloDeepSeekTransport({
    apiKey: "test-secret",
    baseUrl: "https://provider.test/v1",
    model: "deepseek-chat",
    timeoutMs: 5_000,
    maxOutputTokens: 2_400,
    fetchImpl: async (_url, init) => {
      streamingBody = JSON.parse(String(init?.body || "{}"));
      const events = [
        { id: "stream-req-1", model: "deepseek-chat", choices: [{ delta: { content: completeOutput.slice(0, splitAt) } }], usage: null },
        { id: "stream-req-1", model: "deepseek-chat", choices: [{ delta: { content: completeOutput.slice(splitAt) } }], usage: null },
        { id: "stream-req-1", model: "deepseek-chat", choices: [], usage: { prompt_tokens: 111, completion_tokens: 222 } }
      ];
      const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
  });
  const streamedDeltas: string[] = [];
  const streamResult = await streamTransport.generate({
    attemptId: "attempt-stream",
    stage: "NARRATOR",
    prompt: narratorPrompt,
    context: compiled.context,
    onTextDelta: (delta) => {
      streamedDeltas.push(delta);
    }
  });
  assert.equal(streamingBody.stream, true);
  assert.equal(streamingBody.response_format, undefined);
  assert.equal(streamingBody.stream_options.include_usage, true);
  assert.equal(streamedDeltas.join(""), completeOutput);
  assert.equal(streamResult.rawText, completeOutput);
  assert.equal(streamResult.stage, "NARRATOR");

  let environmentSelectedModel = "";
  let environmentUrl = "";
  let environmentAuthorization = "";
  let environmentBody: any = null;
  const fromEnvironment = SoloDeepSeekTransport.fromEnv({
    DEEPSEEK_API_KEY: "deepseek-secret",
    SOLO_STORY_API_KEY: "solo-provider-secret",
    DEEPSEEK_MODEL: "deepseek-v4-pro",
    SOLO_STORY_THINKING: "enabled"
  } as NodeJS.ProcessEnv, async (url, init) => {
    environmentUrl = String(url);
    environmentAuthorization = new Headers(init?.headers).get("authorization") || "";
    environmentBody = JSON.parse(String(init?.body || "{}"));
    environmentSelectedModel = environmentBody.model;
    return new Response(JSON.stringify({
      model: environmentSelectedModel,
      choices: [{ message: { content: validNarratorProse() } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await fromEnvironment.generate({
    attemptId: "attempt-env",
    stage: "NARRATOR",
    prompt: narratorPrompt,
    context: compiled.context
  });
  assert.equal(environmentSelectedModel, "deepseek-chat");
  assert.match(environmentUrl, /^https:\/\/api\.deepseek\.com\/v1\/chat\/completions$/);
  assert.equal(environmentAuthorization, "Bearer deepseek-secret");
  assert.equal(environmentBody.thinking.type, "enabled");
  assert.equal(environmentBody.reasoning_effort, "high");

  let relayUrl = "";
  let relayAuthorization = "";
  let relayBody: any = null;
  const relayFromEnvironment = SoloDeepSeekTransport.fromEnv({
    DEEPSEEK_API_KEY: "deepseek-secret",
    SOLO_STORY_API_KEY: "solo-provider-secret",
    SOLO_STORY_BASE_URL: "https://api.siliconflow.cn/v1",
    SOLO_STORY_MODEL: "Pro/moonshotai/Kimi-K2.6",
    SOLO_STORY_THINKING: "disabled",
    SOLO_STORY_THINKING_BUDGET: "512"
  } as NodeJS.ProcessEnv, async (url, init) => {
    relayUrl = String(url);
    relayAuthorization = new Headers(init?.headers).get("authorization") || "";
    relayBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({
      model: relayBody.model,
      choices: [{ message: { content: validNarratorProse() } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await relayFromEnvironment.generate({
    attemptId: "attempt-relay-env",
    stage: "NARRATOR",
    prompt: narratorPrompt,
    context: compiled.context
  });
  assert.equal(relayUrl, "https://api.siliconflow.cn/v1/chat/completions");
  assert.equal(relayAuthorization, "Bearer solo-provider-secret");
  assert.equal(relayBody.model, "Pro/moonshotai/Kimi-K2.6");
  assert.equal(relayBody.thinking, undefined);
  assert.equal(relayBody.enable_thinking, false);
  assert.equal(relayBody.thinking_budget, 512);

  const glmBodies: any[] = [];
  const glmTransport = new SoloDeepSeekTransport({
    apiKey: "test-secret",
    baseUrl: "https://api.siliconflow.com/v1",
    model: "zai-org/GLM-5.2",
    timeoutMs: 5_000,
    maxOutputTokens: 2_400,
    thinkingBudget: 512,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      glmBodies.push(body);
      return new Response(JSON.stringify({
        model: body.model,
        choices: [{ message: { content: validNarratorProse() } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const glmDeltas: string[] = [];
  const glmNarrator = await glmTransport.generate({
    attemptId: "attempt-glm-narrator",
    stage: "NARRATOR",
    prompt: narratorPrompt,
    context: compiled.context,
    onTextDelta: (delta) => {
      glmDeltas.push(delta);
    }
  });
  await glmTransport.generate({
    attemptId: "attempt-glm-decision",
    stage: "DECISION",
    prompt: buildSoloDecisionPrompt(compiled.context, draft),
    context: compiled.context
  });
  assert.equal(glmBodies.length, 2);
  assert.equal(glmBodies[0].stream, false);
  assert.equal(glmBodies[0].stream_options, undefined);
  assert.equal(glmBodies[0].max_tokens, 1_600);
  assert.equal(glmBodies[1].max_tokens, 1_600);
  assert.equal(glmBodies[0].temperature, 0.2);
  assert.equal(glmBodies[1].temperature, 0.2);
  assert.equal(glmDeltas.length, 0);
  assert.equal(glmNarrator.rawText, validNarratorProse());
  assert.equal(glmBodies[1].response_format, undefined);
  assert.equal(glmBodies[1].enable_thinking, false);
  assert.equal(glmBodies[0].thinking_budget, 512);
  assert.equal(glmBodies[1].thinking_budget, 512);

  console.log("solo story engine DeepSeek two-stage transport: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
