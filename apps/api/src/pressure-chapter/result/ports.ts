import {
  NARRATIVE_STATUSES_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  PressureChapterContractError,
  validateAuthoritativePressureResultSnapshotV1 as validateSharedAuthoritySnapshotV1,
  type AuthoritativePressureResultSnapshotV1,
  type FrozenRunRouteV1,
  type NarrativeStatusV1,
  type ParticipantModeV1,
  type PressureReplayActionV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "./errors";

export type { AuthoritativePressureResultSnapshotV1 } from "@ai-story/shared";

export interface ResultViewerContextV1 {
  runId: string;
  viewerId: string;
  seatId: SeatIdV1;
  authorizedImpactIds: readonly string[];
  authorizedRevealIds: readonly string[];
  allowedReplayRoleIds: readonly SeatIdV1[];
}

/**
 * Result-owned, mutable presentation state. It is deliberately not part of
 * AuthoritativePressureResultSnapshotV1 or its snapshotHash.
 */
export interface StoredPressureNarrativeV1 {
  seatId: SeatIdV1;
  status: NarrativeStatusV1;
  text: string | null;
  contentHash: string | null;
  sourceCommitHash: string;
  sourceDecisionHash: string;
}

/** Exact read-side join response from NarrativeProjection/Artifact storage. */
export interface PressureResultNarrativeReadSetV1 {
  schemaVersion: "pressure_result_narrative_read_set_v1";
  runId: string;
  sourceCommitHash: string;
  sourceDecisionHash: string;
  narratives: StoredPressureNarrativeV1[];
}

/**
 * Viewer-independent read model. Authority and presentation remain separate so
 * a narrative refresh cannot change, re-hash or write back the authority.
 */
export interface PressureResultReadModelSourceV1 {
  authority: AuthoritativePressureResultSnapshotV1;
  narratives: StoredPressureNarrativeV1[];
}

export interface ReplayPolicySourceV1 {
  runId: string;
  worldId: "sangtian";
  participantMode: ParticipantModeV1;
  frozenRoute: FrozenRunRouteV1;
  frozenRouteHash: string;
  resultContractRegistryVersion: string;
}

/** Read-only authority port. Implementations must never synthesize or recompute a Finale. */
export interface AuthoritativeResultReaderPort {
  readFinalized(runId: string): Promise<unknown | null>;
}

export interface PressureResultReadModelInputV1 {
  authority: unknown;
  narrativeReadSet: unknown;
}

/**
 * Production implementation must read authority plus six narrative projection
 * identities/artifacts in one read-only consistent transaction.
 */
export interface PressureResultReadModelInputReaderPort {
  readConsistentSource(runId: string): Promise<unknown | null>;
}

/** ResultQuery consumes only a pre-composed, viewer-independent read model. */
export interface PressureResultReadModelReaderPort {
  readFinalized(runId: string): Promise<unknown | null>;
}

/** Read-only membership and audience capability lookup. */
export interface ResultViewerAuthorizerPort {
  readViewerContext(runId: string, viewerId: string): Promise<unknown | null>;
}

/** Server-side policy port. It receives no six-seat private result data. */
export interface PressureReplayPolicyPort {
  listActions(
    source: Readonly<ReplayPolicySourceV1>,
    viewer: Readonly<ResultViewerContextV1>,
  ): Promise<readonly unknown[]>;
}

export function toReplayPolicySourceV1(
  source: AuthoritativePressureResultSnapshotV1,
): ReplayPolicySourceV1 {
  return Object.freeze({
    runId: source.runId,
    worldId: source.worldId,
    participantMode: source.participantMode,
    frozenRoute: structuredClone(source.frozenRoute),
    frozenRouteHash: source.frozenRouteHash,
    resultContractRegistryVersion: source.resultContractRegistryVersion,
  });
}

export function validateResultViewerContextV1(
  value: unknown,
  expectedRunId: string,
  expectedViewerId: string,
): ResultViewerContextV1 {
  const viewer = record(value, "viewer");
  exactKeys(viewer, [
    "runId",
    "viewerId",
    "seatId",
    "authorizedImpactIds",
    "authorizedRevealIds",
    "allowedReplayRoleIds",
  ], "viewer");
  if (viewer.runId !== expectedRunId || viewer.viewerId !== expectedViewerId) {
    failPressureResultRead(ERROR.RESULT_ACCESS_DENIED, "viewer", "IDENTITY_MISMATCH");
  }
  assertSeatId(viewer.seatId, "viewer.seatId");
  assertSortedUniqueStrings(viewer.authorizedImpactIds, "viewer.authorizedImpactIds");
  assertSortedUniqueStrings(viewer.authorizedRevealIds, "viewer.authorizedRevealIds");
  assertSeatArray(viewer.allowedReplayRoleIds, "viewer.allowedReplayRoleIds", false);
  return structuredClone(viewer) as unknown as ResultViewerContextV1;
}

/** Shared authority validator with read-side error classification. */
export function validateAuthoritativePressureResultSnapshotV1(
  value: unknown,
  expectedRunId?: string,
): AuthoritativePressureResultSnapshotV1 {
  try {
    return structuredClone(validateSharedAuthoritySnapshotV1(value, expectedRunId));
  } catch (error) {
    if (error instanceof PressureChapterContractError) {
      if (error.path.includes("rendererKey") || error.path.includes("presentationSchemaVersion")) {
        failPressureResultRead(ERROR.RESULT_RENDERER_UNAVAILABLE, error.path, error.detail);
      }
      if (
        error.path.includes("frozenRoute") ||
        error.code === "RUNTIME_PROFILE_UNSUPPORTED" ||
        error.code === "RUN_ROUTE_INCOMPLETE" ||
        error.code === "RUN_ROUTE_UNREGISTERED" ||
        error.code === "RUN_ROUTE_HASH_MISMATCH"
      ) {
        failPressureResultRead(ERROR.RESULT_ROUTE_CONTRACT_MISMATCH, error.path, error.detail);
      }
      failPressureResultRead(ERROR.RESULT_STORED_RECORD_INVALID, error.path, error.detail ?? error.code);
    }
    failPressureResultRead(
      ERROR.RESULT_STORED_RECORD_INVALID,
      "authorityResultSnapshot",
      error instanceof Error ? error.message : "INVALID_AUTHORITY_SNAPSHOT",
    );
  }
}

export function validatePressureResultNarrativeReadSetV1(
  value: unknown,
  authority: Readonly<AuthoritativePressureResultSnapshotV1>,
): PressureResultNarrativeReadSetV1 {
  const readSet = record(value, "narrativeReadSet");
  exactKeys(readSet, [
    "schemaVersion",
    "runId",
    "sourceCommitHash",
    "sourceDecisionHash",
    "narratives",
  ], "narrativeReadSet");
  literal(readSet.schemaVersion, "pressure_result_narrative_read_set_v1", "narrativeReadSet.schemaVersion");
  literal(readSet.runId, authority.runId, "narrativeReadSet.runId");
  literal(readSet.sourceCommitHash, authority.sourceCommitHash, "narrativeReadSet.sourceCommitHash");
  literal(readSet.sourceDecisionHash, authority.decisionHash, "narrativeReadSet.sourceDecisionHash");
  const narratives = validateNarratives(
    readSet.narratives,
    authority.sourceCommitHash,
    authority.decisionHash,
  );
  return structuredClone({ ...readSet, narratives }) as unknown as PressureResultNarrativeReadSetV1;
}

export function validatePressureResultReadModelInputV1(
  value: unknown,
): PressureResultReadModelInputV1 {
  const input = record(value, "resultReadModelInput");
  exactKeys(input, ["authority", "narrativeReadSet"], "resultReadModelInput");
  return {
    authority: input.authority,
    narrativeReadSet: input.narrativeReadSet,
  };
}

export function validatePressureResultReadModelSourceV1(
  value: unknown,
  expectedRunId?: string,
): PressureResultReadModelSourceV1 {
  const source = record(value, "resultReadModel");
  exactKeys(source, ["authority", "narratives"], "resultReadModel");
  const authority = validateAuthoritativePressureResultSnapshotV1(
    source.authority,
    expectedRunId,
  );
  const narratives = validateNarratives(
    source.narratives,
    authority.sourceCommitHash,
    authority.decisionHash,
  );
  return structuredClone({ authority, narratives });
}

function validateNarratives(
  value: unknown,
  commitHash: string,
  decisionHash: string,
): StoredPressureNarrativeV1[] {
  if (!Array.isArray(value) || value.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    invalid("narratives", "EXACT_SIX");
  }
  const validated = value.map((item, index) => {
    const path = `narratives[${index}]`;
    const narrative = record(item, path);
    exactKeys(narrative, [
      "seatId",
      "status",
      "text",
      "contentHash",
      "sourceCommitHash",
      "sourceDecisionHash",
    ], path);
    literal(narrative.seatId, PRESSURE_CHAPTER_SEAT_IDS_V1[index], `${path}.seatId`);
    if (!NARRATIVE_STATUSES_V1.includes(narrative.status as never)) invalid(`${path}.status`);
    literal(narrative.sourceCommitHash, commitHash, `${path}.sourceCommitHash`);
    literal(narrative.sourceDecisionHash, decisionHash, `${path}.sourceDecisionHash`);
    const published = narrative.status === "PUBLISHED" || narrative.status === "FALLBACK_PUBLISHED";
    if (published) {
      nonEmptyString(narrative.text, `${path}.text`);
      sha256(narrative.contentHash, `${path}.contentHash`);
    } else if (narrative.text !== null || narrative.contentHash !== null) {
      invalid(path, "UNPUBLISHED_REQUIRES_NULL_CONTENT");
    }
    return structuredClone(narrative) as unknown as StoredPressureNarrativeV1;
  });
  return validated;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(path, "PLAIN_OBJECT");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function literal<T>(value: unknown, expected: T, path: string): void {
  if (value !== expected) invalid(path, `EXPECTED_${String(expected)}`);
}

function nonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(path, "NON_EMPTY_STRING");
}

function sha256(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid(path, "SHA256_LOWER_HEX");
}

function assertSortedUniqueStrings(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value)) invalid(path, "ARRAY");
  value.forEach((entry, index) => nonEmptyString(entry, `${path}[${index}]`));
  for (let index = 1; index < value.length; index += 1) {
    if (value[index - 1]! >= value[index]!) invalid(path, "ORDER_OR_DUPLICATE");
  }
}

function assertSeatId(value: unknown, path: string): asserts value is SeatIdV1 {
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(value as never)) invalid(path, "SEAT_ID");
}

function assertSeatArray(value: unknown, path: string, nonEmpty: boolean): asserts value is SeatIdV1[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    invalid(path, nonEmpty ? "NON_EMPTY_ARRAY" : "ARRAY");
  }
  let previousRank = -1;
  value.forEach((entry, index) => {
    assertSeatId(entry, `${path}[${index}]`);
    const rank = PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(entry);
    if (rank <= previousRank) invalid(path, "ORDER_OR_DUPLICATE");
    previousRank = rank;
  });
}

function invalid(path: string, detail?: string): never {
  failPressureResultRead(ERROR.RESULT_STORED_RECORD_INVALID, path, detail);
}

export type ValidatedPressureReplayActionV1 = Readonly<PressureReplayActionV1>;
