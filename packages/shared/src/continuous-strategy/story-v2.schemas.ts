import { GAME_PROJECTION_V2_SCHEMA_VERSION } from "./constants";
import { fail, integerAtLeast, isRecord, nonEmptyString, pass, type ValidationResult } from "./schema-utils";
import type { CreditControlProjection } from "./credit-control.schemas";

export type IntentTargetTypeV2 = "ROLE" | "PERSON" | "EVIDENCE" | "RESOURCE" | "LOCATION" | "INSTITUTION" | "PUBLIC_FRAME";
export type IntentVisibilityV2 = "PRIVATE" | "LIMITED" | "OBSERVABLE" | "PUBLIC";
export type IntentRiskToleranceV2 = "LOW" | "MEDIUM" | "HIGH";

// Every entry below is a complete player decision. The value records how the
// player expressed that decision; it never creates a side action or a second
// resolution path.
export type DecisionFormV2 = "STORY_CHOICE" | "CONVERSATION" | "INVESTIGATION" | "LEVERAGE" | "CUSTOM_PLAN";

export type PlayerIntentV2 = {
  objective: string;
  target: { type: IntentTargetTypeV2; id: string; label: string };
  method: string;
  leverageKeys: string[];
  visibility: IntentVisibilityV2;
  riskTolerance: IntentRiskToleranceV2;
  fallback: null | { method: string; triggerOn: "PRIMARY_BLOCKED" | "PRIMARY_PARTIAL" | "TARGET_REFUSED" };
  condition: null | { eventType: string; actorRoleId?: string; targetId?: string; expiresAtStage?: number };
  freeText?: string;
};

export type WorldBoundaryDecisionV2 =
  | "ACCEPT"
  | "ACCEPT_WITH_COST"
  | "REWRITE_NEEDED"
  | "REJECT_OUT_OF_WORLD"
  | "REJECT_ROLE_IMPOSSIBLE"
  | "REJECT_UNKNOWN_INFORMATION"
  | "REJECT_CONTROL_OTHER_PLAYER"
  | "REJECT_DECLARE_RESULT"
  | "REJECT_CAUSAL_GAP"
  | "REJECT_WORLD_CONTRADICTION";

export type WorldBoundaryResultV2 = {
  decision: WorldBoundaryDecisionV2;
  reason: string;
  matchedRules: string[];
  riskFlags: string[];
  normalizedIntent: PlayerIntentV2;
  suggestedRewrite: PlayerIntentV2 | null;
};

export type DecisionCandidateV2 = {
  id: string;
  actionKey: string | null;
  label: string;
  description: string;
  intent: string;
  targetRoleId: string | null;
  targetRoleName: string | null;
  risk: "LOW" | "NORMAL" | "HIGH";
  basisFactKeys: string[];
  requiredAssetKeys: string[];
  authorityBasis: string;
  intendedOutcome: string;
  concreteCost: string;
  expectedCountermove: string;
  visibility: IntentVisibilityV2;
  effectHooks: string[];
  intentDraft: PlayerIntentV2;
};

export type StoryTimelineEntryV2 = {
  id: string;
  kind: "OPENING" | "RESULT" | "CROSS_IMPACT" | "OBSERVABLE_TRACE" | "NEXT_SITUATION" | "ENDING";
  title: string;
  content: string;
  worldSequence: number;
  createdAt: string;
  sourceRoleName?: string;
  decisionForm?: DecisionFormV2;
};

export type ActorTurnProjectionV2 = {
  id: string;
  revision: number;
  stageIndex: number;
  turnIndex: number;
  baseWorldSequence: number;
  status: "OPEN" | "RESOLVING" | "RESOLVED" | "COMPLETED";
  title: string;
  narrative: string;
  visibleFacts: Array<{ factKey: string; content: string }>;
  framing: string;
  decisions: DecisionCandidateV2[];
  availableTargets: Array<{ type: IntentTargetTypeV2; id: string; label: string }>;
  customActionAllowed: boolean;
};

export type VisibleAssetV2 = {
  assetKey: string;
  kind: string;
  label: string;
  quantity: number;
  status: string;
};

export type CommitmentProjectionV2 = {
  id: string;
  issuerRoleId: string;
  issuerRoleName: string;
  receiverRoleId: string;
  receiverRoleName: string;
  content: string;
  visibility: IntentVisibilityV2;
  expiresAtStage: number | null;
  status: string;
};

export type ArmedConditionProjectionV2 = {
  id: string;
  eventType: string;
  actorRoleId: string | null;
  targetId: string | null;
  expiresAtStage: number | null;
  fallbackMethod: string | null;
  status: string;
};

export type PendingInteractionProjectionV2 = {
  id: string;
  sourceRoleId: string;
  sourceRoleName: string;
  requestKind: string;
  pressure: string;
  observableTrace: string | null;
  expiresAt: string | null;
  responseOptions: Array<{ id: string; label: string; description: string; intentDraft: PlayerIntentV2 }>;
};

export type ObservableTraceProjectionV2 = {
  id: string;
  content: string;
  worldSequence: number;
  createdAt: string;
};

export type GamePageWorldProjectionV1 = {
  schemaVersion: "game_page_world_v1";
  worldId: string;
  title: string;
  locale: "en" | "zh-CN";
  totalStages: number;
  presentation: {
    locationLabel: string;
    roundLabel: string;
    finaleLabel: string;
    sceneBackground: string;
    accent: string;
    accentSoft: string;
    statusMetrics: Array<{ key: string; label: string; value: number; suffix: string; tone: "default" | "green" | "gold" | "crown" }>;
  };
  roles: Array<{
    roleKey: string;
    roleName: string;
    identity: string;
    publicInfo: string;
    personalGoal: string;
    currentState: string;
    abilityText: string;
    arcText: string;
    knownInfo: string[];
    cannotDo: string[];
    portrait: string;
    gameplayProfile: {
      characterName: string;
      rank: string;
      office: string;
      fateQuestion: string;
      goals: string[];
      resources: Array<{ label: string; value: string }>;
      leverage: string[];
    };
  }>;
};

export type GameProjectionV2 = {
  schemaVersion: typeof GAME_PROJECTION_V2_SCHEMA_VERSION;
  generatedAt: string;
  worldSequence: number;
  room: { id: string; title: string; worldId: string; status: string; mode: string; ownerUserId?: string };
  world?: GamePageWorldProjectionV1;
  player: { userId: string; roleId: string; roleKey: string; roleName: string; identity: string; personalGoal: string };
  control: { mode: string; epoch: number; canHumanAct: boolean };
  currentTurn: ActorTurnProjectionV2 | null;
  timeline: StoryTimelineEntryV2[];
  otherActors: Array<{ roleId: string; roleName: string; controllerKind: "HUMAN" | "AI"; stageIndex: number }>;
  visibleAssets: VisibleAssetV2[];
  evidenceHoldings: VisibleAssetV2[];
  commitments: CommitmentProjectionV2[];
  armedConditions: ArmedConditionProjectionV2[];
  pendingInteractions: PendingInteractionProjectionV2[];
  observableTraces: ObservableTraceProjectionV2[];
  access: { state: string; requiresUnlock: boolean; requiredCredits: number; canCurrentUserUnlock: boolean; unlockEndpoint: string | null };
  creditControl: CreditControlProjection;
  completed: boolean;
  resultUrl: string | null;
};

export type TurnDecisionCommandV2 = {
  idempotencyKey: string;
  turnRevision: number;
  controlEpoch: number;
  candidateId?: string;
  customAction?: string;
  interactionId?: string;
  decisionForm?: DecisionFormV2;
  intent: PlayerIntentV2;
};

export type TurnDecisionResponseV2 = {
  accepted: true;
  resolution: {
    id: string;
    appliedWorldSequence: number;
    resultNarrative: string;
    nextHook: string;
  };
  gameProjection: GameProjectionV2;
} | {
  accepted: false;
  reason: string;
  suggestedRewrite: string | null;
  attemptId: string;
  gameProjection: GameProjectionV2;
};

export function validateGameProjectionV2(value: unknown): ValidationResult<GameProjectionV2> {
  if (!isRecord(value)) return fail(["game projection v2 must be an object"]);
  const errors: string[] = [];
  if (value.schemaVersion !== GAME_PROJECTION_V2_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!nonEmptyString(value.generatedAt)) errors.push("generatedAt is required");
  if (!integerAtLeast(value.worldSequence, 0)) errors.push("worldSequence must be >= 0");
  for (const key of ["room", "player", "control", "access", "creditControl"] as const) if (!isRecord(value[key])) errors.push(`${key} must be an object`);
  if (value.currentTurn !== null && !isRecord(value.currentTurn)) errors.push("currentTurn must be an object or null");
  if (!Array.isArray(value.timeline)) errors.push("timeline must be an array");
  if (!Array.isArray(value.otherActors)) errors.push("otherActors must be an array");
  for (const key of ["visibleAssets", "evidenceHoldings", "commitments", "armedConditions", "pendingInteractions", "observableTraces"] as const) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }
  if (typeof value.completed !== "boolean") errors.push("completed must be boolean");
  if (value.resultUrl !== null && typeof value.resultUrl !== "string") errors.push("resultUrl must be string or null");
  return errors.length ? fail(errors) : pass(value as GameProjectionV2);
}
