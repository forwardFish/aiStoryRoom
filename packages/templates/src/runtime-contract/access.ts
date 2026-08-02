import type { DurablePredicate, KnowledgeGrant, VisibilityRule, WorldRuntimeContract } from "./types";

export function visibilityActors(contract: WorldRuntimeContract, visibility: VisibilityRule): Set<string> | undefined {
  if (visibility.scope === "PRIVATE") return new Set([visibility.actorId]);
  if (visibility.scope === "ACTOR_SET") return new Set(visibility.actorIds);
  if (visibility.scope === "RELATION_BASED") {
    const policy = contract.actorPolicies.find((item) => item.id === visibility.policyId);
    return policy ? new Set([policy.actorId]) : new Set();
  }
  return undefined;
}
export function visibilityAllowsActor(contract: WorldRuntimeContract, visibility: VisibilityRule, actorId: string): boolean {
  if (visibility.scope === "PUBLIC") return true;
  if (visibility.scope === "INFERABLE") return false;
  return visibilityActors(contract, visibility)?.has(actorId) ?? false;
}
export function visibilitiesEquivalent(contract: WorldRuntimeContract, left: VisibilityRule, right: VisibilityRule): boolean {
  if (left.scope === "PUBLIC" || right.scope === "PUBLIC") return left.scope === right.scope;
  if (left.scope === "INFERABLE" || right.scope === "INFERABLE") {
    if (left.scope !== "INFERABLE" || right.scope !== "INFERABLE") return false;
    const a = new Set(left.evidenceEventIds); const b = new Set(right.evidenceEventIds);
    return a.size === b.size && [...a].every((eventId) => b.has(eventId));
  }
  const a = visibilityActors(contract, left)!; const b = visibilityActors(contract, right)!;
  return a.size === b.size && [...a].every((actor) => b.has(actor));
}
export function visibilityKey(visibility: VisibilityRule): string {
  if (visibility.scope === "INFERABLE") return `INFERABLE:${[...new Set(visibility.evidenceEventIds)].sort().join(",")}`;
  if (visibility.scope === "ACTOR_SET") return `ACTOR_SET:${[...new Set(visibility.actorIds)].sort().join(",")}`;
  return JSON.stringify(visibility);
}
export class KnowledgeAccessValidator {
  private readonly grantsBySecret = new Map<string, KnowledgeGrant[]>();
  constructor(private readonly contract: WorldRuntimeContract) {
    for (const grant of contract.knowledgeAcl) this.grantsBySecret.set(grant.secretId, [...(this.grantsBySecret.get(grant.secretId) ?? []), grant]);
  }
  canAccess(secretId: string, actorId: string): boolean { return (this.grantsBySecret.get(secretId) ?? []).some((grant) => grant.actorIds.includes(actorId) && visibilityAllowsActor(this.contract, grant.visibility, actorId)); }
  requireAccess(secretId: string, actorId: string, path: string): void { if (!this.canAccess(secretId, actorId)) throw new Error(`ACL_LEAK:${path}:${actorId}:${secretId}`); }
  requireSecretVisibility(secretId: string, targetActorId: string, visibility: VisibilityRule, path: string): void {
    this.requireAccess(secretId, targetActorId, path);
    const visibleActors = visibilityActors(this.contract, visibility);
    if (!visibleActors || !visibleActors.has(targetActorId) || [...visibleActors].some((actor) => !this.canAccess(secretId, actor))) throw new Error(`ACL_SCOPE_MISMATCH:${path}`);
  }
  requireKnowledgePredicate(predicate: DurablePredicate, projectionActorId: string, path: string): void {
    if (predicate.type !== "KNOWLEDGE.REVEALED_TO") return;
    this.requireAccess(predicate.secretId, projectionActorId, path);
    if (predicate.actorId !== projectionActorId) throw new Error(`PROJECTION_OTHER_ACTOR_KNOWLEDGE:${path}`);
  }
}
