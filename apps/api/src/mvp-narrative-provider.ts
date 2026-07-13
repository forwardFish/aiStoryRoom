import type { MvpNarrativeProvider } from "./mvp-types";

type DeepSeekPayload = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: string; message?: string };
};

/**
 * Optional narration adapter. It can only propose wording; MvpStoryEngine discards
 * any model-proposed state, trigger, responsibility or ending changes.
 */
export class DeepSeekMvpNarrativeProvider implements MvpNarrativeProvider {
  readonly name: string;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  lastCall = { attempts: 0, elapsedMs: 0, maxAttempts: 2, inputTokens: 0, outputTokens: 0 };
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string; timeoutMs?: number; maxAttempts?: number }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
    this.model = config.model || "deepseek-v4-pro";
    this.timeoutMs = Math.max(1000, Math.min(60_000, Number(config.timeoutMs || 15_000)));
    this.maxAttempts = Math.max(1, Math.min(3, Number(config.maxAttempts || 2)));
    this.lastCall = { attempts: 0, elapsedMs: 0, maxAttempts: this.maxAttempts, inputTokens: 0, outputTokens: 0 };
    this.name = `deepseek:${this.model}`;
  }

  async generateDecisionCandidate(context: Record<string, unknown>) {
    const startedAt = Date.now();
    let lastError: unknown = new Error("causal narrative provider failed");
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`
          },
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({
            model: this.model,
            messages: [
              {
                role: "system",
                content: [
                  "你是《桑田诏》叙事润色器，只输出 JSON。",
                  "不得提出或修改数值、关系、证据、责任、FateSeed、触发条件和结局。",
                  "只能润色 immediateResult.resultMessage、visibleCausalCard 的可见文字，以及 roleReactions.messageToPlayer。",
                  "保持历史语境克制、清楚，不能替角色宣布未知事实。"
                ].join("\n")
              },
              {
                role: "user",
                content: JSON.stringify({
                  task: "根据规则已决定的选择，生成简洁的玩家可见叙事候选。",
                  outputSchema: {
                    immediateResult: { resultMessage: { title: "string", narrative: "string" } },
                    visibleCausalCard: { decisionSummary: "string", personalEcho: "string", worldEcho: "string", playerFacingHint: "string" },
                    roleReactions: [{ roleKey: "string", messageToPlayer: { title: "string", narrative: "string" } }]
                  },
                  context
                })
              }
            ],
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
            stream: false,
            max_tokens: Math.max(1, Math.min(8_000, Number(process.env.AI_DECISION_MAX_OUTPUT_TOKENS || 1_800))),
            temperature: 0.3
          })
        });
        const payload = await response.json().catch(() => ({})) as DeepSeekPayload;
        if (!response.ok) {
          const code = payload.error?.code || `http_${response.status}`;
          throw new Error(`causal narrative provider failed: ${code}`);
        }
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new Error("causal narrative provider returned no content");
        const candidate = JSON.parse(content);
        this.lastCall = {
          attempts: attempt,
          elapsedMs: Date.now() - startedAt,
          maxAttempts: this.maxAttempts,
          inputTokens: Math.max(0, Number(payload.usage?.prompt_tokens || 0)),
          outputTokens: Math.max(0, Number(payload.usage?.completion_tokens || 0))
        };
        return candidate;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxAttempts) continue;
      }
    }
    this.lastCall = { attempts: this.maxAttempts, elapsedMs: Date.now() - startedAt, maxAttempts: this.maxAttempts, inputTokens: 0, outputTokens: 0 };
    throw lastError;
  }
}

export function createConfiguredMvpNarrativeProvider(): MvpNarrativeProvider | undefined {
  const provider = String(process.env.AI_CAUSAL_PROVIDER || "").trim().toLowerCase();
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (provider === "rules" || provider === "mock" || provider === "none") return undefined;
  if (!apiKey) return undefined;
  if (provider && provider !== "deepseek") return undefined;
  return new DeepSeekMvpNarrativeProvider({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
    timeoutMs: Number(process.env.AI_CAUSAL_TIMEOUT_MS || 15_000),
    maxAttempts: Number(process.env.AI_CAUSAL_MAX_ATTEMPTS || 2)
  });
}

