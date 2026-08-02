import type { DurableEntityKind, WorldRuntimeContract } from "./types";

export class ReferenceValidator {
  readonly entities: ReadonlyMap<string, DurableEntityKind>;
  readonly actors: ReadonlySet<string>;
  readonly policies: ReadonlySet<string>;
  readonly capabilities: ReadonlySet<string>;
  readonly delayedRules: ReadonlySet<string>;

  constructor(contract: WorldRuntimeContract) {
    this.entities = new Map(contract.entities.map((entity) => [entity.id, entity.kind]));
    this.actors = new Set(contract.entities.filter((entity) => entity.kind === "ACTOR").map((entity) => entity.id));
    this.policies = new Set(contract.actorPolicies.map((policy) => policy.id));
    this.capabilities = new Set(contract.capabilities.map((capability) => capability.id));
    this.delayedRules = new Set(contract.delayedRules.map((rule) => rule.id));
  }

  requireEntity(id: string): void { if (!this.entities.has(id)) throw new Error(`DANGLING_ENTITY:${id}`); }
  requireKind(id: string, kind: DurableEntityKind): void { if (this.entities.get(id) !== kind) throw new Error(`REFERENCE_KIND_INVALID:${id}:${kind}`); }
  requireActor(id: string): void { if (!this.actors.has(id)) throw new Error(`DANGLING_ACTOR:${id}`); }
  requirePolicy(id: string): void { if (!this.policies.has(id)) throw new Error(`DANGLING_POLICY:${id}`); }
  requireCapability(id: string): void { if (!this.capabilities.has(id)) throw new Error(`DANGLING_CAPABILITY:${id}`); }

  validatePredicateField(field: string, value: string): void {
    const kinds: Record<string, DurableEntityKind> = { locationId: "LOCATION", documentId: "DOCUMENT", evidenceId: "EVIDENCE", secretId: "SECRET", resourceId: "RESOURCE" };
    if (kinds[field]) this.requireKind(value, kinds[field]);
    else if (["actorId", "fromActorId", "toActorId"].includes(field)) this.requireActor(value);
    else if (field === "entityId" || field === "audienceId") this.requireEntity(value);
    else if (field === "capabilityId") this.requireCapability(value);
  }
}

export function actorCanUseCapability(contract: WorldRuntimeContract, actorId: string, capabilityId: string): boolean {
  const capability = contract.capabilities.find((item) => item.id === capabilityId);
  const policy = contract.actorPolicies.find((item) => item.actorId === actorId);
  return Boolean(capability?.allowedActorIds.includes(actorId) && policy?.capabilityIds.includes(capabilityId));
}
