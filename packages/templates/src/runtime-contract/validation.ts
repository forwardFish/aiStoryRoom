import {
  durableEntityKinds,
  type CausalCondition,
  type CausalEvent,
  type DurablePredicate,
  type DurablePredicatePattern,
  type DurableState,
  type DurableTurnEnvelope,
  type VisibilityRule,
  type WorldRuntimeContract,
} from "./types";
import { KnowledgeAccessValidator, visibilitiesEquivalent, visibilityKey } from "./access";
import { EventContextValidator, validateInferableEvidence } from "./event-context";
import { patternKey, patternSubsumes, patternsOverlap, predicateFields, predicateMatchesPattern, validatePatternReferences } from "./pattern";
import { actorCanUseCapability, ReferenceValidator } from "./reference";

const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const WORLD_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const STATUS_KEY = /^[a-z][A-Za-z0-9_]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/;
type Raw = Record<string, unknown>;
type Context = ReferenceValidator;

function fail(code: string, detail: string): never { throw new Error(`${code}:${detail}`); }
function object(value: unknown, code: string, path: string): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, path);
  return value as Raw;
}
function exact(value: Raw, fields: readonly string[], code: string, path: string): void {
  const actual = Object.keys(value);
  const unknown = actual.find((field) => !fields.includes(field));
  const missing = fields.find((field) => !(field in value));
  if (unknown) fail(`${code}_UNKNOWN_FIELD`, `${path}.${unknown}`);
  if (missing) fail(`${code}_MISSING_FIELD`, `${path}.${missing}`);
}
function id(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID.test(value)) fail("ID_INVALID", path);
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) fail("STRING_INVALID", path);
  return value;
}
function stringArray(value: unknown, path: string, nonEmpty = false): string[] {
  if (!Array.isArray(value)) fail("STRING_ARRAY_INVALID", path);
  const result = value.map((entry, index) => text(entry, `${path}[${index}]`));
  if (nonEmpty && result.length === 0) fail("STRING_ARRAY_EMPTY", path);
  unique(result, path);
  return result;
}
function idArray(value: unknown, path: string, nonEmpty = false): string[] {
  const result = stringArray(value, path, nonEmpty);
  result.forEach((entry, index) => id(entry, `${path}[${index}]`));
  return result;
}
function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) fail("DUPLICATE_ID", path);
}
function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail("REVISION_INVALID", path);
  return Number(value);
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("BOOLEAN_INVALID", path);
  return value;
}

function context(contract: WorldRuntimeContract): Context {
  return new ReferenceValidator(contract);
}
function requireRef(set: ReadonlySet<string>, value: string, code: string): void { if (!set.has(value)) fail(code, value); }
function requireKind(ctx: Context, value: string, kind: string): void {
  ctx.requireKind(value, kind as never);
}

export function predicateKey(predicate: DurablePredicate): string {
  return JSON.stringify(Object.fromEntries(Object.entries(predicate).sort(([a], [b]) => a.localeCompare(b))));
}
export function predicatesEqual(left: DurablePredicate, right: DurablePredicate): boolean {
  return predicateKey(left) === predicateKey(right);
}

export function validateDurablePredicate(input: unknown, ctx: Context): DurablePredicate {
  const value = object(input, "PREDICATE_INVALID", "predicate");
  const type = value.type;
  if (typeof type !== "string" || !(type in predicateFields)) fail("PREDICATE_KIND_INVALID", String(type));
  const fields = predicateFields[type as DurablePredicate["type"]];
  exact(value, ["type", ...fields], "PREDICATE_INVALID", type);
  for (const field of fields) {
    if (field === "delta") {
      if (typeof value[field] !== "number" || !Number.isFinite(value[field])) fail("PREDICATE_VALUE_INVALID", `${type}.${field}`);
    } else {
      id(value[field], `${type}.${field}`);
    }
  }
  for (const field of fields) if (field !== "delta") ctx.validatePredicateField(field, String(value[field]));
  return value as unknown as DurablePredicate;
}

export function validatePredicatePattern(input: unknown, ctx: Context): DurablePredicatePattern {
  const value = object(input, "PATTERN_INVALID", "pattern");
  exact(value, ["type", "constraints"], "PATTERN_INVALID", "pattern");
  if (typeof value.type !== "string" || !(value.type in predicateFields)) fail("PREDICATE_KIND_INVALID", String(value.type));
  const constraints = object(value.constraints, "PATTERN_INVALID", "constraints");
  for (const [field, constraint] of Object.entries(constraints)) {
    if (!predicateFields[value.type as DurablePredicate["type"]].includes(field)) fail("PATTERN_FIELD_INVALID", field);
    if (typeof constraint !== "string" && typeof constraint !== "number" && typeof constraint !== "boolean") fail("PATTERN_VALUE_INVALID", field);
  }
  const sample = { type: value.type, ...constraints } as Raw;
  for (const field of predicateFields[value.type as DurablePredicate["type"]]) {
    if (!(field in sample)) continue;
    if (field === "delta") {
      if (typeof sample[field] !== "number" || !Number.isFinite(sample[field])) fail("PATTERN_VALUE_INVALID", field);
    } else id(sample[field], field);
  }
  const pattern = { type: value.type as DurablePredicate["type"], constraints } as DurablePredicatePattern;
  validatePatternReferences(pattern, ctx);
  return pattern;
}

function validateVisibility(input: unknown, ctx: Context, eventIds?: Set<string>): VisibilityRule {
  const value = object(input, "VISIBILITY_INVALID", "visibility");
  switch (value.scope) {
    case "PUBLIC": exact(value, ["scope"], "VISIBILITY_INVALID", "PUBLIC"); break;
    case "PRIVATE":
      exact(value, ["scope", "actorId"], "VISIBILITY_INVALID", "PRIVATE");
      requireRef(ctx.actors, id(value.actorId, "visibility.actorId"), "DANGLING_ACTOR"); break;
    case "ACTOR_SET":
      exact(value, ["scope", "actorIds"], "VISIBILITY_INVALID", "ACTOR_SET");
      idArray(value.actorIds, "visibility.actorIds", true).forEach((actor) => requireRef(ctx.actors, actor, "DANGLING_ACTOR")); break;
    case "RELATION_BASED":
      exact(value, ["scope", "policyId"], "VISIBILITY_INVALID", "RELATION_BASED");
      requireRef(ctx.policies, id(value.policyId, "visibility.policyId"), "DANGLING_POLICY"); break;
    case "INFERABLE":
      exact(value, ["scope", "evidenceEventIds"], "VISIBILITY_INVALID", "INFERABLE");
      if (!eventIds) fail("VISIBILITY_CONTEXT_REQUIRED", "INFERABLE");
      idArray(value.evidenceEventIds, "visibility.evidenceEventIds", true).forEach((event) => requireRef(eventIds, event, "DANGLING_EVENT")); break;
    default: fail("VISIBILITY_INVALID", String(value.scope));
  }
  return value as unknown as VisibilityRule;
}

function validateCondition(input: unknown, ctx: Context): CausalCondition {
  const value = object(input, "CONDITION_INVALID", "condition");
  exact(value, Object.prototype.hasOwnProperty.call(value, "all") ? ["all"] : Object.prototype.hasOwnProperty.call(value, "any") ? ["any"] : ["not"], "CONDITION_INVALID", "condition");
  if ("not" in value) return { not: validateDurablePredicate(value.not, ctx) };
  const operator = "all" in value ? "all" : "any";
  if (!Array.isArray(value[operator]) || (value[operator] as unknown[]).length === 0) fail("CONDITION_INVALID", operator);
  return { [operator]: (value[operator] as unknown[]).map((entry) => validateDurablePredicate(entry, ctx)) } as CausalCondition;
}
export function conditionSatisfied(condition: CausalCondition | undefined, predicates: DurablePredicate[]): boolean {
  if (!condition) return true;
  const keys = new Set(predicates.map(predicateKey));
  if ("all" in condition) return condition.all.every((predicate) => keys.has(predicateKey(predicate)));
  if ("any" in condition) return condition.any.some((predicate) => keys.has(predicateKey(predicate)));
  return !keys.has(predicateKey(condition.not));
}

export function validateWorldRuntimeContract(input: unknown, skipState = false): WorldRuntimeContract {
  const value = object(input, "RUNTIME_CONTRACT_INVALID", "contract");
  const topFields = ["worldId", "contractVersion", "aliasesByLocale", "title", "entities", "roles", "actorPolicies", "capabilities", "knowledgeAcl", "destinyHooks", "causalRules", "delayedRules", "styleProfile", "openingState", "openingProjections"];
  exact(value, topFields, "RUNTIME_CONTRACT_INVALID", "contract");
  if (typeof value.worldId !== "string" || !WORLD_KEY.test(value.worldId)) fail("WORLD_ID_INVALID", "worldId");
  const worldId = value.worldId;
  if (typeof value.contractVersion !== "string" || !VERSION.test(value.contractVersion)) fail("VERSION_INVALID", "contractVersion");
  text(value.title, "title");
  const rows = (field: string): unknown[] => { if (!Array.isArray(value[field])) fail("ARRAY_INVALID", field); return value[field] as unknown[]; };

  const entityRows = rows("entities").map((entry) => object(entry, "ENTITY_INVALID", "entity"));
  unique(entityRows.map((entity) => id(entity.id, "entity.id")), "entities");
  const entityAliases = new Set<string>();
  for (const entity of entityRows) {
    const fields = ["id", "kind", "displayName", "aliases", "durable", "initialStatus", ...(entity.visibilityPolicyId === undefined ? [] : ["visibilityPolicyId"])];
    exact(entity, fields, "ENTITY_INVALID", String(entity.id));
    if (!durableEntityKinds.includes(entity.kind as never)) fail("ENTITY_KIND_INVALID", String(entity.kind));
    text(entity.displayName, "entity.displayName");
    for (const alias of stringArray(entity.aliases, "entity.aliases")) { const key = alias.normalize("NFC").trim().toLowerCase(); if (entityAliases.has(key)) fail("ALIAS_COLLISION", alias); entityAliases.add(key); }
    if (entity.durable !== true) fail("ENTITY_INVALID", "durable");
    const status = object(entity.initialStatus, "INITIAL_STATUS_INVALID", "initialStatus");
    for (const [key, item] of Object.entries(status)) if (!STATUS_KEY.test(key) || (item !== null && typeof item !== "string" && typeof item !== "boolean" && (typeof item !== "number" || !Number.isFinite(item)))) fail("INITIAL_STATUS_INVALID", key);
  }
  const partial = value as unknown as WorldRuntimeContract;
  const ctx = context(partial);

  const policyRows = rows("actorPolicies").map((entry) => object(entry, "POLICY_INVALID", "policy"));
  const capabilityRows = rows("capabilities").map((entry) => object(entry, "CAPABILITY_INVALID", "capability"));
  const projectionRows = rows("openingProjections").map((entry) => object(entry, "PROJECTION_INVALID", "projection"));
  unique(policyRows.map((row) => id(row.id, "policy.id")), "policies");
  unique(capabilityRows.map((row) => id(row.id, "capability.id")), "capabilities");
  unique(projectionRows.map((row) => id(row.id, "projection.id")), "projections");

  const aliases = object(value.aliasesByLocale, "ALIASES_INVALID", "aliasesByLocale");
  for (const [locale, mappingInput] of Object.entries(aliases)) {
    if (!LOCALE.test(locale)) fail("LOCALE_INVALID", locale);
    const mapping = object(mappingInput, "ALIASES_INVALID", locale); const seen = new Set<string>();
    for (const [entityId, values] of Object.entries(mapping)) {
      requireRef(new Set(ctx.entities.keys()), id(entityId, "alias.entityId"), "DANGLING_ENTITY");
      for (const alias of stringArray(values, `aliases.${locale}.${entityId}`, true)) { const key = alias.normalize("NFC").trim().toLowerCase(); if (seen.has(key)) fail("ALIAS_COLLISION", `${locale}.${alias}`); seen.add(key); }
    }
  }

  for (const policy of policyRows) {
    exact(policy, ["id", "actorId", "capabilityIds"], "POLICY_INVALID", String(policy.id));
    const actorId = id(policy.actorId, "policy.actorId"); requireRef(ctx.actors, actorId, "DANGLING_ACTOR");
    for (const capabilityId of idArray(policy.capabilityIds, "policy.capabilityIds", true)) {
      const capability = capabilityRows.find((item) => item.id === capabilityId);
      if (!capability) fail("DANGLING_CAPABILITY", capabilityId);
      if (!idArray(capability.allowedActorIds, "capability.allowedActorIds", true).includes(actorId)) fail("ACTOR_CAPABILITY_MISMATCH", capabilityId);
    }
  }
  for (const capability of capabilityRows) {
    exact(capability, ["id", "institutionId", "allowedActorIds", "effectPatterns"], "CAPABILITY_INVALID", String(capability.id));
    requireKind(ctx, id(capability.institutionId, "capability.institutionId"), "INSTITUTION");
    idArray(capability.allowedActorIds, "capability.allowedActorIds", true).forEach((actor) => requireRef(ctx.actors, actor, "DANGLING_ACTOR"));
    if (!Array.isArray(capability.effectPatterns) || capability.effectPatterns.length === 0) fail("CAPABILITY_INVALID", "effectPatterns");
    const patterns = (capability.effectPatterns as unknown[]).map((pattern) => validatePredicatePattern(pattern, ctx));
    unique(patterns.map((pattern) => JSON.stringify(pattern)), "capability.effectPatterns");
  }

  const roleRows = rows("roles").map((entry) => object(entry, "ROLE_INVALID", "role"));
  const aclRows = rows("knowledgeAcl").map((entry) => object(entry, "ACL_INVALID", "acl"));
  const hookRows = rows("destinyHooks").map((entry) => object(entry, "HOOK_INVALID", "hook"));
  if (ctx.actors.size === 0 || roleRows.length === 0 || policyRows.length === 0 || capabilityRows.length === 0 || projectionRows.length === 0) fail("WORLD_CONTRACT_EMPTY", worldId);
  unique(roleRows.map((row) => id(row.id, "role.id")), "roles"); unique(aclRows.map((row) => id(row.id, "acl.id")), "acl"); unique(hookRows.map((row) => id(row.id, "hook.id")), "hooks");
  for (const role of roleRows) {
    exact(role, ["id", "actorId", "goalIds", "secretIds", "destinyQuestion", "openingProjectionId", "policyId"], "ROLE_INVALID", String(role.id));
    const actorId = id(role.actorId, "role.actorId"); requireRef(ctx.actors, actorId, "DANGLING_ACTOR");
    idArray(role.goalIds, "role.goalIds", true); text(role.destinyQuestion, "role.destinyQuestion");
    const secrets = idArray(role.secretIds, "role.secretIds"); secrets.forEach((secret) => requireKind(ctx, secret, "SECRET"));
    const policy = policyRows.find((row) => row.id === role.policyId); const projection = projectionRows.find((row) => row.id === role.openingProjectionId);
    if (!policy) fail("DANGLING_POLICY", String(role.policyId)); if (!projection) fail("DANGLING_PROJECTION", String(role.openingProjectionId));
    if (policy.actorId !== actorId) fail("ROLE_POLICY_ACTOR_MISMATCH", String(role.id)); if (projection.actorId !== actorId) fail("ROLE_PROJECTION_ACTOR_MISMATCH", String(role.id));
  }
  for (const acl of aclRows) {
    exact(acl, ["id", "secretId", "actorIds", "visibility"], "ACL_INVALID", String(acl.id));
    requireKind(ctx, id(acl.secretId, "acl.secretId"), "SECRET");
    const actors = idArray(acl.actorIds, "acl.actorIds", true); actors.forEach((actor) => requireRef(ctx.actors, actor, "DANGLING_ACTOR"));
    const visibility = validateVisibility(acl.visibility, ctx);
    if (visibility.scope === "PRIVATE" && (actors.length !== 1 || actors[0] !== visibility.actorId)) fail("ACL_SCOPE_MISMATCH", String(acl.id));
    if (visibility.scope === "ACTOR_SET" && (actors.length !== visibility.actorIds.length || actors.some((actor) => !visibility.actorIds.includes(actor)))) fail("ACL_SCOPE_MISMATCH", String(acl.id));
    if (visibility.scope === "PUBLIC" || visibility.scope === "INFERABLE") fail("ACL_LEAK", String(acl.id));
    if (visibility.scope === "RELATION_BASED") { const policy = policyRows.find((row) => row.id === visibility.policyId); if (!policy || actors.some((actor) => actor !== policy.actorId)) fail("ACL_SCOPE_MISMATCH", String(acl.id)); }
  }
  const access = new KnowledgeAccessValidator(partial);
  for (const role of roleRows) for (const secret of role.secretIds as string[]) access.requireAccess(secret, String(role.actorId), `role.${String(role.id)}.secretIds`);

  const immediateRows = rows("causalRules").map((entry) => object(entry, "RULE_INVALID", "rule"));
  const delayedRows = rows("delayedRules").map((entry) => object(entry, "RULE_INVALID", "delayedRule"));
  const ruleRows = [...immediateRows, ...delayedRows]; unique(ruleRows.map((row) => id(row.id, "rule.id")), "rules");
  const ruleIds = new Set(ruleRows.map((row) => String(row.id)));
  for (const [index, rule] of ruleRows.entries()) {
    const delayed = index >= immediateRows.length;
    exact(rule, ["id", "capabilityId", ...(rule.condition === undefined ? [] : ["condition"]), "effects", "visibility", ...(delayed ? ["delayRevisions"] : [])], "RULE_INVALID", String(rule.id));
    const capabilityId = id(rule.capabilityId, "rule.capabilityId"); requireRef(ctx.capabilities, capabilityId, "DANGLING_CAPABILITY");
    if (rule.condition !== undefined) rule.condition = validateCondition(rule.condition, ctx);
    if (!Array.isArray(rule.effects) || rule.effects.length === 0) fail("RULE_INVALID", "effects");
    const effects = (rule.effects as unknown[]).map((effect) => validateDurablePredicate(effect, ctx)); unique(effects.map(predicateKey), "rule.effects");
    const capability = capabilityRows.find((item) => item.id === capabilityId)!;
    const patterns = (capability.effectPatterns as unknown[]).map((pattern) => validatePredicatePattern(pattern, ctx));
    for (const effect of effects) if (!patterns.some((pattern) => predicateMatchesPattern(effect, pattern))) fail("RULE_EFFECT_NOT_AUTHORIZED", String(rule.id));
    validateVisibility(rule.visibility, ctx); if (delayed) integer(rule.delayRevisions, "delayRevisions", 1);
    for (const effect of effects) if (effect.type === "KNOWLEDGE.REVEALED_TO") access.requireSecretVisibility(effect.secretId, effect.actorId, rule.visibility as VisibilityRule, `rule.${String(rule.id)}`);
  }
  for (const hook of hookRows) {
    exact(hook, ["id", "actorIds", "entityIds", "secretIds", "causalRuleIds", "activationCondition", ...(hook.convergenceCondition === undefined ? [] : ["convergenceCondition"]), ...(hook.resolutionCondition === undefined ? [] : ["resolutionCondition"])], "HOOK_INVALID", String(hook.id));
    idArray(hook.actorIds, "hook.actorIds", true).forEach((actor) => requireRef(ctx.actors, actor, "DANGLING_ACTOR"));
    idArray(hook.entityIds, "hook.entityIds", true).forEach((entity) => requireRef(new Set(ctx.entities.keys()), entity, "DANGLING_ENTITY"));
    idArray(hook.secretIds, "hook.secretIds").forEach((secret) => requireKind(ctx, secret, "SECRET"));
    idArray(hook.causalRuleIds, "hook.causalRuleIds", true).forEach((rule) => requireRef(ruleIds, rule, "DANGLING_RULE"));
    hook.activationCondition = validateCondition(hook.activationCondition, ctx);
    if (hook.convergenceCondition !== undefined) hook.convergenceCondition = validateCondition(hook.convergenceCondition, ctx);
    if (hook.resolutionCondition !== undefined) hook.resolutionCondition = validateCondition(hook.resolutionCondition, ctx);
  }
  for (const projection of projectionRows) {
    exact(projection, ["id", "actorId", "visibleEntityIds", "knownSecretIds", "visiblePredicates"], "PROJECTION_INVALID", String(projection.id));
    const actorId = id(projection.actorId, "projection.actorId"); requireRef(ctx.actors, actorId, "DANGLING_ACTOR");
    idArray(projection.visibleEntityIds, "projection.visibleEntityIds", true).forEach((entity) => { requireRef(new Set(ctx.entities.keys()), entity, "DANGLING_ENTITY"); if (ctx.entities.get(entity) === "SECRET") access.requireAccess(entity, actorId, `projection.${String(projection.id)}.visibleEntityIds`); });
    idArray(projection.knownSecretIds, "projection.knownSecretIds").forEach((secret) => { requireKind(ctx, secret, "SECRET"); access.requireAccess(secret, actorId, `projection.${String(projection.id)}.knownSecretIds`); });
    if (!Array.isArray(projection.visiblePredicates)) fail("PROJECTION_INVALID", "visiblePredicates"); (projection.visiblePredicates as unknown[]).forEach((inputPredicate) => { const predicate = validateDurablePredicate(inputPredicate, ctx); access.requireKnowledgePredicate(predicate, actorId, `projection.${String(projection.id)}.visiblePredicates`); });
  }
  for (const entity of entityRows) if (entity.visibilityPolicyId !== undefined) requireRef(ctx.policies, id(entity.visibilityPolicyId, "entity.visibilityPolicyId"), "DANGLING_POLICY");
  const style = object(value.styleProfile, "STYLE_INVALID", "styleProfile"); exact(style, ["locale", "pov", "tense", "tags"], "STYLE_INVALID", "styleProfile");
  if (typeof style.locale !== "string" || !LOCALE.test(style.locale)) fail("STYLE_INVALID", "locale");
  if (!(String(style.locale) in aliases)) fail("STYLE_LOCALE_ALIAS_MAP_MISSING", String(style.locale));
  if (!["FIRST_PERSON", "SECOND_PERSON", "THIRD_PERSON_LIMITED"].includes(String(style.pov))) fail("STYLE_INVALID", "pov");
  if (!["PAST", "PRESENT"].includes(String(style.tense))) fail("STYLE_INVALID", "tense"); stringArray(style.tags, "style.tags");
  const contract = value as unknown as WorldRuntimeContract;
  if (!skipState) {
    contract.openingState = validateDurableState(value.openingState, contract, true);
    const openingKeys = new Set(contract.openingState.predicates.map(predicateKey));
    for (const projection of contract.openingProjections) for (const predicate of projection.visiblePredicates) if (!openingKeys.has(predicateKey(predicate))) fail("PROJECTION_FALSE_PREDICATE", projection.id);
    const reachable = new Map(contract.openingState.predicates.map((predicate) => [predicateKey(predicate), predicate]));
    const remaining = new Set([...contract.causalRules, ...contract.delayedRules].map((rule) => rule.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of [...contract.causalRules, ...contract.delayedRules]) {
        if (!remaining.has(rule.id) || !conditionSatisfied(rule.condition, [...reachable.values()])) continue;
        rule.effects.forEach((effect) => reachable.set(predicateKey(effect), effect));
        remaining.delete(rule.id); changed = true;
      }
    }
    if (remaining.size) fail("CAUSAL_REFERENCE_UNSATISFIABLE", [...remaining].join(","));
  }
  return contract;
}

export function validateDurableState(input: unknown, contractInput: WorldRuntimeContract, opening = false): DurableState {
  const contract = validateWorldRuntimeContract(contractInput, true); const ctx = context(contract); const value = object(input, "STATE_INVALID", "state");
  exact(value, ["worldId", "revision", "predicates", "pendingRuleIds"], "STATE_INVALID", "state");
  if (value.worldId !== contract.worldId) fail("WORLD_MISMATCH", String(value.worldId)); const revision = integer(value.revision, "state.revision"); if (opening && revision !== 0) fail("STATE_REVISION_INVALID", String(revision));
  if (!Array.isArray(value.predicates)) fail("STATE_INVALID", "predicates"); const predicates = (value.predicates as unknown[]).map((predicate) => validateDurablePredicate(predicate, ctx)); unique(predicates.map(predicateKey), "state.predicates");
  const pendingRuleIds = idArray(value.pendingRuleIds, "state.pendingRuleIds"); pendingRuleIds.forEach((rule) => requireRef(ctx.delayedRules, rule, "DANGLING_RULE"));
  return { worldId: contract.worldId, revision, predicates, pendingRuleIds };
}

export function validateCausalEvent(input: unknown, contractInput: WorldRuntimeContract, evidenceInputs: readonly unknown[] = []): CausalEvent {
  const contract = validateWorldRuntimeContract(contractInput); const ctx = context(contract); const value = object(input, "CAUSAL_EVENT_INVALID", "event");
  const optional = ["applyAtRevision", "triggerCondition", "publicSummary"].filter((field) => value[field] !== undefined);
  exact(value, ["eventId", "runId", "worldId", "worldTurnId", "sourceActionId", "sourceRuleId", "originActorId", "affectedActorIds", "predicate", "status", "createdAtRevision", ...optional, "visibility", "affectedPlayerSummaries", "revealOriginActor", "containsProtectedSecret", "idempotencyKey"], "CAUSAL_EVENT_INVALID", "event");
  id(value.eventId, "eventId"); id(value.runId, "runId"); id(value.worldTurnId, "worldTurnId"); id(value.sourceActionId, "sourceActionId");
  if (value.worldId !== contract.worldId) fail("EVENT_WORLD_MISMATCH", String(value.worldId));
  const rule = [...contract.causalRules, ...contract.delayedRules].find((item) => item.id === value.sourceRuleId); if (!rule) fail("DANGLING_RULE", String(value.sourceRuleId));
  const originActorId = id(value.originActorId, "originActorId"); requireRef(ctx.actors, originActorId, "DANGLING_ACTOR");
  if (!actorCanUseCapability(contract, originActorId, rule.capabilityId)) fail("ACTOR_CAPABILITY_MISMATCH", `${originActorId}:${rule.capabilityId}`);
  const affected = idArray(value.affectedActorIds, "affectedActorIds", true); affected.forEach((actor) => requireRef(ctx.actors, actor, "DANGLING_ACTOR"));
  if (!["SCHEDULED", "APPLIED", "CANCELLED"].includes(String(value.status))) fail("EVENT_STATUS_INVALID", String(value.status));
  const created = integer(value.createdAtRevision, "createdAtRevision"); const applyAt = value.applyAtRevision === undefined ? undefined : integer(value.applyAtRevision, "applyAtRevision");
  if (applyAt !== undefined && applyAt < created) fail("EVENT_REVISION_INVALID", "applyAtRevision");
  if (value.status === "SCHEDULED" && !((applyAt !== undefined && applyAt > created) || value.triggerCondition !== undefined)) fail("EVENT_STATUS_INVARIANT", "SCHEDULED");
  if (value.status === "CANCELLED" && applyAt !== undefined) fail("EVENT_STATUS_INVARIANT", "CANCELLED");
  if (value.triggerCondition !== undefined) value.triggerCondition = validateCondition(value.triggerCondition, ctx);
  const predicate = validateDurablePredicate(value.predicate, ctx); if (!rule.effects.some((effect) => predicatesEqual(effect, predicate))) fail("EVENT_PREDICATE_NOT_AUTHORIZED", String(value.eventId));
  const evidenceContext = new EventContextValidator(evidenceInputs, (evidence) => validateCausalEvent(evidence, contract, []));
  const visibilityValue = object(value.visibility, "VISIBILITY_INVALID", "visibility");
  if (visibilityValue.scope === "INFERABLE") {
    const evidenceIds = idArray(visibilityValue.evidenceEventIds, "visibility.evidenceEventIds", true);
    validateVisibility(value.visibility, ctx, new Set(evidenceContext.events.keys()));
    validateInferableEvidence(value.visibility as VisibilityRule, { eventId: String(value.eventId), runId: String(value.runId), createdAtRevision: created }, evidenceContext);
  } else validateVisibility(value.visibility, ctx);
  if (value.publicSummary !== undefined) text(value.publicSummary, "publicSummary");
  const summaries = object(value.affectedPlayerSummaries, "EVENT_SUMMARIES_INVALID", "affectedPlayerSummaries");
  for (const [actor, summary] of Object.entries(summaries)) { requireRef(ctx.actors, id(actor, "summary.actorId"), "DANGLING_ACTOR"); if (!affected.includes(actor)) fail("EVENT_SUMMARY_ACTOR_MISMATCH", actor); text(summary, `summary.${actor}`); }
  for (const actor of affected) if (contract.roles.some((role) => role.actorId === actor) && !(actor in summaries)) fail("EVENT_SUMMARY_MISSING", actor);
  bool(value.revealOriginActor, "revealOriginActor"); const protectedSecret = bool(value.containsProtectedSecret, "containsProtectedSecret");
  const visibility = value.visibility as VisibilityRule; if (protectedSecret && visibility.scope === "PUBLIC") fail("PUBLIC_PROTECTED_SECRET", String(value.eventId));
  if (protectedSecret && predicate.type !== "KNOWLEDGE.REVEALED_TO") fail("PROTECTED_SECRET_UNBOUND", String(value.eventId));
  const access = new KnowledgeAccessValidator(contract); if (predicate.type === "KNOWLEDGE.REVEALED_TO") { if (!protectedSecret) fail("PROTECTED_SECRET_FLAG_REQUIRED", String(value.eventId)); access.requireSecretVisibility(predicate.secretId, predicate.actorId, visibility, `event.${String(value.eventId)}`); }
  id(value.idempotencyKey, "idempotencyKey");
  return { ...value, predicate } as unknown as CausalEvent;
}

export function validateDurableTurnEnvelope(input: unknown, contractInput: WorldRuntimeContract, events: readonly unknown[] = []): DurableTurnEnvelope {
  const contract = validateWorldRuntimeContract(contractInput); const ctx = context(contract); const value = object(input, "TURN_ENVELOPE_INVALID", "envelope");
  const fields = ["turnEnvelopeId", "runId", "worldTurnId", "beforeStateRevision", "sourceActionId", "originActorId", "allowedPredicates", "requiredVisiblePredicates", "forbiddenPredicatePatterns", "unresolvedFacts", "activeSceneEntityIds", "personalEffects", "crossPlayerEffects", "worldEffects", "delayedEffects", "projectionActorId", "narrativeSeed"];
  exact(value, fields, "TURN_ENVELOPE_INVALID", "envelope"); id(value.turnEnvelopeId, "turnEnvelopeId"); id(value.runId, "runId"); id(value.worldTurnId, "worldTurnId"); id(value.sourceActionId, "sourceActionId"); integer(value.beforeStateRevision, "beforeStateRevision");
  const origin = id(value.originActorId, "originActorId"); requireRef(ctx.actors, origin, "DANGLING_ACTOR"); const projection = id(value.projectionActorId, "projectionActorId"); requireRef(ctx.actors, projection, "DANGLING_ACTOR"); if (!contract.openingProjections.some((item) => item.actorId === projection)) fail("DANGLING_PROJECTION", projection);
  const eventContext = new EventContextValidator(events, (event, prior) => validateCausalEvent(event, contract, prior));
  const patternArray = (field: "allowedPredicates" | "forbiddenPredicatePatterns") => { if (!Array.isArray(value[field])) fail("TURN_ENVELOPE_INVALID", field); const result = (value[field] as unknown[]).map((entry) => validatePredicatePattern(entry, ctx)); unique(result.map(patternKey), field); return result; };
  const allowed = patternArray("allowedPredicates"); const forbidden = patternArray("forbiddenPredicatePatterns");
  for (const left of allowed) for (const right of forbidden) if (patternsOverlap(left, right)) fail("TURN_ENVELOPE_PATTERN_CONFLICT", left.type);
  if (!Array.isArray(value.requiredVisiblePredicates)) fail("TURN_ENVELOPE_INVALID", "requiredVisiblePredicates");
  const requiredPatterns = (value.requiredVisiblePredicates as unknown[]).map((entry) => {
    const required = object(entry, "REQUIRED_VISIBLE_INVALID", "requiredVisiblePredicate"); exact(required, ["pattern", "visibility"], "REQUIRED_VISIBLE_INVALID", "requiredVisiblePredicate");
    const pattern = validatePredicatePattern(required.pattern, ctx); const visibilityValue = object(required.visibility, "VISIBILITY_INVALID", "required.visibility");
    const visibility = validateVisibility(required.visibility, ctx, visibilityValue.scope === "INFERABLE" ? new Set(eventContext.events.keys()) : undefined);
    validateInferableEvidence(visibility, { eventId: String(value.turnEnvelopeId), runId: String(value.runId), createdAtRevision: Number(value.beforeStateRevision) }, eventContext);
    return { pattern, visibility };
  });
  unique(requiredPatterns.map((required) => `${patternKey(required.pattern)}:${visibilityKey(required.visibility)}`), "requiredVisiblePredicates");
  for (const required of requiredPatterns) { if (!allowed.some((pattern) => patternSubsumes(pattern, required.pattern))) fail("REQUIRED_PATTERN_NOT_ALLOWED", required.pattern.type); if (forbidden.some((pattern) => patternsOverlap(pattern, required.pattern))) fail("REQUIRED_PATTERN_FORBIDDEN", required.pattern.type); }
  stringArray(value.unresolvedFacts, "unresolvedFacts"); idArray(value.activeSceneEntityIds, "activeSceneEntityIds").forEach((entity) => requireRef(new Set(ctx.entities.keys()), entity, "DANGLING_ENTITY"));
  const seenRefs = new Set<string>(); const referencedEvents: CausalEvent[] = [];
  for (const field of ["personalEffects", "crossPlayerEffects", "worldEffects", "delayedEffects"] as const) {
    if (!Array.isArray(value[field])) fail("TURN_ENVELOPE_INVALID", field);
    for (const inputRef of value[field] as unknown[]) { const ref = object(inputRef, "EVENT_REF_INVALID", field); exact(ref, ["eventId", "expectedStatus"], "EVENT_REF_INVALID", field); const eventId = id(ref.eventId, `${field}.eventId`); if (seenRefs.has(eventId)) fail("EVENT_REF_DUPLICATE", eventId); seenRefs.add(eventId); if (!["SCHEDULED", "APPLIED", "CANCELLED"].includes(String(ref.expectedStatus))) fail("EVENT_STATUS_INVALID", String(ref.expectedStatus)); const event = eventContext.require(eventId); referencedEvents.push(event); if (event.status !== ref.expectedStatus || event.runId !== value.runId || event.worldTurnId !== value.worldTurnId || event.sourceActionId !== value.sourceActionId || event.originActorId !== origin || event.createdAtRevision !== value.beforeStateRevision) fail("TURN_ENVELOPE_EVENT_MISMATCH", eventId); if (!allowed.some((pattern) => predicateMatchesPattern(event.predicate, pattern)) || forbidden.some((pattern) => predicateMatchesPattern(event.predicate, pattern))) fail("TURN_ENVELOPE_EVENT_UNAUTHORIZED", eventId); }
  }
  for (const required of requiredPatterns) if (!referencedEvents.some((event) => predicateMatchesPattern(event.predicate, required.pattern) && visibilitiesEquivalent(contract, event.visibility, required.visibility))) fail("REQUIRED_VISIBLE_PREDICATE_UNSATISFIED", required.pattern.type);
  const seed = object(value.narrativeSeed, "NARRATIVE_SEED_INVALID", "narrativeSeed"); exact(seed, ["playerOutcome", "npcOrWorldPressure", "stopCondition"], "NARRATIVE_SEED_INVALID", "narrativeSeed"); text(seed.playerOutcome, "narrativeSeed.playerOutcome"); text(seed.npcOrWorldPressure, "narrativeSeed.npcOrWorldPressure"); text(seed.stopCondition, "narrativeSeed.stopCondition");
  return value as unknown as DurableTurnEnvelope;
}
