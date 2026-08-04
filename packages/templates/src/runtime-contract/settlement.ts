import type {
  CausalEvent, DurablePredicate, DurableState, DurableTurnEnvelope, EchoCategory, NarrativeDisposition,
  EchoAudience, PlayerActionIntent, ProtectedNarrativeBlock, SettlementBinding, SettlementOutcome, SettlementPackage,
  SettlementResult, SettlementSnapshot, VisibilityRule, WorldRuntimeContract,
} from "./types";
import { playerIntentTypes } from "./types";
import { actorCanUseCapability, ReferenceValidator } from "./reference";
import { conditionSatisfied, mergeDurablePredicates, predicateKey, validateCausalEvent, validateDurableState, validateDurableTurnEnvelope, validateWorldRuntimeContract } from "./validation";
import { predicateFields } from "./pattern";

const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/;
type Raw = Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const exact = (value: Raw, fields: string[], code: string): void => { const unknown = Object.keys(value).find((key) => !fields.includes(key)); const missing = fields.find((key) => !(key in value)); if (unknown) throw new Error(`${code}_UNKNOWN_FIELD:${unknown}`); if (missing) throw new Error(`${code}_MISSING_FIELD:${missing}`); };
const object = (value: unknown, code: string): Raw => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${code}:OBJECT`); return value as Raw; };
const id = (value: unknown, code: string): string => { if (typeof value !== "string" || !ID.test(value)) throw new Error(`${code}:ID`); return value; };
const text = (value: unknown, code: string): string => { if (typeof value !== "string" || !value.trim()) throw new Error(`${code}:TEXT`); return value; };
const ids = (value: unknown, code: string, nonempty = false): string[] => { if (!Array.isArray(value) || (nonempty && value.length === 0)) throw new Error(`${code}:ARRAY`); const out = value.map((entry) => id(entry, code)); if (new Set(out).size !== out.length) throw new Error(`${code}:DUPLICATE`); return out; };

function predicateActorIds(predicate: DurablePredicate): string[] {
  switch (predicate.type) {
    case "ENTITY.HELD_BY":
    case "DOCUMENT.AUTHENTICATED":
    case "KNOWLEDGE.REVEALED_TO":
    case "ACTOR.COMMITTED":
    case "ACTOR.ORDERED":
    case "RESOURCE.CHANGED":
      return [predicate.actorId];
    case "DOCUMENT.TRANSFERRED":
    case "RELATION.TRUST_CHANGED":
    case "RELATION.SUSPICION_CHANGED":
      return [predicate.fromActorId, predicate.toActorId];
    default:
      return [];
  }
}

function visibilityActors(contract: WorldRuntimeContract, visibility: VisibilityRule, predicate: DurablePredicate): string[] {
  const actors = new Set(contract.entities.filter((entity) => entity.kind === "ACTOR").map((entity) => entity.id));
  if (visibility.scope === "PUBLIC") return [...actors].sort();
  if (visibility.scope === "PRIVATE") return actors.has(visibility.actorId) ? [visibility.actorId] : [];
  if (visibility.scope === "ACTOR_SET") return visibility.actorIds.filter((actor) => actors.has(actor)).sort();
  if (visibility.scope === "RELATION_BASED") {
    const policy = contract.actorPolicies.find((candidate) => candidate.id === visibility.policyId);
    if (!policy) return [];
    return [...new Set([policy.actorId, ...predicateActorIds(predicate)])]
      .filter((actor) => actors.has(actor)).sort();
  }
  throw new Error("AUDIENCE_VISIBILITY_INFERABLE_UNSUPPORTED");
}

function resolveAudience(contract: WorldRuntimeContract, audience: EchoAudience, originActorId: string, visibility: VisibilityRule, predicate: DurablePredicate): string[] {
  const players = contract.roles.map((role) => role.actorId).sort();
  const visible = new Set(visibilityActors(contract, visibility, predicate));
  const selected = audience.kind === "ORIGIN_ACTOR" ? [originActorId]
    : audience.kind === "OTHER_PLAYERS" ? players.filter((actor) => actor !== originActorId)
    : audience.kind === "ALL_PLAYERS" ? players
    : audience.kind === "EXPLICIT_ACTORS" ? audience.actorIds
    : [...visible];
  return [...new Set(selected)].filter((actor) => visible.has(actor)).sort();
}

export function validatePlayerActionIntent(input: unknown, contractInput: WorldRuntimeContract): PlayerActionIntent {
  const contract = validateWorldRuntimeContract(contractInput); const value = object(input, "INTENT_INVALID");
  const optional = Object.prototype.hasOwnProperty.call(value, "proposedCapabilityId") ? ["proposedCapabilityId"] : [];
  exact(value, ["actionId", "runId", "actorId", "rawText", "submittedAt", "expectedStateRevision", "intentType", "referencedEntityIds", ...optional, "explicitCommitment", "explicitOrder", "confidence"], "INTENT_INVALID");
  id(value.actionId, "ACTION_ID_INVALID"); id(value.runId, "RUN_ID_INVALID"); const actorId = id(value.actorId, "ACTOR_ID_INVALID");
  const refs = ids(value.referencedEntityIds, "ENTITY_REFS_INVALID"); const ctx = new ReferenceValidator(contract); ctx.requireActor(actorId); refs.forEach((entry) => ctx.requireEntity(entry));
  if (typeof value.rawText !== "string") throw new Error("RAW_TEXT_INVALID");
  if (typeof value.submittedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.submittedAt) || Number.isNaN(Date.parse(value.submittedAt))) throw new Error("TIMESTAMP_INVALID");
  if (!Number.isInteger(value.expectedStateRevision) || Number(value.expectedStateRevision) < 0) throw new Error("REVISION_INVALID");
  if (!playerIntentTypes.includes(value.intentType as never)) throw new Error("INTENT_TYPE_INVALID");
  if (typeof value.explicitCommitment !== "boolean" || typeof value.explicitOrder !== "boolean") throw new Error("INTENT_FLAGS_INVALID");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("CONFIDENCE_INVALID");
  const intentType = value.intentType as PlayerActionIntent["intentType"];
  if (Boolean(value.explicitOrder) !== (intentType === "ORDER") || Boolean(value.explicitCommitment) !== (intentType === "COMMIT")) throw new Error("INTENT_FLAG_CONTRADICTION");
  if (value.proposedCapabilityId !== undefined) { const capability = id(value.proposedCapabilityId, "CAPABILITY_ID_INVALID"); ctx.requireCapability(capability); if (!actorCanUseCapability(contract, actorId, capability)) throw new Error("ACTOR_CAPABILITY_MISMATCH"); }
  if (["USE_CAPABILITY", "COMMIT", "ORDER"].includes(intentType) && (value.proposedCapabilityId === undefined || Number(value.confidence) < 0.5)) throw new Error("CAPABILITY_PROPOSAL_REQUIRED");
  return clone(value) as unknown as PlayerActionIntent;
}

export function validateNarrativeDisposition(input: unknown): NarrativeDisposition {
  const value = object(input, "NARRATIVE_DISPOSITION_INVALID");
  if (value.kind === "USE_ORIGINAL") exact(value, ["kind", "draftId"], "NARRATIVE_DISPOSITION_INVALID");
  else if (value.kind === "USE_FALLBACK") exact(value, ["kind", "fallbackId", "reason"], "NARRATIVE_DISPOSITION_INVALID");
  else throw new Error("NARRATIVE_DISPOSITION_INVALID:KIND");
  for (const [key, item] of Object.entries(value)) if (key !== "kind") text(item, `NARRATIVE_DISPOSITION_INVALID:${key}`);
  return clone(value) as NarrativeDisposition;
}

export function validateProtectedNarrativeBlock(input: unknown, events: readonly CausalEvent[], locale: string): ProtectedNarrativeBlock {
  const value = object(input, "PROTECTED_BLOCK_INVALID"); exact(value, ["blockId", "sourcePredicateIds", "locale", "text", "immutable"], "PROTECTED_BLOCK_INVALID");
  id(value.blockId, "PROTECTED_BLOCK_ID_INVALID"); const sources = ids(value.sourcePredicateIds, "PROTECTED_BLOCK_SOURCES_INVALID", true);
  if (value.locale !== locale || typeof value.locale !== "string" || !LOCALE.test(value.locale)) throw new Error("PROTECTED_BLOCK_LOCALE_INVALID"); text(value.text, "PROTECTED_BLOCK_TEXT_INVALID"); if (value.immutable !== true) throw new Error("PROTECTED_BLOCK_MUTABLE");
  for (const source of sources) { const event = events.find((item) => item.eventId === source); if (!event || event.status !== "APPLIED") throw new Error(`PROTECTED_BLOCK_GHOST_SOURCE:${source}`); }
  return clone(value) as unknown as ProtectedNarrativeBlock;
}

export function validateSettlementPackage(input: SettlementPackage, contractInput: WorldRuntimeContract): SettlementPackage {
  const contract = validateWorldRuntimeContract(contractInput); const value = object(input, "SETTLEMENT_PACKAGE_INVALID"); exact(value, ["bindings", "fallback"], "SETTLEMENT_PACKAGE_INVALID");
  if (!Array.isArray(value.bindings) || value.bindings.length === 0) throw new Error("SETTLEMENT_BINDINGS_EMPTY"); const ctx = new ReferenceValidator(contract); const bindingIds = new Set<string>(); const selectors = new Set<string>();
  for (const raw of value.bindings) { const binding = object(raw, "SETTLEMENT_BINDING_INVALID"); const optional = binding.protectedTemplate === undefined ? [] : ["protectedTemplate"]; exact(binding, ["id", "intentType", "capabilityId", "immediateRuleIds", "delayedRuleIds", "echoRoutes", "renderPolicy", ...optional], "SETTLEMENT_BINDING_INVALID"); const bindingId = id(binding.id, "BINDING_ID_INVALID"); if (bindingIds.has(bindingId)) throw new Error("DUPLICATE_BINDING"); bindingIds.add(bindingId); if (!playerIntentTypes.includes(binding.intentType as never)) throw new Error("INTENT_TYPE_INVALID"); const capabilityId = id(binding.capabilityId, "CAPABILITY_ID_INVALID"); ctx.requireCapability(capabilityId); const selector = `${String(binding.intentType)}:${capabilityId}`; if (selectors.has(selector)) throw new Error(`DUPLICATE_BINDING_SELECTOR:${selector}`); selectors.add(selector); const immediate = ids(binding.immediateRuleIds, "IMMEDIATE_RULES_INVALID", true); const delayed = ids(binding.delayedRuleIds, "DELAYED_RULES_INVALID"); immediate.forEach((ruleId) => { const rule = contract.causalRules.find((item) => item.id === ruleId); if (!rule || rule.capabilityId !== capabilityId) throw new Error(`BINDING_RULE_INVALID:${ruleId}`); }); delayed.forEach((ruleId) => { const rule = contract.delayedRules.find((item) => item.id === ruleId); if (!rule || rule.capabilityId !== capabilityId) throw new Error(`BINDING_DELAYED_RULE_INVALID:${ruleId}`); for (const effect of rule.effects) if (visibilityActors(contract, rule.visibility, effect).length === 0) throw new Error(`DELAYED_ROUTE_EMPTY:${ruleId}`); });
    if (!Array.isArray(binding.echoRoutes)) throw new Error("ECHO_ROUTES_INVALID"); const categoryCounts = new Map<EchoCategory, number>(); const causalSources = new Set<string>(); const causalEffects = new Set<string>(); for (const rawRoute of binding.echoRoutes) { const route = object(rawRoute, "ECHO_ROUTE_INVALID"); exact(route, ["category", "ruleId", "effectIndex", "audience", "summary"], "ECHO_ROUTE_INVALID"); if (!["PERSONAL", "CROSS_PLAYER", "WORLD"].includes(String(route.category))) throw new Error("ECHO_CATEGORY_INVALID"); const category = route.category as EchoCategory; categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1); const rule = contract.causalRules.find((item) => item.id === route.ruleId); if (!rule || !immediate.includes(String(route.ruleId)) || !Number.isInteger(route.effectIndex) || Number(route.effectIndex) < 0 || Number(route.effectIndex) >= rule.effects.length) throw new Error("ECHO_EFFECT_INVALID"); const source = `${rule.id}:${Number(route.effectIndex)}`; if (causalSources.has(source)) throw new Error("ECHO_CAUSAL_SOURCE_DUPLICATE"); causalSources.add(source); const predicate = rule.effects[Number(route.effectIndex)]; const effect = predicateKey(predicate); if (causalEffects.has(effect)) throw new Error("ECHO_EFFECT_DUPLICATE"); causalEffects.add(effect); if (category === "WORLD" && rule.visibility.scope !== "PUBLIC") throw new Error("WORLD_ECHO_NOT_PUBLIC"); const audience = object(route.audience, "ECHO_AUDIENCE_INVALID"); if (!["ORIGIN_ACTOR", "OTHER_PLAYERS", "ALL_PLAYERS", "EXPLICIT_ACTORS", "VISIBILITY_ACTORS"].includes(String(audience.kind))) throw new Error("ECHO_AUDIENCE_KIND_INVALID"); exact(audience, audience.kind === "EXPLICIT_ACTORS" ? ["kind", "actorIds"] : ["kind"], "ECHO_AUDIENCE_INVALID"); if (audience.kind === "EXPLICIT_ACTORS") ids(audience.actorIds, "ECHO_AUDIENCE_ACTORS_INVALID", true).forEach((actor) => ctx.requireActor(actor)); text(route.summary, "ECHO_SUMMARY_INVALID"); const capability = contract.capabilities.find((item) => item.id === capabilityId)!; const eligibleOrigins = capability.allowedActorIds.filter((actor) => actorCanUseCapability(contract, actor, capabilityId)); for (const origin of eligibleOrigins) { const resolved = resolveAudience(contract, audience as unknown as EchoAudience, origin, rule.visibility, predicate); if (category === "PERSONAL" && !resolved.includes(origin)) throw new Error("ECHO_ROUTE_PERSONAL_ORIGIN_MISSING"); if (category === "CROSS_PLAYER" && !resolved.some((actor) => contract.roles.some((role) => role.actorId === actor) && actor !== origin)) throw new Error("ECHO_ROUTE_CROSS_PLAYER_MISSING"); } } const requiredCategories: EchoCategory[] = ["PERSONAL", "CROSS_PLAYER", "WORLD"]; if (requiredCategories.some((category) => !categoryCounts.has(category))) throw new Error("ECHO_ROUTING_INCOMPLETE"); if (requiredCategories.some((category) => categoryCounts.get(category) !== 1)) throw new Error("ECHO_ROUTE_CARDINALITY_INVALID");
    if (!['MODEL_ALLOWED', 'PROTECTED_TEMPLATE'].includes(String(binding.renderPolicy))) throw new Error("RENDER_POLICY_INVALID"); if (binding.renderPolicy === "PROTECTED_TEMPLATE") { const template = text(binding.protectedTemplate, "PROTECTED_TEMPLATE_MISSING"); const parts = template.split("{summary}"); if (parts.length !== 2 || `${parts[0]}${parts[1]}`.includes("{") || `${parts[0]}${parts[1]}`.includes("}")) throw new Error("PROTECTED_TEMPLATE_GRAMMAR_INVALID"); } else if (binding.protectedTemplate !== undefined) throw new Error("PROTECTED_TEMPLATE_UNEXPECTED");
  }
  const fallback = object(value.fallback, "FALLBACK_INVALID"); exact(fallback, ["locale", "playerOutcomePrefix", "reactionPrefix", "worldPressurePrefix", "nextDecisionPoint"], "FALLBACK_INVALID"); if (typeof fallback.locale !== "string" || !LOCALE.test(fallback.locale) || fallback.locale !== contract.styleProfile.locale) throw new Error("FALLBACK_LOCALE_INVALID"); ["playerOutcomePrefix", "reactionPrefix", "worldPressurePrefix", "nextDecisionPoint"].forEach((key) => text(fallback[key], `FALLBACK_ASSET_INVALID:${key}`)); return clone(input);
}

const eventRef = (event: CausalEvent) => ({ eventId: event.eventId, expectedStatus: event.status });
const addPredicates = (state: DurableState, predicates: DurablePredicate[], revision: number): DurableState => ({ ...state, revision, predicates: mergeDurablePredicates(state.predicates, predicates) });

export function validateSettlementSnapshot(input: SettlementSnapshot, contractInput: WorldRuntimeContract): SettlementSnapshot {
  const contract = validateWorldRuntimeContract(contractInput); const value = object(input, "SETTLEMENT_SNAPSHOT_INVALID"); const optionalRun = value.runId === undefined ? [] : ["runId"]; exact(value, [...optionalRun, "state", "events", "pending"], "SETTLEMENT_SNAPSHOT_INVALID"); const runId = value.runId === undefined ? undefined : id(value.runId, "SNAPSHOT_RUN_ID_INVALID");
  const state = validateDurableState(value.state, contract); if (!Array.isArray(value.events) || !Array.isArray(value.pending)) throw new Error("SETTLEMENT_SNAPSHOT_ARRAY_INVALID");
  const rawEvents = value.events as CausalEvent[]; const eventIds = rawEvents.map((event) => id(event.eventId, "SNAPSHOT_EVENT_ID_INVALID")); if (new Set(eventIds).size !== eventIds.length) throw new Error("SNAPSHOT_EVENT_DUPLICATE");
  const events = rawEvents.map((event) => validateCausalEvent(event, contract, rawEvents.filter((other) => other.eventId !== event.eventId))); const eventRunIds = [...new Set(events.map((event) => event.runId))]; if (eventRunIds.length > 1) throw new Error("SNAPSHOT_RUN_ID_MISMATCH"); const resolvedRunId = runId ?? eventRunIds[0]; if (events.some((event) => event.runId !== resolvedRunId)) throw new Error("SNAPSHOT_RUN_ID_MISMATCH"); const byId = new Map(events.map((event) => [event.eventId, event]));
  const pending = (value.pending as SettlementSnapshot["pending"]).map((entry) => { const row = object(entry, "PENDING_INVALID"); const optional = row.appliedAtRevision === undefined ? [] : ["appliedAtRevision"]; exact(row, ["event", ...optional], "PENDING_INVALID"); const event = row.event as CausalEvent; const ledger = byId.get(String(event.eventId)); if (!ledger) throw new Error(`PENDING_EVENT_MISSING:${String(event.eventId)}`); if (stable(event) !== stable(ledger)) throw new Error(`PENDING_EVENT_MISMATCH:${event.eventId}`); if (row.appliedAtRevision === undefined && event.status !== "SCHEDULED" && event.status !== "CANCELLED") throw new Error(`PENDING_STATUS_INVALID:${event.eventId}`); if (row.appliedAtRevision !== undefined && (event.status !== "APPLIED" || !Number.isInteger(row.appliedAtRevision) || Number(row.appliedAtRevision) < event.createdAtRevision)) throw new Error(`PENDING_APPLIED_INVALID:${event.eventId}`); return clone(entry); });
  const scheduledRules = [...new Set(pending.filter((entry) => entry.event.status === "SCHEDULED" && entry.appliedAtRevision === undefined).map((entry) => entry.event.sourceRuleId))].sort(); if (stable([...state.pendingRuleIds].sort()) !== stable(scheduledRules)) throw new Error("SNAPSHOT_PENDING_RULE_IDS_MISMATCH");
  return { ...(resolvedRunId ? { runId: resolvedRunId } : {}), state, events: clone(events), pending };
}

export class DeterministicSettlementEngine {
  settle(contractInput: WorldRuntimeContract, packageInput: SettlementPackage, snapshotInput: SettlementSnapshot, intentInput: unknown): SettlementOutcome {
    try {
      const contract = validateWorldRuntimeContract(contractInput); const config = validateSettlementPackage(packageInput, contract); const snapshot = validateSettlementSnapshot(snapshotInput, contract); const intent = validatePlayerActionIntent(intentInput, contract); const state = snapshot.state;
      if (snapshot.runId && intent.runId !== snapshot.runId) return { kind: "REJECTED", code: "SNAPSHOT_RUN_ID_MISMATCH" }; if (intent.expectedStateRevision !== state.revision) return { kind: "CONFLICT", expectedRevision: intent.expectedStateRevision, actualRevision: state.revision };
      if (snapshot.events.some((event) => event.sourceActionId === intent.actionId)) return { kind: "REJECTED", code: "ACTION_ID_ALREADY_SETTLED" };
      const binding = config.bindings.find((item) => item.intentType === intent.intentType && item.capabilityId === intent.proposedCapabilityId); if (!binding) return { kind: "REJECTED", code: "NO_SETTLEMENT_BINDING" };
      const rules = binding.immediateRuleIds.map((ruleId) => contract.causalRules.find((item) => item.id === ruleId)!); if (!rules.every((rule) => conditionSatisfied(rule.condition, state.predicates))) return { kind: "REJECTED", code: "CAUSAL_CONDITION_UNSATISFIED" };
      const worldTurnId = `${intent.runId}.turn.${state.revision + 1}`; const revision = state.revision + 1; const events: CausalEvent[] = [];
      for (const [routeIndex, route] of binding.echoRoutes.entries()) { const rule = rules.find((item) => item.id === route.ruleId)!; const predicate = rule.effects[route.effectIndex]; const affected = resolveAudience(contract, route.audience, intent.actorId, rule.visibility, predicate); if (route.category === "PERSONAL" && !affected.includes(intent.actorId)) return { kind: "REJECTED", code: "ECHO_ROUTE_PERSONAL_ORIGIN_MISSING" }; if (route.category === "CROSS_PLAYER" && !affected.some((actor) => contract.roles.some((role) => role.actorId === actor) && actor !== intent.actorId)) return { kind: "REJECTED", code: "ECHO_ROUTE_CROSS_PLAYER_MISSING" }; const summaryActors = affected.filter((actor) => contract.roles.some((role) => role.actorId === actor)); const summaries = Object.fromEntries(summaryActors.map((actor) => [actor, route.summary])); events.push({ eventId: `${intent.actionId}.event.${routeIndex + 1}`, runId: intent.runId, worldId: contract.worldId, worldTurnId, sourceActionId: intent.actionId, sourceRuleId: rule.id, originActorId: intent.actorId, affectedActorIds: affected, predicate, status: "APPLIED", createdAtRevision: state.revision, visibility: rule.visibility, ...(rule.visibility.scope === "PUBLIC" ? { publicSummary: route.summary } : {}), affectedPlayerSummaries: summaries, revealOriginActor: true, containsProtectedSecret: predicate.type === "KNOWLEDGE.REVEALED_TO", idempotencyKey: `${intent.actionId}.key.${routeIndex + 1}` }); }
      let nextState = addPredicates(state, events.map((event) => event.predicate), revision); const pending = [...snapshot.pending]; const delayedEvents: CausalEvent[] = [];
      for (const [index, ruleId] of binding.delayedRuleIds.entries()) { const rule = contract.delayedRules.find((item) => item.id === ruleId)!; if (!conditionSatisfied(rule.condition, nextState.predicates)) continue; for (const [effectIndex, predicate] of rule.effects.entries()) { const affected = visibilityActors(contract, rule.visibility, predicate); const summaryActors = affected.filter((actor) => contract.roles.some((role) => role.actorId === actor)); const summary = binding.echoRoutes.find((route) => route.category === "WORLD")!.summary; const event: CausalEvent = { eventId: `${intent.actionId}.delayed.${index + 1}.${effectIndex + 1}`, runId: intent.runId, worldId: contract.worldId, worldTurnId, sourceActionId: intent.actionId, sourceRuleId: rule.id, originActorId: intent.actorId, affectedActorIds: affected, predicate, status: "SCHEDULED", createdAtRevision: state.revision, applyAtRevision: revision + rule.delayRevisions, visibility: rule.visibility, ...(rule.visibility.scope === "PUBLIC" ? { publicSummary: summary } : {}), affectedPlayerSummaries: Object.fromEntries(summaryActors.map((actor) => [actor, summary])), revealOriginActor: true, containsProtectedSecret: predicate.type === "KNOWLEDGE.REVEALED_TO", idempotencyKey: `${intent.actionId}.delayed.key.${index + 1}.${effectIndex + 1}` }; delayedEvents.push(event); pending.push({ event }); } }
      if (delayedEvents.length) nextState = { ...nextState, pendingRuleIds: [...new Set([...nextState.pendingRuleIds, ...delayedEvents.map((event) => event.sourceRuleId)])].sort() };
      const allEvents = [...snapshot.events, ...events, ...delayedEvents]; for (const event of [...events, ...delayedEvents]) validateCausalEvent(event, contract, allEvents.filter((item) => item.eventId !== event.eventId));
      const refs = (category: EchoCategory) => binding.echoRoutes.map((route, index) => ({ route, event: events[index] })).filter((item) => item.route.category === category).map((item) => eventRef(item.event));
      const authorizedEffects = [...rules.flatMap((rule) => rule.effects), ...binding.delayedRuleIds.flatMap((ruleId) => contract.delayedRules.find((rule) => rule.id === ruleId)!.effects)];
      const requiredVisiblePredicates = binding.echoRoutes.flatMap((route, index) => {
        if (route.category === "PERSONAL" && binding.renderPolicy === "PROTECTED_TEMPLATE") return [];
        const event = events[index]!;
        const visibleToProjection = event.visibility.scope === "PUBLIC"
          || event.affectedActorIds.includes(intent.actorId);
        if (!visibleToProjection || event.status !== "APPLIED") return [];
        const constraints = Object.fromEntries(
          predicateFields[event.predicate.type].map((field) => [
            field,
            (event.predicate as unknown as Record<string, string | number | boolean>)[field],
          ]),
        );
        return [{
          id: `${event.eventId}.required`,
          pattern: { type: event.predicate.type, constraints },
          visibility: event.visibility,
          requiredMeaning: route.summary,
          supportEventIds: [event.eventId],
        }];
      });
      const envelope: DurableTurnEnvelope = { turnEnvelopeId: `${intent.actionId}.envelope`, runId: intent.runId, worldTurnId, beforeStateRevision: state.revision, sourceActionId: intent.actionId, originActorId: intent.actorId, allowedPredicates: [...new Map(authorizedEffects.map((predicate) => [predicate.type, { type: predicate.type, constraints: {} }])).values()], requiredVisiblePredicates, forbiddenPredicatePatterns: [], unresolvedFacts: [], activeSceneEntityIds: intent.referencedEntityIds, personalEffects: refs("PERSONAL"), crossPlayerEffects: refs("CROSS_PLAYER"), worldEffects: refs("WORLD"), delayedEffects: delayedEvents.map(eventRef), projectionActorId: intent.actorId, narrativeSeed: { playerOutcome: binding.echoRoutes.find((route) => route.category === "PERSONAL")!.summary, npcOrWorldPressure: binding.echoRoutes.find((route) => route.category === "WORLD")!.summary, stopCondition: config.fallback.nextDecisionPoint } };
      validateDurableTurnEnvelope(envelope, contract, [...events, ...delayedEvents]);
      const protectedBlocks: ProtectedNarrativeBlock[] = binding.renderPolicy === "PROTECTED_TEMPLATE" ? [{ blockId: `${intent.actionId}.protected`, sourcePredicateIds: events.map((event) => event.eventId), locale: config.fallback.locale, text: binding.protectedTemplate!.replace("{summary}", envelope.narrativeSeed.playerOutcome), immutable: true }] : [];
      protectedBlocks.forEach((block) => validateProtectedNarrativeBlock(block, events, config.fallback.locale));
      const fallbackText = `${config.fallback.playerOutcomePrefix} ${protectedBlocks[0]?.text ?? envelope.narrativeSeed.playerOutcome}\n${config.fallback.reactionPrefix} ${binding.echoRoutes.find((route) => route.category === "CROSS_PLAYER")!.summary}\n${config.fallback.worldPressurePrefix} ${envelope.narrativeSeed.npcOrWorldPressure}\n${config.fallback.nextDecisionPoint}`;
      const resultSnapshot = validateSettlementSnapshot({ runId: intent.runId, state: nextState, events: allEvents, pending }, contract); const result: SettlementResult = { snapshot: resultSnapshot, envelope, events: [...events, ...delayedEvents], protectedBlocks, fallbackText, disposition: { kind: "USE_FALLBACK", fallbackId: `${intent.actionId}.fallback`, reason: "NARRATIVE_PIPELINE_UNAVAILABLE" } }; return { kind: "ACCEPTED", result };
    } catch (error) { return { kind: "REJECTED", code: error instanceof Error ? error.message : "SETTLEMENT_FAILED" }; }
  }

  applyDue(contractInput: WorldRuntimeContract, snapshotInput: SettlementSnapshot): SettlementSnapshot {
    const contract = validateWorldRuntimeContract(contractInput); const snapshot = validateSettlementSnapshot(snapshotInput, contract); const dueEntries = snapshot.pending.filter((pending) => pending.event.status === "SCHEDULED" && pending.appliedAtRevision === undefined && (pending.event.applyAtRevision !== undefined ? snapshot.state.revision >= pending.event.applyAtRevision : conditionSatisfied(pending.event.triggerCondition, snapshot.state.predicates)));
    if (dueEntries.length === 0) return snapshot;
    const appliedAtRevision = snapshot.state.revision + 1; const applied: DurablePredicate[] = [];
    for (const pending of dueEntries) { pending.event.status = "APPLIED"; pending.appliedAtRevision = appliedAtRevision; const stored = snapshot.events.find((item) => item.eventId === pending.event.eventId); if (!stored) throw new Error(`PENDING_EVENT_MISSING:${pending.event.eventId}`); stored.status = "APPLIED"; applied.push(pending.event.predicate); }
    const scheduledRules = new Set(snapshot.pending.filter((pending) => pending.event.status === "SCHEDULED" && pending.appliedAtRevision === undefined).map((pending) => pending.event.sourceRuleId)); snapshot.state = addPredicates({ ...snapshot.state, pendingRuleIds: snapshot.state.pendingRuleIds.filter((ruleId) => scheduledRules.has(ruleId)).sort() }, applied, appliedAtRevision); return validateSettlementSnapshot(snapshot, contract);
  }
}

export class InMemorySettlementCoordinator {
  private snapshot: SettlementSnapshot; private readonly ledger = new Map<string, { request: string; result: SettlementResult }>(); private tail: Promise<void> = Promise.resolve();
  constructor(snapshot: SettlementSnapshot) { this.snapshot = clone(snapshot); }
  submit(engine: DeterministicSettlementEngine, contract: WorldRuntimeContract, config: SettlementPackage, key: string, intent: unknown): Promise<SettlementOutcome> { const request = stable(intent); return new Promise((resolve) => { this.tail = this.tail.then(() => { const prior = this.ledger.get(key); if (prior) { resolve(prior.request === request ? { kind: "REPLAYED", result: clone(prior.result) } : { kind: "REJECTED", code: "IDEMPOTENCY_KEY_REUSED" }); return; } const outcome = engine.settle(contract, config, this.snapshot, intent); if (outcome.kind === "ACCEPTED") { this.snapshot = clone(outcome.result.snapshot); this.ledger.set(key, { request, result: clone(outcome.result) }); } resolve(outcome); }); }); }
  read(): SettlementSnapshot { return clone(this.snapshot); }
}
