export const MANEUVER_SCHEMA_VERSION = "maneuver_rules_v1" as const;

export type ManeuverKindV1 =
  | "CONVERSATION"
  | "INVESTIGATION"
  | "CARD_LAYOUT"
  | "CUSTOM_PLAN"
  | "REACTION";

export type ManeuverSlotV1 = "MANEUVER_1" | "MANEUVER_2" | "REACTION";

export type ManeuverVisibilityScopeV1 = "PRIVATE" | "LIMITED" | "OBSERVABLE" | "PUBLIC";

export type ActionPreviewDecisionV1 =
  | "READY"
  | "REROUTE_REQUIRED"
  | "SPLIT_REQUIRED"
  | "REWRITE_REQUIRED"
  | "BLOCKED";

export type PreviewSectionKindV1 =
  | "CAN_DO"
  | "CANNOT_GUARANTEE"
  | "MAY_LEAVE"
  | "WHEN_REVEALED"
  | "TRIGGER";

export type PreviewChipKindV1 = "COST" | "TIME" | "VISIBILITY" | "LOCK";

export type EvidenceLevelV1 = "LEAD" | "CORROBORATION" | "PROOF";

export type EvidenceAuthenticityV1 = "UNVERIFIED" | "SUPPORTED" | "AUTHENTICATED" | "DISPUTED";

export type TraceTypeV1 = "RECORD" | "WITNESS" | "PHYSICAL" | "TRANSACTION" | "RELATION" | "BEHAVIOR";

export type TraceStatusV1 = "ACTIVE" | "OBSCURED" | "EXHAUSTED" | "DESTROYED" | "EXPIRED";

export type InvestigationSettlementMomentV1 =
  | { kind: "IMMEDIATE_AFTER_COMMIT" }
  | { kind: "BEFORE_MAIN_LOCK" }
  | { kind: "NEXT_ACTOR_TURN" }
  | { kind: "ON_WORLD_EVENT"; eventPatternId: string }
  | { kind: "AT_STAGE"; stageIndex: number };

export type RuleCardTimingV1 = "ACTIVE" | "SET" | "ATTACH" | "REACTION";

export type RuleCardConsumptionV1 = "CONSUME" | "LOCK" | "COOLDOWN" | "REUSABLE";

export interface VisibilityRuleV1 {
  scope: ManeuverVisibilityScopeV1;
  actorIds?: string[];
  roleIds?: string[];
}

export interface ManeuverCostV1 {
  kind: "OPPORTUNITY" | "REACTION" | "RESOURCE" | "ASSET_LOCK" | "ASSET_CONSUME" | "COOLDOWN";
  id?: string;
  amount?: number;
  label: string;
}

export interface ManeuverTimingV1 {
  startsAt: "ON_COMMIT" | "ON_TRIGGER";
  settlesAt: InvestigationSettlementMomentV1 | { kind: "CURRENT_SETTLEMENT" };
  playerLabel: string;
}

export interface TracePolicyV1 {
  leavesTrace: boolean;
  playerSafeHint: string | null;
  traceTemplateIds?: string[];
}

export interface ReactionPolicyV1 {
  mode: "NONE" | "IF_OBSERVED" | "ALWAYS";
  playerSafeHint: string | null;
  eligibleAudiencePolicyId?: string;
}

export interface ActionTargetV1 {
  type:
    | "ROLE"
    | "ACTOR"
    | "PERSON"
    | "DOCUMENT"
    | "EVIDENCE"
    | "RESOURCE"
    | "LOCATION"
    | "INSTITUTION"
    | "PUBLIC_FRAME"
    | "TRACE"
    | "WORLD_ENTITY";
  id: string;
  label: string;
  aliases?: string[];
}

export interface ActionBoundaryStatementV1 {
  statement: string;
  sourceRuleId?: string;
}

export type ManeuverPrimaryEffectV1 =
  | {
      kind: "OPEN_INTERACTION";
      targetActorId: string;
      requestKind: "ASK" | "TEST" | "PERSUADE" | "EXCHANGE" | "PRESSURE" | "PROPOSE_TERM";
    }
  | {
      kind: "START_INVESTIGATION";
      traceId: string;
      routeId: string;
    }
  | {
      kind: "PLAY_RULE_CARD";
      cardAssetKey: string;
      playMode: "ACTIVE" | "SET";
      triggerPatternId?: string;
    }
  | {
      kind: "APPLY_CAPABILITY";
      capabilityId: string;
      effectKey: string;
    }
  | {
      kind: "DISCLOSE_EVIDENCE";
      evidenceAssetIds: string[];
      audience: "TARGET" | "ACTOR_SET" | "PUBLIC";
    }
  | {
      kind: "REACTION_RESPONSE";
      reactionId: string;
      optionId?: string;
      hold: boolean;
    };

export interface CompiledManeuverActionV1 {
  schemaVersion: "compiled_maneuver_action_v1";
  actionKind: ManeuverKindV1;
  slot: ManeuverSlotV1;

  runId: string;
  actorTurnId: string;
  actorRoleId: string;
  actorId: string;

  objective: string;
  target: ActionTargetV1;
  method: string;
  primaryEffect: ManeuverPrimaryEffectV1;

  guaranteedStart: ActionBoundaryStatementV1[];
  contestedOutcome: ActionBoundaryStatementV1[];
  notGuaranteed: ActionBoundaryStatementV1[];

  costs: ManeuverCostV1[];
  timing: ManeuverTimingV1;
  visibility: VisibilityRuleV1;
  tracePolicy: TracePolicyV1;
  reactionPolicy: ReactionPolicyV1;

  attachedAssetKeys: string[];
  sourceEvidenceIds: string[];
  settlementBindingId: string;

  turnRevision: number;
  stateRevision: number;
  maneuverWindowVersion: number;
  controlEpoch: number;
  contextHash: string;
}

export interface ConversationDraftV1 {
  schemaVersion: "maneuver_draft_v1";
  kind: "CONVERSATION";
  targetActorId: string;
  message: string;
  purpose?: "ASK" | "TEST" | "PERSUADE" | "EXCHANGE" | "PRESSURE" | "PROPOSE_TERM";
  visibility: "LIMITED" | "PUBLIC";
  attachmentAssetKeys: string[];
  formalAgreementRequested: boolean;
}

export interface InvestigationDraftV1 {
  schemaVersion: "maneuver_draft_v1";
  kind: "INVESTIGATION";
  traceId: string;
  routeId: string;
  executorAssetKey?: string;
  attachmentAssetKeys: string[];
}

export interface CardLayoutDraftV1 {
  schemaVersion: "maneuver_draft_v1";
  kind: "CARD_LAYOUT";
  cardAssetKey: string;
  playMode: "ACTIVE" | "SET";
  targetId: string;
  triggerPatternId?: string;
}

export interface CustomPlanDraftV1 {
  schemaVersion: "maneuver_draft_v1";
  kind: "CUSTOM_PLAN";
  rawText: string;
  attachmentAssetKeys: string[];
  visibilityPreference?: "QUIET" | "NORMAL" | "PUBLIC";
}

export interface ReactionDraftV1 {
  schemaVersion: "maneuver_draft_v1";
  kind: "REACTION";
  reactionId: string;
  optionId?: string;
  rawText?: string;
  cardAssetKey?: string;
  hold?: boolean;
}

export type ManeuverDraftV1 =
  | ConversationDraftV1
  | InvestigationDraftV1
  | CardLayoutDraftV1
  | CustomPlanDraftV1
  | ReactionDraftV1;

export interface ActionPreviewPresentationV1 {
  eyebrow: string;
  title: string;
  narrative: string;
  sections: Array<{
    kind: PreviewSectionKindV1;
    label: string;
    lines: string[];
  }>;
  chips: Array<{
    kind: PreviewChipKindV1;
    label: string;
  }>;
  confirmLabel: string;
  editLabel: string;
}

export interface ActionPreviewSplitOptionV1 {
  optionId: string;
  label: string;
  draft: ManeuverDraftV1;
}

export interface ActionPreviewResponseV1 {
  schemaVersion: "action_preview_response_v1";
  decision: ActionPreviewDecisionV1;
  previewId: string | null;
  expiresAt: string | null;
  rerouteKind?: ManeuverKindV1;
  splitOptions?: ActionPreviewSplitOptionV1[];
  reason?: string;
  suggestedDraft?: ManeuverDraftV1;
  compiledAction?: CompiledManeuverActionV1;
  presentation?: ActionPreviewPresentationV1;
  safeDebug?: {
    matchedRuleIds: string[];
    riskFlags: string[];
  };
}

export interface ContactDefinitionV1 {
  actorId: string;
  roleId?: string;
  displayName: string;
  publicIdentity: string;
  currentAccess: string;
  whyRelevant: string;
  canReceiveEvidence: boolean;
  visibilityOptions: Array<"LIMITED" | "PUBLIC">;
  accessibleByRoleIds: string[];
}

export interface WorldTraceV1 {
  traceId: string;
  runId: string;
  title: string;
  narrativeHook: string;
  traceType: TraceTypeV1;
  subjectEntityIds: string[];
  sourceEventIds: string[];
  supportedClaimKeys: string[];
  sourceGroupKey: string;
  accessRoleIds: string[];
  routeIds: string[];
  visibility: VisibilityRuleV1;
  status: TraceStatusV1;
  createdAtRevision: number;
  expiresAtStage?: number;
}

export interface InvestigationRevealRuleV1 {
  claimKey: string;
  statement: string;
  strength: 1 | 2 | 3;
  when: "ALWAYS" | string;
}

export interface InvestigationRouteV1 {
  routeId: string;
  traceId: string;
  label: string;
  narrativeMethod: string;
  requiredCapabilityIds: string[];
  requiredResourceCosts: Array<{ resourceId: string; amount: number; label: string }>;
  optionalCardTags: string[];
  revealRules: InvestigationRevealRuleV1[];
  evidenceCeiling: EvidenceLevelV1;
  mayLearn: string[];
  cannotProve: string[];
  settlementMoment: InvestigationSettlementMomentV1;
  observableTrail: null | {
    summary: string;
    audiencePolicyId: string;
  };
  counterTags: string[];
  expiresWithTrace: boolean;
}

export interface EvidenceSupportV1 {
  claimKey: string;
  statement: string;
  strength: 1 | 2 | 3;
}

export interface EvidenceCardStateV1 {
  schemaVersion: "evidence_card_v1";
  evidenceId: string;
  title: string;
  level: EvidenceLevelV1;
  authenticity: EvidenceAuthenticityV1;
  supports: EvidenceSupportV1[];
  cannotProve: string[];
  source: {
    traceId: string;
    routeId: string;
    sourceGroupKey: string;
    sourceEventIds: string[];
  };
  ownerRoleId: string;
  visibility: "PRIVATE" | "SHARED" | "PUBLIC";
  sharedWithRoleIds: string[];
  acquiredAtRevision: number;
  derivedFromEvidenceIds: string[];
}

export interface EvidenceClaimRuleV1 {
  claimKey: string;
  label: string;
  requiredIndependentSourceGroups: number;
  minimumTotalStrength: number;
  resultingLevel: EvidenceLevelV1;
  resultingStatement: string;
  forbiddenSameSourceStacking: boolean;
}

export interface InvestigationObstructionV1 {
  tag: string;
  effect: "BLOCK" | "OBSCURE" | "DISPUTE" | "REVEAL_ALTERNATE";
  alternateRevealRules?: InvestigationRevealRuleV1[];
  processResult: string;
}

export interface InvestigationResolutionInputV1 {
  trace: WorldTraceV1;
  route: InvestigationRouteV1;
  actorRoleId: string;
  actorCapabilityIds: string[];
  availableResources: Record<string, number>;
  obstruction?: InvestigationObstructionV1 | null;
  evidenceId: string;
  evidenceTitle: string;
  acquiredAtRevision: number;
}

export interface InvestigationResolutionV1 {
  status: "EVIDENCE_ACQUIRED" | "ROUTE_EXHAUSTED" | "BLOCKED" | "PROCESS_ONLY";
  processNarrative: string;
  evidence: EvidenceCardStateV1 | null;
  discoveredTrace?: WorldTraceV1;
  observableTrail: InvestigationRouteV1["observableTrail"];
}

export interface RuleCardDefinitionV1 {
  cardKey: string;
  label: string;
  tags: string[];
  allowedRoleKeys: string[];
  timing: RuleCardTimingV1[];
  legalTargetTypes: ActionTargetV1["type"][];
  capabilityId: string;
  triggerPatternIds: string[];
  guaranteedEffects: string[];
  duration: { kind: "INSTANT" | "UNTIL_TURN_END" | "UNTIL_STAGE_END" | "USES"; value?: number };
  visibility: {
    beforeTrigger: VisibilityRuleV1;
    afterTrigger: VisibilityRuleV1;
  };
  consumption: RuleCardConsumptionV1;
  cooldownStages?: number;
  counterTags: string[];
  playerFacingLimitations: string[];
}

export interface RuleCardHoldingV1 {
  cardAssetKey: string;
  cardKey: string;
  ownerRoleId: string;
  status: "AVAILABLE" | "LOCKED" | "COOLDOWN" | "CONSUMED";
  cooldownUntilStage?: number;
}

export interface ManeuverActionBindingV1 {
  bindingId: string;
  effectKey: string;
  capabilityId: string;
  /** Terms used only to map free expression to this finite binding. */
  matchTerms?: string[];
  labels: {
    actionTitle: string;
    method: string;
    guaranteedStart: string[];
    contestedOutcome: string[];
    notGuaranteed: string[];
    confirmLabel: string;
  };
  legalTargetTypes: ActionTargetV1["type"][];
  defaultVisibility: VisibilityRuleV1;
  tracePolicy: TracePolicyV1;
  reactionPolicy: ReactionPolicyV1;
  timing: ManeuverTimingV1;
  costs: ManeuverCostV1[];
}

export interface CustomPlanCandidateV1 {
  candidateId: string;
  label: string;
  objective: string;
  target: ActionTargetV1;
  effectKey: string;
  capabilityId: string;
  matchedBindingId: string;
  rawText: string;
}

export interface ManeuverCompileContextV1 {
  runId: string;
  actorTurnId: string;
  actorRoleId: string;
  actorRoleKey: string;
  actorId: string;
  actorLabel: string;
  slot: ManeuverSlotV1;
  turnRevision: number;
  stateRevision: number;
  maneuverWindowVersion: number;
  controlEpoch: number;
  contextHash: string;

  contacts: ContactDefinitionV1[];
  traces: WorldTraceV1[];
  investigationRoutes: InvestigationRouteV1[];
  ruleCards: RuleCardDefinitionV1[];
  ruleCardHoldings: RuleCardHoldingV1[];
  actionBindings: ManeuverActionBindingV1[];
  targets: ActionTargetV1[];
  evidence: EvidenceCardStateV1[];
  capabilityIds: string[];
  resourceAmounts: Record<string, number>;
  currentStage: number;
  nowIso: string;
  previewTtlSeconds: number;
}

export interface CreateActionPreviewCommandV1 {
  idempotencyKey: string;
  turnRevision: number;
  expectedStateRevision: number;
  expectedManeuverWindowVersion: number;
  controlEpoch: number;
  draft: ManeuverDraftV1;
}
