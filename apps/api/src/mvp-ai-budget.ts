export type MvpAiBudget = {
  maxCalls: number;
  maxTotalTokens: number;
  costLimitMinor: number | null;
  calls: number;
  totalTokens: number;
  totalCostMinor: number;
  exhausted: boolean;
  lastFallbackReason: string | null;
};

export type MvpAiBudgetCheck = {
  allowed: boolean;
  reason: string | null;
  plannedCalls: number;
  plannedInputTokens: number;
  plannedOutputTokens: number;
  plannedCostMinor: number;
};

function integerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function optionalIntegerEnv(name: string) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function createMvpAiBudget(): MvpAiBudget {
  return {
    maxCalls: integerEnv("AI_RUN_MAX_CALLS", 55),
    maxTotalTokens: integerEnv("AI_RUN_MAX_TOTAL_TOKENS", 260_000),
    costLimitMinor: optionalIntegerEnv("AI_RUN_COST_LIMIT_MINOR"),
    calls: 0,
    totalTokens: 0,
    totalCostMinor: 0,
    exhausted: false,
    lastFallbackReason: null
  };
}

function decisionInputLimit() { return integerEnv("AI_DECISION_MAX_INPUT_TOKENS", 6_000); }
function decisionOutputLimit() { return integerEnv("AI_DECISION_MAX_OUTPUT_TOKENS", 1_800); }

function costFor(inputTokens: number, outputTokens: number) {
  const inputPrice = integerEnv("AI_INPUT_PRICE_PER_MILLION_MINOR", 0);
  const outputPrice = integerEnv("AI_OUTPUT_PRICE_PER_MILLION_MINOR", 0);
  return Math.ceil((inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000);
}

export function checkMvpAiBudget(budget: MvpAiBudget, maxAttempts = 1): MvpAiBudgetCheck {
  const plannedCalls = Math.max(1, Math.floor(maxAttempts) || 1);
  const plannedInputTokens = decisionInputLimit();
  const plannedOutputTokens = decisionOutputLimit();
  const plannedCostMinor = costFor(plannedInputTokens, plannedOutputTokens);
  const reason = budget.calls + plannedCalls > budget.maxCalls
    ? "ai_budget_max_calls"
    : budget.totalTokens + plannedInputTokens + plannedOutputTokens > budget.maxTotalTokens
      ? "ai_budget_max_total_tokens"
      : budget.costLimitMinor !== null && budget.totalCostMinor + plannedCostMinor > budget.costLimitMinor
        ? "ai_budget_cost_limit"
        : null;
  return { allowed: !reason, reason, plannedCalls, plannedInputTokens, plannedOutputTokens, plannedCostMinor };
}

export function recordMvpAiBudgetUse(budget: MvpAiBudget, check: MvpAiBudgetCheck, usage: { attempts?: number; inputTokens?: number; outputTokens?: number } = {}) {
  const attempts = Math.max(1, Math.floor(Number(usage.attempts) || check.plannedCalls));
  const inputTokens = Math.max(0, Math.floor(Number(usage.inputTokens) || check.plannedInputTokens));
  const outputTokens = Math.max(0, Math.floor(Number(usage.outputTokens) || check.plannedOutputTokens));
  const costMinor = costFor(inputTokens, outputTokens);
  budget.calls += attempts;
  budget.totalTokens += inputTokens + outputTokens;
  budget.totalCostMinor += costMinor;
  return { attempts, inputTokens, outputTokens, costMinor };
}

export function exhaustMvpAiBudget(budget: MvpAiBudget, reason: string) {
  budget.exhausted = true;
  budget.lastFallbackReason = reason;
}
