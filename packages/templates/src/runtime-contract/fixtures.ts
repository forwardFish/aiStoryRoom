import type { DurablePredicatePattern, WorldRuntimeContract } from "./types";

const pattern = (type: DurablePredicatePattern["type"], constraints: DurablePredicatePattern["constraints"] = {}): DurablePredicatePattern => ({ type, constraints });

export const sangtianRuntimeFixture: WorldRuntimeContract = {
  worldId: "sangtian",
  contractVersion: "1.1.0",
  title: "桑田诏",
  aliasesByLocale: { "zh-CN": { "sangtian.actor.governor": ["总督"], "sangtian.actor.inspector": ["巡抚"] } },
  entities: [
    { id: "sangtian.actor.governor", kind: "ACTOR", displayName: "总督", aliases: [], durable: true, initialStatus: { ready: true } },
    { id: "sangtian.actor.inspector", kind: "ACTOR", displayName: "巡抚", aliases: [], durable: true, initialStatus: {} },
    { id: "sangtian.institution.council", kind: "INSTITUTION", displayName: "议事机构", aliases: [], durable: true, initialStatus: {} },
    { id: "sangtian.document.order", kind: "DOCUMENT", displayName: "命令文书", aliases: [], durable: true, initialStatus: { sealed: false }, visibilityPolicyId: "sangtian.policy.governor" },
    { id: "sangtian.secret.plan", kind: "SECRET", displayName: "隐秘计划", aliases: [], durable: true, initialStatus: {} },
    { id: "sangtian.location.hall", kind: "LOCATION", displayName: "议事厅", aliases: [], durable: true, initialStatus: {} },
    { id: "sangtian.resource.influence", kind: "RESOURCE", displayName: "影响力", aliases: [], durable: true, initialStatus: { amount: 2 } },
  ],
  roles: [
    { id: "sangtian.role.governor", actorId: "sangtian.actor.governor", goalIds: ["sangtian.goal.stability"], secretIds: ["sangtian.secret.plan"], destinyQuestion: "如何维持局势？", openingProjectionId: "sangtian.projection.governor", policyId: "sangtian.policy.governor" },
    { id: "sangtian.role.inspector", actorId: "sangtian.actor.inspector", goalIds: ["sangtian.goal.audit"], secretIds: [], destinyQuestion: "如何查明事实？", openingProjectionId: "sangtian.projection.inspector", policyId: "sangtian.policy.inspector" },
  ],
  actorPolicies: [
    { id: "sangtian.policy.governor", actorId: "sangtian.actor.governor", capabilityIds: ["sangtian.capability.issue"] },
    { id: "sangtian.policy.inspector", actorId: "sangtian.actor.inspector", capabilityIds: ["sangtian.capability.inspect"] },
  ],
  capabilities: [
    { id: "sangtian.capability.issue", institutionId: "sangtian.institution.council", allowedActorIds: ["sangtian.actor.governor"], effectPatterns: [pattern("DOCUMENT.CREATED"), pattern("RESOURCE.CHANGED", { actorId: "sangtian.actor.governor" })] },
    { id: "sangtian.capability.inspect", institutionId: "sangtian.institution.council", allowedActorIds: ["sangtian.actor.inspector"], effectPatterns: [pattern("WORLD.PRESSURE_CHANGED")] },
  ],
  knowledgeAcl: [{ id: "sangtian.acl.plan", secretId: "sangtian.secret.plan", actorIds: ["sangtian.actor.governor"], visibility: { scope: "PRIVATE", actorId: "sangtian.actor.governor" } }],
  destinyHooks: [{ id: "sangtian.hook.crisis", actorIds: ["sangtian.actor.governor", "sangtian.actor.inspector"], entityIds: ["sangtian.document.order", "sangtian.institution.council"], secretIds: ["sangtian.secret.plan"], causalRuleIds: ["sangtian.rule.issue", "sangtian.rule.pressure"], activationCondition: { all: [{ type: "ENTITY.INTRODUCED", entityId: "sangtian.institution.council" }] }, convergenceCondition: { any: [{ type: "DOCUMENT.CREATED", documentId: "sangtian.document.order" }] }, resolutionCondition: { not: { type: "ACTOR.COMMITTED", actorId: "sangtian.actor.inspector", commitmentId: "sangtian.commitment.block" } } }],
  causalRules: [{ id: "sangtian.rule.issue", capabilityId: "sangtian.capability.issue", condition: { all: [{ type: "ENTITY.INTRODUCED", entityId: "sangtian.institution.council" }] }, effects: [{ type: "DOCUMENT.CREATED", documentId: "sangtian.document.order" }, { type: "RESOURCE.CHANGED", actorId: "sangtian.actor.governor", resourceId: "sangtian.resource.influence", delta: 1 }], visibility: { scope: "PUBLIC" } }],
  delayedRules: [{ id: "sangtian.rule.pressure", capabilityId: "sangtian.capability.inspect", condition: { all: [{ type: "DOCUMENT.CREATED", documentId: "sangtian.document.order" }] }, effects: [{ type: "WORLD.PRESSURE_CHANGED", pressureId: "sangtian.pressure.audit", delta: 1 }], visibility: { scope: "ACTOR_SET", actorIds: ["sangtian.actor.governor", "sangtian.actor.inspector"] }, delayRevisions: 2 }],
  styleProfile: { locale: "zh-CN", pov: "THIRD_PERSON_LIMITED", tense: "PAST", tags: ["political", "multi-pov"] },
  openingState: { worldId: "sangtian", revision: 0, predicates: [{ type: "ENTITY.INTRODUCED", entityId: "sangtian.institution.council" }, { type: "ENTITY.LOCATED_AT", entityId: "sangtian.document.order", locationId: "sangtian.location.hall" }], pendingRuleIds: [] },
  openingProjections: [
    { id: "sangtian.projection.governor", actorId: "sangtian.actor.governor", visibleEntityIds: ["sangtian.actor.governor", "sangtian.actor.inspector", "sangtian.institution.council", "sangtian.document.order", "sangtian.location.hall", "sangtian.resource.influence"], knownSecretIds: ["sangtian.secret.plan"], visiblePredicates: [{ type: "ENTITY.INTRODUCED", entityId: "sangtian.institution.council" }] },
    { id: "sangtian.projection.inspector", actorId: "sangtian.actor.inspector", visibleEntityIds: ["sangtian.actor.inspector", "sangtian.institution.council", "sangtian.document.order", "sangtian.location.hall"], knownSecretIds: [], visiblePredicates: [{ type: "ENTITY.LOCATED_AT", entityId: "sangtian.document.order", locationId: "sangtian.location.hall" }] },
  ],
};

export const caesarRuntimeFixture: WorldRuntimeContract = {
  worldId: "caesar",
  contractVersion: "1.1.0",
  title: "Caesar",
  aliasesByLocale: { en: { "caesar.actor.senator": ["Senator"], "caesar.actor.envoy": ["Envoy"] } },
  entities: [
    { id: "caesar.actor.senator", kind: "ACTOR", displayName: "Senator", aliases: [], durable: true, initialStatus: {} },
    { id: "caesar.actor.envoy", kind: "ACTOR", displayName: "Envoy", aliases: [], durable: true, initialStatus: {} },
    { id: "caesar.institution.senate", kind: "INSTITUTION", displayName: "Senate", aliases: [], durable: true, initialStatus: {} },
    { id: "caesar.evidence.letter", kind: "EVIDENCE", displayName: "Letter", aliases: [], durable: true, initialStatus: { intact: true } },
    { id: "caesar.secret.route", kind: "SECRET", displayName: "Route", aliases: [], durable: true, initialStatus: {} },
    { id: "caesar.location.forum", kind: "LOCATION", displayName: "Forum", aliases: [], durable: true, initialStatus: {} },
    { id: "caesar.relation.alliance", kind: "RELATION", displayName: "Alliance", aliases: [], durable: true, initialStatus: { trust: 0 } },
  ],
  roles: [
    { id: "caesar.role.senator", actorId: "caesar.actor.senator", goalIds: ["caesar.goal.order"], secretIds: ["caesar.secret.route"], destinyQuestion: "What preserves the republic?", openingProjectionId: "caesar.projection.senator", policyId: "caesar.policy.senator" },
    { id: "caesar.role.envoy", actorId: "caesar.actor.envoy", goalIds: ["caesar.goal.warning"], secretIds: [], destinyQuestion: "Who should receive the warning?", openingProjectionId: "caesar.projection.envoy", policyId: "caesar.policy.envoy" },
  ],
  actorPolicies: [{ id: "caesar.policy.senator", actorId: "caesar.actor.senator", capabilityIds: ["caesar.capability.deliberate"] }, { id: "caesar.policy.envoy", actorId: "caesar.actor.envoy", capabilityIds: ["caesar.capability.warn"] }],
  capabilities: [
    { id: "caesar.capability.deliberate", institutionId: "caesar.institution.senate", allowedActorIds: ["caesar.actor.senator"], effectPatterns: [pattern("RELATION.TRUST_CHANGED", { fromActorId: "caesar.actor.senator" })] },
    { id: "caesar.capability.warn", institutionId: "caesar.institution.senate", allowedActorIds: ["caesar.actor.envoy"], effectPatterns: [pattern("EVIDENCE.DESTROYED"), pattern("KNOWLEDGE.REVEALED_TO")] },
  ],
  knowledgeAcl: [{ id: "caesar.acl.route", secretId: "caesar.secret.route", actorIds: ["caesar.actor.senator"], visibility: { scope: "ACTOR_SET", actorIds: ["caesar.actor.senator"] } }],
  destinyHooks: [{ id: "caesar.hook.warning", actorIds: ["caesar.actor.envoy"], entityIds: ["caesar.evidence.letter"], secretIds: [], causalRuleIds: ["caesar.rule.trust", "caesar.rule.destroy"], activationCondition: { any: [{ type: "ENTITY.LOCATED_AT", entityId: "caesar.evidence.letter", locationId: "caesar.location.forum" }] }, convergenceCondition: { not: { type: "EVIDENCE.DESTROYED", evidenceId: "caesar.evidence.letter" } } }],
  causalRules: [{ id: "caesar.rule.trust", capabilityId: "caesar.capability.deliberate", condition: { any: [{ type: "ENTITY.INTRODUCED", entityId: "caesar.actor.senator" }] }, effects: [{ type: "RELATION.TRUST_CHANGED", fromActorId: "caesar.actor.senator", toActorId: "caesar.actor.envoy", delta: 1 }], visibility: { scope: "RELATION_BASED", policyId: "caesar.policy.senator" } }],
  delayedRules: [{ id: "caesar.rule.destroy", capabilityId: "caesar.capability.warn", condition: { not: { type: "ACTOR.COMMITTED", actorId: "caesar.actor.envoy", commitmentId: "caesar.commitment.preserve" } }, effects: [{ type: "EVIDENCE.DESTROYED", evidenceId: "caesar.evidence.letter" }], visibility: { scope: "PRIVATE", actorId: "caesar.actor.envoy" }, delayRevisions: 1 }],
  styleProfile: { locale: "en", pov: "FIRST_PERSON", tense: "PRESENT", tags: ["civic", "diplomatic"] },
  openingState: { worldId: "caesar", revision: 0, predicates: [{ type: "ENTITY.INTRODUCED", entityId: "caesar.actor.senator" }, { type: "ENTITY.LOCATED_AT", entityId: "caesar.evidence.letter", locationId: "caesar.location.forum" }], pendingRuleIds: [] },
  openingProjections: [{ id: "caesar.projection.senator", actorId: "caesar.actor.senator", visibleEntityIds: ["caesar.actor.senator", "caesar.actor.envoy", "caesar.institution.senate", "caesar.evidence.letter", "caesar.location.forum", "caesar.relation.alliance"], knownSecretIds: ["caesar.secret.route"], visiblePredicates: [{ type: "ENTITY.INTRODUCED", entityId: "caesar.actor.senator" }] }, { id: "caesar.projection.envoy", actorId: "caesar.actor.envoy", visibleEntityIds: ["caesar.actor.envoy", "caesar.evidence.letter", "caesar.location.forum"], knownSecretIds: [], visiblePredicates: [{ type: "ENTITY.LOCATED_AT", entityId: "caesar.evidence.letter", locationId: "caesar.location.forum" }] }],
};
