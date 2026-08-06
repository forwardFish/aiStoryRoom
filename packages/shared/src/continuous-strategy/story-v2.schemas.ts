import { GAME_PROJECTION_V2_SCHEMA_VERSION } from "./constants";
import { fail, integerAtLeast, isRecord, nonEmptyString, pass, type ValidationResult } from "./schema-utils";
import type { CreditControlProjection } from "./credit-control.schemas";

export type IntentTargetTypeV2 = "ROLE" | "PERSON" | "DOCUMENT" | "EVIDENCE" | "RESOURCE" | "LOCATION" | "INSTITUTION" | "PUBLIC_FRAME";
export type ManeuverTargetTypeV1 = IntentTargetTypeV2 | "ACTOR" | "TRACE" | "WORLD_ENTITY";
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
  kind:
    | "OPENING"
    | "RESULT"
    | "CROSS_IMPACT"
    | "OBSERVABLE_TRACE"
    | "NEXT_SITUATION"
    | "ENDING"
    | "MANEUVER_ACTION"
    | "MANEUVER_RESULT"
    | "EVIDENCE"
    | "REACTION";
  title: string;
  content: string;
  worldSequence: number;
  createdAt: string;
  sourceRoleName?: string;
  sourceActionId?: string;
  decisionForm?: DecisionFormV2;
};

export type ActionAvailabilityStateV2 = "AVAILABLE" | "LOCKED";

export type ActionFormAvailabilityV2 = {
  state: ActionAvailabilityStateV2;
  reason: string;
  targetIds: string[];
  assetKeys: string[];
};

export type ActorTurnActionAvailabilityItemV2 = ActionFormAvailabilityV2;

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


export type ManeuverWindowProjectionV1 = {
  windowId: string;
  status: "OPEN" | "CLOSING" | "CLOSED";
  totalOpportunities: number;
  remainingOpportunities: number;
  usedSlots: Array<{ slot: "MANEUVER_1" | "MANEUVER_2"; actionId: string; kind: string; status: string }>;
  formLimits: { conversationRemaining: number; investigationRemaining: number };
  version: number;
  closesWhen: "MAIN_DECISION_COMMITS" | "DAY_ADVANCES";
};

export type ManeuverContactProjectionV1 = {
  actorId: string;
  roleId?: string;
  displayName: string;
  publicIdentity: string;
  currentAccess: string;
  whyRelevant: string;
  canReceiveEvidence: boolean;
  visibilityOptions: Array<"LIMITED" | "PUBLIC">;
};

export type ManeuverInvestigationLeadProjectionV1 = {
  traceId: string;
  title: string;
  narrativeHook: string;
  urgency: "NOW" | "THIS_TURN" | "PERSISTENT";
  expiresAtLabel: string | null;
  knownBecause: string;
  routeCount: number;
  visibleToCurrentRole: true;
  routes: Array<{
    routeId: string;
    label: string;
    narrativeMethod: string;
    mayLearn: string[];
    cannotProve: string[];
    costLabels: string[];
    returnLabel: string;
    possibleTrail: string | null;
  }>;
};

export type ManeuverRuleCardProjectionV1 = {
  cardAssetKey: string;
  cardKey: string;
  label: string;
  status: "AVAILABLE" | "LOCKED" | "COOLDOWN" | "CONSUMED";
  timing: Array<"ACTIVE" | "SET" | "ATTACH" | "REACTION">;
  guaranteedEffects: string[];
  limitations: string[];
  counterTags: string[];
  legalTargets?: Array<{ id: string; label: string; type: ManeuverTargetTypeV1 }>;
  triggerOptions?: Array<{ triggerPatternId: string; label: string }>;
};

export type ManeuverEvidenceProjectionV1 = {
  evidenceId: string;
  title: string;
  level: string;
  authenticity: string;
  supports: string[];
  cannotProve: string[];
  visibility: "PRIVATE" | "SHARED" | "PUBLIC";
  sourceLabel: string;
};

export type ManeuverPendingActionProjectionV1 = {
  actionId: string;
  kind: "CONVERSATION" | "INVESTIGATION" | "CARD_LAYOUT" | "CUSTOM_PLAN" | "REACTION";
  title: string;
  status: string;
  slot: "MANEUVER_1" | "MANEUVER_2" | "REACTION";
  revealsAtLabel?: string | null;
  sourceActionId?: string | null;
  resultTitle?: string | null;
  resultNarrative?: string | null;
  evidenceId?: string | null;
};

export type ManeuverReactionProjectionV1 = {
  reactionId: string;
  storyNotice: { title: string; narrative: string };
  options: Array<{ optionId: string; label: string; description: string }>;
  eligibleCardAssetKeys: string[];
  customAllowed: boolean;
  holdAllowed: boolean;
  expiresAt: string | null;
};

export type ManeuverRulesProjectionV1 = {
  schemaVersion: "maneuver_rules_projection_v1";
  enabled: true;
  window: ManeuverWindowProjectionV1;
  contacts: ManeuverContactProjectionV1[];
  investigationLeads: ManeuverInvestigationLeadProjectionV1[];
  ruleCards: ManeuverRuleCardProjectionV1[];
  evidenceCards: ManeuverEvidenceProjectionV1[];
  pendingActions: ManeuverPendingActionProjectionV1[];
  reactions: ManeuverReactionProjectionV1[];
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
  capabilities?: { maneuverRulesV1?: ManeuverRulesProjectionV1 };
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
  if (value.prologueNarrative !== undefined && typeof value.prologueNarrative !== "string") errors.push("prologueNarrative must be a string when provided");
  for (const key of ["room", "player", "control", "access", "creditControl"] as const) if (!isRecord(value[key])) errors.push(`${key} must be an object`);
  if (value.currentTurn !== null && !isRecord(value.currentTurn)) errors.push("currentTurn must be an object or null");
  if (!Array.isArray(value.timeline)) errors.push("timeline must be an array");
  if (!Array.isArray(value.otherActors)) errors.push("otherActors must be an array");
  for (const key of ["visibleAssets", "evidenceHoldings", "commitments", "armedConditions", "pendingInteractions", "observableTraces"] as const) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }
  if (value.capabilities !== undefined) {
    if (!isRecord(value.capabilities)) errors.push("capabilities must be an object when provided");
    else if (value.capabilities.maneuverRulesV1 !== undefined) {
      const maneuver = value.capabilities.maneuverRulesV1;
      validateManeuverRulesProjectionV1(maneuver, errors);
    }
  }
  if (typeof value.completed !== "boolean") errors.push("completed must be boolean");
  if (value.resultUrl !== null && typeof value.resultUrl !== "string") errors.push("resultUrl must be string or null");
  return errors.length ? fail(errors) : pass(value as GameProjectionV2);
}

function validateManeuverRulesProjectionV1(value: unknown, errors: string[]) {
  if (!isRecord(value) || value.schemaVersion !== "maneuver_rules_projection_v1" || value.enabled !== true) {
    errors.push("invalid maneuverRulesV1 capability");
    return;
  }
  const window = value.window;
  if (!isRecord(window)) {
    errors.push("maneuverRulesV1.window must be an object");
  } else {
    if (!nonEmptyString(window.windowId)) errors.push("maneuverRulesV1.window.windowId is required");
    if (!["OPEN", "CLOSING", "CLOSED"].includes(String(window.status || ""))) errors.push("invalid maneuverRulesV1.window.status");
    if (!integerAtLeast(window.totalOpportunities, 0)) errors.push("maneuverRulesV1.window.totalOpportunities must be >= 0");
    if (!integerAtLeast(window.remainingOpportunities, 0)) errors.push("maneuverRulesV1.window.remainingOpportunities must be >= 0");
    if (Number(window.remainingOpportunities) > Number(window.totalOpportunities)) errors.push("maneuverRulesV1.window remaining exceeds total");
    if (!integerAtLeast(window.version, 1)) errors.push("maneuverRulesV1.window.version must be >= 1");
    if (!Array.isArray(window.usedSlots)) errors.push("maneuverRulesV1.window.usedSlots must be an array");
    else for (const [index, slot] of window.usedSlots.entries()) {
      if (!isRecord(slot)
        || !["MANEUVER_1", "MANEUVER_2"].includes(String(slot.slot || ""))
        || !nonEmptyString(slot.actionId)
        || !nonEmptyString(slot.kind)
        || !nonEmptyString(slot.status)) errors.push(`invalid maneuverRulesV1.window.usedSlots[${index}]`);
    }
    if (!isRecord(window.formLimits)
      || !integerAtLeast(window.formLimits.conversationRemaining, 0)
      || !integerAtLeast(window.formLimits.investigationRemaining, 0)) errors.push("invalid maneuverRulesV1.window.formLimits");
  }

  for (const key of ["contacts", "investigationLeads", "ruleCards", "evidenceCards", "pendingActions", "reactions"] as const) {
    if (!Array.isArray(value[key])) errors.push(`maneuverRulesV1.${key} must be an array`);
  }
  if (Array.isArray(value.contacts)) value.contacts.forEach((item, index) => {
    if (!isRecord(item) || !nonEmptyString(item.actorId) || !nonEmptyString(item.displayName)
      || !Array.isArray(item.visibilityOptions) || typeof item.canReceiveEvidence !== "boolean") {
      errors.push(`invalid maneuverRulesV1.contacts[${index}]`);
    }
  });
  if (Array.isArray(value.investigationLeads)) value.investigationLeads.forEach((item, index) => {
    if (!isRecord(item) || !nonEmptyString(item.traceId) || !nonEmptyString(item.title)
      || item.visibleToCurrentRole !== true || !Array.isArray(item.routes)
      || !integerAtLeast(item.routeCount, 0) || item.routes.length !== item.routeCount) {
      errors.push(`invalid maneuverRulesV1.investigationLeads[${index}]`);
      return;
    }
    item.routes.forEach((route, routeIndex) => {
      if (!isRecord(route) || !nonEmptyString(route.routeId) || !nonEmptyString(route.label)
        || !Array.isArray(route.mayLearn) || !Array.isArray(route.cannotProve)
        || !Array.isArray(route.costLabels) || !nonEmptyString(route.returnLabel)) {
        errors.push(`invalid maneuverRulesV1.investigationLeads[${index}].routes[${routeIndex}]`);
      }
    });
  });
  if (Array.isArray(value.ruleCards)) value.ruleCards.forEach((item, index) => {
    if (!isRecord(item) || !nonEmptyString(item.cardAssetKey) || !nonEmptyString(item.cardKey)
      || !["AVAILABLE", "LOCKED", "COOLDOWN", "CONSUMED"].includes(String(item.status || ""))
      || !Array.isArray(item.timing) || !Array.isArray(item.guaranteedEffects)
      || !Array.isArray(item.limitations) || !Array.isArray(item.counterTags)) {
      errors.push(`invalid maneuverRulesV1.ruleCards[${index}]`);
    }
  });
  if (Array.isArray(value.evidenceCards)) value.evidenceCards.forEach((item, index) => {
    if (!isRecord(item) || !nonEmptyString(item.evidenceId) || !nonEmptyString(item.title)
      || !["PRIVATE", "SHARED", "PUBLIC"].includes(String(item.visibility || ""))
      || !Array.isArray(item.supports) || !Array.isArray(item.cannotProve)) {
      errors.push(`invalid maneuverRulesV1.evidenceCards[${index}]`);
    }
  });
  if (Array.isArray(value.pendingActions)) value.pendingActions.forEach((item, index) => {
    if (!isRecord(item) || !nonEmptyString(item.actionId)
      || !["CONVERSATION", "INVESTIGATION", "CARD_LAYOUT", "CUSTOM_PLAN", "REACTION"].includes(String(item.kind || ""))
      || !["MANEUVER_1", "MANEUVER_2", "REACTION"].includes(String(item.slot || ""))) {
      errors.push(`invalid maneuverRulesV1.pendingActions[${index}]`);
    }
  });
  if (Array.isArray(value.reactions)) value.reactions.forEach((item, index) => {
    if (!isRecord(item) || !nonEmptyString(item.reactionId) || !isRecord(item.storyNotice)
      || !nonEmptyString(item.storyNotice.title) || !nonEmptyString(item.storyNotice.narrative)
      || !Array.isArray(item.options) || !Array.isArray(item.eligibleCardAssetKeys)
      || typeof item.customAllowed !== "boolean" || typeof item.holdAllowed !== "boolean") {
      errors.push(`invalid maneuverRulesV1.reactions[${index}]`);
    }
  });
}
