export const durableEntityKinds = [
  "ACTOR", "LOCATION", "DOCUMENT", "EVIDENCE", "SECRET", "INSTITUTION",
  "RESOURCE", "EVENT", "RELATION",
] as const;

export type DurableEntityKind = (typeof durableEntityKinds)[number];
export type StableScalar = boolean | number | string | null;

export type VisibilityRule =
  | { scope: "PUBLIC" }
  | { scope: "PRIVATE"; actorId: string }
  | { scope: "ACTOR_SET"; actorIds: string[] }
  | { scope: "RELATION_BASED"; policyId: string }
  | { scope: "INFERABLE"; evidenceEventIds: string[] };

export type DurablePredicate =
  | { type: "ENTITY.INTRODUCED"; entityId: string }
  | { type: "ENTITY.LOCATED_AT"; entityId: string; locationId: string }
  | { type: "ENTITY.HELD_BY"; entityId: string; actorId: string }
  | { type: "DOCUMENT.CREATED"; documentId: string }
  | { type: "DOCUMENT.AUTHENTICATED"; documentId: string; actorId: string }
  | { type: "DOCUMENT.TRANSFERRED"; documentId: string; fromActorId: string; toActorId: string }
  | { type: "DOCUMENT.PUBLISHED"; documentId: string; audienceId: string }
  | { type: "EVIDENCE.DESTROYED"; evidenceId: string }
  | { type: "KNOWLEDGE.REVEALED_TO"; secretId: string; actorId: string }
  | { type: "ACTOR.COMMITTED"; actorId: string; commitmentId: string }
  | { type: "ACTOR.ORDERED"; actorId: string; capabilityId: string }
  | { type: "RELATION.TRUST_CHANGED"; fromActorId: string; toActorId: string; delta: number }
  | { type: "RELATION.SUSPICION_CHANGED"; fromActorId: string; toActorId: string; delta: number }
  | { type: "WORLD.PRESSURE_CHANGED"; pressureId: string; delta: number }
  | { type: "RESOURCE.CHANGED"; actorId: string; resourceId: string; delta: number };

export type PredicateConstraint = string | number | boolean;
export interface DurablePredicatePattern {
  type: DurablePredicate["type"];
  constraints: Record<string, PredicateConstraint>;
}

export interface RequiredVisiblePredicate {
  pattern: DurablePredicatePattern;
  visibility: VisibilityRule;
}

export interface DurableEntity {
  id: string;
  kind: DurableEntityKind;
  displayName: string;
  aliases: string[];
  durable: true;
  initialStatus: Record<string, StableScalar>;
  visibilityPolicyId?: string;
}

export interface RoleDefinition {
  id: string;
  actorId: string;
  goalIds: string[];
  secretIds: string[];
  destinyQuestion: string;
  openingProjectionId: string;
  policyId: string;
}

export interface ActorPolicy { id: string; actorId: string; capabilityIds: string[] }
export interface InstitutionCapability {
  id: string;
  institutionId: string;
  allowedActorIds: string[];
  effectPatterns: DurablePredicatePattern[];
}
export interface KnowledgeGrant { id: string; secretId: string; actorIds: string[]; visibility: VisibilityRule }
export type CausalCondition =
  | { all: DurablePredicate[] }
  | { any: DurablePredicate[] }
  | { not: DurablePredicate };
export interface DestinyHook {
  id: string;
  actorIds: string[];
  entityIds: string[];
  secretIds: string[];
  causalRuleIds: string[];
  activationCondition: CausalCondition;
  convergenceCondition?: CausalCondition;
  resolutionCondition?: CausalCondition;
}
export interface CausalRule {
  id: string;
  capabilityId: string;
  condition?: CausalCondition;
  effects: DurablePredicate[];
  visibility: VisibilityRule;
}
export type DelayedCausalRule = CausalRule & { delayRevisions: number };
export interface DurableState { worldId: string; revision: number; predicates: DurablePredicate[]; pendingRuleIds: string[] }

export interface CausalEvent {
  eventId: string;
  runId: string;
  worldId: string;
  worldTurnId: string;
  sourceActionId: string;
  sourceRuleId: string;
  originActorId: string;
  affectedActorIds: string[];
  predicate: DurablePredicate;
  status: "SCHEDULED" | "APPLIED" | "CANCELLED";
  createdAtRevision: number;
  applyAtRevision?: number;
  triggerCondition?: CausalCondition;
  visibility: VisibilityRule;
  publicSummary?: string;
  affectedPlayerSummaries: Record<string, string>;
  revealOriginActor: boolean;
  containsProtectedSecret: boolean;
  idempotencyKey: string;
}

export interface CausalEventRef { eventId: string; expectedStatus: CausalEvent["status"] }
export interface NarrativeSeed { playerOutcome: string; npcOrWorldPressure: string; stopCondition: string }
export interface DurableTurnEnvelope {
  turnEnvelopeId: string;
  runId: string;
  worldTurnId: string;
  beforeStateRevision: number;
  sourceActionId: string;
  originActorId: string;
  allowedPredicates: DurablePredicatePattern[];
  requiredVisiblePredicates: RequiredVisiblePredicate[];
  forbiddenPredicatePatterns: DurablePredicatePattern[];
  unresolvedFacts: string[];
  activeSceneEntityIds: string[];
  personalEffects: CausalEventRef[];
  crossPlayerEffects: CausalEventRef[];
  worldEffects: CausalEventRef[];
  delayedEffects: CausalEventRef[];
  projectionActorId: string;
  narrativeSeed: NarrativeSeed;
}

export interface StyleProfile {
  locale: string;
  pov: "FIRST_PERSON" | "SECOND_PERSON" | "THIRD_PERSON_LIMITED";
  tense: "PAST" | "PRESENT";
  tags: string[];
}
export interface PlayerOpeningProjection {
  id: string;
  actorId: string;
  visibleEntityIds: string[];
  knownSecretIds: string[];
  visiblePredicates: DurablePredicate[];
}
export interface WorldRuntimeContract {
  worldId: string;
  contractVersion: string;
  aliasesByLocale: Record<string, Record<string, string[]>>;
  title: string;
  entities: DurableEntity[];
  roles: RoleDefinition[];
  actorPolicies: ActorPolicy[];
  capabilities: InstitutionCapability[];
  knowledgeAcl: KnowledgeGrant[];
  destinyHooks: DestinyHook[];
  causalRules: CausalRule[];
  delayedRules: DelayedCausalRule[];
  styleProfile: StyleProfile;
  openingState: DurableState;
  openingProjections: PlayerOpeningProjection[];
}
export interface WorldRegistryEntry {
  worldKey: string;
  aliases: string[];
  worldId: string;
  contractVersion: string;
  contractSha256: string;
  contractPath: string;
}
export interface WorldRegistryIndex { registryVersion: 1; worlds: WorldRegistryEntry[] }
