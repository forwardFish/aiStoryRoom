import type { DurablePredicate, DurablePredicatePattern } from "./types";
import type { ReferenceValidator } from "./reference";

export const predicateFields: Record<DurablePredicate["type"], readonly string[]> = {
  "ENTITY.INTRODUCED": ["entityId"], "ENTITY.LOCATED_AT": ["entityId", "locationId"], "ENTITY.HELD_BY": ["entityId", "actorId"], "ENTITY.STATE": ["entityId", "attribute", "value"],
  "DOCUMENT.CREATED": ["documentId"], "DOCUMENT.AUTHENTICATED": ["documentId", "actorId"], "DOCUMENT.TRANSFERRED": ["documentId", "fromActorId", "toActorId"], "DOCUMENT.PUBLISHED": ["documentId", "audienceId"],
  "EVIDENCE.DESTROYED": ["evidenceId"], "KNOWLEDGE.REVEALED_TO": ["secretId", "actorId"], "ACTOR.COMMITTED": ["actorId", "commitmentId"], "ACTOR.ORDERED": ["actorId", "capabilityId"],
  "RELATION.TRUST_CHANGED": ["fromActorId", "toActorId", "delta"], "RELATION.SUSPICION_CHANGED": ["fromActorId", "toActorId", "delta"], "WORLD.PRESSURE_CHANGED": ["pressureId", "delta"], "RESOURCE.CHANGED": ["actorId", "resourceId", "delta"],
};

export function predicateMatchesPattern(predicate: DurablePredicate, pattern: DurablePredicatePattern): boolean {
  return predicate.type === pattern.type && Object.entries(pattern.constraints).every(([field, value]) => (predicate as unknown as Record<string, unknown>)[field] === value);
}
export function patternsOverlap(left: DurablePredicatePattern, right: DurablePredicatePattern): boolean {
  if (left.type !== right.type) return false;
  return Object.keys(left.constraints).filter((field) => field in right.constraints).every((field) => left.constraints[field] === right.constraints[field]);
}
export function patternSubsumes(broad: DurablePredicatePattern, narrow: DurablePredicatePattern): boolean {
  return broad.type === narrow.type && Object.entries(broad.constraints).every(([field, value]) => narrow.constraints[field] === value);
}
export function validatePatternReferences(pattern: DurablePredicatePattern, references: ReferenceValidator): void {
  for (const [field, value] of Object.entries(pattern.constraints)) {
    if (typeof value === "string" && field !== "attribute" && field !== "value") {
      references.validatePredicateField(field, value);
    }
  }
}
export function patternKey(pattern: DurablePredicatePattern): string {
  return JSON.stringify({ type: pattern.type, constraints: Object.fromEntries(Object.entries(pattern.constraints).sort(([a], [b]) => a.localeCompare(b))) });
}
