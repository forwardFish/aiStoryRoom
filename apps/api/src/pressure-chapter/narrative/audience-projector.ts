import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type NarrativeProjectionKindV1,
  type NarrativeSourceAuthorityV1,
  type OpenNovelNarrativeProjectionJobV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_NARRATIVE_OUTBOX_ERROR_CODES as ERROR,
  failPressureNarrativeOutbox,
} from "./errors";

type Visibility = "PUBLIC" | "AUTHORIZED";

interface VisibleRecord {
  visibility: Visibility;
  authorizedSeatIds: SeatIdV1[];
}

/**
 * Projects the full committed source into the only DTO that may cross the
 * Provider boundary. Raw source records never leave this class.
 */
export class PressureNarrativeAudienceProjectorV1 {
  project(job: OpenNovelNarrativeProjectionJobV1, value: unknown): unknown {
    const source = record(value, "source");
    exact(source, [
      "schemaVersion", "runId", "projectionKind", "sourceAuthority", "sourceId",
      "sourceCommitHash", "sourceContentHash", "facts", "objects", "knowledge",
      "claims", "publicVariant", "seatVariants",
    ], "source");
    literal(source.schemaVersion, "authoritative_narrative_source_snapshot_v1", "source.schemaVersion");
    for (const field of ["runId", "projectionKind", "sourceAuthority", "sourceId", "sourceCommitHash", "sourceContentHash"] as const) {
      if (source[field] !== job[field]) {
        failPressureNarrativeOutbox(ERROR.AUTHORITY_SOURCE_BINDING_MISMATCH, `source.${field}`);
      }
    }

    const facts = projectFacts(source.facts, job);
    const objects = projectObjects(source.objects, job);
    const knowledge = projectKnowledge(source.knowledge, job);
    const claims = projectClaims(source.claims, job, facts, objects, knowledge);
    const variant = projectVariant(source.publicVariant, source.seatVariants, job);
    assertVariantClaimBindings(variant, claims);
    return {
      schemaVersion: "audience_safe_narrative_source_v1",
      projectionKind: job.projectionKind,
      sourceAuthority: job.sourceAuthority,
      sourceId: job.sourceId,
      sourceCommitHash: job.sourceCommitHash,
      sourceContentHash: job.sourceContentHash,
      audience: structuredClone(job.audience),
      facts,
      objects,
      knowledge,
      allowedClaims: claims,
      variant,
    };
  }
}

function projectFacts(value: unknown, job: OpenNovelNarrativeProjectionJobV1) {
  const result = array(value, "source.facts").map((entry, index) => {
    const path = `source.facts[${index}]`;
    const item = visibleRecord(entry, path, ["factId", "text", "temporalStatus"]);
    text(item.factId, `${path}.factId`);
    text(item.text, `${path}.text`);
    oneOf(item.temporalStatus, ["FROZEN", "COMMITTED_WORKING", "PENDING"], `${path}.temporalStatus`);
    return item;
  }).filter((item) => allowed(item, job.audience));
  assertExactIds(result.map((item) => String(item.factId)), job.allowedFactIds, "facts");
  return result.map(({ factId, text: valueText, temporalStatus }) => ({ factId, text: valueText, temporalStatus }));
}

function projectObjects(value: unknown, job: OpenNovelNarrativeProjectionJobV1) {
  const result = array(value, "source.objects").map((entry, index) => {
    const path = `source.objects[${index}]`;
    const item = visibleRecord(entry, path, ["objectVersionId", "label", "stateText"]);
    for (const field of ["objectVersionId", "label", "stateText"] as const) text(item[field], `${path}.${field}`);
    return item;
  }).filter((item) => allowed(item, job.audience));
  assertExactIds(result.map((item) => String(item.objectVersionId)), job.allowedObjectVersionIds, "objects");
  return result.map(({ objectVersionId, label, stateText }) => ({ objectVersionId, label, stateText }));
}

function projectKnowledge(value: unknown, job: OpenNovelNarrativeProjectionJobV1) {
  const result = array(value, "source.knowledge").map((entry, index) => {
    const path = `source.knowledge[${index}]`;
    const item = visibleRecord(entry, path, ["knowledgeId", "text"]);
    text(item.knowledgeId, `${path}.knowledgeId`);
    text(item.text, `${path}.text`);
    return item;
  }).filter((item) => allowed(item, job.audience));
  assertExactIds(result.map((item) => String(item.knowledgeId)), job.allowedKnowledgeIds, "knowledge");
  return result.map(({ knowledgeId, text: valueText }) => ({ knowledgeId, text: valueText }));
}

function projectClaims(
  value: unknown,
  job: OpenNovelNarrativeProjectionJobV1,
  facts: Array<{ factId: unknown }>,
  objects: Array<{ objectVersionId: unknown }>,
  knowledge: Array<{ knowledgeId: unknown }>,
) {
  const factIds = new Set(facts.map((entry) => String(entry.factId)));
  const objectIds = new Set(objects.map((entry) => String(entry.objectVersionId)));
  const knowledgeIds = new Set(knowledge.map((entry) => String(entry.knowledgeId)));
  const result = array(value, "source.claims").map((entry, index) => {
    const path = `source.claims[${index}]`;
    const item = visibleRecord(entry, path, ["kind", "refId", "statement", "required"]);
    oneOf(item.kind, ["FACT", "OUTCOME", "VERDICT", "OBJECT", "KNOWLEDGE", "TEMPORAL"], `${path}.kind`);
    text(item.refId, `${path}.refId`);
    text(item.statement, `${path}.statement`);
    if (typeof item.required !== "boolean") invalid(`${path}.required`, "BOOLEAN");
    return item;
  }).filter((item) => allowed(item, job.audience));
  result.forEach((item, index) => {
    const path = `projected.claims[${index}]`;
    if (
      (item.kind === "FACT" && !factIds.has(String(item.refId))) ||
      (item.kind === "OBJECT" && !objectIds.has(String(item.refId))) ||
      (item.kind === "KNOWLEDGE" && !knowledgeIds.has(String(item.refId)))
    ) invalid(`${path}.refId`, "NOT_IN_PROJECTED_AUDIENCE");
  });
  const projectedKeys = result.map((item) => `${String(item.kind)}\u0000${String(item.refId)}`);
  assertOrderedUnique(projectedKeys, "claims");
  return result.map(({ kind, refId, statement, required }) => ({ kind, refId, statement, required }));
}

function projectVariant(
  publicVariant: unknown,
  seatVariantsValue: unknown,
  job: OpenNovelNarrativeProjectionJobV1,
): unknown {
  if (job.audience.kind === "PUBLIC") {
    return validateVariant(publicVariant, job.projectionKind, job.sourceAuthority, "PUBLIC");
  }
  const variants = array(seatVariantsValue, "source.seatVariants");
  let selected: unknown;
  let previousRank = -1;
  for (let index = 0; index < variants.length; index += 1) {
    const path = `source.seatVariants[${index}]`;
    const item = record(variants[index], path);
    exact(item, ["seatId", "variant"], path);
    seat(item.seatId, `${path}.seatId`);
    const rank = PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(item.seatId);
    if (rank <= previousRank) invalid("source.seatVariants", "ORDER_OR_DUPLICATE");
    previousRank = rank;
    if (item.seatId === job.audience.seatId) selected = item.variant;
  }
  if (selected === undefined) invalid("source.seatVariants", "VIEWER_VARIANT_MISSING");
  return validateVariant(selected, job.projectionKind, job.sourceAuthority, "SEAT");
}

function assertVariantClaimBindings(
  variantValue: unknown,
  claims: Array<{ kind: unknown; refId: unknown }>,
): void {
  const variant = record(variantValue, "projected.variant");
  if (variant.kind !== "FINALE") return;
  const keys = new Set(claims.map((claim) => `${String(claim.kind)}\u0000${String(claim.refId)}`));
  if (!keys.has(`OUTCOME\u0000${String(variant.worldOutcomeRef)}`)) {
    invalid("projected.variant.worldOutcomeRef", "OUTCOME_CLAIM_MISSING");
  }
  if (
    variant.viewerVerdictRef !== null &&
    !keys.has(`VERDICT\u0000${String(variant.viewerVerdictRef)}`)
  ) invalid("projected.variant.viewerVerdictRef", "VERDICT_CLAIM_MISSING");
}

function validateVariant(
  value: unknown,
  kind: NarrativeProjectionKindV1,
  authority: NarrativeSourceAuthorityV1,
  audienceKind: "PUBLIC" | "SEAT",
): unknown {
  const variant = record(value, "variant");
  if (kind === "GENESIS_NARRATIVE") {
    exact(variant, ["kind", "stageId", "openingHook"], "variant");
    literal(variant.kind, "GENESIS", "variant.kind");
    literal(variant.stageId, "P0", "variant.stageId");
    text(variant.openingHook, "variant.openingHook");
  } else if (kind === "BEAT_NARRATIVE") {
    exact(variant, ["kind", "chapterId", "workingRevision", "temporalBoundary"], "variant");
    literal(variant.kind, "BEAT", "variant.kind");
    chapter(variant.chapterId, "variant.chapterId");
    integer(variant.workingRevision, "variant.workingRevision", 1, Number.MAX_SAFE_INTEGER);
    literal(variant.temporalBoundary, "WORKING_NOT_FROZEN", "variant.temporalBoundary");
  } else if (kind === "CHAPTER_NARRATIVE") {
    exact(variant, ["kind", "chapterId", "committedWorldSequence", "nextChapterId"], "variant");
    literal(variant.kind, "CHAPTER", "variant.kind");
    const current = chapter(variant.chapterId, "variant.chapterId");
    integer(variant.committedWorldSequence, "variant.committedWorldSequence", 1, 7);
    if (variant.committedWorldSequence !== Number(current.slice(1))) invalid("variant.committedWorldSequence", "CHAPTER_SEQUENCE_MISMATCH");
    if (variant.nextChapterId !== null) chapter(variant.nextChapterId, "variant.nextChapterId");
  } else {
    exact(variant, ["kind", "terminalKind", "worldOutcomeRef", "viewerVerdictRef"], "variant");
    literal(variant.kind, "FINALE", "variant.kind");
    const terminal = oneOf(variant.terminalKind, ["PRESSURE_FINALE", "LEGACY_TERMINAL"], "variant.terminalKind");
    if ((terminal === "PRESSURE_FINALE") !== (authority === "FINALE_FROZEN")) invalid("variant.terminalKind", "AUTHORITY_MISMATCH");
    text(variant.worldOutcomeRef, "variant.worldOutcomeRef");
    if (variant.viewerVerdictRef !== null) text(variant.viewerVerdictRef, "variant.viewerVerdictRef");
    if (
      (audienceKind === "PUBLIC" && variant.viewerVerdictRef !== null) ||
      (audienceKind === "SEAT" && variant.viewerVerdictRef === null)
    ) invalid("variant.viewerVerdictRef", "AUDIENCE_MISMATCH");
  }
  return structuredClone(variant);
}

function visibleRecord(value: unknown, path: string, contentKeys: readonly string[]): Record<string, unknown> & VisibleRecord {
  const item = record(value, path);
  exact(item, [...contentKeys, "visibility", "authorizedSeatIds"], path);
  const visibility = oneOf(item.visibility, ["PUBLIC", "AUTHORIZED"], `${path}.visibility`);
  if (!Array.isArray(item.authorizedSeatIds)) invalid(`${path}.authorizedSeatIds`, "ARRAY");
  let previousRank = -1;
  item.authorizedSeatIds.forEach((entry, index) => {
    seat(entry, `${path}.authorizedSeatIds[${index}]`);
    const rank = PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(entry);
    if (rank <= previousRank) invalid(`${path}.authorizedSeatIds`, "ORDER_OR_DUPLICATE");
    previousRank = rank;
  });
  if ((visibility === "PUBLIC") !== (item.authorizedSeatIds.length === 0)) {
    invalid(path, "VISIBILITY_AUDIENCE_MISMATCH");
  }
  return item as Record<string, unknown> & VisibleRecord;
}

function allowed(item: VisibleRecord, audience: OpenNovelNarrativeProjectionJobV1["audience"]): boolean {
  return item.visibility === "PUBLIC" || (
    audience.kind === "SEAT" && audience.seatId !== null && item.authorizedSeatIds.includes(audience.seatId)
  );
}

function assertExactIds(actual: string[], expected: string[], path: string): void {
  assertOrderedUnique(actual, path);
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    failPressureNarrativeOutbox(ERROR.AUDIENCE_PROJECTION_VIOLATION, path, "JOB_ALLOWLIST_MISMATCH");
  }
}

function assertOrderedUnique(values: string[], path: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) invalid(path, "ORDER_OR_DUPLICATE");
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(path, "PLAIN_OBJECT");
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "ARRAY");
  return value;
}
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}
function literal<T>(value: unknown, expected: T, path: string): void {
  if (value !== expected) invalid(path, `EXPECTED_${String(expected)}`);
}
function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(path, "NON_EMPTY_STRING");
}
function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(path, `ALLOWED_${allowed.join("|")}`);
  return value as T[number];
}
function seat(value: unknown, path: string): asserts value is SeatIdV1 {
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(value as never)) invalid(path, "SEAT_ID");
}
function chapter(value: unknown, path: string): "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7" {
  return oneOf(value, ["N1", "N2", "N3", "N4", "N5", "N6", "N7"], path);
}
function integer(value: unknown, path: string, min: number, max: number): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) invalid(path, `INTEGER_${min}_${max}`);
}
function invalid(path: string, detail?: string): never {
  failPressureNarrativeOutbox(ERROR.AUTHORITY_SOURCE_INVALID, path, detail);
}
