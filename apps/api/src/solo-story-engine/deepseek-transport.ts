import type { StoryTurnTransport, StoryTurnTransportRequest, StoryTurnTransportResponse } from "./types";
import { operationalMetrics } from "../observability/operational-metrics";

export type SoloDeepSeekTransportOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  thinkingMode?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  thinkingBudget?: number;
  fetchImpl?: typeof fetch;
};

export class SoloDeepSeekTransport implements StoryTurnTransport {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SoloDeepSeekTransportOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("SOLO_STORY_API_KEY or DEEPSEEK_API_KEY is required for Solo story generation");
    }
    this.fetchImpl = options.fetchImpl || fetch;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch) {
    const explicitSoloBaseUrl = String(env.SOLO_STORY_BASE_URL || "").trim();
    const baseUrl = explicitSoloBaseUrl
      || String(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
    const apiKey = explicitSoloBaseUrl
      ? String(env.SOLO_STORY_API_KEY || env.DEEPSEEK_API_KEY || "").trim()
      : String(env.DEEPSEEK_API_KEY || env.SOLO_STORY_API_KEY || "").trim();
    return new SoloDeepSeekTransport({
      apiKey,
      baseUrl: normalizeBaseUrl(baseUrl),
      // Solo is an interactive two-stage hot path. Each stage is one bounded
      // provider call. Do not inherit the
      // repository-wide DEEPSEEK_MODEL: that setting may intentionally point
      // at a reasoning model whose entire output budget can be consumed by
      // reasoning_content before any player-visible JSON is produced.
      model: String(env.SOLO_STORY_MODEL || "deepseek-chat").trim(),
      timeoutMs: boundedInteger(env.SOLO_STORY_PROVIDER_TIMEOUT_MS, 30_000, 5_000, 120_000),
      maxOutputTokens: boundedInteger(env.SOLO_STORY_MAX_OUTPUT_TOKENS, 3_200, 800, 8_000),
      thinkingMode: parseThinkingMode(env.SOLO_STORY_THINKING),
      reasoningEffort: parseReasoningEffort(env.SOLO_STORY_REASONING_EFFORT),
      thinkingBudget: optionalBoundedInteger(env.SOLO_STORY_THINKING_BUDGET, 128, 32_768),
      fetchImpl
    });
  }

  async generate(request: StoryTurnTransportRequest): Promise<StoryTurnTransportResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const streaming = request.stage === "NARRATOR"
      && typeof request.onTextDelta === "function"
      && !requiresBufferedNarratorResponse(this.options.baseUrl, this.options.model);
    const batchType = `SOLO_TURN_${request.stage}`;
    try {
      // This method deliberately contains exactly one fetch. Provider, HTTP and
      // JSON failures are returned to the attempt state machine; no retry is
      // hidden in this transport.
      const response = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: request.prompt.systemPrompt },
            { role: "user", content: request.prompt.userPrompt }
          ],
          ...(request.prompt.responseMode === "JSON"
            && supportsJsonObjectResponse(this.options.baseUrl, this.options.model)
            ? { response_format: { type: "json_object" } }
            : {}),
          // DeepSeek V4 enables thinking by default. Other OpenAI-compatible
          // providers do not necessarily accept this vendor-specific field.
          // Keep the transport portable so the exact same frozen story fixture
          // can be benchmarked through SiliconFlow or another relay.
          ...(isDeepSeekEndpoint(this.options.baseUrl)
            ? {
                thinking: { type: this.options.thinkingMode || "disabled" },
                ...((this.options.thinkingMode || "disabled") === "enabled"
                  ? { reasoning_effort: this.options.reasoningEffort || "high" }
                  : {})
              }
            : isSiliconFlowEndpoint(this.options.baseUrl)
              ? {
                  // SiliconFlow exposes reasoning control through
                  // enable_thinking/thinking_budget. In particular, Kimi may
                  // spend the whole completion budget on reasoning when only
                  // thinking_budget is supplied. The interactive story path
                  // therefore defaults to Instant mode and receives only the
                  // final player-visible content stream. Some SiliconFlow
                  // replicas have nevertheless consumed the full completion
                  // as hidden reasoning while reporting Instant mode. Always
                  // transmit the configured hard budget as a second guard so
                  // enough tokens remain for player-visible content.
                  enable_thinking: (this.options.thinkingMode || "disabled") === "enabled",
                  ...(this.options.thinkingBudget
                    ? { thinking_budget: this.options.thinkingBudget }
                    : {})
                }
            : this.options.thinkingBudget
              ? { thinking_budget: this.options.thinkingBudget }
              : {}),
          stream: streaming,
          ...(streaming ? { stream_options: { include_usage: true } } : {}),
          // The foreground narrator must stay inside a server-settled fact
          // envelope. A low temperature still permits scene prose
          // while sharply reducing invented documents, quantities and
          // discoveries. The decision editor is even more constrained.
          temperature: stageTemperature(
            this.options.baseUrl,
            this.options.model,
            request.stage
          ),
          max_tokens: effectiveMaxOutputTokens(
            this.options.baseUrl,
            this.options.model,
            this.options.maxOutputTokens
          )
        }),
        signal: controller.signal
      });
      const headersAt = Date.now();
      const requestId = response.headers.get("x-request-id") || response.headers.get("x-deepseek-request-id") || undefined;
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as any;
        const reason = String(payload?.error?.message || payload?.message || `DeepSeek HTTP ${response.status}`).slice(0, 500);
        throw new Error(reason);
      }
      if (streaming) {
        const streamed = await readDeepSeekStream({
          response,
          stage: request.stage,
          modelFallback: this.options.model,
          startedAt,
          headersAt,
          onTextDelta: request.onTextDelta!
        });
        operationalMetrics.providerAttempt({
          engine: "solo_story_v2",
          batchType,
          result: "success",
          inputTokens: streamed.usage.inputTokens,
          outputTokens: streamed.usage.outputTokens
        });
        return {
          ...streamed,
          providerRequestId: requestId || streamed.providerRequestId
        };
      }
      const payload = await response.json().catch(() => null) as any;
      const rawText = String(payload?.choices?.[0]?.message?.content || "").trim();
      const inputTokens = Number(payload?.usage?.prompt_tokens || 0);
      const outputTokens = Number(payload?.usage?.completion_tokens || 0);
      const reasoningTokens = Number(payload?.usage?.completion_tokens_details?.reasoning_tokens || 0);
      if (!rawText) {
        const finishReason = String(payload?.choices?.[0]?.finish_reason || "missing");
        throw new Error(
          `Solo story provider returned an empty story response `
          + `(finish_reason=${finishReason}, completion_tokens=${outputTokens}, reasoning_tokens=${reasoningTokens})`
        );
      }
      const promptCacheHitTokens = Number(payload?.usage?.prompt_cache_hit_tokens || 0);
      const promptCacheMissTokens = Number(payload?.usage?.prompt_cache_miss_tokens || 0);
      operationalMetrics.providerAttempt({
        engine: "solo_story_v2",
        batchType,
        result: "success",
        inputTokens,
        outputTokens
      });
      return {
        stage: request.stage,
        rawText,
        model: String(payload?.model || this.options.model),
        providerRequestId: requestId,
        timings: { timeToHeadersMs: headersAt - startedAt, totalMs: Date.now() - startedAt },
        usage: {
          inputTokens,
          outputTokens,
          reasoningTokens,
          promptCacheHitTokens,
          promptCacheMissTokens
        }
      };
    } catch (error) {
      operationalMetrics.providerAttempt({ engine: "solo_story_v2", batchType, result: "failure" });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readDeepSeekStream(input: {
  response: Response;
  stage: StoryTurnTransportRequest["stage"];
  modelFallback: string;
  startedAt: number;
  headersAt: number;
  onTextDelta: NonNullable<StoryTurnTransportRequest["onTextDelta"]>;
}): Promise<StoryTurnTransportResponse> {
  if (!input.response.body) throw new Error("Solo story provider returned an empty streaming response");
  const reader = input.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let model = input.modelFallback;
  let providerRequestId: string | undefined;
  let firstTokenAt: number | undefined;
  let usage: StoryTurnTransportResponse["usage"] = { inputTokens: 0, outputTokens: 0 };

  const consumeLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as any;
    model = String(chunk?.model || model);
    providerRequestId = providerRequestId || (chunk?.id ? String(chunk.id) : undefined);
    if (chunk?.usage) usage = providerUsage(chunk.usage);
    const delta = typeof chunk?.choices?.[0]?.delta?.content === "string"
      ? chunk.choices[0].delta.content
      : "";
    if (!delta) return;
    rawText += delta;
    firstTokenAt ??= Date.now();
    await input.onTextDelta(delta, rawText);
  };

  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value || new Uint8Array(), { stream: !next.done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) await consumeLine(line);
    if (next.done) break;
  }
  if (buffer.trim()) await consumeLine(buffer);
  rawText = rawText.trim();
  if (!rawText) throw new Error("Solo story provider returned an empty story response");
  return {
    stage: input.stage,
    rawText,
    model,
    providerRequestId,
    usage,
    timings: {
      timeToHeadersMs: input.headersAt - input.startedAt,
      timeToFirstTokenMs: firstTokenAt == null ? undefined : firstTokenAt - input.startedAt,
      totalMs: Date.now() - input.startedAt
    }
  };
}

function providerUsage(payload: any): StoryTurnTransportResponse["usage"] {
  return {
    inputTokens: Number(payload?.prompt_tokens || 0),
    outputTokens: Number(payload?.completion_tokens || 0),
    reasoningTokens: Number(payload?.completion_tokens_details?.reasoning_tokens || 0),
    promptCacheHitTokens: Number(payload?.prompt_cache_hit_tokens || 0),
    promptCacheMissTokens: Number(payload?.prompt_cache_miss_tokens || 0)
  };
}

function normalizeBaseUrl(raw: string) {
  const value = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) throw new Error("DEEPSEEK_BASE_URL must be an absolute HTTP(S) URL");
  return value.endsWith("/v1") ? value : `${value}/v1`;
}

function isDeepSeekEndpoint(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase().endsWith("deepseek.com");
  } catch {
    return false;
  }
}

function requiresBufferedNarratorResponse(baseUrl: string, model: string) {
  // Keep this provider/model pair on one buffered request so an empty GLM-5.2
  // completion retains finish_reason and token-usage diagnostics. This does
  // not retry the provider or replace the model selected for the story run.
  return isSiliconFlowEndpoint(baseUrl) && /(?:^|\/)GLM-5\.2$/i.test(model.trim());
}

function effectiveMaxOutputTokens(baseUrl: string, model: string, configuredMax: number) {
  // This path explicitly disables GLM thinking. Giving the relay an 8k output
  // ceiling made a 3.3k-token foreground prompt run until the 120s abort,
  // while the identical prompt completed in about 12s with a 1.6k ceiling.
  // The visible story budget is below 1k Chinese characters and the Decision
  // payload contains only two routes, so keep both stages bounded instead of
  // reserving hidden-reasoning capacity that this mode must not use.
  if (isSiliconFlowEndpoint(baseUrl) && /(?:^|\/)GLM-5\.2$/i.test(model.trim())) {
    return Math.min(configuredMax, 1_600);
  }
  return configuredMax;
}

function stageTemperature(
  baseUrl: string,
  model: string,
  stage: StoryTurnTransportRequest["stage"]
) {
  if (
    stage === "NARRATOR"
    && isSiliconFlowEndpoint(baseUrl)
    && /(?:^|\/)GLM-5\.2$/i.test(model.trim())
  ) {
    return 0.2;
  }
  return stage === "NARRATOR" ? 0.25 : 0.2;
}

function isSiliconFlowEndpoint(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "api.siliconflow.com" || hostname === "api.siliconflow.cn";
  } catch {
    return false;
  }
}

function supportsJsonObjectResponse(baseUrl: string, model: string) {
  // SiliconFlow currently rejects response_format for its GLM-5.x route.
  // The decision prompt still requires a single JSON object and the existing
  // parser validates it, so omit only the unsupported transport hint.
  return !(
    isSiliconFlowEndpoint(baseUrl)
    && /^zai-org\/GLM-5(?:\.|$)/i.test(model.trim())
  );
}

function parseThinkingMode(raw: unknown): "enabled" | "disabled" {
  return String(raw || "").trim().toLowerCase() === "enabled" ? "enabled" : "disabled";
}

function parseReasoningEffort(raw: unknown): "high" | "max" {
  return String(raw || "").trim().toLowerCase() === "max" ? "max" : "high";
}

function boundedInteger(raw: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function optionalBoundedInteger(raw: unknown, minimum: number, maximum: number) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}
