import type { EvidenceCardStateV1, RuleCardHoldingV1, WorldTraceV1 } from "@ai-story/templates";

export type MvpScalar = string | number | boolean | null;

export interface MvpStoryEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MvpDecisionOption {
  key: string;
  title: string;
  body: string;
  gain: string;
  risk: string;
  patch: Record<string, number>;
  tags?: string[];
  reactionRoleKey?: string;
}

export interface MvpActiveDecision {
  messageId: string;
  decisionKey: string;
  day: number;
  index: number;
  title: string;
  help: string;
  reactionRoleKey: string;
  options: MvpDecisionOption[];
  promptKind?: "main_decision" | "critical_response";
}

export interface MvpRunState {
  id: string;
  storyId: string;
  templateKey: string;
  mode: string;
  selectedRoleKey: string;
  title: string;
  location: string;
  currentDay: number;
  currentTime: string;
  totalDays: number;
  status: string;
  version: number;
  decisionsCompletedToday: number;
  decisionsRequiredToday: number;
  totalDecisionsCompleted: number;
  totalDecisionsRequired: number;
  createdAt: string;
  updatedAt: string;
}

export interface MvpView {
  run: MvpRunState;
  player: Record<string, unknown>;
  messages: Array<Record<string, any>>;
  activeDecision: MvpActiveDecision | null;
  activePrompt?: {
    eventId: string;
    promptKind: "main_decision" | "critical_response";
    prompt: string;
    options: Array<{ optionKey: string; title: string }>;
    maxLength: number;
    submitLabel: string;
  } | null;
  narrativeEntries?: Array<Record<string, any>>;
  criticalEvent?: Record<string, any> | null;
  pendingCriticalEvents?: Array<Record<string, any>>;
  maneuverPanel?: Record<string, any>;
  situationRecord?: Record<string, any>;
  situationRecordOpen?: boolean;
  changeSummary?: Record<string, any> | null;
  dashboard: Record<string, any>;
  decisionHistory: Array<Record<string, any>>;
  events: MvpStoryEvent[];
  causalLedger: Record<string, any>;
  daySummary: Record<string, any> | null;
  daySummaries: Record<string, Record<string, any>>;
  finalJudgement: Record<string, any> | null;
  outcome: Record<string, any> | null;
  runtime: {
    schemaVersion: string;
    narrativeProvider: string;
    fallbackUsed: boolean;
    aiBudget: {
      maxCalls: number;
      maxTotalTokens: number;
      costLimitMinor: number | null;
      calls: number;
      totalTokens: number;
      totalCostMinor: number;
      exhausted: boolean;
      lastFallbackReason: string | null;
    };
  };
  maneuverRulesV1: MvpManeuverRulesStateV1;
  maneuverState: {
    maneuverOpportunitiesPerDay: number;
    maneuversUsedToday: number;
    maneuverOpportunitiesRemaining: number;
    totalManeuversUsed: number;
    usedLeverageKeys: string[];
  };
}


export interface MvpPendingManeuverV1 {
  actionId: string;
  kind: "CONVERSATION" | "INVESTIGATION" | "CARD_LAYOUT" | "CUSTOM_PLAN" | "REACTION";
  slot: "MANEUVER_1" | "MANEUVER_2" | "REACTION";
  day: number;
  title: string;
  status: "PENDING" | "ARMED" | "RESOLVED" | "EXPIRED";
  revealAtDay?: number;
  traceId?: string;
  routeId?: string;
  evidenceId?: string;
  evidenceTitle?: string;
  sourceActionId?: string;
  resultNarrative?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface MvpArmedRuleCardV1 {
  actionId: string;
  day: number;
  cardAssetKey: string;
  targetId: string;
  triggerPatternId: string;
  status: "ARMED" | "TRIGGERED" | "EXPIRED";
  createdAt: string;
  resolvedAt?: string;
}

export interface MvpManeuverRulesStateV1 {
  schemaVersion: "mvp_maneuver_rules_state_v1";
  enabled: true;
  windowVersion: number;
  conversationUsedToday: number;
  investigationUsedToday: number;
  traces: WorldTraceV1[];
  evidenceCards: EvidenceCardStateV1[];
  ruleCardHoldings: RuleCardHoldingV1[];
  pendingActions: MvpPendingManeuverV1[];
  armedCards: MvpArmedRuleCardV1[];
}

export interface MvpMutationInput {
  version: number;
  [key: string]: unknown;
}

export interface MvpNarrativeProvider {
  readonly name: string;
  readonly lastCall?: {
    attempts: number;
    elapsedMs: number;
    maxAttempts: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  generateDecisionCandidate(context: Record<string, unknown>): Promise<unknown>;
}
