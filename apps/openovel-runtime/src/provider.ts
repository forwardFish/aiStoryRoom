import type { OpenNovelProvider, ProviderRequest, ProviderResult } from "./types.js";

export type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  narratorModel: string;
  reviewerModel?: string;
  optionsModel: string;
  storykeeperModel: string;
  timeoutMs: number;
  thinkingMode?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  fetchImpl?: typeof fetch;
};

export class OpenAICompatibleProvider implements OpenNovelProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ProviderConfig) {
    this.fetchImpl = config.fetchImpl || fetch;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch) {
    // OpenNovel has its own provider contract. Legacy Solo variables may still
    // exist in .env.test, but they must never silently redirect the V4 runtime
    // to GLM or another provider. A non-DeepSeek provider remains possible only
    // through the explicit OPENOVEL_* variables.
    const explicitBase = String(env.OPENOVEL_PROVIDER_BASE_URL || "").trim();
    const baseUrl = normalizeBaseUrl(
      explicitBase || String(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"),
    );
    const apiKey = providerApiKey(env, baseUrl);
    const defaultModel = String(
      env.OPENOVEL_MODEL || defaultModelForBaseUrl(baseUrl),
    ).trim();
    const officialDeepSeek = isOfficialDeepSeek(baseUrl);
    return new OpenAICompatibleProvider({
      apiKey,
      baseUrl,
      narratorModel: String(env.OPENOVEL_NARRATOR_MODEL || defaultModel).trim(),
      reviewerModel: String(env.OPENOVEL_REVIEWER_MODEL || defaultModel).trim(),
      optionsModel: String(env.OPENOVEL_OPTIONS_MODEL || defaultModel).trim(),
      storykeeperModel: String(env.OPENOVEL_STORYKEEPER_MODEL || defaultModel).trim(),
      timeoutMs: boundedInteger(
        env.OPENOVEL_PROVIDER_TIMEOUT_MS,
        180_000,
        5_000,
        300_000,
      ),
      // MVP freeze: official DeepSeek calls never enter reasoning transport.
      // Direct constructor use remains configurable for protocol tests and a
      // future, separately approved thinking-mode implementation.
      thinkingMode: officialDeepSeek
        ? "disabled"
        : env.OPENOVEL_DEEPSEEK_THINKING === "disabled" ? "disabled" : "enabled",
      reasoningEffort: env.OPENOVEL_DEEPSEEK_REASONING_EFFORT === "max" ? "max" : "high",
      fetchImpl,
    });
  }

  describe() {
    return {
      provider: new URL(this.config.baseUrl).hostname,
      model: this.config.narratorModel,
      configured: Boolean(this.config.apiKey),
    };
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.config.apiKey) throw new Error("OPENOVEL_API_KEY, SOLO_STORY_API_KEY, or DEEPSEEK_API_KEY is required");
    const model = this.modelFor(request.profile);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(request.timeoutMs) && Number(request.timeoutMs) > 0
      ? Math.min(this.config.timeoutMs, Math.max(1_000, Number(request.timeoutMs)))
      : this.config.timeoutMs;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`Provider timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        this.execute(request, model, controller.signal, startedAt),
        timeout,
      ]);
    } catch (error) {
      if (timedOut || (error as Error).name === "AbortError") {
        throw new Error(`Provider timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async execute(
    request: ProviderRequest,
    model: string,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<ProviderResult> {
    const response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: request.stream,
        ...(request.stream ? { stream_options: { include_usage: true } } : {}),
        ...(request.jsonSchema && supportsStructuredOutputs(this.config.baseUrl, model)
          ? {
              response_format: {
                type: "json_schema",
                json_schema: request.jsonSchema,
              },
            }
          : request.json && supportsJsonMode(this.config.baseUrl, model)
            ? { response_format: { type: "json_object" } }
            : {}),
        ...thinkingFields(
          this.config.baseUrl,
          request.profile === "reviewer" || request.profile === "options"
            ? "disabled"
            : this.config.thinkingMode,
          this.config.reasoningEffort,
        ),
      }),
      signal,
    });
    const requestId = response.headers.get("x-request-id")
      || response.headers.get("x-deepseek-request-id")
      || undefined;
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      const error = payload?.error as Record<string, unknown> | undefined;
      throw new Error(String(error?.message || payload?.message || `Provider HTTP ${response.status}`).slice(0, 500));
    }
    if (request.stream) {
      return {
        ...(await readStream(response, request.onDelta)),
        model,
        requestId,
        latencyMs: Date.now() - startedAt,
      };
    }
    const payload = await response.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = String(payload.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("Provider returned an empty response");
    return {
      text,
      model: payload.model || model,
      requestId,
      ...(payload.choices?.[0]?.finish_reason
        ? { finishReason: payload.choices[0].finish_reason }
        : {}),
      usage: {
        inputTokens: Number(payload.usage?.prompt_tokens || 0),
        outputTokens: Number(payload.usage?.completion_tokens || 0),
      },
      latencyMs: Date.now() - startedAt,
    };
  }

  private modelFor(profile: ProviderRequest["profile"]) {
    if (profile === "reviewer") {
      return this.config.reviewerModel || this.config.narratorModel;
    }
    if (profile === "options") return this.config.optionsModel;
    if (profile === "storykeeper") return this.config.storykeeperModel;
    return this.config.narratorModel;
  }
}

function providerApiKey(env: NodeJS.ProcessEnv, baseUrl: string) {
  const explicit = String(env.OPENOVEL_API_KEY || "").trim();
  if (explicit) return explicit;
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host.endsWith("deepseek.com")) {
    return String(env.DEEPSEEK_API_KEY || env.SOLO_STORY_API_KEY || "").trim();
  }
  return String(env.SOLO_STORY_API_KEY || env.DEEPSEEK_API_KEY || "").trim();
}

function defaultModelForBaseUrl(baseUrl: string) {
  return isOfficialDeepSeek(baseUrl) ? "deepseek-v4-pro" : "zai-org/GLM-5.2";
}

function isOfficialDeepSeek(baseUrl: string) {
  return new URL(baseUrl).hostname.toLowerCase().endsWith("deepseek.com");
}

async function readStream(response: Response, onDelta?: (text: string) => void) {
  if (!response.body) throw new Error("Provider returned an empty stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      const payload = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const delta = String(payload.choices?.[0]?.delta?.content || "");
      if (delta) {
        text += delta;
        onDelta?.(delta);
      }
      inputTokens = Number(payload.usage?.prompt_tokens || inputTokens);
      outputTokens = Number(payload.usage?.completion_tokens || outputTokens);
      finishReason = String(payload.choices?.[0]?.finish_reason || finishReason);
    }
  }
  text = text.trim();
  if (!text) throw new Error("Provider returned an empty streamed response");
  return {
    text,
    ...(finishReason ? { finishReason } : {}),
    usage: { inputTokens, outputTokens },
  };
}

function thinkingFields(
  baseUrl: string,
  mode: "enabled" | "disabled" = "enabled",
  effort: "high" | "max" = "high",
) {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host.endsWith("deepseek.com")) {
    return mode === "enabled"
      ? { thinking: { type: "enabled" }, reasoning_effort: effort }
      : { thinking: { type: "disabled" } };
  }
  if (host.includes("siliconflow")) {
    // SiliconFlow documents a 4096-token default thinking budget for
    // reasoning models. Some newly deployed models still spend that budget
    // even when enable_thinking=false, so make the minimum explicit.
    return { enable_thinking: false, thinking_budget: 128 };
  }
  return {};
}

function supportsStructuredOutputs(baseUrl: string, model: string) {
  const host = new URL(baseUrl).hostname.toLowerCase();
  // The isolated engineering provider uses Ollama's OpenAI-compatible endpoint,
  // which accepts response_format=json_schema on loopback. Keep this capability
  // narrow so an arbitrary third-party compatible endpoint is not overclaimed.
  if (isLoopbackHost(host)) return true;
  if (!host.includes("siliconflow")) return false;
  // SiliconFlow exposes JSON Schema for supported models, but GLM-5.x rejects
  // response_format at transport level. The complete schema remains embedded
  // in the Reviewer contract and the response is validated after generation.
  return !/^zai-org\/GLM-5(?:\.|$)/i.test(model);
}

function isLoopbackHost(host: string) {
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

function supportsJsonMode(baseUrl: string, model: string) {
  const host = new URL(baseUrl).hostname.toLowerCase();
  // SiliconFlow currently rejects response_format=json_object for GLM-5.x
  // even though its general JSON-mode guide describes broad LLM support.
  // These models still receive the complete output schema in the Reviewer
  // contract and are validated identically after plain-text transport.
  return !(host.includes("siliconflow") && /^zai-org\/GLM-5(?:\.|$)/i.test(model));
}

function normalizeBaseUrl(value: string) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) throw new Error("Provider base URL must be absolute HTTP(S)");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}
