import { validateSettlementSnapshot } from "./settlement";
import type {
  CausalEvent,
  DestinyNetProjection,
  DurablePredicate,
  DurableTurnEnvelope,
  EchoCategory,
  PlayerTurnProjection,
  ProjectedEffect,
  ProjectedFact,
  ProjectedRelation,
  SettlementSnapshot,
  WorldRuntimeContract,
} from "./types";
import {
  conditionSatisfied,
  validateDurableTurnEnvelope,
  validateWorldRuntimeContract,
} from "./validation";

type VisibilityClass = "PUBLIC" | "PRIVATE" | "INFERABLE";

/**
 * Compile the only player-safe view consumed by Narrator, Options and UI.
 * The compiler never reads prose and never returns an event that the typed
 * visibility contract does not expose to this actor.
 */
export function compilePlayerTurnProjection(input: {
  contract: WorldRuntimeContract;
  snapshot: SettlementSnapshot;
  envelope: DurableTurnEnvelope;
  actorId: string;
}): PlayerTurnProjection {
  const contract = validateWorldRuntimeContract(input.contract);
  const snapshot = validateSettlementSnapshot(input.snapshot, contract);
  const role = contract.roles.find((candidate) => candidate.actorId === input.actorId);
  if (!role) throw new Error(`PROJECTION_ACTOR_NOT_PLAYABLE:${input.actorId}`);
  const envelope = validateDurableTurnEnvelope(
    input.envelope,
    contract,
    snapshot.events,
  );
  if (envelope.runId !== snapshot.runId) throw new Error("PROJECTION_RUN_MISMATCH");

  const applied = snapshot.events.filter((event) => event.status === "APPLIED");
  const byId = new Map(applied.map((event) => [event.eventId, event]));
  const publicFacts: ProjectedFact[] = [];
  const privateFacts: ProjectedFact[] = [];
  const inferableSignals: PlayerTurnProjection["inferableSignals"] = [];

  for (const event of applied) {
    const visibility = eventVisibility(event, input.actorId, byId);
    if (!visibility) continue;
    if (visibility === "INFERABLE") {
      inferableSignals.push({
        eventId: event.eventId,
        summary: summaryFor(event, input.actorId),
        evidenceEventIds: event.visibility.scope === "INFERABLE"
          ? [...event.visibility.evidenceEventIds]
          : [],
      });
      continue;
    }
    const fact = factFor(event, input.actorId);
    if (visibility === "PUBLIC") publicFacts.push(fact);
    else privateFacts.push(fact);
  }

  const personalEchoes = projectEchoes(
    "PERSONAL",
    envelope.personalEffects,
    envelope,
    input.actorId,
    byId,
  );
  const crossPlayerEchoes = projectEchoes(
    "CROSS_PLAYER",
    envelope.crossPlayerEffects,
    envelope,
    input.actorId,
    byId,
  );
  const worldEchoes = projectEchoes(
    "WORLD",
    envelope.worldEffects,
    envelope,
    input.actorId,
    byId,
  );
  const relationshipChanges = [...publicFacts, ...privateFacts]
    .flatMap((fact) => relationFor(fact.eventId, fact.predicate));

  const opening = contract.openingProjections.find((item) => item.actorId === input.actorId);
  if (!opening) throw new Error(`PROJECTION_OPENING_MISSING:${input.actorId}`);
  const visibleEntityIds = new Set(opening.visibleEntityIds);
  for (const fact of [...publicFacts, ...privateFacts]) {
    for (const entityId of predicateEntityIds(fact.predicate)) visibleEntityIds.add(entityId);
  }
  const activeDestinyHooks = contract.destinyHooks.flatMap((hook) => {
    if (!hook.actorIds.includes(input.actorId)) return [];
    if (!conditionSatisfied(hook.activationCondition, snapshot.state.predicates)) return [];
    const status = hook.resolutionCondition
      && conditionSatisfied(hook.resolutionCondition, snapshot.state.predicates)
      ? "RESOLVED" as const
      : hook.convergenceCondition
        && conditionSatisfied(hook.convergenceCondition, snapshot.state.predicates)
        ? "CONVERGING" as const
        : "ACTIVE" as const;
    return [{
      hookId: hook.id,
      status,
      visibleActorIds: hook.actorIds.filter((actorId) => visibleEntityIds.has(actorId)),
      visibleEntityIds: hook.entityIds.filter((entityId) => visibleEntityIds.has(entityId)),
      // Secret IDs intentionally never leave this compiler.
    }];
  });

  return {
    runId: envelope.runId,
    worldTurnId: envelope.worldTurnId,
    actorId: input.actorId,
    stateRevision: snapshot.state.revision,
    privateFacts,
    publicFacts,
    inferableSignals,
    personalEchoes,
    crossPlayerEchoes,
    worldEchoes,
    relationshipChanges,
    activeDestinyHooks,
    destinyQuestion: role.destinyQuestion,
  };
}

export function compileDestinyNetProjection(
  projection: PlayerTurnProjection,
  contractInput: WorldRuntimeContract,
): DestinyNetProjection {
  const contract = validateWorldRuntimeContract(contractInput);
  const entityById = new Map(contract.entities.map((entity) => [entity.id, entity]));
  const nodes = new Map<string, DestinyNetProjection["nodes"][number]>();
  const addEntity = (entityId: string, visibility: "KNOWN" | "PUBLIC") => {
    const entity = entityById.get(entityId);
    if (!entity || entity.kind === "SECRET") return;
    nodes.set(entityId, {
      id: entityId,
      label: entity.displayName,
      type: entityId === projection.actorId
        ? "SELF"
        : entity.kind === "ACTOR"
          ? "ACTOR"
          : entity.kind === "LOCATION"
            ? "LOCATION"
            : ["DOCUMENT", "EVIDENCE"].includes(entity.kind)
              ? "CLUE"
              : "UNKNOWN",
      visibility,
    });
  };
  addEntity(projection.actorId, "KNOWN");
  for (const fact of projection.privateFacts) {
    predicateEntityIds(fact.predicate).forEach((id) => addEntity(id, "KNOWN"));
  }
  for (const fact of projection.publicFacts) {
    predicateEntityIds(fact.predicate).forEach((id) => addEntity(id, "PUBLIC"));
  }
  for (const signal of projection.inferableSignals) {
    nodes.set(signal.eventId, {
      id: signal.eventId,
      label: signal.summary,
      type: "EVENT",
      visibility: "SUSPECTED",
    });
  }
  const edges: DestinyNetProjection["edges"] = projection.relationshipChanges
    .filter((relation) => nodes.has(relation.fromActorId) && nodes.has(relation.toActorId))
    .map((relation) => ({
      from: relation.fromActorId,
      to: relation.toActorId,
      label: `${relation.kind}:${relation.delta}`,
      visibility: projection.publicFacts.some((fact) => fact.eventId === relation.eventId)
        ? "PUBLIC" as const
        : "KNOWN" as const,
    }));
  return { actorId: projection.actorId, nodes: [...nodes.values()], edges };
}

function eventVisibility(
  event: CausalEvent,
  actorId: string,
  byId: ReadonlyMap<string, CausalEvent>,
): VisibilityClass | null {
  if (event.visibility.scope === "PUBLIC") return "PUBLIC";
  if (event.visibility.scope === "INFERABLE") {
    const evidenceIsPublic = event.visibility.evidenceEventIds.every((eventId) => {
      const evidence = byId.get(eventId);
      return evidence?.status === "APPLIED" && evidence.visibility.scope === "PUBLIC";
    });
    return evidenceIsPublic && event.affectedActorIds.includes(actorId)
      ? "INFERABLE"
      : null;
  }
  return event.affectedActorIds.includes(actorId) ? "PRIVATE" : null;
}

function factFor(event: CausalEvent, actorId: string): ProjectedFact {
  return {
    eventId: event.eventId,
    predicate: structuredClone(event.predicate),
    summary: summaryFor(event, actorId),
    ...(event.revealOriginActor ? { originActorId: event.originActorId } : {}),
  };
}

function projectEchoes(
  category: EchoCategory,
  refs: DurableTurnEnvelope["personalEffects"],
  envelope: DurableTurnEnvelope,
  actorId: string,
  byId: ReadonlyMap<string, CausalEvent>,
): ProjectedEffect[] {
  if (category === "PERSONAL" && actorId !== envelope.originActorId) return [];
  return refs.flatMap((ref) => {
    const event = byId.get(ref.eventId);
    if (!event || event.status !== ref.expectedStatus) return [];
    const visibility = eventVisibility(event, actorId, byId);
    if (!visibility) return [];
    return [{
      eventId: event.eventId,
      category,
      summary: summaryFor(event, actorId),
      ...(visibility === "INFERABLE" ? {} : { predicate: structuredClone(event.predicate) }),
      ...(event.revealOriginActor ? { originActorId: event.originActorId } : {}),
    }];
  });
}

function summaryFor(event: CausalEvent, actorId: string) {
  const summary = event.affectedPlayerSummaries[actorId] || event.publicSummary;
  if (!summary) throw new Error(`PROJECTION_SUMMARY_MISSING:${event.eventId}:${actorId}`);
  return summary;
}

function relationFor(eventId: string, predicate: DurablePredicate): ProjectedRelation[] {
  if (predicate.type === "RELATION.TRUST_CHANGED") {
    return [{
      eventId,
      kind: "TRUST" as const,
      fromActorId: predicate.fromActorId,
      toActorId: predicate.toActorId,
      delta: predicate.delta,
    }];
  }
  if (predicate.type === "RELATION.SUSPICION_CHANGED") {
    return [{
      eventId,
      kind: "SUSPICION" as const,
      fromActorId: predicate.fromActorId,
      toActorId: predicate.toActorId,
      delta: predicate.delta,
    }];
  }
  return [];
}

function predicateEntityIds(predicate: DurablePredicate): string[] {
  switch (predicate.type) {
    case "ENTITY.INTRODUCED": return [predicate.entityId];
    case "ENTITY.LOCATED_AT": return [predicate.entityId, predicate.locationId];
    case "ENTITY.HELD_BY": return [predicate.entityId, predicate.actorId];
    case "DOCUMENT.CREATED": return [predicate.documentId];
    case "DOCUMENT.AUTHENTICATED": return [predicate.documentId, predicate.actorId];
    case "DOCUMENT.TRANSFERRED": return [predicate.documentId, predicate.fromActorId, predicate.toActorId];
    case "DOCUMENT.PUBLISHED": return [predicate.documentId, predicate.audienceId];
    case "EVIDENCE.DESTROYED": return [predicate.evidenceId];
    case "KNOWLEDGE.REVEALED_TO": return [predicate.actorId];
    case "ACTOR.COMMITTED": return [predicate.actorId];
    case "ACTOR.ORDERED": return [predicate.actorId];
    case "RELATION.TRUST_CHANGED":
    case "RELATION.SUSPICION_CHANGED": return [predicate.fromActorId, predicate.toActorId];
    case "RESOURCE.CHANGED": return [predicate.actorId, predicate.resourceId];
    case "WORLD.PRESSURE_CHANGED": return [];
  }
}
