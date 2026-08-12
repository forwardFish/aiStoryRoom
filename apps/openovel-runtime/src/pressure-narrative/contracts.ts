import { hashNarrativeValue } from "./canonical.js";
import {
  PRESSURE_NARRATIVE_ERROR_CODES as ERROR,
  failPressureNarrative,
} from "./errors.js";
import { assertPressureNarrativeOutputSurfaceV1 } from "./output-surface-guard.js";

export const PRESSURE_NARRATIVE_SEAT_IDS = Object.freeze([
  "cabinet_finance",
  "jiangnan_merchant",
  "qingliu_law",
  "sili_weaving",
  "zhejiang_administration",
  "zhejiang_governor",
] as const);

export type NarrativeSeatIdV1 = (typeof PRESSURE_NARRATIVE_SEAT_IDS)[number];
export type NarrativeProjectionKindV1 =
  | "GENESIS_NARRATIVE"
  | "BEAT_NARRATIVE"
  | "CHAPTER_NARRATIVE"
  | "FINALE_NARRATIVE";
export type NarrativeSourceAuthorityV1 =
  | "GENESIS_FROZEN"
  | "CHAPTER_WORKING"
  | "CHAPTER_FROZEN"
  | "FINALE_FROZEN"
  | "LEGACY_TERMINAL_COMMITTED";

export interface NarrativeAudienceV1 {
  kind: "PUBLIC" | "SEAT";
  seatId: NarrativeSeatIdV1 | null;
}

/** Structural mirror of the canonical shared PC-W0 wire job. */
export interface NarrativeProjectionJobV1 {
  schemaVersion: "openovel_narrative_projection_job_v1";
  jobId: string;
  runId: string;
  audience: NarrativeAudienceV1;
  sourceRuntimeProfile: string;
  projectionKind: NarrativeProjectionKindV1;
  sourceAuthority: NarrativeSourceAuthorityV1;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  allowedFactIds: string[];
  allowedObjectVersionIds: string[];
  allowedKnowledgeIds: string[];
  narrativeProfileVersion: string;
  idempotencyKey: string;
}

export interface AudienceSafeFactV1 {
  factId: string;
  text: string;
  temporalStatus: "FROZEN" | "COMMITTED_WORKING" | "PENDING";
}

export interface AudienceSafeObjectV1 {
  objectVersionId: string;
  label: string;
  stateText: string;
}

export interface AudienceSafeKnowledgeV1 {
  knowledgeId: string;
  text: string;
}

export interface AudienceSafeClaimV1 {
  kind: "FACT" | "OUTCOME" | "VERDICT" | "OBJECT" | "KNOWLEDGE" | "TEMPORAL";
  refId: string;
  statement: string;
  required: boolean;
}

export type NarrativeSourceVariantV1 =
  | { kind: "GENESIS"; stageId: "P0"; openingHook: string }
  | {
      kind: "BEAT";
      chapterId: "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
      workingRevision: number;
      temporalBoundary: "WORKING_NOT_FROZEN";
    }
  | {
      kind: "CHAPTER";
      chapterId: "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
      committedWorldSequence: number;
      nextChapterId: "N2" | "N3" | "N4" | "N5" | "N6" | "N7" | null;
    }
  | {
      kind: "FINALE";
      terminalKind: "PRESSURE_FINALE" | "LEGACY_TERMINAL";
      worldOutcomeRef: string;
      viewerVerdictRef: string | null;
    };

export interface AudienceSafeNarrativeSourceV1 {
  schemaVersion: "audience_safe_narrative_source_v1";
  projectionKind: NarrativeProjectionKindV1;
  sourceAuthority: NarrativeSourceAuthorityV1;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  audience: NarrativeAudienceV1;
  facts: AudienceSafeFactV1[];
  objects: AudienceSafeObjectV1[];
  knowledge: AudienceSafeKnowledgeV1[];
  allowedClaims: AudienceSafeClaimV1[];
  variant: NarrativeSourceVariantV1;
}

export interface NarrativeContextV1 {
  schemaVersion: "pressure_narrative_context_v1";
  contextCompilerVersion: string;
  projectionKind: NarrativeProjectionKindV1;
  audience: NarrativeAudienceV1;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  temporalInstruction: string;
  facts: AudienceSafeFactV1[];
  objects: AudienceSafeObjectV1[];
  knowledge: AudienceSafeKnowledgeV1[];
  allowedClaims: AudienceSafeClaimV1[];
  variant: NarrativeSourceVariantV1;
  contextHash: string;
}

export interface NarrativeCandidateClaimV1 {
  kind: AudienceSafeClaimV1["kind"];
  refId: string;
  statement: string;
}

export interface NarrativeRenderCandidateV1 {
  text: string;
  usedFactRefs: string[];
  claims: NarrativeCandidateClaimV1[];
}

export interface NarrativeTruthReportV1 {
  accepted: boolean;
  guardVersion: string;
  issueCodes: string[];
  usedFactRefs: string[];
  reportHash: string;
}

export interface NarrativeProfileV1 {
  profileVersion: string;
  projectorVersion: string;
  contextCompilerVersion: string;
  truthGuardVersion: string;
  fallbackTemplateVersion: string;
  maxProviderAttempts: number;
  retryBackoffMs: number[];
  providerTimeoutMs: number;
  leaseMs: number;
  providerEnabled: boolean;
  maxDeliveryFailures: number;
}

export interface NarrativeArtifactV1 {
  schemaVersion: "openovel_narrative_artifact_v1";
  jobId: string;
  runId: string;
  projectionKind: NarrativeProjectionKindV1;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  audience: NarrativeAudienceV1;
  narrativeProfileVersion: string;
  projectorVersion: string;
  text: string;
  usedFactRefs: string[];
  validationReportHash: string;
  contentHash: string;
  renderMode: "PROVIDER" | "AUTHORED_FALLBACK";
  status: "PUBLISHED" | "FALLBACK_PUBLISHED";
}

export function validateNarrativeProjectionJobV1(value: unknown): NarrativeProjectionJobV1 {
  const job = object(value, "job", ERROR.JOB_INVALID);
  exact(job, [
    "schemaVersion", "jobId", "runId", "audience", "sourceRuntimeProfile",
    "projectionKind", "sourceAuthority", "sourceId", "sourceCommitHash",
    "sourceContentHash", "allowedFactIds", "allowedObjectVersionIds",
    "allowedKnowledgeIds", "narrativeProfileVersion", "idempotencyKey",
  ], "job", ERROR.JOB_INVALID);
  literal(job.schemaVersion, "openovel_narrative_projection_job_v1", "job.schemaVersion", ERROR.JOB_INVALID);
  for (const field of ["jobId", "runId", "sourceRuntimeProfile", "sourceId", "idempotencyKey"] as const) {
    string(job[field], `job.${field}`, ERROR.JOB_INVALID);
  }
  version(job.narrativeProfileVersion, "job.narrativeProfileVersion", ERROR.JOB_INVALID);
  validateAudience(job.audience, "job.audience", ERROR.JOB_INVALID);
  const kind = projectionKind(job.projectionKind, "job.projectionKind", ERROR.JOB_INVALID);
  const authority = sourceAuthority(job.sourceAuthority, "job.sourceAuthority", ERROR.JOB_INVALID);
  assertKindAuthority(kind, authority, "job.sourceAuthority", ERROR.JOB_INVALID);
  hash(job.sourceCommitHash, "job.sourceCommitHash", ERROR.JOB_INVALID);
  hash(job.sourceContentHash, "job.sourceContentHash", ERROR.JOB_INVALID);
  sortedStrings(job.allowedFactIds, "job.allowedFactIds", ERROR.JOB_INVALID);
  sortedStrings(job.allowedObjectVersionIds, "job.allowedObjectVersionIds", ERROR.JOB_INVALID);
  sortedStrings(job.allowedKnowledgeIds, "job.allowedKnowledgeIds", ERROR.JOB_INVALID);
  return structuredClone(job) as unknown as NarrativeProjectionJobV1;
}

export function validateAudienceSafeNarrativeSourceV1(
  value: unknown,
  job: NarrativeProjectionJobV1,
): AudienceSafeNarrativeSourceV1 {
  const source = object(value, "source", ERROR.AUDIENCE_SOURCE_INVALID);
  exact(source, [
    "schemaVersion", "projectionKind", "sourceAuthority", "sourceId",
    "sourceCommitHash", "sourceContentHash", "audience", "facts", "objects",
    "knowledge", "allowedClaims", "variant",
  ], "source", ERROR.AUDIENCE_SOURCE_INVALID);
  literal(source.schemaVersion, "audience_safe_narrative_source_v1", "source.schemaVersion", ERROR.AUDIENCE_SOURCE_INVALID);
  const kind = projectionKind(source.projectionKind, "source.projectionKind", ERROR.AUDIENCE_SOURCE_INVALID);
  const authority = sourceAuthority(source.sourceAuthority, "source.sourceAuthority", ERROR.AUDIENCE_SOURCE_INVALID);
  validateAudience(source.audience, "source.audience", ERROR.AUDIENCE_SOURCE_INVALID);
  for (const field of ["sourceId", "sourceCommitHash", "sourceContentHash"] as const) {
    if (!deepEqual(source[field], job[field])) {
      failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, `source.${field}`);
    }
  }
  if (
    kind !== job.projectionKind || authority !== job.sourceAuthority ||
    !deepEqual(source.audience, job.audience)
  ) failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, "source", "JOB_BINDING");
  assertKindAuthority(kind, authority, "source.sourceAuthority", ERROR.AUDIENCE_SOURCE_INVALID);

  const facts = array(source.facts, "source.facts", ERROR.AUDIENCE_SOURCE_INVALID).map((entry, index) => {
    const path = `source.facts[${index}]`;
    const fact = object(entry, path, ERROR.AUDIENCE_SOURCE_INVALID);
    exact(fact, ["factId", "text", "temporalStatus"], path, ERROR.AUDIENCE_SOURCE_INVALID);
    string(fact.factId, `${path}.factId`, ERROR.AUDIENCE_SOURCE_INVALID);
    string(fact.text, `${path}.text`, ERROR.AUDIENCE_SOURCE_INVALID);
    oneOf(fact.temporalStatus, ["FROZEN", "COMMITTED_WORKING", "PENDING"], `${path}.temporalStatus`, ERROR.AUDIENCE_SOURCE_INVALID);
    if (!job.allowedFactIds.includes(String(fact.factId))) failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, `${path}.factId`, "NOT_JOB_ALLOWED");
    return fact;
  });
  ordered(facts, (entry) => String(entry.factId), "source.facts", ERROR.AUDIENCE_SOURCE_INVALID);

  const objects = validateSafeTextEntries(source.objects, "source.objects", "objectVersionId", ["objectVersionId", "label", "stateText"]);
  objects.forEach((entry, index) => {
    if (!job.allowedObjectVersionIds.includes(String(entry.objectVersionId))) {
      failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, `source.objects[${index}].objectVersionId`, "NOT_JOB_ALLOWED");
    }
  });
  const knowledge = validateSafeTextEntries(source.knowledge, "source.knowledge", "knowledgeId", ["knowledgeId", "text"]);
  knowledge.forEach((entry, index) => {
    if (!job.allowedKnowledgeIds.includes(String(entry.knowledgeId))) {
      failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, `source.knowledge[${index}].knowledgeId`, "NOT_JOB_ALLOWED");
    }
  });
  validateAllowedClaims(source.allowedClaims, facts, objects, knowledge);
  validateVariant(source.variant, kind, authority, job.audience);
  validateVariantClaimBindings(source.variant, source.allowedClaims);
  return structuredClone(source) as unknown as AudienceSafeNarrativeSourceV1;
}

export function validateNarrativeProfileV1(value: unknown, expectedVersion: string): NarrativeProfileV1 {
  const profile = object(value, "profile", ERROR.PROFILE_UNAVAILABLE);
  exact(profile, [
    "profileVersion", "projectorVersion", "contextCompilerVersion", "truthGuardVersion",
    "fallbackTemplateVersion", "maxProviderAttempts", "retryBackoffMs",
    "providerTimeoutMs", "leaseMs", "providerEnabled", "maxDeliveryFailures",
  ], "profile", ERROR.PROFILE_UNAVAILABLE);
  literal(profile.profileVersion, expectedVersion, "profile.profileVersion", ERROR.PROFILE_UNAVAILABLE);
  for (const field of ["projectorVersion", "contextCompilerVersion", "truthGuardVersion", "fallbackTemplateVersion"] as const) {
    version(profile[field], `profile.${field}`, ERROR.PROFILE_UNAVAILABLE);
  }
  integer(profile.maxProviderAttempts, "profile.maxProviderAttempts", 1, 10);
  const backoff = array(profile.retryBackoffMs, "profile.retryBackoffMs", ERROR.PROFILE_UNAVAILABLE);
  if (backoff.length !== Number(profile.maxProviderAttempts) - 1) failPressureNarrative(ERROR.PROFILE_UNAVAILABLE, "profile.retryBackoffMs", "ATTEMPT_COUNT_MISMATCH");
  backoff.forEach((entry, index) => integer(entry, `profile.retryBackoffMs[${index}]`, 0, 86_400_000));
  integer(profile.providerTimeoutMs, "profile.providerTimeoutMs", 1, 300_000);
  integer(profile.leaseMs, "profile.leaseMs", 1, 3_600_000);
  if (typeof profile.providerEnabled !== "boolean") failPressureNarrative(ERROR.PROFILE_UNAVAILABLE, "profile.providerEnabled", "BOOLEAN");
  integer(profile.maxDeliveryFailures, "profile.maxDeliveryFailures", 1, 100);
  return structuredClone(profile) as unknown as NarrativeProfileV1;
}

export function validateNarrativeRenderCandidateV1(value: unknown): NarrativeRenderCandidateV1 {
  const candidate = object(value, "candidate", ERROR.PROVIDER_OUTPUT_INVALID);
  exact(candidate, ["text", "usedFactRefs", "claims"], "candidate", ERROR.PROVIDER_OUTPUT_INVALID);
  string(candidate.text, "candidate.text", ERROR.PROVIDER_EMPTY);
  sortedStrings(candidate.usedFactRefs, "candidate.usedFactRefs", ERROR.PROVIDER_OUTPUT_INVALID);
  const claims = array(candidate.claims, "candidate.claims", ERROR.PROVIDER_OUTPUT_INVALID).map((entry, index) => {
    const path = `candidate.claims[${index}]`;
    const claim = object(entry, path, ERROR.PROVIDER_OUTPUT_INVALID);
    exact(claim, ["kind", "refId", "statement"], path, ERROR.PROVIDER_OUTPUT_INVALID);
    oneOf(claim.kind, ["FACT", "OUTCOME", "VERDICT", "OBJECT", "KNOWLEDGE", "TEMPORAL"], `${path}.kind`, ERROR.PROVIDER_OUTPUT_INVALID);
    string(claim.refId, `${path}.refId`, ERROR.PROVIDER_OUTPUT_INVALID);
    string(claim.statement, `${path}.statement`, ERROR.PROVIDER_OUTPUT_INVALID);
    return claim;
  });
  ordered(claims, (claim) => `${String(claim.kind)}\u0000${String(claim.refId)}`, "candidate.claims", ERROR.PROVIDER_OUTPUT_INVALID);
  return structuredClone(candidate) as unknown as NarrativeRenderCandidateV1;
}

export function computeNarrativeProjectionFingerprint(
  job: NarrativeProjectionJobV1,
  projectorVersion: string,
): string {
  return hashNarrativeValue({
    projectionKind: job.projectionKind,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion,
    audience: job.audience,
  });
}

/** The logical uniqueness boundary mandated by the final Pressure contract. */
export function computeNarrativeLogicalProjectionKey(
  job: Pick<NarrativeProjectionJobV1, "sourceCommitHash" | "audience" | "projectionKind">,
): string {
  return hashNarrativeValue({
    sourceCommitHash: job.sourceCommitHash,
    audience: job.audience,
    projectionKind: job.projectionKind,
  });
}

export function computeNarrativeArtifactContentHash(
  artifact: Pick<NarrativeArtifactV1, "text" | "usedFactRefs">,
): string {
  return hashNarrativeValue({
    text: artifact.text,
    usedFactRefs: artifact.usedFactRefs,
  });
}

export function validateNarrativeArtifactV1(
  value: unknown,
  job?: NarrativeProjectionJobV1,
): NarrativeArtifactV1 {
  const artifact = object(value, "artifact", ERROR.PROVIDER_OUTPUT_INVALID);
  exact(artifact, [
    "schemaVersion", "jobId", "runId", "projectionKind", "sourceId",
    "sourceCommitHash", "sourceContentHash", "audience", "narrativeProfileVersion",
    "projectorVersion", "text", "usedFactRefs", "validationReportHash",
    "contentHash", "renderMode", "status",
  ], "artifact", ERROR.PROVIDER_OUTPUT_INVALID);
  literal(artifact.schemaVersion, "openovel_narrative_artifact_v1", "artifact.schemaVersion", ERROR.PROVIDER_OUTPUT_INVALID);
  for (const field of ["jobId", "runId", "sourceId"] as const) {
    string(artifact[field], `artifact.${field}`, ERROR.PROVIDER_OUTPUT_INVALID);
  }
  version(artifact.narrativeProfileVersion, "artifact.narrativeProfileVersion", ERROR.PROVIDER_OUTPUT_INVALID);
  version(artifact.projectorVersion, "artifact.projectorVersion", ERROR.PROVIDER_OUTPUT_INVALID);
  string(artifact.text, "artifact.text", ERROR.PROVIDER_EMPTY);
  assertPressureNarrativeOutputSurfaceV1(String(artifact.text), "artifact.text");
  projectionKind(artifact.projectionKind, "artifact.projectionKind", ERROR.PROVIDER_OUTPUT_INVALID);
  validateAudience(artifact.audience, "artifact.audience", ERROR.PROVIDER_OUTPUT_INVALID);
  hash(artifact.sourceCommitHash, "artifact.sourceCommitHash", ERROR.PROVIDER_OUTPUT_INVALID);
  hash(artifact.sourceContentHash, "artifact.sourceContentHash", ERROR.PROVIDER_OUTPUT_INVALID);
  hash(artifact.validationReportHash, "artifact.validationReportHash", ERROR.PROVIDER_OUTPUT_INVALID);
  hash(artifact.contentHash, "artifact.contentHash", ERROR.PROVIDER_OUTPUT_INVALID);
  sortedStrings(artifact.usedFactRefs, "artifact.usedFactRefs", ERROR.PROVIDER_OUTPUT_INVALID);
  const renderMode = oneOf(artifact.renderMode, ["PROVIDER", "AUTHORED_FALLBACK"], "artifact.renderMode", ERROR.PROVIDER_OUTPUT_INVALID);
  const status = oneOf(artifact.status, ["PUBLISHED", "FALLBACK_PUBLISHED"], "artifact.status", ERROR.PROVIDER_OUTPUT_INVALID);
  if (
    (renderMode === "PROVIDER" && status !== "PUBLISHED") ||
    (renderMode === "AUTHORED_FALLBACK" && status !== "FALLBACK_PUBLISHED")
  ) failPressureNarrative(ERROR.PROVIDER_OUTPUT_INVALID, "artifact.status", "RENDER_MODE_STATUS_MISMATCH");
  const typed = structuredClone(artifact) as unknown as NarrativeArtifactV1;
  if (typed.contentHash !== computeNarrativeArtifactContentHash(typed)) {
    failPressureNarrative(ERROR.PROVIDER_OUTPUT_INVALID, "artifact.contentHash", "HASH_MISMATCH");
  }
  if (job) {
    for (const field of [
      "jobId", "runId", "projectionKind", "sourceId", "sourceCommitHash",
      "sourceContentHash", "narrativeProfileVersion",
    ] as const) {
      if (typed[field] !== job[field]) {
        failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, `artifact.${field}`, "JOB_BINDING");
      }
    }
    if (!deepEqual(typed.audience, job.audience)) {
      failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, "artifact.audience", "JOB_BINDING");
    }
    const allowedFacts = new Set(job.allowedFactIds);
    if (typed.usedFactRefs.some((ref) => !allowedFacts.has(ref))) {
      failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, "artifact.usedFactRefs", "NOT_JOB_ALLOWED");
    }
  }
  return typed;
}

function validateSafeTextEntries(
  value: unknown,
  path: string,
  idField: string,
  fields: readonly string[],
): Record<string, unknown>[] {
  const entries = array(value, path, ERROR.AUDIENCE_SOURCE_INVALID).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = object(entry, itemPath, ERROR.AUDIENCE_SOURCE_INVALID);
    exact(item, fields, itemPath, ERROR.AUDIENCE_SOURCE_INVALID);
    fields.forEach((field) => string(item[field], `${itemPath}.${field}`, ERROR.AUDIENCE_SOURCE_INVALID));
    return item;
  });
  ordered(entries, (entry) => String(entry[idField]), path, ERROR.AUDIENCE_SOURCE_INVALID);
  return entries;
}

function validateAllowedClaims(
  value: unknown,
  facts: Record<string, unknown>[],
  objects: Record<string, unknown>[],
  knowledge: Record<string, unknown>[],
): void {
  const factIds = new Set(facts.map((entry) => String(entry.factId)));
  const objectIds = new Set(objects.map((entry) => String(entry.objectVersionId)));
  const knowledgeIds = new Set(knowledge.map((entry) => String(entry.knowledgeId)));
  const claims = array(value, "source.allowedClaims", ERROR.AUDIENCE_SOURCE_INVALID).map((entry, index) => {
    const path = `source.allowedClaims[${index}]`;
    const claim = object(entry, path, ERROR.AUDIENCE_SOURCE_INVALID);
    exact(claim, ["kind", "refId", "statement", "required"], path, ERROR.AUDIENCE_SOURCE_INVALID);
    const kind = oneOf(claim.kind, ["FACT", "OUTCOME", "VERDICT", "OBJECT", "KNOWLEDGE", "TEMPORAL"], `${path}.kind`, ERROR.AUDIENCE_SOURCE_INVALID);
    string(claim.refId, `${path}.refId`, ERROR.AUDIENCE_SOURCE_INVALID);
    string(claim.statement, `${path}.statement`, ERROR.AUDIENCE_SOURCE_INVALID);
    if (typeof claim.required !== "boolean") failPressureNarrative(ERROR.AUDIENCE_SOURCE_INVALID, `${path}.required`, "BOOLEAN");
    const refId = String(claim.refId);
    if (
      (kind === "FACT" && !factIds.has(refId)) ||
      (kind === "OBJECT" && !objectIds.has(refId)) ||
      (kind === "KNOWLEDGE" && !knowledgeIds.has(refId))
    ) failPressureNarrative(ERROR.AUDIENCE_SOURCE_INVALID, `${path}.refId`, "UNKNOWN_SAFE_REFERENCE");
    return claim;
  });
  ordered(claims, (claim) => `${String(claim.kind)}\u0000${String(claim.refId)}`, "source.allowedClaims", ERROR.AUDIENCE_SOURCE_INVALID);
}

function validateVariant(
  value: unknown,
  kind: NarrativeProjectionKindV1,
  authority: NarrativeSourceAuthorityV1,
  audience: NarrativeAudienceV1,
): void {
  const variant = object(value, "source.variant", ERROR.AUDIENCE_SOURCE_INVALID);
  if (kind === "GENESIS_NARRATIVE") {
    exact(variant, ["kind", "stageId", "openingHook"], "source.variant", ERROR.AUDIENCE_SOURCE_INVALID);
    literal(variant.kind, "GENESIS", "source.variant.kind", ERROR.AUDIENCE_SOURCE_INVALID);
    literal(variant.stageId, "P0", "source.variant.stageId", ERROR.AUDIENCE_SOURCE_INVALID);
    string(variant.openingHook, "source.variant.openingHook", ERROR.AUDIENCE_SOURCE_INVALID);
    return;
  }
  if (kind === "BEAT_NARRATIVE") {
    exact(variant, ["kind", "chapterId", "workingRevision", "temporalBoundary"], "source.variant", ERROR.AUDIENCE_SOURCE_INVALID);
    literal(variant.kind, "BEAT", "source.variant.kind", ERROR.AUDIENCE_SOURCE_INVALID);
    chapter(variant.chapterId, "source.variant.chapterId");
    integer(variant.workingRevision, "source.variant.workingRevision", 1, Number.MAX_SAFE_INTEGER, ERROR.AUDIENCE_SOURCE_INVALID);
    literal(variant.temporalBoundary, "WORKING_NOT_FROZEN", "source.variant.temporalBoundary", ERROR.AUDIENCE_SOURCE_INVALID);
    return;
  }
  if (kind === "CHAPTER_NARRATIVE") {
    exact(variant, ["kind", "chapterId", "committedWorldSequence", "nextChapterId"], "source.variant", ERROR.AUDIENCE_SOURCE_INVALID);
    literal(variant.kind, "CHAPTER", "source.variant.kind", ERROR.AUDIENCE_SOURCE_INVALID);
    const current = chapter(variant.chapterId, "source.variant.chapterId");
    integer(variant.committedWorldSequence, "source.variant.committedWorldSequence", 1, 7, ERROR.AUDIENCE_SOURCE_INVALID);
    if (Number(variant.committedWorldSequence) !== Number(current.slice(1))) failPressureNarrative(ERROR.AUDIENCE_SOURCE_INVALID, "source.variant.committedWorldSequence", "CHAPTER_SEQUENCE_MISMATCH");
    if (variant.nextChapterId !== null) chapter(variant.nextChapterId, "source.variant.nextChapterId");
    return;
  }
  exact(variant, ["kind", "terminalKind", "worldOutcomeRef", "viewerVerdictRef"], "source.variant", ERROR.AUDIENCE_SOURCE_INVALID);
  literal(variant.kind, "FINALE", "source.variant.kind", ERROR.AUDIENCE_SOURCE_INVALID);
  const terminalKind = oneOf(variant.terminalKind, ["PRESSURE_FINALE", "LEGACY_TERMINAL"], "source.variant.terminalKind", ERROR.AUDIENCE_SOURCE_INVALID);
  if (
    (terminalKind === "PRESSURE_FINALE" && authority !== "FINALE_FROZEN") ||
    (terminalKind === "LEGACY_TERMINAL" && authority !== "LEGACY_TERMINAL_COMMITTED")
  ) failPressureNarrative(ERROR.AUDIENCE_SOURCE_INVALID, "source.variant.terminalKind", "AUTHORITY_MISMATCH");
  string(variant.worldOutcomeRef, "source.variant.worldOutcomeRef", ERROR.AUDIENCE_SOURCE_INVALID);
  if (variant.viewerVerdictRef !== null) string(variant.viewerVerdictRef, "source.variant.viewerVerdictRef", ERROR.AUDIENCE_SOURCE_INVALID);
  if (
    (audience.kind === "PUBLIC" && variant.viewerVerdictRef !== null) ||
    (audience.kind === "SEAT" && variant.viewerVerdictRef === null)
  ) failPressureNarrative(ERROR.AUDIENCE_SOURCE_INVALID, "source.variant.viewerVerdictRef", "AUDIENCE_MISMATCH");
}

function validateVariantClaimBindings(variantValue: unknown, claimsValue: unknown): void {
  const variant = variantValue as Record<string, unknown>;
  if (variant.kind !== "FINALE") return;
  const claims = claimsValue as Array<Record<string, unknown>>;
  const keys = new Set(claims.map((claim) => `${String(claim.kind)}\u0000${String(claim.refId)}`));
  if (!keys.has(`OUTCOME\u0000${String(variant.worldOutcomeRef)}`)) {
    failPressureNarrative(ERROR.AUDIENCE_SOURCE_INVALID, "source.variant.worldOutcomeRef", "OUTCOME_CLAIM_MISSING");
  }
  if (
    variant.viewerVerdictRef !== null &&
    !keys.has(`VERDICT\u0000${String(variant.viewerVerdictRef)}`)
  ) failPressureNarrative(ERROR.AUDIENCE_SOURCE_INVALID, "source.variant.viewerVerdictRef", "VERDICT_CLAIM_MISSING");
}

function validateAudience(value: unknown, path: string, code: PressureContractCode): NarrativeAudienceV1 {
  const audience = object(value, path, code);
  exact(audience, ["kind", "seatId"], path, code);
  const kind = oneOf(audience.kind, ["PUBLIC", "SEAT"], `${path}.kind`, code);
  if (kind === "PUBLIC") literal(audience.seatId, null, `${path}.seatId`, code);
  else if (!PRESSURE_NARRATIVE_SEAT_IDS.includes(audience.seatId as never)) failPressureNarrative(code, `${path}.seatId`, "SEAT_ID");
  return audience as unknown as NarrativeAudienceV1;
}

function assertKindAuthority(kind: NarrativeProjectionKindV1, authority: NarrativeSourceAuthorityV1, path: string, code: typeof ERROR.JOB_INVALID | typeof ERROR.AUDIENCE_SOURCE_INVALID): void {
  const allowed: Record<NarrativeProjectionKindV1, readonly NarrativeSourceAuthorityV1[]> = {
    GENESIS_NARRATIVE: ["GENESIS_FROZEN"],
    BEAT_NARRATIVE: ["CHAPTER_WORKING"],
    CHAPTER_NARRATIVE: ["CHAPTER_FROZEN"],
    FINALE_NARRATIVE: ["FINALE_FROZEN", "LEGACY_TERMINAL_COMMITTED"],
  };
  if (!allowed[kind].includes(authority)) failPressureNarrative(code, path, "KIND_AUTHORITY_MISMATCH");
}

function projectionKind(value: unknown, path: string, code: PressureContractCode): NarrativeProjectionKindV1 {
  return oneOf(value, ["GENESIS_NARRATIVE", "BEAT_NARRATIVE", "CHAPTER_NARRATIVE", "FINALE_NARRATIVE"], path, code);
}
function sourceAuthority(value: unknown, path: string, code: PressureContractCode): NarrativeSourceAuthorityV1 {
  return oneOf(value, ["GENESIS_FROZEN", "CHAPTER_WORKING", "CHAPTER_FROZEN", "FINALE_FROZEN", "LEGACY_TERMINAL_COMMITTED"], path, code);
}
function chapter(value: unknown, path: string): "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7" {
  return oneOf(value, ["N1", "N2", "N3", "N4", "N5", "N6", "N7"], path, ERROR.AUDIENCE_SOURCE_INVALID);
}
function object(value: unknown, path: string, code: PressureContractCode): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) failPressureNarrative(code, path, "PLAIN_OBJECT");
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string, code: PressureContractCode): unknown[] {
  if (!Array.isArray(value)) failPressureNarrative(code, path, "ARRAY");
  return value;
}
function exact(value: Record<string, unknown>, fields: readonly string[], path: string, code: PressureContractCode): void {
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown) failPressureNarrative(code, `${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = fields.find((field) => !(field in value));
  if (missing) failPressureNarrative(code, `${path}.${missing}`, "MISSING_FIELD");
}
function literal<T>(value: unknown, expected: T, path: string, code: PressureContractCode): void {
  if (value !== expected) failPressureNarrative(code, path, `EXPECTED_${String(expected)}`);
}
function string(value: unknown, path: string, code: PressureContractCode): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) failPressureNarrative(code, path, "NON_EMPTY_STRING");
}
function version(value: unknown, path: string, code: PressureContractCode): asserts value is string {
  string(value, path, code);
  if (/^(?:TBD|TODO|UNKNOWN)$/i.test(value)) failPressureNarrative(code, path, "INCOMPLETE_VERSION");
}
function hash(value: unknown, path: string, code: PressureContractCode): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) failPressureNarrative(code, path, "SHA256_LOWER_HEX");
}
function sortedStrings(value: unknown, path: string, code: PressureContractCode): asserts value is string[] {
  const entries = array(value, path, code);
  entries.forEach((entry, index) => string(entry, `${path}[${index}]`, code));
  ordered(entries as string[], (entry) => entry, path, code);
}
function ordered<T>(entries: T[], key: (entry: T) => string, path: string, code: PressureContractCode): void {
  for (let index = 1; index < entries.length; index += 1) {
    if (key(entries[index - 1]!) >= key(entries[index]!)) failPressureNarrative(code, path, "ORDER_OR_DUPLICATE");
  }
}
function integer(value: unknown, path: string, min: number, max: number, code: PressureContractCode = ERROR.PROFILE_UNAVAILABLE): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) failPressureNarrative(code, path, `INTEGER_${min}_${max}`);
}
function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, path: string, code: PressureContractCode): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) failPressureNarrative(code, path, `ALLOWED_${allowed.join("|")}`);
  return value as T[number];
}
function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
type PressureContractCode =
  | typeof ERROR.JOB_INVALID
  | typeof ERROR.AUDIENCE_SOURCE_INVALID
  | typeof ERROR.SOURCE_BINDING_MISMATCH
  | typeof ERROR.PROFILE_UNAVAILABLE
  | typeof ERROR.PROVIDER_OUTPUT_INVALID
  | typeof ERROR.PROVIDER_EMPTY;
