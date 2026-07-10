import type { MvpNarrativeProvider } from "./mvp-types";

type DeepSeekPayload = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { code?: string; message?: string };
};

/**
 * Optional narration adapter. It can only propose wording; MvpStoryEngine discards
 * any model-proposed state, trigger, responsibility or ending changes.
 */
export class DeepSeekMvpNarrativeProvider implements MvpNarrativeProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
    this.model = config.model || "deepseek-v4-pro";
    this.name = `deepseek:${this.model}`;
  }

  async generateDecisionCandidate(context: Record<string, unknown>) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      signal: AbortSignal.timeout(15_000),
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
    return JSON.parse(content);
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
    model: process.env.DEEPSEEK_MODEL
  });
}

