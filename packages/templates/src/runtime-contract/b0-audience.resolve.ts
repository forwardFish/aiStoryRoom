import type {
  B0ActionContractV1,
  B0SettlementResolutionV1,
  B0StateMutationV1,
  B0TypedAudienceSpecV1,
} from "@ai-story/shared";
import {
  B0AudienceErrorV1,
  type B0AudienceResolverMapsV1,
  type BuildB0PublicationPlanInputV1,
} from "./b0-audience.types";

export type B0ActorIndexV1 = {
  actorIds: string[];
  actorSet: Set<string>;
  intentById: Map<string, B0ActionContractV1>;
  relationById: Map<string, B0SettlementResolutionV1["intentRelations"][number]>;
  mutationById: Map<string, B0StateMutationV1>;
  actorLabels: Map<string, string[]>;
};

const LEGACY_FIELDS = new Set(["affectedActorIds", "recipientActorIds", "audienceActorIds", "visibleActorIds"]);

export function extractB0AudienceResolverMapsV1(input: BuildB0PublicationPlanInputV1["snapshot"]): B0AudienceResolverMapsV1 {
  const maps = { traceObservers: {}, roleSets: {}, conditionRecipients: {}, detectedIntentActors: {} } as Record<keyof Required<B0AudienceResolverMapsV1>, Record<string, string[]>>;
  for (const source of [input.worldState, input.knowledgeState, input.relationshipState]) {
    const root = record(source);
    const index = record(root?.audienceIndex) ?? root;
    if (!index) continue;
    mergeStringMap(maps.traceObservers, index.traceObservers);
    mergeStringMap(maps.roleSets, index.roleSets);
    mergeStringMap(maps.conditionRecipients, index.conditionRecipients ?? index.conditions);
    mergeStringMap(maps.detectedIntentActors, index.detectedIntentActors ?? index.detectedIntents);
  }
  return maps;
}

export function resolveB0TypedAudienceV1(spec: B0TypedAudienceSpecV1, input: BuildB0PublicationPlanInputV1): string[] {
  assertNoLegacyAudienceFields(spec, "audience");
  exactAudienceKeys(spec);
  const index = buildB0ActorIndexV1(input);
  const maps = mergeB0AudienceMapsV1(extractB0AudienceResolverMapsV1(input.snapshot), input.maps ?? {});
  let recipients: string[];
  switch (spec.type) {
    case "PUBLIC": recipients = index.actorIds; break;
    case "ACTOR_ONLY": recipients = [spec.actorRef]; break;
    case "DIRECT_TARGETS": {
      const intent = index.intentById.get(spec.originIntentId);
      if (!intent) throw audienceFailure(`Unknown origin intent ${spec.originIntentId}.`);
      recipients = intent.targetRefs.filter((entry) => entry.type === "ACTOR").map((entry) => entry.id);
      break;
    }
    case "OBSERVERS_OF_TRACE": recipients = mappedRecipients(maps.traceObservers, spec.traceId, "trace"); break;
    case "RELATION_PARTICIPANTS": {
      const relation = index.relationById.get(spec.relationId);
      if (!relation) throw audienceFailure(`Unknown relation ${spec.relationId}.`);
      recipients = [relation.leftIntentId, relation.rightIntentId]
        .map((id) => index.intentById.get(id)?.actorId)
        .filter((value): value is string => Boolean(value));
      break;
    }
    case "ROLE_SET": recipients = mappedRecipients(maps.roleSets, spec.roleSetId, "role set"); break;
    case "CONDITION_BASED": recipients = mappedRecipients(maps.conditionRecipients, spec.conditionId, "condition"); break;
    default: throw audienceFailure("Unknown typed audience variant.");
  }
  const stable = uniqueSorted(recipients);
  if (!stable.length) throw audienceFailure(`${spec.type} resolved no recipients.`);
  for (const actorId of stable) {
    if (!index.actorSet.has(actorId)) {
      throw new B0AudienceErrorV1("AUDIENCE_RUN_SCOPE_VIOLATION", `Audience actor ${actorId} is outside the settlement snapshot.`);
    }
  }
  return stable;
}

export function buildB0ActorIndexV1(input: BuildB0PublicationPlanInputV1): B0ActorIndexV1 {
  const actorSet = new Set<string>();
  const actorLabels = new Map<string, string[]>();
  for (const raw of input.snapshot.actorStates) {
    const value = record(raw);
    const actorId = firstString(value, ["actorId", "id", "roleId"]);
    if (!actorId) continue;
    actorSet.add(actorId);
    actorLabels.set(actorId, uniqueSorted([firstString(value, ["displayName", "roleName", "name", "label"]) ?? ""]));
  }
  for (const raw of input.snapshot.roleBindings) {
    const actorId = firstString(record(raw), ["actorId", "roleId"]);
    if (actorId) actorSet.add(actorId);
  }
  if (!actorSet.size) throw audienceFailure("Settlement snapshot has no actors.");
  return {
    actorIds: [...actorSet].sort(),
    actorSet,
    intentById: new Map(input.intents.map((entry) => [entry.id, entry])),
    relationById: new Map(input.resolution.intentRelations.map((entry) => [entry.id, entry])),
    mutationById: new Map(input.resolution.worldDelta.mutations.map((entry) => [entry.mutationId, entry])),
    actorLabels,
  };
}

export function mergeB0AudienceMapsV1(base: B0AudienceResolverMapsV1, override: B0AudienceResolverMapsV1): B0AudienceResolverMapsV1 {
  return {
    traceObservers: mergeMapValues(base.traceObservers, override.traceObservers),
    roleSets: mergeMapValues(base.roleSets, override.roleSets),
    conditionRecipients: mergeMapValues(base.conditionRecipients, override.conditionRecipients),
    detectedIntentActors: mergeMapValues(base.detectedIntentActors, override.detectedIntentActors),
  };
}

export function assertNoLegacyAudienceFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLegacyAudienceFields(entry, `${path}[${index}]`));
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const key of Object.keys(object)) {
    if (LEGACY_FIELDS.has(key)) throw new B0AudienceErrorV1("LEGACY_AUDIENCE_BYPASS", `${path} contains forbidden legacy field ${key}.`);
    assertNoLegacyAudienceFields(object[key], `${path}.${key}`);
  }
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((entry) => typeof entry === "string" && entry.length > 0))].sort();
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return uniqueSorted(left).join("|") === uniqueSorted(right).join("|");
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactAudienceKeys(spec: B0TypedAudienceSpecV1): void {
  const allowed: Record<B0TypedAudienceSpecV1["type"], string[]> = {
    PUBLIC: ["type"], ACTOR_ONLY: ["type", "actorRef"], DIRECT_TARGETS: ["type", "originIntentId"],
    OBSERVERS_OF_TRACE: ["type", "traceId"], RELATION_PARTICIPANTS: ["type", "relationId"],
    ROLE_SET: ["type", "roleSetId"], CONDITION_BASED: ["type", "conditionId"],
  };
  const unknown = Object.keys(spec).filter((key) => !allowed[spec.type]?.includes(key));
  if (unknown.length) throw new B0AudienceErrorV1("AUDIENCE_UNKNOWN_FIELD", `Audience contains unknown fields: ${unknown.join(", ")}.`);
}

function mappedRecipients(map: Readonly<Record<string, readonly string[]>> | undefined, key: string, label: string): string[] {
  const recipients = map?.[key];
  if (!recipients?.length) throw audienceFailure(`No recipients are defined for ${label} ${key}.`);
  return [...recipients];
}

function mergeMapValues(left?: Readonly<Record<string, readonly string[]>>, right?: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const source of [left, right]) for (const [key, values] of Object.entries(source ?? {})) result[key] = uniqueSorted([...(result[key] ?? []), ...values]);
  return result;
}

function mergeStringMap(target: Record<string, string[]>, value: unknown): void {
  const source = record(value);
  if (!source) return;
  for (const [key, entry] of Object.entries(source)) {
    const values = Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
    if (values.length) target[key] = uniqueSorted([...(target[key] ?? []), ...values]);
  }
}

function firstString(value: Record<string, unknown> | null, keys: string[]): string | null {
  if (!value) return null;
  for (const key of keys) if (typeof value[key] === "string" && (value[key] as string).length) return value[key] as string;
  return null;
}

function audienceFailure(message: string): B0AudienceErrorV1 {
  return new B0AudienceErrorV1("AUDIENCE_RESOLUTION_FAILED", message);
}
