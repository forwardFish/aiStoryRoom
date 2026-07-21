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
      // Solo is an interactive, single-call hot path.  Do not inherit the
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
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
          response_format: { type: "json_object" },
          stream: false,
          temperature: 0.72,
          max_tokens: this.options.maxOutputTokens
        }),
        signal: controller.signal
      });
      const requestId = response.headers.get("x-request-id") || response.headers.get("x-deepseek-request-id") || undefined;
      const payload = await response.json().catch(() => null) as any;
      if (!response.ok) {
        const reason = String(payload?.error?.message || payload?.message || `DeepSeek HTTP ${response.status}`).slice(0, 500);
        throw new Error(reason);
      }
      const rawText = String(payload?.choices?.[0]?.message?.content || "").trim();
      if (!rawText) throw new Error("DeepSeek returned an empty story response");
      const inputTokens = Number(payload?.usage?.prompt_tokens || 0);
      const outputTokens = Number(payload?.usage?.completion_tokens || 0);
      operationalMetrics.providerAttempt({
        engine: "solo_story_v2",
        batchType: "SOLO_TURN",
        result: "success",
        inputTokens,
        outputTokens
      });
      return {
        rawText,
        model: String(payload?.model || this.options.model),
        providerRequestId: requestId,
        usage: {
          inputTokens,
          outputTokens
        }
      };
    } catch (error) {
      operationalMetrics.providerAttempt({ engine: "solo_story_v2", batchType: "SOLO_TURN", result: "failure" });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
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
