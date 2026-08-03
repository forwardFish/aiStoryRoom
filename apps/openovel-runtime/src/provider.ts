import type { OpenNovelProvider, ProviderRequest, ProviderResult } from "./types.js";

export type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  narratorModel: string;
  reviewerModel?: string;
  repairModel?: string;
  optionsModel: string;
  storykeeperModel: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export class OpenAICompatibleProvider implements OpenNovelProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ProviderConfig) {
    this.fetchImpl = config.fetchImpl || fetch;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch) {
    const explicitBase = String(env.OPENOVEL_PROVIDER_BASE_URL || env.SOLO_STORY_BASE_URL || "").trim();
    const baseUrl = normalizeBaseUrl(explicitBase || String(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"));
    const apiKey = String(
      env.OPENOVEL_API_KEY
      || env.SOLO_STORY_API_KEY
      || env.DEEPSEEK_API_KEY
      || "",
    ).trim();
    const defaultModel = String(env.OPENOVEL_MODEL || env.SOLO_STORY_MODEL || "zai-org/GLM-5.2").trim();
    return new OpenAICompatibleProvider({
      apiKey,
      baseUrl,
      narratorModel: String(env.OPENOVEL_NARRATOR_MODEL || defaultModel).trim(),
      reviewerModel: String(env.OPENOVEL_REVIEWER_MODEL || defaultModel).trim(),
      repairModel: String(env.OPENOVEL_REPAIR_MODEL || defaultModel).trim(),
      optionsModel: String(env.OPENOVEL_OPTIONS_MODEL || defaultModel).trim(),
      storykeeperModel: String(env.OPENOVEL_STORYKEEPER_MODEL || defaultModel).trim(),
      timeoutMs: boundedInteger(
        env.OPENOVEL_PROVIDER_TIMEOUT_MS || env.SOLO_STORY_PROVIDER_TIMEOUT_MS,
        180_000,
        5_000,
        300_000,
      ),
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
        ...(request.json && supportsJsonMode(this.config.baseUrl, model)
          ? { response_format: { type: "json_object" } }
          : {}),
        ...thinkingFields(this.config.baseUrl),
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
    if (profile === "repair") {
      return this.config.repairModel || this.config.narratorModel;
    }
    if (profile === "options") return this.config.optionsModel;
    if (profile === "storykeeper") return this.config.storykeeperModel;
    return this.config.narratorModel;
  }
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

function thinkingFields(baseUrl: string) {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host.endsWith("deepseek.com")) return { thinking: { type: "disabled" } };
  if (host.includes("siliconflow")) {
    // SiliconFlow documents a 4096-token default thinking budget for
    // reasoning models. Some newly deployed models still spend that budget
    // even when enable_thinking=false, so make the minimum explicit.
    return { enable_thinking: false, thinking_budget: 128 };
  }
  return {};
}

function supportsJsonMode(baseUrl: string, model: string) {
  const host = new URL(baseUrl).hostname.toLowerCase();
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
