import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { caesarRuntimeFixture, sangtianRuntimeFixture } from "../src/runtime-contract/fixtures";
import {
  applyCausalRule, conditionSatisfied, predicateKey, runtimeContractSha256,
  validateCausalEvent, validateDurableState, validateDurableTurnEnvelope,
  validateWorldRegistryIndex, validateWorldRuntimeContract, WorldRegistry,
  patternsOverlap, patternSubsumes,
  visibilitiesEquivalent,
} from "../src/runtime-contract";
import type { CausalEvent, DurableTurnEnvelope, WorldRuntimeContract } from "../src/runtime-contract";

const clone = <T>(value: T): T => structuredClone(value);
const mutateContract = (mutate: (contract: any) => void, expected: RegExp): void => {
  const contract = clone(sangtianRuntimeFixture); mutate(contract); assert.throws(() => validateWorldRuntimeContract(contract), expected);
};
const eventFixture = (contract: WorldRuntimeContract = sangtianRuntimeFixture): CausalEvent => {
  const rule = contract.causalRules[0]; const actorId = contract.roles[0].actorId;
  return {
    eventId: `${contract.worldId}.event.one`, runId: `${contract.worldId}.run.one`, worldId: contract.worldId,
    worldTurnId: `${contract.worldId}.turn.one`, sourceActionId: `${contract.worldId}.action.one`, sourceRuleId: rule.id,
    originActorId: actorId, affectedActorIds: [actorId], predicate: rule.effects[0], status: "APPLIED",
    createdAtRevision: 0, visibility: { scope: "PUBLIC" }, publicSummary: "A durable result occurred.",
    affectedPlayerSummaries: { [actorId]: "Your situation changed." }, revealOriginActor: true,
    containsProtectedSecret: false, idempotencyKey: `${contract.worldId}.idempotency.one`,
  };
};
const envelopeFixture = (event: CausalEvent): DurableTurnEnvelope => ({
  turnEnvelopeId: `${event.worldId}.envelope.one`, runId: event.runId, worldTurnId: event.worldTurnId,
  beforeStateRevision: event.createdAtRevision, sourceActionId: event.sourceActionId, originActorId: event.originActorId,
  allowedPredicates: [{ type: event.predicate.type, constraints: {} }], requiredVisiblePredicates: [],
  forbiddenPredicatePatterns: [], unresolvedFacts: ["Outcome remains unresolved."],
  activeSceneEntityIds: [sangtianRuntimeFixture.entities[2].id], personalEffects: [{ eventId: event.eventId, expectedStatus: event.status }],
  crossPlayerEffects: [], worldEffects: [], delayedEffects: [], projectionActorId: event.originActorId,
  narrativeSeed: { playerOutcome: "The selected action settled.", npcOrWorldPressure: "The world responds.", stopCondition: "Stop at the next decision." },
});
const requiredVisible = (
  event: CausalEvent,
  pattern: DurableTurnEnvelope["allowedPredicates"][number],
  visibility: CausalEvent["visibility"],
) => ({
  id: `${event.eventId}.required`,
  pattern,
  visibility,
  requiredMeaning: "The settled event must be visibly dramatized.",
  supportEventIds: [event.eventId],
});

test("same loader validates two structurally different worlds", () => {
  const first = validateWorldRuntimeContract(sangtianRuntimeFixture); const second = validateWorldRuntimeContract(caesarRuntimeFixture);
  assert.equal(first.roles.length, 2); assert.equal(second.entities.some((entity) => entity.kind === "EVIDENCE"), true);
  assert.notDeepEqual(first.capabilities.map((item) => item.effectPatterns), second.capabilities.map((item) => item.effectPatterns));
});
test("state transitions are deterministic without prose", () => {
  for (const contract of [sangtianRuntimeFixture, caesarRuntimeFixture]) {
    const first = applyCausalRule(contract, contract.openingState, contract.causalRules[0].id); const repeat = applyCausalRule(contract, contract.openingState, contract.causalRules[0].id);
    assert.deepEqual(first, repeat); const delayed = applyCausalRule(contract, first, contract.delayedRules[0].id); assert.deepEqual(delayed.pendingRuleIds, [contract.delayedRules[0].id]);
  }
});
test("condition unknown fields and predicate property order fail and compare correctly", () => {
  mutateContract((contract) => { contract.causalRules[0].condition.extra = true; }, /CONDITION_INVALID_UNKNOWN_FIELD/);
  const left = { type: "ENTITY.INTRODUCED" as const, entityId: sangtianRuntimeFixture.entities[0].id }; const right = { entityId: left.entityId, type: left.type };
  assert.equal(predicateKey(left), predicateKey(right)); assert.equal(conditionSatisfied({ all: [left] }, [right]), true);
});
test("all declaration namespaces reject duplicate IDs", () => {
  for (const field of ["entities", "roles", "actorPolicies", "capabilities", "knowledgeAcl", "destinyHooks", "openingProjections"]) mutateContract((contract) => contract[field].push(clone(contract[field][0])), /DUPLICATE_ID/);
  mutateContract((contract) => { contract.delayedRules[0].id = contract.causalRules[0].id; }, /DUPLICATE_ID/);
});
test("durable state rejects unknown predicates, duplicates, bad revisions and references", () => {
  assert.throws(() => validateDurableState({ ...sangtianRuntimeFixture.openingState, revision: -1 }, sangtianRuntimeFixture), /REVISION_INVALID/);
  assert.throws(() => validateDurableState({ ...sangtianRuntimeFixture.openingState, predicates: [{ type: "STORY.SPECIAL" }] }, sangtianRuntimeFixture), /PREDICATE_KIND_INVALID/);
  assert.throws(() => validateDurableState({ ...sangtianRuntimeFixture.openingState, pendingRuleIds: ["ghost.rule"] }, sangtianRuntimeFixture), /DANGLING_RULE/);
});
test("CausalEvent validates the complete v4 contract", () => {
  const event = eventFixture(); assert.doesNotThrow(() => validateCausalEvent(event, sangtianRuntimeFixture));
  for (const field of ["runId", "worldTurnId", "sourceActionId", "affectedPlayerSummaries", "revealOriginActor", "containsProtectedSecret"] as const) { const broken: any = clone(event); delete broken[field]; assert.throws(() => validateCausalEvent(broken, sangtianRuntimeFixture), /MISSING_FIELD/); }
  assert.doesNotThrow(() => validateCausalEvent({ ...event, applyAtRevision: 2, triggerCondition: { all: [event.predicate] } }, sangtianRuntimeFixture));
  assert.throws(() => validateCausalEvent({ ...event, triggerCondition: { any: [event.predicate], extra: true } }, sangtianRuntimeFixture), /CONDITION_INVALID_UNKNOWN_FIELD/);
});
test("CausalEvent rejects wrong world, actors, status, revisions and keys", () => {
  const event = eventFixture(); assert.throws(() => validateCausalEvent({ ...event, worldId: "ghost.world" }, sangtianRuntimeFixture), /WORLD_MISMATCH/);
  assert.throws(() => validateCausalEvent({ ...event, originActorId: "ghost.actor" }, sangtianRuntimeFixture), /DANGLING_ACTOR/);
  assert.throws(() => validateCausalEvent({ ...event, affectedActorIds: ["ghost.actor"] }, sangtianRuntimeFixture), /DANGLING_ACTOR/);
  assert.throws(() => validateCausalEvent({ ...event, status: "DONE" }, sangtianRuntimeFixture), /STATUS_INVALID/);
  assert.throws(() => validateCausalEvent({ ...event, createdAtRevision: -1 }, sangtianRuntimeFixture), /REVISION_INVALID/);
  assert.throws(() => validateCausalEvent({ ...event, idempotencyKey: "bad" }, sangtianRuntimeFixture), /ID_INVALID/);
});
test("CausalEvent binds rule effects, summaries and INFERABLE evidence", () => {
  const event = eventFixture(); assert.throws(() => validateCausalEvent({ ...event, predicate: sangtianRuntimeFixture.delayedRules[0].effects[0] }, sangtianRuntimeFixture), /NOT_AUTHORIZED/);
  assert.throws(() => validateCausalEvent({ ...event, affectedPlayerSummaries: { "ghost.actor": "No" } }, sangtianRuntimeFixture), /DANGLING_ACTOR/);
  const evidence = { ...event, eventId: "sangtian.event.evidence", idempotencyKey: "sangtian.idempotency.evidence" };
  const inferable = { ...event, visibility: { scope: "INFERABLE" as const, evidenceEventIds: [evidence.eventId] } }; assert.doesNotThrow(() => validateCausalEvent(inferable, sangtianRuntimeFixture, [evidence]));
  assert.throws(() => validateCausalEvent(inferable, sangtianRuntimeFixture), /DANGLING_EVENT/);
});
test("DurableTurnEnvelope validates full shape and four effect reference groups", () => {
  const event = eventFixture(); const envelope = envelopeFixture(event); assert.doesNotThrow(() => validateDurableTurnEnvelope(envelope, sangtianRuntimeFixture, [event]));
  for (const group of ["personalEffects", "crossPlayerEffects", "worldEffects", "delayedEffects"] as const) { const item = clone(envelope); item.personalEffects = []; item[group] = [{ eventId: event.eventId, expectedStatus: event.status }]; assert.doesNotThrow(() => validateDurableTurnEnvelope(item, sangtianRuntimeFixture, [event])); }
});
test("DurableTurnEnvelope rejects unknown, ghost, revision and event context", () => {
  const event = eventFixture(); const envelope: any = envelopeFixture(event);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, extra: true }, sangtianRuntimeFixture, [event]), /UNKNOWN_FIELD/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, originActorId: "ghost.actor" }, sangtianRuntimeFixture, [event]), /DANGLING_ACTOR/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, projectionActorId: "ghost.actor" }, sangtianRuntimeFixture, [event]), /DANGLING_ACTOR/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, beforeStateRevision: -1 }, sangtianRuntimeFixture, [event]), /REVISION_INVALID/);
  assert.throws(() => validateDurableTurnEnvelope(envelope, sangtianRuntimeFixture, []), /DANGLING_EVENT/);
});
test("DurableTurnEnvelope rejects pattern conflicts, duplicate refs and narrativeSeed extras", () => {
  const event = eventFixture(); const envelope = envelopeFixture(event); const conflict = envelope.allowedPredicates[0];
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, forbiddenPredicatePatterns: [conflict] }, sangtianRuntimeFixture, [event]), /PATTERN_CONFLICT/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, worldEffects: envelope.personalEffects }, sangtianRuntimeFixture, [event]), /EVENT_REF_DUPLICATE/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, narrativeSeed: { ...envelope.narrativeSeed, internalAnchor: "hidden" } }, sangtianRuntimeFixture, [event]), /NARRATIVE_SEED_INVALID_UNKNOWN_FIELD/);
});
test("DestinyHook validates every reference and all three conditions", () => {
  for (const [field, value] of [["actorIds", ["ghost.actor"]], ["entityIds", ["ghost.entity"]], ["secretIds", ["ghost.secret"]], ["causalRuleIds", ["ghost.rule"]]] as const) mutateContract((contract) => { contract.destinyHooks[0][field] = value; }, /DANGLING|REFERENCE_KIND/);
  mutateContract((contract) => { contract.destinyHooks[0].convergenceCondition = { all: [], extra: true }; }, /CONDITION_INVALID_UNKNOWN_FIELD/);
  mutateContract((contract) => { contract.destinyHooks[0].resolutionCondition = { any: [] }; }, /CONDITION_INVALID/);
});
test("Role fields are fully runtime validated", () => {
  mutateContract((contract) => { contract.roles[0].goalIds = [3]; }, /STRING_INVALID/); mutateContract((contract) => { contract.roles[0].destinyQuestion = 3; }, /STRING_INVALID/);
  mutateContract((contract) => { contract.roles[0].secretIds = [contract.entities[0].id]; }, /REFERENCE_KIND_INVALID/);
});
test("Policy and capability fields and effect authorization are validated", () => {
  mutateContract((contract) => { contract.actorPolicies[0].capabilityIds = []; }, /STRING_ARRAY_EMPTY/);
  mutateContract((contract) => { contract.capabilities[0].allowedActorIds = ["ghost.actor"]; }, /DANGLING_ACTOR|ACTOR_CAPABILITY_MISMATCH/);
  mutateContract((contract) => { contract.causalRules[0].effects.push({ type: "WORLD.PRESSURE_CHANGED", pressureId: "sangtian.pressure.extra", delta: 1 }); }, /RULE_EFFECT_NOT_AUTHORIZED/);
});
test("ACL rejects ghost, duplicate and visibility/grant mismatches", () => {
  mutateContract((contract) => { contract.knowledgeAcl[0].actorIds.push("ghost.actor"); }, /DANGLING_ACTOR/);
  mutateContract((contract) => { contract.knowledgeAcl[0].actorIds.push(contract.knowledgeAcl[0].actorIds[0]); }, /DUPLICATE_ID/);
  mutateContract((contract) => { contract.knowledgeAcl[0].visibility = { scope: "ACTOR_SET", actorIds: [contract.roles[1].actorId] }; }, /ACL_SCOPE_MISMATCH/);
});
test("causal reachability honors any, not and rejects a true closed cycle", () => {
  const negative = clone(sangtianRuntimeFixture); negative.causalRules[0].condition = { not: { type: "ACTOR.COMMITTED", actorId: negative.roles[0].actorId, commitmentId: "sangtian.commitment.absent" } }; assert.doesNotThrow(() => validateWorldRuntimeContract(negative));
  const any = clone(sangtianRuntimeFixture); any.causalRules[0].condition = { any: [any.openingState.predicates[0], { type: "ACTOR.COMMITTED", actorId: any.roles[0].actorId, commitmentId: "sangtian.commitment.missing" }] }; assert.doesNotThrow(() => validateWorldRuntimeContract(any));
  mutateContract((contract) => { const effect = contract.causalRules[0].effects[0]; contract.causalRules[0].condition = { all: [effect] }; }, /CAUSAL_REFERENCE_UNSATISFIABLE/);
});
test("Projection, style and entity visibility policy are fail closed", () => {
  mutateContract((contract) => { contract.openingProjections[0].visibleEntityIds = ["ghost.entity"]; }, /DANGLING_ENTITY/);
  mutateContract((contract) => { contract.styleProfile.pov = "OMNISCIENT"; }, /STYLE_INVALID/); mutateContract((contract) => { contract.styleProfile.tense = "FUTURE"; }, /STYLE_INVALID/); mutateContract((contract) => { contract.styleProfile.tags = [1]; }, /STRING_INVALID/);
  mutateContract((contract) => { contract.entities[0].visibilityPolicyId = "ghost.policy"; }, /DANGLING_POLICY/);
});
test("entity initial status and locale aliases are stable and strict", () => {
  mutateContract((contract) => { contract.entities[0].initialStatus.bad = []; }, /INITIAL_STATUS_INVALID/); mutateContract((contract) => { contract.entities[0].initialStatus.bad = Infinity; }, /INITIAL_STATUS_INVALID/);
  const reordered = clone(sangtianRuntimeFixture); reordered.aliasesByLocale = { "zh-CN": Object.fromEntries(Object.entries(reordered.aliasesByLocale["zh-CN"]).reverse()) }; assert.equal(runtimeContractSha256(reordered), runtimeContractSha256(sangtianRuntimeFixture));
  mutateContract((contract) => { contract.aliasesByLocale.bad_locale = {}; }, /LOCALE_INVALID/);
});
test("registry index rejects invalid versions, paths and entry fields", () => {
  const contract = sangtianRuntimeFixture; const valid = { worldKey: "world.one", aliases: ["one"], worldId: contract.worldId, contractVersion: contract.contractVersion, contractSha256: runtimeContractSha256(contract), contractPath: "world/contract.json" };
  assert.doesNotThrow(() => validateWorldRegistryIndex({ registryVersion: 1, worlds: [valid] }));
  assert.throws(() => validateWorldRegistryIndex({ registryVersion: 1, worlds: [{ ...valid, contractVersion: "bad" }] }), /VERSION/);
  for (const path of ["", "../contract.json", "/absolute.json"]) assert.throws(() => validateWorldRegistryIndex({ registryVersion: 1, worlds: [{ ...valid, contractPath: path }] }), /PATH/);
  assert.throws(() => validateWorldRegistryIndex({ registryVersion: 1, worlds: [{ ...valid, extra: true }] }), /FIELDS/);
});
test("registry rejects world-key and cross-entry alias collisions", () => {
  const contract = sangtianRuntimeFixture; const base = { worldKey: "world.one", aliases: ["shared"], worldId: contract.worldId, contractVersion: contract.contractVersion, contractSha256: runtimeContractSha256(contract), contractPath: "one.json" };
  assert.throws(() => validateWorldRegistryIndex({ registryVersion: 1, worlds: [base, { ...base, contractPath: "two.json" }] }), /WORLD_KEY_COLLISION/);
  assert.throws(() => validateWorldRegistryIndex({ registryVersion: 1, worlds: [base, { ...base, worldKey: "world.two", aliases: ["shared"], contractPath: "two.json" }] }), /ALIAS_COLLISION/);
});
test("registry loader binds world, version and hash", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-registry-")); const contract = sangtianRuntimeFixture; writeFileSync(join(root, "contract.json"), JSON.stringify(contract));
  const valid = { worldKey: "world.one", aliases: ["one"], worldId: contract.worldId, contractVersion: contract.contractVersion, contractSha256: runtimeContractSha256(contract), contractPath: "contract.json" };
  assert.equal(new WorldRegistry({ registryVersion: 1, worlds: [valid] }, root).get("one").worldId, contract.worldId);
  assert.throws(() => new WorldRegistry({ registryVersion: 1, worlds: [{ ...valid, worldId: "wrong.world" }] }, root), /WORLD_MISMATCH/);
  assert.throws(() => new WorldRegistry({ registryVersion: 1, worlds: [{ ...valid, contractSha256: "0".repeat(64) }] }, root), /HASH_MISMATCH/);
});

test("event origin requires both policy ownership and capability allowance", () => {
  const event = eventFixture(); const other = sangtianRuntimeFixture.roles[1].actorId;
  assert.throws(() => validateCausalEvent({ ...event, originActorId: other, affectedActorIds: [other], affectedPlayerSummaries: { [other]: "Changed." } }, sangtianRuntimeFixture), /ACTOR_CAPABILITY_MISMATCH/);
});
test("envelope validates untrusted events and rejects duplicate event IDs", () => {
  const event = eventFixture(); const envelope = envelopeFixture(event);
  assert.throws(() => validateDurableTurnEnvelope(envelope, sangtianRuntimeFixture, [{ ...event, worldId: "ghost.world" }]), /EVENT_WORLD_MISMATCH/);
  assert.throws(() => validateDurableTurnEnvelope(envelope, sangtianRuntimeFixture, [event, clone(event)]), /EVENT_ID_DUPLICATE/);
});
test("opening projections cannot invent facts or expose secret entities", () => {
  mutateContract((contract) => { contract.openingProjections[1].visiblePredicates = [contract.causalRules[0].effects[0]]; }, /PROJECTION_FALSE_PREDICATE/);
  mutateContract((contract) => { contract.openingProjections[1].visibleEntityIds.push("sangtian.secret.plan"); }, /ACL_LEAK/);
});
test("role and projection knowledge always use merged ACL grants", () => {
  mutateContract((contract) => { contract.roles[1].secretIds = ["sangtian.secret.plan"]; }, /ACL_LEAK/);
  mutateContract((contract) => { contract.openingProjections[1].knownSecretIds = ["sangtian.secret.plan"]; }, /ACL_LEAK/);
  mutateContract((contract) => { contract.openingProjections[1].visiblePredicates.push({ type: "KNOWLEDGE.REVEALED_TO", secretId: "sangtian.secret.plan", actorId: "sangtian.actor.governor" }); }, /ACL_LEAK|OTHER_ACTOR/);
  const merged = clone(sangtianRuntimeFixture); merged.knowledgeAcl.push({ id: "sangtian.acl.plan.inspector", secretId: "sangtian.secret.plan", actorIds: ["sangtian.actor.inspector"], visibility: { scope: "PRIVATE", actorId: "sangtian.actor.inspector" } }); merged.roles[1].secretIds = ["sangtian.secret.plan"]; assert.doesNotThrow(() => validateWorldRuntimeContract(merged));
});
test("protected and knowledge events cannot escape ACL visibility", () => {
  const event = eventFixture(); assert.throws(() => validateCausalEvent({ ...event, containsProtectedSecret: true }, sangtianRuntimeFixture), /PUBLIC_PROTECTED_SECRET/);
  mutateContract((contract) => { contract.capabilities[0].effectPatterns.push({ type: "KNOWLEDGE.REVEALED_TO", constraints: {} }); contract.causalRules[0].effects.push({ type: "KNOWLEDGE.REVEALED_TO", secretId: "sangtian.secret.plan", actorId: "sangtian.actor.governor" }); }, /ACL_SCOPE_MISMATCH/);
});
test("knowledge reveal honors PRIVATE ACTOR_SET and RELATION_BASED ACLs", () => {
  for (const scope of ["PRIVATE", "ACTOR_SET", "RELATION_BASED"] as const) {
    const contract = clone(sangtianRuntimeFixture); const actor = contract.roles[0].actorId; const policy = contract.roles[0].policyId;
    const visibility = scope === "PRIVATE" ? { scope, actorId: actor } : scope === "ACTOR_SET" ? { scope, actorIds: [actor] } : { scope, policyId: policy };
    contract.knowledgeAcl[0].visibility = visibility; contract.capabilities[0].effectPatterns.push({ type: "KNOWLEDGE.REVEALED_TO", constraints: {} });
    const predicate = { type: "KNOWLEDGE.REVEALED_TO" as const, secretId: contract.knowledgeAcl[0].secretId, actorId: actor }; contract.causalRules[0].effects.push(predicate); contract.causalRules[0].visibility = visibility;
    assert.doesNotThrow(() => validateWorldRuntimeContract(contract)); const event = { ...eventFixture(contract), predicate, visibility, containsProtectedSecret: true }; assert.doesNotThrow(() => validateCausalEvent(event, contract));
    assert.throws(() => validateCausalEvent({ ...event, visibility: { scope: "PUBLIC" } }, contract), /ACL_SCOPE_MISMATCH|PUBLIC_PROTECTED_SECRET/);
  }
});
test("INFERABLE rejects self, ghost and evidence invisible to affected actors", () => {
  const event = eventFixture(); const self = { ...event, visibility: { scope: "INFERABLE" as const, evidenceEventIds: [event.eventId] } };
  assert.throws(() => validateCausalEvent(self, sangtianRuntimeFixture, []), /SELF_REFERENCE|DANGLING_EVENT/);
  assert.throws(() => validateCausalEvent({ ...self, visibility: { scope: "INFERABLE", evidenceEventIds: ["sangtian.event.ghost"] } }, sangtianRuntimeFixture, []), /DANGLING_EVENT/);
  const other = sangtianRuntimeFixture.roles[1].actorId; const privateEvidence = { ...event, eventId: "sangtian.event.private", visibility: { scope: "PRIVATE" as const, actorId: event.originActorId }, idempotencyKey: "sangtian.idempotency.private" };
  const inferred = { ...event, affectedActorIds: [other], affectedPlayerSummaries: { [other]: "Signal." }, visibility: { scope: "INFERABLE" as const, evidenceEventIds: [privateEvidence.eventId] } };
  assert.throws(() => validateCausalEvent(inferred, sangtianRuntimeFixture, [privateEvidence]), /EVIDENCE_NOT_PUBLIC/);
});
test("pattern constraints validate references in contracts and envelopes", () => {
  mutateContract((contract) => { contract.capabilities[0].effectPatterns.push({ type: "DOCUMENT.CREATED", constraints: { documentId: "ghost.document" } }); }, /REFERENCE_KIND_INVALID/);
  const event = eventFixture(); const envelope = envelopeFixture(event); envelope.personalEffects = [];
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, allowedPredicates: [{ type: "DOCUMENT.CREATED", constraints: { documentId: "ghost.document" } }] }, sangtianRuntimeFixture, []), /REFERENCE_KIND_INVALID/);
});
test("pattern algebra handles broad and narrow overlap and subsumption", () => {
  const broad = { type: "DOCUMENT.CREATED" as const, constraints: {} }; const narrow = { type: "DOCUMENT.CREATED" as const, constraints: { documentId: "sangtian.document.order" } }; const disjoint = { type: "DOCUMENT.CREATED" as const, constraints: { documentId: "sangtian.document.other" } };
  assert.equal(patternsOverlap(broad, narrow), true); assert.equal(patternSubsumes(broad, narrow), true); assert.equal(patternSubsumes(narrow, broad), false); assert.equal(patternsOverlap(narrow, disjoint), false);
});
test("envelope pattern algebra rejects conflicts without events", () => {
  const event = eventFixture(); const envelope = envelopeFixture(event); envelope.personalEffects = [];
  const narrow = { type: event.predicate.type, constraints: { documentId: "sangtian.document.order" } } as any;
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, forbiddenPredicatePatterns: [narrow] }, sangtianRuntimeFixture, []), /PATTERN_CONFLICT/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, requiredVisiblePredicates: [requiredVisible(event, narrow, { scope: "PUBLIC" })], forbiddenPredicatePatterns: [narrow] }, sangtianRuntimeFixture, []), /PATTERN_CONFLICT|FORBIDDEN/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, allowedPredicates: [{ type: "RESOURCE.CHANGED", constraints: {} }], requiredVisiblePredicates: [requiredVisible(event, narrow, { scope: "PUBLIC" })] }, sangtianRuntimeFixture, []), /NOT_ALLOWED/);
});
test("required visible predicates bind both event predicate and visibility", () => {
  const event = eventFixture(); const envelope = envelopeFixture(event); const required = requiredVisible(event, envelope.allowedPredicates[0], { scope: "PUBLIC" as const });
  assert.doesNotThrow(() => validateDurableTurnEnvelope({ ...envelope, requiredVisiblePredicates: [required] }, sangtianRuntimeFixture, [event]));
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, requiredVisiblePredicates: [{ ...required, visibility: { scope: "PRIVATE", actorId: sangtianRuntimeFixture.roles[1].actorId } }] }, sangtianRuntimeFixture, [event]), /UNSATISFIED/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, requiredVisiblePredicates: [{ ...required, requiredMeaning: "" }] }, sangtianRuntimeFixture, [event]), /requiredMeaning|TEXT/);
  assert.throws(() => validateDurableTurnEnvelope({ ...envelope, requiredVisiblePredicates: [{ ...required, supportEventIds: ["sangtian.event.ghost"] }] }, sangtianRuntimeFixture, [event]), /SUPPORT_NOT_IN_TURN/);
});
test("event status and player summary invariants are enforced", () => {
  const event = eventFixture(); assert.throws(() => validateCausalEvent({ ...event, status: "SCHEDULED" }, sangtianRuntimeFixture), /STATUS_INVARIANT/);
  assert.doesNotThrow(() => validateCausalEvent({ ...event, status: "SCHEDULED", applyAtRevision: 2 }, sangtianRuntimeFixture));
  assert.throws(() => validateCausalEvent({ ...event, affectedPlayerSummaries: {} }, sangtianRuntimeFixture), /SUMMARY_MISSING/);
});
test("locale aliases and registry are closed and registry reads are defensive", () => {
  mutateContract((contract) => { contract.aliasesByLocale = {}; }, /STYLE_LOCALE_ALIAS_MAP_MISSING/);
  mutateContract((contract) => { contract.entities[0].aliases = ["shared"]; contract.entities[1].aliases = ["shared"]; }, /ALIAS_COLLISION/);
  assert.throws(() => validateWorldRegistryIndex({ registryVersion: 1, worlds: [] }), /REGISTRY_EMPTY/);
  const root = mkdtempSync(join(tmpdir(), "runtime-registry-copy-")); const contract = sangtianRuntimeFixture; writeFileSync(join(root, "contract.json"), JSON.stringify(contract)); const item = { worldKey: "world.one", aliases: [], worldId: contract.worldId, contractVersion: contract.contractVersion, contractSha256: runtimeContractSha256(contract), contractPath: "contract.json" }; const registry = new WorldRegistry({ registryVersion: 1, worlds: [item] }, root); registry.get("world.one").title = "mutated"; assert.equal(registry.get("world.one").title, contract.title);
});

test("INFERABLE requires public evidence", () => {
  const inferred = eventFixture(); const evidence = { ...inferred, eventId: "sangtian.event.private.evidence", visibility: { scope: "PRIVATE" as const, actorId: inferred.originActorId }, idempotencyKey: "sangtian.idempotency.private.evidence" };
  inferred.visibility = { scope: "INFERABLE", evidenceEventIds: [evidence.eventId] };
  assert.throws(() => validateCausalEvent(inferred, sangtianRuntimeFixture, [evidence]), /VISIBILITY_EVIDENCE_NOT_PUBLIC/);
});
test("INFERABLE rejects cancelled and future evidence", () => {
  const inferred = eventFixture(); const cancelled = { ...inferred, eventId: "sangtian.event.cancelled.evidence", status: "CANCELLED" as const, idempotencyKey: "sangtian.idempotency.cancelled.evidence" };
  inferred.visibility = { scope: "INFERABLE", evidenceEventIds: [cancelled.eventId] };
  assert.throws(() => validateCausalEvent(inferred, sangtianRuntimeFixture, [cancelled]), /VISIBILITY_EVIDENCE_NOT_APPLIED/);
  const future = { ...cancelled, eventId: "sangtian.event.future.evidence", status: "APPLIED" as const, createdAtRevision: inferred.createdAtRevision + 1, idempotencyKey: "sangtian.idempotency.future.evidence" };
  inferred.visibility = { scope: "INFERABLE", evidenceEventIds: [future.eventId] };
  assert.throws(() => validateCausalEvent(inferred, sangtianRuntimeFixture, [future]), /VISIBILITY_EVIDENCE_FROM_FUTURE/);
});
test("INFERABLE evidence cannot cross run boundaries", () => {
  const inferred = eventFixture(); const evidence = { ...inferred, eventId: "sangtian.event.other.run", runId: "sangtian.run.other", idempotencyKey: "sangtian.idempotency.other.run" };
  inferred.visibility = { scope: "INFERABLE", evidenceEventIds: [evidence.eventId] };
  assert.throws(() => validateCausalEvent(inferred, sangtianRuntimeFixture, [evidence]), /VISIBILITY_EVIDENCE_RUN_MISMATCH/);
});
test("required INFERABLE predicate accepts qualified public evidence", () => {
  const evidence = { ...eventFixture(), eventId: "sangtian.event.public.evidence", idempotencyKey: "sangtian.idempotency.public.evidence" };
  const inferred = { ...eventFixture(), eventId: "sangtian.event.inferred", visibility: { scope: "INFERABLE" as const, evidenceEventIds: [evidence.eventId] }, idempotencyKey: "sangtian.idempotency.inferred" };
  const envelope = envelopeFixture(inferred); envelope.requiredVisiblePredicates = [requiredVisible(inferred, envelope.allowedPredicates[0], inferred.visibility)];
  assert.doesNotThrow(() => validateDurableTurnEnvelope(envelope, sangtianRuntimeFixture, [evidence, inferred]));
});
test("INFERABLE visibility equivalence ignores evidence ID order", () => {
  const left = { scope: "INFERABLE" as const, evidenceEventIds: ["event.one", "event.two"] }; const right = { scope: "INFERABLE" as const, evidenceEventIds: ["event.two", "event.one"] };
  assert.equal(visibilitiesEquivalent(sangtianRuntimeFixture, left, right), true);
});
test("empty non-playable world contract is rejected", () => {
  const empty: any = clone(sangtianRuntimeFixture); for (const field of ["entities", "roles", "actorPolicies", "capabilities", "knowledgeAcl", "destinyHooks", "causalRules", "delayedRules", "openingProjections"]) empty[field] = []; empty.aliasesByLocale = {}; empty.openingState = { worldId: empty.worldId, revision: 0, predicates: [], pendingRuleIds: [] };
  assert.throws(() => validateWorldRuntimeContract(empty), /WORLD_CONTRACT_EMPTY/);
});
