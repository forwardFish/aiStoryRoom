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
}

export interface MvpRunState {
  id: string;
  storyId: string;
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
  };
}

export interface MvpMutationInput {
  version: number;
  [key: string]: unknown;
}

export interface MvpNarrativeProvider {
  readonly name: string;
  generateDecisionCandidate(context: Record<string, unknown>): Promise<unknown>;
}
