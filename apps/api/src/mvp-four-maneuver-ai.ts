import { checkMvpAiBudget, exhaustMvpAiBudget, recordMvpAiBudgetUse } from "./mvp-ai-budget";
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
