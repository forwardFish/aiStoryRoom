import type { StoryTurnTransport, StoryTurnTransportRequest, StoryTurnTransportResponse } from "./types";
import { operationalMetrics } from "../observability/operational-metrics";

export type SoloDeepSeekTransportOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
};

export class SoloDeepSeekTransport implements StoryTurnTransport {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SoloDeepSeekTransportOptions) {
    if (!options.apiKey.trim()) throw new Error("DEEPSEEK_API_KEY is required for Solo story generation");
    this.fetchImpl = options.fetchImpl || fetch;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch) {
    return new SoloDeepSeekTransport({
      apiKey: String(env.DEEPSEEK_API_KEY || "").trim(),
      baseUrl: normalizeBaseUrl(String(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com")),
      // Solo is an interactive two-stage hot path. Each stage is one bounded
      // provider call. Do not inherit the
      // repository-wide DEEPSEEK_MODEL: that setting may intentionally point
      // at a reasoning model whose entire output budget can be consumed by
      // reasoning_content before any player-visible JSON is produced.
      model: String(env.SOLO_STORY_MODEL || "deepseek-chat").trim(),
      timeoutMs: boundedInteger(env.SOLO_STORY_PROVIDER_TIMEOUT_MS, 30_000, 5_000, 120_000),
      maxOutputTokens: boundedInteger(env.SOLO_STORY_MAX_OUTPUT_TOKENS, 3_200, 800, 8_000),
      fetchImpl
    });
  }

  async generate(request: StoryTurnTransportRequest): Promise<StoryTurnTransportResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const streaming = request.stage === "NARRATOR" && typeof request.onTextDelta === "function";
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
            ? { response_format: { type: "json_object" } }
            : {}),
          // Solo is an interactive narrative-writing path, not a reasoning
          // task. DeepSeek V4 otherwise enables thinking by default, which can
          // spend player-visible wait time on hidden reasoning without
          // improving the deterministic rules/grounding handled by the server.
          thinking: { type: "disabled" },
          stream: streaming,
          ...(streaming ? { stream_options: { include_usage: true } } : {}),
          // The foreground narrator needs enough variation to write living
          // prose. The post-narration decision editor is more constrained.
          temperature: request.stage === "NARRATOR" ? 0.78 : 0.28,
          max_tokens: this.options.maxOutputTokens
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
      if (!rawText) throw new Error("DeepSeek returned an empty story response");
      const inputTokens = Number(payload?.usage?.prompt_tokens || 0);
      const outputTokens = Number(payload?.usage?.completion_tokens || 0);
      const reasoningTokens = Number(payload?.usage?.completion_tokens_details?.reasoning_tokens || 0);
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
  if (!input.response.body) throw new Error("DeepSeek returned an empty streaming response");
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
  if (!rawText) throw new Error("DeepSeek returned an empty story response");
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

function boundedInteger(raw: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}
