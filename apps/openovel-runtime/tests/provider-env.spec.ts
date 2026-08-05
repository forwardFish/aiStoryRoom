import assert from "node:assert/strict";
import test from "node:test";
import { OpenAICompatibleProvider } from "../src/provider.js";
import type { ProviderRequest } from "../src/types.js";

const profiles: ProviderRequest["profile"][] = [
  "narrator",
  "reviewer",
  "options",
  "storykeeper",
];

test("legacy Solo GLM variables cannot redirect the OpenNovel DeepSeek runtime", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const provider = OpenAICompatibleProvider.fromEnv({
    OPENOVEL_API_KEY: "test-key",
    SOLO_STORY_BASE_URL: "https://api.siliconflow.com",
    SOLO_STORY_MODEL: "zai-org/GLM-5.2",
    OPENOVEL_DEEPSEEK_THINKING: "enabled",
  }, async (url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    return responseFor(String(body.model));
  });

  assert.deepEqual(provider.describe(), {
    provider: "api.deepseek.com",
    model: "deepseek-v4-pro",
    configured: true,
  });

  for (const profile of profiles) {
    const result = await provider.generate(request(profile));
    assert.equal(result.model, "deepseek-v4-pro");
  }

  assert.equal(calls.length, profiles.length);
  for (const call of calls) {
    assert.equal(call.url, "https://api.deepseek.com/v1/chat/completions");
    assert.equal(call.body.model, "deepseek-v4-pro");
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.equal("reasoning_effort" in call.body, false);
  }
});

test("every explicit OpenNovel stage inherits the frozen DeepSeek V4-Pro model", async () => {
  const models: string[] = [];
  const provider = OpenAICompatibleProvider.fromEnv({
    DEEPSEEK_API_KEY: "test-key",
    OPENOVEL_PROVIDER_BASE_URL: "https://api.deepseek.com",
    OPENOVEL_MODEL: "deepseek-v4-pro",
    OPENOVEL_DEEPSEEK_THINKING: "disabled",
  }, async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    models.push(String(body.model));
    return responseFor(String(body.model));
  });

  for (const profile of profiles) await provider.generate(request(profile));
  assert.deepEqual(models, profiles.map(() => "deepseek-v4-pro"));
});

test("a non-DeepSeek provider requires explicit OPENOVEL configuration", async () => {
  let sent: Record<string, unknown> = {};
  let sentUrl = "";
  const provider = OpenAICompatibleProvider.fromEnv({
    OPENOVEL_API_KEY: "test-key",
    OPENOVEL_PROVIDER_BASE_URL: "https://api.siliconflow.com",
    OPENOVEL_MODEL: "Qwen/Qwen3.5-122B-A10B",
    SOLO_STORY_MODEL: "zai-org/GLM-5.2",
  }, async (url, init) => {
    sentUrl = String(url);
    sent = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return responseFor(String(sent.model));
  });

  const result = await provider.generate(request("narrator"));
  assert.equal(sentUrl, "https://api.siliconflow.com/v1/chat/completions");
  assert.equal(sent.model, "Qwen/Qwen3.5-122B-A10B");
  assert.equal(result.model, "Qwen/Qwen3.5-122B-A10B");
  assert.equal(sent.enable_thinking, false);
  assert.equal(sent.thinking_budget, 128);
});

function request(profile: ProviderRequest["profile"]): ProviderRequest {
  return {
    profile,
    messages: [{ role: "user", content: "fixture" }],
    temperature: 0,
    maxTokens: 32,
    json: false,
    stream: false,
  };
}

function responseFor(model: string) {
  return new Response(JSON.stringify({
    model,
    choices: [{ message: { content: "done" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 1 },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
