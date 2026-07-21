import assert from "node:assert/strict";
import { SoloDeepSeekTransport } from "../deepseek-transport";
import { compileSoloStoryContext } from "../context-compiler";
import { arbitratePlayerIntent } from "../rules-arbiter";
import { normalizePlayerIntent } from "../player-intent";
import { buildSoloStoryTurnPrompt } from "../prompt-builder";
import { baseCanon, baseCards, baseFacts, basePending, basePressures, baseRole, baseScene, baseTargets, validModelOutput } from "./helpers";

void (async () => {
  let calls = 0;
  let requestBody: any = null;
  const transport = new SoloDeepSeekTransport({
    apiKey: "test-secret",
    baseUrl: "https://provider.test/v1",
    model: "deepseek-chat",
    timeoutMs: 5_000,
    maxOutputTokens: 2_400,
    fetchImpl: async (_url, init) => {
      calls += 1;
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({
        model: "deepseek-chat",
        choices: [{ message: { content: validModelOutput() } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 }
      }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-1" } });
    }
  });
  const normalized = normalizePlayerIntent({
    source: "CUSTOM",
    text: "派亲随去清流县档房封存现场并查勘潜入痕迹。"
  });
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("test action failed to normalize");
  const resolution = arbitratePlayerIntent({ role: baseRole(), intent: normalized.intent, validation: { ok: true, decision: "ACCEPT", issues: [] } });
  const compiled = compileSoloStoryContext({
    role: baseRole(), scene: baseScene(), facts: baseFacts(), recentCanon: baseCanon(), pendingConsequences: basePending(),
    activePressures: basePressures(), relevantScriptCards: baseCards(), actionResolution: resolution,
    playerIntent: normalized.intent, availableTargets: baseTargets(), openingTrigger: null, maxTokenEstimate: 6_000
  });
  if (!compiled.ok) throw new Error(compiled.code);
  assert.equal(compiled.ok, true);
  const result = await transport.generate({ attemptId: "attempt-1", prompt: buildSoloStoryTurnPrompt(compiled.context), context: compiled.context });

  assert.equal(calls, 1);
  assert.equal(requestBody.messages.length, 2);
  assert.equal(requestBody.response_format.type, "json_object");
  assert.equal(result.providerRequestId, "req-1");
  assert.equal(result.usage.inputTokens, 100);
  assert.match(result.rawText, /decisions/);

  let environmentSelectedModel = "";
  const fromEnvironment = SoloDeepSeekTransport.fromEnv({
    DEEPSEEK_API_KEY: "test-secret",
    DEEPSEEK_MODEL: "deepseek-v4-pro"
  } as NodeJS.ProcessEnv, async (_url, init) => {
    environmentSelectedModel = JSON.parse(String(init?.body || "{}")).model;
    return new Response(JSON.stringify({
      model: environmentSelectedModel,
      choices: [{ message: { content: validModelOutput() } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await fromEnvironment.generate({ attemptId: "attempt-env", prompt: buildSoloStoryTurnPrompt(compiled.context), context: compiled.context });
  assert.equal(environmentSelectedModel, "deepseek-chat", "Solo must not inherit the repository-wide reasoning model");

  console.log("solo story engine DeepSeek transport one-fetch: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
