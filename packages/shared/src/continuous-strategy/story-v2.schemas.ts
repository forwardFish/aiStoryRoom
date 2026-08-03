import {
  CONTINUOUS_OPENOVEL_ENGINE_VERSION,
  CONTINUOUS_STORY_ENGINE_VERSION,
  GAME_PROJECTION_V2_SCHEMA_VERSION,
  OPENOVEL_ROLE_RUNTIME_MODE
} from "./constants";
import { fail, integerAtLeast, isRecord, nonEmptyString, onlyKeys, pass, type ValidationResult } from "./schema-utils";
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
  effectClaim?: "REQUEST" | "CONTEST" | "TRANSFER" | "INJURY" | "PERMANENT_REMOVAL" | "OTHER";
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

export type ActorTurnActionAvailabilityItemV2 = {
  state: "AVAILABLE" | "LOCKED";
  reason: string;
  targetIds: string[];
  assetKeys: string[];
};

export type ActorTurnActionAvailabilityV2 = {
  storyChoice: ActorTurnActionAvailabilityItemV2;
  conversation: ActorTurnActionAvailabilityItemV2;
  investigation: ActorTurnActionAvailabilityItemV2;
  leverage: ActorTurnActionAvailabilityItemV2;
  customPlan: ActorTurnActionAvailabilityItemV2;
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
  actionAvailability?: ActorTurnActionAvailabilityV2;
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
  direction: "INCOMING" | "OUTGOING";
  sourceRoleId: string;
  sourceRoleName: string;
  targetRoleId: string;
  targetRoleName: string;
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
  engineVersion: typeof CONTINUOUS_STORY_ENGINE_VERSION | typeof CONTINUOUS_OPENOVEL_ENGINE_VERSION | "solo_story_v2";
  runtimeMode: "STRUCTURED_STORY_V2" | typeof OPENOVEL_ROLE_RUNTIME_MODE | "SOLO_STORY_V2";
  generatedAt: string;
  worldSequence: number;
  prologueNarrative?: string;
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
  pendingImpacts: Array<{
    id: string;
    status: "PENDING" | "SYNCING" | "RECOVERY_REQUIRED";
    appliedWorldSequence: number | null;
  }>;
  roleNarrativeState: {
    canonStatus: "READY" | "GENERATING" | "EMPTY";
    generationStatus: "IDLE" | "GENERATING" | "RETRY_AVAILABLE";
    impactStatus: "SYNCED" | "PENDING" | "SYNCING" | "RECOVERY_REQUIRED";
    canRetry: boolean;
  };
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
  const errors: string[] = onlyKeys(value, [
    "schemaVersion", "engineVersion", "runtimeMode", "generatedAt", "worldSequence", "prologueNarrative", "room", "world", "player", "control",
    "currentTurn", "timeline", "otherActors", "visibleAssets", "evidenceHoldings", "commitments", "armedConditions",
    "pendingInteractions", "observableTraces", "pendingImpacts", "roleNarrativeState", "access", "creditControl", "completed", "resultUrl"
  ]);
  if (value.schemaVersion !== GAME_PROJECTION_V2_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (![CONTINUOUS_STORY_ENGINE_VERSION, CONTINUOUS_OPENOVEL_ENGINE_VERSION, "solo_story_v2"].includes(String(value.engineVersion))) errors.push("invalid engineVersion");
  const expectedRuntime = value.engineVersion === CONTINUOUS_OPENOVEL_ENGINE_VERSION
    ? OPENOVEL_ROLE_RUNTIME_MODE
    : value.engineVersion === "solo_story_v2" ? "SOLO_STORY_V2" : "STRUCTURED_STORY_V2";
  if (value.runtimeMode !== expectedRuntime) errors.push("runtimeMode does not match engineVersion");
  if (!nonEmptyString(value.generatedAt)) errors.push("generatedAt is required");
  if (!integerAtLeast(value.worldSequence, 0)) errors.push("worldSequence must be >= 0");
  for (const key of ["room", "player", "control", "access", "creditControl"] as const) if (!isRecord(value[key])) errors.push(`${key} must be an object`);
  if (value.currentTurn !== null && !isRecord(value.currentTurn)) errors.push("currentTurn must be an object or null");
  if (!Array.isArray(value.timeline)) errors.push("timeline must be an array");
  if (!Array.isArray(value.otherActors)) errors.push("otherActors must be an array");
  for (const key of ["visibleAssets", "evidenceHoldings", "commitments", "armedConditions", "pendingInteractions", "observableTraces", "pendingImpacts"] as const) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }
  if (Array.isArray(value.pendingImpacts)) for (const impact of value.pendingImpacts) {
    if (!isRecord(impact)
      || !nonEmptyString(impact.id)
      || !["PENDING", "SYNCING", "RECOVERY_REQUIRED"].includes(String(impact.status))
      || (impact.appliedWorldSequence !== null && !integerAtLeast(impact.appliedWorldSequence, 1))) {
      errors.push("pendingImpacts contains an invalid item");
    }
  }
  if (!isRecord(value.roleNarrativeState)
    || !["READY", "GENERATING", "EMPTY"].includes(String(value.roleNarrativeState.canonStatus))
    || !["IDLE", "GENERATING", "RETRY_AVAILABLE"].includes(String(value.roleNarrativeState.generationStatus))
    || !["SYNCED", "PENDING", "SYNCING", "RECOVERY_REQUIRED"].includes(String(value.roleNarrativeState.impactStatus))
    || typeof value.roleNarrativeState.canRetry !== "boolean") errors.push("roleNarrativeState is invalid");
  for (const forbidden of projectionForbiddenKeys(value)) errors.push(`forbidden projection property: ${forbidden}`);
  if (typeof value.completed !== "boolean") errors.push("completed must be boolean");
  if (value.resultUrl !== null && typeof value.resultUrl !== "string") errors.push("resultUrl must be string or null");
  return errors.length ? fail(errors) : pass(value as GameProjectionV2);
}

const FORBIDDEN_PROJECTION_KEYS = new Set([
  "contextjson", "statepatch", "statepatchjson", "prompt", "systemprompt", "developerprompt",
  "rationale", "internalpayload", "providerpayload", "rawpayload"
]);

function projectionForbiddenKeys(value: unknown, path = "projection"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => projectionForbiddenKeys(item, `${path}[${index}]`));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const current = `${path}.${key}`;
    return [
      ...(FORBIDDEN_PROJECTION_KEYS.has(key.toLowerCase()) ? [current] : []),
      ...projectionForbiddenKeys(nested, current)
    ];
  });
}
