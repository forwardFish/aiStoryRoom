from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRANCH = os.environ.get("TARGET_BRANCH", "feat/mvp-four-maneuver-actions")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value.rstrip() + "\n", encoding="utf-8")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return source.replace(old, new, 1)


def run(command: str) -> None:
    print(f"$ {command}", flush=True)
    result = subprocess.run(command, cwd=ROOT, shell=True, text=True)
    if result.returncode:
        raise SystemExit(result.returncode)


AI_HELPER = r'''import { checkMvpAiBudget, exhaustMvpAiBudget, recordMvpAiBudgetUse } from "./mvp-ai-budget";
import type { MvpMutationInput, MvpNarrativeProvider, MvpView } from "./mvp-types";
import { getLeverageDefinition, getManeuverActor } from "./mvp-maneuver-config";

export type FourManeuverNarrativePlan = {
  maneuverType: "contact" | "investigate" | "leverage" | "custom";
  sceneKey: string;
  originEventId: string;
  title: string;
  narrative: string;
  statePatch: Record<string, number>;
  factKeys: string[];
  traces: string[];
  targetRoleKey?: string;
  consumedLeverageKey?: string;
};

type RecordAiTask = (task: {
  runId: string;
  eventId: string;
  taskType: string;
  status: string;
  provider: string;
  inputJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  errorMessage?: string;
}) => Promise<void> | void;

export async function resolveFourManeuverNarrative(options: {
  view: MvpView;
  plan: FourManeuverNarrativePlan;
  input: MvpMutationInput;
  provider?: MvpNarrativeProvider;
  recordAiTask?: RecordAiTask;
}) {
  const fallback = { title: options.plan.title, narrative: options.plan.narrative, replyText: "", fallbackUsed: true };
  if (!needsAi(options.plan)) return fallback;

  const provider = options.provider;
  if (!provider?.generateManeuverCandidate) {
    options.view.runtime.narrativeProvider = "deterministic-rules";
    options.view.runtime.fallbackUsed = true;
    return fallback;
  }

  const budget = options.view.runtime.aiBudget;
  const budgetCheck = checkMvpAiBudget(budget, provider.lastCall?.maxAttempts || 1);
  const target = options.plan.targetRoleKey ? getManeuverActor(options.plan.targetRoleKey) : null;
  const leverage = options.plan.consumedLeverageKey ? getLeverageDefinition(options.plan.consumedLeverageKey) : null;
  const aiContext = {
    task: options.plan.maneuverType === "contact" ? "character_response" : "leverage_character_response",
    sceneKey: options.plan.sceneKey,
    maneuverType: options.plan.maneuverType,
    target: target ? { roleKey: target.roleKey, displayName: target.displayName, publicIdentity: target.publicIdentity } : null,
    playerMessage: options.plan.maneuverType === "contact" ? String(options.input.messageText || "").trim() : "",
    leverage: leverage ? { leverageKey: leverage.leverageKey, label: leverage.label, description: leverage.description } : null,
    fallbackTitle: options.plan.title,
    fallbackNarrative: options.plan.narrative,
    immutableRuleResult: {
      statePatchKeys: Object.keys(options.plan.statePatch),
      factKeys: options.plan.factKeys,
      traces: options.plan.traces
    }
  };

  if (!budgetCheck.allowed) {
    const reason = budgetCheck.reason || "ai_budget_blocked";
    exhaustMvpAiBudget(budget, reason);
    options.view.runtime.narrativeProvider = "deterministic-rules";
    options.view.runtime.fallbackUsed = true;
    await options.recordAiTask?.({
      runId: options.view.run.id,
      eventId: options.plan.originEventId,
      taskType: "resolve_maneuver_narrative",
      status: "fallback",
      provider: provider.name,
      inputJson: aiContext,
      resultJson: { fallbackUsed: true, fallbackReason: reason, tokenUsage: { attempts: 0, inputTokens: 0, outputTokens: 0, costMinor: 0 } }
    });
    return fallback;
  }

  let tokenUsage = { attempts: 0, inputTokens: 0, outputTokens: 0, costMinor: 0 };
  try {
    const candidate = await provider.generateManeuverCandidate(aiContext);
    tokenUsage = recordMvpAiBudgetUse(budget, budgetCheck, provider.lastCall || {});
    const normalized = normalizeCandidate(candidate, options.plan, target?.displayName || "对方", leverage?.label || "");
    options.view.runtime.narrativeProvider = provider.name;
    options.view.runtime.fallbackUsed = false;
    await options.recordAiTask?.({
      runId: options.view.run.id,
      eventId: options.plan.originEventId,
      taskType: "resolve_maneuver_narrative",
      status: "completed",
      provider: provider.name,
      inputJson: aiContext,
      resultJson: { fallbackUsed: false, tokenUsage, output: normalized }
    });
    return { ...normalized, fallbackUsed: false };
  } catch (error) {
    if (tokenUsage.attempts === 0) tokenUsage = recordMvpAiBudgetUse(budget, budgetCheck, provider.lastCall || {});
    const reason = error instanceof Error ? error.message.slice(0, 500) : "maneuver_provider_failed";
    options.view.runtime.narrativeProvider = "deterministic-rules";
    options.view.runtime.fallbackUsed = true;
    await options.recordAiTask?.({
      runId: options.view.run.id,
      eventId: options.plan.originEventId,
      taskType: "resolve_maneuver_narrative",
      status: "fallback",
      provider: provider.name,
      inputJson: aiContext,
      resultJson: { fallbackUsed: true, fallbackReason: "provider_failed_or_invalid", tokenUsage },
      errorMessage: reason
    });
    return fallback;
  }
}

function needsAi(plan: FourManeuverNarrativePlan) {
  if (plan.maneuverType === "contact") return true;
  if (plan.maneuverType !== "leverage" || !plan.consumedLeverageKey) return false;
  return getLeverageDefinition(plan.consumedLeverageKey)?.resolutionMode === "AI_REACTION";
}

function normalizeCandidate(candidate: unknown, plan: FourManeuverNarrativePlan, targetName: string, leverageLabel: string) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("maneuver narrative candidate invalid");
  const source = candidate as Record<string, unknown>;
  const title = clean(source.title, 120) || plan.title;
  const replyText = clean(source.replyText, 500);
  let narrative = clean(source.narrative, 1500);
  if (!narrative && replyText) narrative = `${targetName}回应：“${replyText}”`;
  if (!narrative) throw new Error("maneuver narrative candidate empty");
  if (plan.maneuverType === "leverage" && leverageLabel && !narrative.includes("筹码已消耗")) {
    narrative = `${narrative}\n\n筹码已消耗：${leverageLabel}`;
  }
  return { title, narrative, replyText };
}

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}
'''

PROVIDER = r'''import type { MvpNarrativeProvider } from "./mvp-types";

type DeepSeekPayload = {
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

/**
 * Optional narration adapter. It can only propose player-visible wording;
 * rule-owned state, evidence, responsibility, cards and endings are ignored.
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
        "你是《桑田诏》主动谋划中的人物回应叙事器，只输出 JSON。",
        "只允许输出 title、narrative、replyText 三个字符串字段。",
        "规则引擎已经决定数值变化、事实、证据、筹码消耗和合法性；不得修改或补充这些权威结果。",
        "人物可以回避、试探、撒谎、提出条件或拒绝，但不能替玩家自动完成新的行动。",
        "保持回应简洁、具体、有角色立场，不要解释游戏规则。"
      ],
      user: {
        task: "为一次已通过规则校验的人物交谈或筹码出牌生成未知回应。",
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
        if (!response.ok) throw new Error(`causal narrative provider failed: ${payload.error?.code || `http_${response.status}`}`);
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
'''

AI_SPEC = r'''import assert from "node:assert/strict";
import test from "node:test";
import { MvpStoryEngine } from "./mvp-causal-runtime";
import { installFourManeuverRuntime } from "./mvp-four-maneuver-runtime";
import { installFourManeuverResolution } from "./mvp-four-maneuver-resolution";
import type { MvpView } from "./mvp-types";

installFourManeuverRuntime();
installFourManeuverResolution();

function view(sceneKey = "d4_1"): MvpView {
  return {
    run: { id: "run-ai", storyId: "sangtian", templateKey: "sangtian", mode: "single", selectedRoleKey: "zhejiang_governor", title: "桑田诏", location: "杭州", currentDay: 4, currentTime: "清晨", totalDays: 7, status: "awaiting_decision", version: 3, decisionsCompletedToday: 0, decisionsRequiredToday: 2, totalDecisionsCompleted: 6, totalDecisionsRequired: 12, createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" },
    player: { leverage: ["田契暗账（半页）", "清流县令密信", "巡抚与商会旧约传闻"] },
    messages: [],
    activeDecision: { messageId: "m-1", decisionKey: sceneKey, day: 4, index: 0, title: "如何使用暗账", help: "", reactionRoleKey: "county_magistrate", options: [] },
    dashboard: { worldState: [["皇帝信任", 45]], roleState: {}, traces: [] }, decisionHistory: [], events: [], causalLedger: {}, daySummary: null, daySummaries: {}, finalJudgement: null, outcome: null,
    runtime: { schemaVersion: "test", narrativeProvider: "rules", fallbackUsed: true, aiBudget: { maxCalls: 20, maxTotalTokens: 100000, costLimitMinor: null, calls: 0, totalTokens: 0, totalCostMinor: 0, exhausted: false, lastFallbackReason: null } },
    maneuverState: { maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2, totalManeuversUsed: 0, usedLeverageKeys: [] } as any
  };
}

class Storage {
  current: MvpView;
  aiTasks: any[] = [];
  constructor(initial: MvpView) { this.current = structuredClone(initial); }
  async load() { return structuredClone(this.current); }
  async save(next: MvpView, expectedVersion: number) { assert.equal(this.current.run.version, expectedVersion); this.current = structuredClone(next); }
  async recordAiTask(task: any) { this.aiTasks.push(structuredClone(task)); }
}

function provider({ fail = false } = {}) {
  const state = { calls: 0 };
  const instance: any = {
    name: "fake-maneuver-provider",
    lastCall: { attempts: 1, elapsedMs: 3, maxAttempts: 1, inputTokens: 80, outputTokens: 40 },
    async generateDecisionCandidate() { return {}; },
    async generateManeuverCandidate() {
      state.calls += 1;
      if (fail) throw new Error("injected maneuver provider failure");
      return { title: "对方终于回应", narrative: "对方沉默片刻，给出了一句带条件的答复。", replyText: "我可以回答，但你也要承担后果。", statePatch: { "皇帝信任": 99 } };
    }
  };
  return { instance, state };
}

test("contact uses exactly one AI call while rule state remains authoritative", async () => {
  const storage = new Storage(view("d4_1"));
  const fake = provider();
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-contact", maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "原始底册是否完整？" });
  assert.equal(fake.state.calls, 1);
  assert.match(result.messages.at(-1).body, /带条件的答复/);
  assert.equal(result.dashboard.worldState.find((item: any[]) => item[0] === "皇帝信任")[1], 45);
  assert.equal(storage.aiTasks.length, 1);
  assert.equal(storage.aiTasks[0].status, "completed");
});

test("fixed investigation remains zero AI", async () => {
  const storage = new Storage(view("d4_1"));
  const fake = provider();
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-investigate", maneuverType: "investigate", intentKey: "inspect_land_register_binding" });
  assert.equal(fake.state.calls, 0);
  assert.match(result.messages.at(-1).body, /重新装订/);
  assert.equal(storage.aiTasks.length, 0);
});

test("AI_REACTION leverage calls once and always records card consumption", async () => {
  const storage = new Storage(view("d4_1"));
  const fake = provider();
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-leverage", maneuverType: "leverage", leverageKey: "land_contract_fragment", targetRoleKey: "merchant" });
  assert.equal(fake.state.calls, 1);
  assert.match(result.messages.at(-1).body, /筹码已消耗：田契暗账/);
  assert.ok(result.maneuverState.usedLeverageKeys.includes("land_contract_fragment"));
});

test("provider failure falls back without consuming a second call", async () => {
  const storage = new Storage(view("d4_1"));
  const fake = provider({ fail: true });
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-fallback", maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "你是否保留了抄件？" });
  assert.equal(fake.state.calls, 1);
  assert.match(result.messages.at(-1).body, /卢象升/);
  assert.equal(storage.aiTasks[0].status, "fallback");
  assert.equal(result.maneuverState.maneuverOpportunitiesRemaining, 1);
});

test("budget rejection performs zero provider calls and keeps deterministic fallback", async () => {
  const initial = view("d4_1");
  initial.runtime.aiBudget.maxCalls = 0;
  const storage = new Storage(initial);
  const fake = provider();
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-budget", maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "原始底册是否完整？" });
  assert.equal(fake.state.calls, 0);
  assert.equal(result.runtime.aiBudget.exhausted, true);
  assert.equal(storage.aiTasks[0].status, "fallback");
});
'''


def main() -> None:
    run("git config user.name 'ChatGPT Pro Stage Runner'")
    run("git config user.email 'actions@users.noreply.github.com'")
    write("apps/api/src/mvp-four-maneuver-ai.ts", AI_HELPER)
    write("apps/api/src/mvp-narrative-provider.ts", PROVIDER)
    write("apps/api/src/mvp-four-maneuver-ai.spec.ts", AI_SPEC)

    path = "apps/api/src/mvp-four-maneuver-resolution.ts"
    source = read(path)
    source = replace_once(source, 'import type { MvpView } from "./mvp-types";\n', 'import type { MvpView } from "./mvp-types";\nimport { resolveFourManeuverNarrative } from "./mvp-four-maneuver-ai";\n', "AI import")
    source = replace_once(source, '  const view = ensureFourManeuverState(structuredClone(stored));\n  applyPatch(view, plan.statePatch);\n', '  const view = ensureFourManeuverState(structuredClone(stored));\n  const narrated = await resolveFourManeuverNarrative({\n    view,\n    plan,\n    input,\n    provider: engine.narrativeProvider,\n    recordAiTask: engine.storage.recordAiTask?.bind(engine.storage)\n  });\n  plan.title = narrated.title;\n  plan.narrative = narrated.narrative;\n  applyPatch(view, plan.statePatch);\n', "AI narrative hook")
    source = source.replace("主劢", "主动")
    write(path, source)

    run("pnpm --filter @apps/api typecheck")
    run("node --import tsx --test apps/api/src/mvp-four-maneuver-ai.spec.ts")
    run("pnpm test:ai-failure")

    (ROOT / ".github/workflows/maneuver-p4.yml").unlink(missing_ok=True)
    (ROOT / "scripts/automation/apply-maneuver-p4.py").unlink(missing_ok=True)
    run("git add -A")
    run("git commit -m 'feat(maneuver-ai): add one-call character responses'")
    run(f"git push origin HEAD:{BRANCH}")


if __name__ == "__main__":
    main()
