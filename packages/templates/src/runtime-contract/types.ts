export const durableEntityKinds = ["ACTOR", "LOCATION", "DOCUMENT", "EVIDENCE", "SECRET", "INSTITUTION", "RESOURCE", "EVENT", "RELATION"] as const;
export type DurableEntityKind = typeof durableEntityKinds[number];

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

export type DurableEntity = { id: string; kind: DurableEntityKind; displayName: string; aliases: string[]; durable: true; initialStatus: Record<string, boolean | number | string | null>; visibilityPolicyId?: string };
export type RoleDefinition = { id: string; actorId: string; goalIds: string[]; secretIds: string[]; destinyQuestion: string; openingProjectionId: string; policyId: string };
export type ActorPolicy = { id: string; actorId: string; capabilityIds: string[] };
export type InstitutionCapability = { id: string; institutionId: string; allowedActorIds: string[]; effectTemplates: DurablePredicate[] };
export type KnowledgeGrant = { id: string; secretId: string; actorIds: string[]; visibility: VisibilityRule };
export type CausalCondition = { all: DurablePredicate[] } | { any: DurablePredicate[] } | { not: DurablePredicate };
export type DestinyHook = { id: string; actorIds: string[]; entityIds: string[]; secretIds: string[]; causalRuleIds: string[]; activationCondition: CausalCondition; convergenceCondition?: CausalCondition; resolutionCondition?: CausalCondition };
export type CausalRule = { id: string; capabilityId: string; condition?: CausalCondition; effects: DurablePredicate[]; visibility: VisibilityRule };
export type DelayedCausalRule = CausalRule & { delayRevisions: number };
export type DurableState = { worldId: string; revision: number; predicates: DurablePredicate[]; pendingRuleIds: string[] };
export type CausalEvent = { eventId: string; worldId: string; sourceRuleId: string; originActorId: string; affectedActorIds: string[]; predicate: DurablePredicate; status: "SCHEDULED" | "APPLIED" | "CANCELLED"; createdAtRevision: number; applyAtRevision?: number; visibility: VisibilityRule; idempotencyKey: string };
export type DurableTurnEnvelope = { id: string; worldId: string; beforeStateRevision: number; sourceRuleId: string; originActorId: string; allowedPredicates: DurablePredicate[]; requiredVisiblePredicates: DurablePredicate[]; forbiddenPredicates: DurablePredicate[]; events: CausalEvent[]; projectionActorId: string };
export type StyleProfile = { locale: string; pov: "FIRST_PERSON" | "SECOND_PERSON" | "THIRD_PERSON_LIMITED"; tense: "PAST" | "PRESENT"; tags: string[] };
export type PlayerOpeningProjection = { id: string; actorId: string; visibleEntityIds: string[]; knownSecretIds: string[]; visiblePredicates: DurablePredicate[] };

export type WorldRuntimeContract = {
  worldId: string;
  contractVersion: string;
  aliases: string[];
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
};

export type WorldRegistryEntry = { worldKey: string; aliases: string[]; worldId: string; contractVersion: string; contractSha256: string; contractPath: string };
export type WorldRegistryIndex = { registryVersion: 1; worlds: WorldRegistryEntry[] };
