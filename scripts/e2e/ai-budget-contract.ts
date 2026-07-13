import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MvpStoryEngine } from "../../apps/api/src/mvp-causal-runtime";
import { MemoryMvpStoryStorage } from "../../apps/api/src/mvp-storage";

function candidate(context: any) {
  return {
    immediateResult: { resultMessage: { title: "预算内润色", narrative: "只润色玩家可见的叙事。" } },
    visibleCausalCard: { decisionSummary: "规则已落账", personalEcho: "保留证据", worldEcho: "局势变化", playerFacingHint: "后续会有回响" },
    roleReactions: [{
      roleKey: context.activeDecision.reactionRoleKey,
      messageToPlayer: { title: "收到消息", narrative: "对方已注意到局势变化。" }
    }]
  };
}

class CapturingStorage extends MemoryMvpStoryStorage {
  readonly aiTasks: any[] = [];
  async recordAiTask(task: any) { this.aiTasks.push(structuredClone(task)); }
}

function setBudget(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

async function runMaxCallsCase() {
  setBudget({
    AI_RUN_MAX_CALLS: "1",
    AI_RUN_MAX_TOTAL_TOKENS: "260000",
    AI_RUN_COST_LIMIT_MINOR: "",
    AI_DECISION_MAX_INPUT_TOKENS: "10",
    AI_DECISION_MAX_OUTPUT_TOKENS: "10"
  });
  let calls = 0;
  const provider = {
    name: "budget-test-provider",
    lastCall: { attempts: 1, elapsedMs: 1, maxAttempts: 1, inputTokens: 5, outputTokens: 5 },
    async generateDecisionCandidate(context: any) { calls += 1; return candidate(context); }
  };
  const storage = new CapturingStorage();
  const engine = new MvpStoryEngine(storage, provider);
  let view: any = await engine.create({ storyId: "sangtian" });
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: view.run.version, optionKey: "A" });
  assert.equal(calls, 1);
  assert.equal(view.runtime.fallbackUsed, false);
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: view.run.version, optionKey: "B" });
  assert.equal(calls, 1, "an exhausted call budget must skip the provider");
  assert.equal(view.runtime.fallbackUsed, true);
  assert.equal(view.runtime.aiBudget.exhausted, true);
  assert.equal(view.runtime.aiBudget.lastFallbackReason, "ai_budget_max_calls");
  assert.equal(view.run.totalDecisionsCompleted, 2, "fallback must not lose an accepted decision");
  assert.equal(storage.aiTasks[1].status, "fallback");
  assert.equal(storage.aiTasks[1].resultJson.fallbackReason, "ai_budget_max_calls");
  return { providerCalls: calls, totalDecisionsCompleted: view.run.totalDecisionsCompleted, fallbackReason: view.runtime.aiBudget.lastFallbackReason };
}

async function runTokenAndCostCases() {
  const cases: Array<{ name: string; env: Record<string, string>; reason: string }> = [
    {
      name: "token",
      env: { AI_RUN_MAX_CALLS: "55", AI_RUN_MAX_TOTAL_TOKENS: "19", AI_RUN_COST_LIMIT_MINOR: "", AI_DECISION_MAX_INPUT_TOKENS: "10", AI_DECISION_MAX_OUTPUT_TOKENS: "10" },
      reason: "ai_budget_max_total_tokens"
    },
    {
      name: "cost",
      env: { AI_RUN_MAX_CALLS: "55", AI_RUN_MAX_TOTAL_TOKENS: "260000", AI_RUN_COST_LIMIT_MINOR: "0", AI_DECISION_MAX_INPUT_TOKENS: "10", AI_DECISION_MAX_OUTPUT_TOKENS: "10", AI_INPUT_PRICE_PER_MILLION_MINOR: "100000", AI_OUTPUT_PRICE_PER_MILLION_MINOR: "0" },
      reason: "ai_budget_cost_limit"
    }
  ];
  const results: Record<string, unknown> = {};
  for (const item of cases) {
    setBudget({ AI_INPUT_PRICE_PER_MILLION_MINOR: "0", AI_OUTPUT_PRICE_PER_MILLION_MINOR: "0", ...item.env });
    let calls = 0;
    const provider = {
      name: `budget-${item.name}-provider`,
      lastCall: { attempts: 1, elapsedMs: 1, maxAttempts: 1, inputTokens: 1, outputTokens: 1 },
      async generateDecisionCandidate(context: any) { calls += 1; return candidate(context); }
    };
    const storage = new CapturingStorage();
    const engine = new MvpStoryEngine(storage, provider);
    const initial: any = await engine.create({ storyId: "sangtian" });
    const view: any = await engine.submitDecision(initial.run.id, initial.activeDecision.messageId, { version: initial.run.version, optionKey: "A" });
    assert.equal(calls, 0, `${item.name} budget must preflight before a provider call`);
    assert.equal(view.runtime.aiBudget.lastFallbackReason, item.reason);
    assert.equal(view.run.totalDecisionsCompleted, 1);
    results[item.name] = { providerCalls: calls, fallbackReason: view.runtime.aiBudget.lastFallbackReason };
  }
  return results;
}

async function main() {
  const original = Object.fromEntries([
    "AI_RUN_MAX_CALLS", "AI_RUN_MAX_TOTAL_TOKENS", "AI_RUN_COST_LIMIT_MINOR", "AI_DECISION_MAX_INPUT_TOKENS", "AI_DECISION_MAX_OUTPUT_TOKENS", "AI_INPUT_PRICE_PER_MILLION_MINOR", "AI_OUTPUT_PRICE_PER_MILLION_MINOR"
  ].map((key) => [key, process.env[key]]));
  try {
    const result = {
      schemaVersion: "ai-budget-contract-v1",
      status: "PASS",
      maxCalls: await runMaxCallsCase(),
      limits: await runTokenAndCostCases(),
      completedAt: new Date().toISOString()
    };
    await mkdir(join(process.cwd(), "docs/auto-execute/results"), { recursive: true });
    await writeFile(join(process.cwd(), "docs/auto-execute/results/ai-budget-contract.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
