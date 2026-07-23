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
  assert.equal(requests[0].temperature, 0.78);
  assert.equal(requests[0].stream, false);
  assert.equal(requests[1].response_format.type, "json_object");
  assert.equal(requests[1].temperature, 0.28);
  assert.equal(requests[1].stream, false);
  assert.equal(requests[0].thinking.type, "disabled");
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
  const fromEnvironment = SoloDeepSeekTransport.fromEnv({
    DEEPSEEK_API_KEY: "test-secret",
    DEEPSEEK_MODEL: "deepseek-v4-pro"
  } as NodeJS.ProcessEnv, async (_url, init) => {
    environmentSelectedModel = JSON.parse(String(init?.body || "{}")).model;
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

  console.log("solo story engine DeepSeek two-stage transport: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
