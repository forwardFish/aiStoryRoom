import { sha256Canonical } from "@ai-story/shared";
import type {
  NarrativeContextV1,
} from "@apps/openovel-runtime/pressure-narrative/contracts";
import type {
  NarrativeProviderPortV1,
} from "@apps/openovel-runtime/pressure-narrative/ports";
import {
  PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureNarrativeProduction,
} from "./errors";

const CONTEXT_FIELDS = Object.freeze([
  "schemaVersion",
  "contextCompilerVersion",
  "projectionKind",
  "audience",
  "sourceId",
  "sourceCommitHash",
  "sourceContentHash",
  "temporalInstruction",
  "facts",
  "objects",
  "knowledge",
  "allowedClaims",
  "variant",
  "contextHash",
] as const);

/**
 * The only external Provider boundary. It accepts a compiled audience-safe
 * context and has no access to raw Genesis/Working/Frozen/Finale records.
 */
export class PressureNarrativeProviderBoundaryV1
implements NarrativeProviderPortV1 {
  readonly configured: boolean;

  constructor(private readonly provider: NarrativeProviderPortV1 | null) {
    this.configured = provider !== null;
  }

  async render(contextValue: NarrativeContextV1): Promise<unknown> {
    const context = validateProviderContextV1(contextValue);
    if (!this.provider) {
      return failPressureNarrativeProduction(
        ERROR.PRODUCTION_CONFIG_INVALID,
        "provider",
        "NOT_CONFIGURED",
      );
    }
    return this.provider.render(structuredClone(context));
  }
}

export function validateProviderContextV1(value: unknown): NarrativeContextV1 {
  const context = record(value, "providerContext");
  exact(context, CONTEXT_FIELDS, "providerContext");
  if (context.schemaVersion !== "pressure_narrative_context_v1") {
    invalid("providerContext.schemaVersion");
  }
  for (const field of [
    "contextCompilerVersion",
    "sourceId",
    "temporalInstruction",
  ] as const) text(context[field], `providerContext.${field}`);
  for (const field of ["sourceCommitHash", "sourceContentHash"] as const) {
    hash(context[field], `providerContext.${field}`);
  }
  oneOf(context.projectionKind, [
    "GENESIS_NARRATIVE",
    "BEAT_NARRATIVE",
    "CHAPTER_NARRATIVE",
    "FINALE_NARRATIVE",
  ], "providerContext.projectionKind");
  validateAudience(context.audience);
  validateSafeEntries(context.facts, ["factId", "text", "temporalStatus"], "facts");
  validateSafeEntries(context.objects, ["objectVersionId", "label", "stateText"], "objects");
  validateSafeEntries(context.knowledge, ["knowledgeId", "text"], "knowledge");
  validateSafeEntries(context.allowedClaims, [
    "kind",
    "refId",
    "statement",
    "required",
  ], "allowedClaims");
  record(context.variant, "providerContext.variant");
  rejectForbiddenKeys(context, "providerContext");
  hash(context.contextHash, "providerContext.contextHash");
  const content = Object.fromEntries(
    Object.entries(context).filter(([field]) => field !== "contextHash"),
  );
  if (sha256Canonical(content) !== context.contextHash) {
    invalid("providerContext.contextHash", "HASH_MISMATCH");
  }
  return structuredClone(context) as unknown as NarrativeContextV1;
}

function validateAudience(value: unknown): void {
  const audience = record(value, "providerContext.audience");
  exact(audience, ["kind", "seatId"], "providerContext.audience");
  if (audience.kind === "PUBLIC") {
    if (audience.seatId !== null) invalid("providerContext.audience.seatId");
    return;
  }
  if (audience.kind !== "SEAT" || typeof audience.seatId !== "string") {
    invalid("providerContext.audience");
  }
}

function validateSafeEntries(
  value: unknown,
  fields: readonly string[],
  path: string,
): void {
  if (!Array.isArray(value)) invalid(`providerContext.${path}`, "ARRAY");
  value.forEach((entry, index) => {
    const itemPath = `providerContext.${path}[${index}]`;
    const item = record(entry, itemPath);
    exact(item, fields, itemPath);
  });
}

function rejectForbiddenKeys(value: unknown, path: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbiddenKeys(entry, `${path}[${index}]`));
    return;
  }
  for (const [field, entry] of Object.entries(value as Record<string, unknown>)) {
    if ([
      "rawAuthority",
      "seatVariants",
      "authorizedSeatIds",
      "visibility",
      "privatePayload",
      "sixSeatOutcomes",
    ].includes(field)) {
      invalid(`${path}.${field}`, "RAW_OR_UNFILTERED_AUTHORITY_FORBIDDEN");
    }
    rejectForbiddenKeys(entry, `${path}.${field}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) return invalid(path, "PLAIN_OBJECT");
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = fields.find((field) => !(field in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
}

function hash(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    invalid(path, "SHA256_LOWER_HEX");
  }
}

function oneOf(
  value: unknown,
  values: readonly string[],
  path: string,
): void {
  if (typeof value !== "string" || !values.includes(value)) invalid(path, "ENUM");
}

function invalid(path: string, detail?: string): never {
  return failPressureNarrativeProduction(
    ERROR.PROVIDER_BOUNDARY_VIOLATION,
    path,
    detail,
  );
}
