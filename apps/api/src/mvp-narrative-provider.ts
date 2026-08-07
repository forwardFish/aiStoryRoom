import type { MvpNarrativeProvider } from "./mvp-types";

type DeepSeekPayload = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: string; message?: string };
};

type RequestSpec = {
  system: string[];
  user: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
};

type ProviderCallMeta = {
  attempts: number;
  elapsedMs: number;
  maxAttempts: number;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
  modelName: string | null;
};

/**
 * Optional narration adapter. It can only propose player-visible wording;
 * rule-owned state, evidence, responsibility, cards and endings are ignored.
 */
export class DeepSeekMvpNarrativeProvider implements MvpNarrativeProvider {
  readonly name: string;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  lastCall: ProviderCallMeta;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string; timeoutMs?: number; maxAttempts?: number }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
    this.model = config.model || "deepseek-v4-pro";
    this.timeoutMs = Math.max(1000, Math.min(60_000, Number(config.timeoutMs || 15_000)));
    this.maxAttempts = Math.max(1, Math.min(3, Number(config.maxAttempts || 2)));
    this.lastCall = emptyCall(this.maxAttempts, this.model);
    this.name = `deepseek:${this.model}`;
  }

  generateDecisionCandidate(context: Record<string, unknown>) {
    return this.requestJson({
      system: [
        "你是《桑田诏》叙事润色器，只输出 JSON。",
        "不得提出或修改数值、关系、证据、责任、FateSeed、触发条件和结局。",
        "只能润色 immediateResult.resultMessage、visibleCausalCard 的可见文字，以及 roleReactions.messageToPlayer。",
        "保持历史语境克制、清楚，不能替角色宣布未知事实。"
      ],
      user: {
        task: "根据规则已决定的选择，生成简洁的玩家可见叙事候选。",
        outputSchema: {
          immediateResult: { resultMessage: { title: "string", narrative: "string" } },
          visibleCausalCard: { decisionSummary: "string", personalEcho: "string", worldEcho: "string", playerFacingHint: "string" },
          roleReactions: [{ roleKey: "string", messageToPlayer: { title: "string", narrative: "string" } }]
        },
        context
      },
      maxTokens: Math.max(1, Math.min(8_000, Number(process.env.AI_DECISION_MAX_OUTPUT_TOKENS || 1_800))),
      temperature: 0.3
    });
  }

  generateManeuverCandidate(context: Record<string, unknown>) {
    return this.requestJson({
      system: [
        "你是一个可插拔叙事世界中的人物回应渲染器，只输出 JSON。",
        "只允许输出 title、narrative、replyText 三个字符串字段；不得输出状态补丁、规则解释或额外字段。",
        "规则引擎已经决定数值变化、事实、证据、筹码消耗和合法性；不得修改、扩张或补充这些权威结果。",
        "严格遵守 context 中的人物公开身份、目标、信息风格、可见 Canon 与 immutableRuleResult。",
        "人物可以回避、试探、撒谎、提出条件或拒绝，但不能替玩家作决定，不能自动完成新的世界行动。",
        "不得泄露 context 未提供的隐藏事实，也不得把推测、传闻或玩家说法升级为已确认事实。",
        "回应应简洁、具体、有角色差异；使用 context 所体现的世界语言和叙事语域，不要解释游戏规则。"
      ],
      user: {
        task: "为一次已通过服务端规则校验的人物交谈或筹码出牌生成一次玩家可见回应。",
        outputSchema: { title: "string", narrative: "string", replyText: "string" },
        context
      },
      maxTokens: Math.max(1, Math.min(2_000, Number(process.env.AI_MANEUVER_MAX_OUTPUT_TOKENS || 700))),
      temperature: 0.45
    });
  }

  private async requestJson(spec: RequestSpec) {
    const startedAt = Date.now();
    let lastError: unknown = new Error("causal narrative provider failed");
    let lastRequestId: string | null = null;
    let lastModelName: string | null = this.model;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: spec.system.join("\n") },
              { role: "user", content: JSON.stringify(spec.user) }
            ],
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
            stream: false,
            max_tokens: spec.maxTokens,
            temperature: spec.temperature
          })
        });
        const payload = await response.json().catch(() => ({})) as DeepSeekPayload;
        lastRequestId = String(
          response.headers.get("x-request-id")
          || response.headers.get("request-id")
          || payload.id
          || "",
        ).trim() || null;
        lastModelName = String(payload.model || this.model).trim() || this.model;
        if (!response.ok) throw new Error(`causal narrative provider failed: ${payload.error?.code || `http_${response.status}`}`);
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new Error("causal narrative provider returned no content");
        const candidate = JSON.parse(content);
        this.lastCall = {
          attempts: attempt,
          elapsedMs: Date.now() - startedAt,
          maxAttempts: this.maxAttempts,
          inputTokens: Math.max(0, Number(payload.usage?.prompt_tokens || 0)),
          outputTokens: Math.max(0, Number(payload.usage?.completion_tokens || 0)),
          requestId: lastRequestId,
          modelName: lastModelName,
        };
        return candidate;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxAttempts) continue;
      }
    }
    this.lastCall = {
      ...emptyCall(this.maxAttempts, lastModelName || this.model),
      attempts: this.maxAttempts,
      elapsedMs: Date.now() - startedAt,
      requestId: lastRequestId,
      modelName: lastModelName,
    };
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

function emptyCall(maxAttempts: number, modelName: string | null): ProviderCallMeta {
  return {
    attempts: 0,
    elapsedMs: 0,
    maxAttempts,
    inputTokens: 0,
    outputTokens: 0,
    requestId: null,
    modelName,
  };
}
