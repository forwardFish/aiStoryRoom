import { isSha256, sha256Canonical } from "@ai-story/shared";
import {
  PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1,
  failPressureGameReadObservationContractV1,
  validatePressureGameReadObservationV1,
  type PressureGameReadModeV1,
  type PressureGameReadObservationV1,
} from "./game-read-observation";
import type { PressureGameReadSamplePhaseV1 } from "./game-read-acceptance-summary";

export const PRESSURE_GAME_READ_ACCEPTANCE_EVIDENCE_SCHEMA_V1 =
  "pressure_game_read_acceptance_evidence_v1" as const;
export const PRESSURE_GAME_READ_ENDPOINT_V1 =
  "GET /v4/rooms/:roomId/game" as const;

export type PressureGameReadParticipantModeV1 = "SOLO" | "MULTIPLAYER";
export type PressureGameReadDecisionModeV1 =
  | "NONE"
  | "SOLO_BEAT"
  | "TARGETED_INTERACTION"
  | "SYNC_CONTEST";
export type PressureGameReadCleanupStatusV1 = "SUCCEEDED" | "FAILED";
export type PressureGameReadChapterV1 =
  | "P0"
  | "N1"
  | "N2"
  | "N3"
  | "N4"
  | "N5"
  | "N6"
  | "N7";
export type PressureGameReadConnectionPoolKindV1 =
  | "DIRECT"
  | "SESSION_POOLER"
  | "TRANSACTION_POOLER";

export interface PressureGameReadConnectionPoolSummaryV1 {
  readonly kind: PressureGameReadConnectionPoolKindV1;
  readonly connectionLimit: number;
  readonly poolTimeoutSeconds: number;
}

export interface PressureGameReadWorkerOwnershipSummaryV1 {
  readonly processRole: "api" | "independent_worker";
  readonly configuredOwner: "embedded_api" | "independent_worker";
  readonly topology: "embedded" | "independent";
  readonly ownsWorkerLanes: boolean;
  readonly ready: boolean;
}

export interface PressureGameReadAcceptanceEvidencePayloadV1 {
  readonly schemaVersion: typeof PRESSURE_GAME_READ_ACCEPTANCE_EVIDENCE_SCHEMA_V1;
  readonly endpoint: typeof PRESSURE_GAME_READ_ENDPOINT_V1;
  readonly branch: string;
  readonly commitSha: string;
  readonly mode: PressureGameReadModeV1;
  readonly chapter: PressureGameReadChapterV1;
  readonly participantMode: PressureGameReadParticipantModeV1;
  readonly decisionMode: PressureGameReadDecisionModeV1;
  readonly feedCursorPresent: boolean;
  readonly feedLimit: number;
  readonly supabaseRegion: string;
  readonly connectionPool: PressureGameReadConnectionPoolSummaryV1;
  readonly workerOwnership: PressureGameReadWorkerOwnershipSummaryV1;
  readonly runDigest: string;
  readonly viewerDigest: string;
  readonly seatDigest: string;
  readonly samplePhase: PressureGameReadSamplePhaseV1;
  readonly sampleIndex: number;
  readonly cleanupStatus: PressureGameReadCleanupStatusV1;
  readonly observation: PressureGameReadObservationV1;
}

export interface CreatePressureGameReadAcceptanceEvidenceInputV1
  extends Omit<PressureGameReadAcceptanceEvidencePayloadV1, "schemaVersion"> {}

export interface PressureGameReadAcceptanceEvidenceV1
  extends PressureGameReadAcceptanceEvidencePayloadV1 {
  readonly evidenceHash: string;
}

const CREATE_EVIDENCE_KEYS = Object.freeze([
  "endpoint",
  "branch",
  "commitSha",
  "mode",
  "chapter",
  "participantMode",
  "decisionMode",
  "feedCursorPresent",
  "feedLimit",
  "supabaseRegion",
  "connectionPool",
  "workerOwnership",
  "runDigest",
  "viewerDigest",
  "seatDigest",
  "samplePhase",
  "sampleIndex",
  "cleanupStatus",
  "observation",
] as const);
const EVIDENCE_PAYLOAD_KEYS = Object.freeze([
  "schemaVersion",
  ...CREATE_EVIDENCE_KEYS,
] as const);
const EVIDENCE_KEYS = Object.freeze([
  ...EVIDENCE_PAYLOAD_KEYS,
  "evidenceHash",
] as const);
const CONNECTION_POOL_KEYS = Object.freeze([
  "kind",
  "connectionLimit",
  "poolTimeoutSeconds",
] as const);
const WORKER_OWNERSHIP_KEYS = Object.freeze([
  "processRole",
  "configuredOwner",
  "topology",
  "ownsWorkerLanes",
  "ready",
] as const);

const MODES = Object.freeze(["REPLAY", "SHADOW", "FAST"] as const);
const CHAPTERS = Object.freeze([
  "P0",
  "N1",
  "N2",
  "N3",
  "N4",
  "N5",
  "N6",
  "N7",
] as const);
const PARTICIPANT_MODES = Object.freeze(["SOLO", "MULTIPLAYER"] as const);
const DECISION_MODES = Object.freeze([
  "NONE",
  "SOLO_BEAT",
  "TARGETED_INTERACTION",
  "SYNC_CONTEST",
] as const);
const CLEANUP_STATUSES = Object.freeze(["SUCCEEDED", "FAILED"] as const);
const SAMPLE_PHASES = Object.freeze(["COLD", "WARM"] as const);
const CONNECTION_POOL_KINDS = Object.freeze([
  "DIRECT",
  "SESSION_POOLER",
  "TRANSACTION_POOLER",
] as const);
const PROCESS_ROLES = Object.freeze(["api", "independent_worker"] as const);
const CONFIGURED_OWNERS = Object.freeze(["embedded_api", "independent_worker"] as const);
const TOPOLOGIES = Object.freeze(["embedded", "independent"] as const);

const GIT_BRANCH = /^(?!.*(?:\.\.|@\{|\/\/))[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,126}[A-Za-z0-9])?$/u;
const GIT_COMMIT_SHA = /^[a-f0-9]{40}$/u;
const SUPABASE_REGION = /^[a-z][a-z0-9-]{1,31}$/u;

export function createPressureGameReadAcceptanceEvidenceV1(
  value: Readonly<CreatePressureGameReadAcceptanceEvidenceInputV1>,
): PressureGameReadAcceptanceEvidenceV1 {
  const input = evidenceRecord(value, "input");
  exactEvidenceKeys(input, CREATE_EVIDENCE_KEYS, "input");
  const payload = normalizeEvidencePayload({
    schemaVersion: PRESSURE_GAME_READ_ACCEPTANCE_EVIDENCE_SCHEMA_V1,
    endpoint: input.endpoint,
    branch: input.branch,
    commitSha: input.commitSha,
    mode: input.mode,
    chapter: input.chapter,
    participantMode: input.participantMode,
    decisionMode: input.decisionMode,
    feedCursorPresent: input.feedCursorPresent,
    feedLimit: input.feedLimit,
    supabaseRegion: input.supabaseRegion,
    connectionPool: input.connectionPool,
    workerOwnership: input.workerOwnership,
    runDigest: input.runDigest,
    viewerDigest: input.viewerDigest,
    seatDigest: input.seatDigest,
    samplePhase: input.samplePhase,
    sampleIndex: input.sampleIndex,
    cleanupStatus: input.cleanupStatus,
    observation: input.observation,
  }, "evidence");
  return Object.freeze({
    ...payload,
    evidenceHash: sha256Canonical(payload),
  });
}

/** Recomputes the canonical hash from a payload that does not contain evidenceHash. */
export function computePressureGameReadAcceptanceEvidenceHashV1(
  value: PressureGameReadAcceptanceEvidencePayloadV1,
): string {
  return sha256Canonical(normalizeEvidencePayload(value, "evidence"));
}

/** Validates an externally stored evidence object, including its self-excluding hash. */
export function validatePressureGameReadAcceptanceEvidenceV1(
  value: unknown,
): PressureGameReadAcceptanceEvidenceV1 {
  const evidence = evidenceRecord(value, "evidence");
  exactEvidenceKeys(evidence, EVIDENCE_KEYS, "evidence");
  const payload = normalizeEvidencePayload({
    schemaVersion: evidence.schemaVersion,
    endpoint: evidence.endpoint,
    branch: evidence.branch,
    commitSha: evidence.commitSha,
    mode: evidence.mode,
    chapter: evidence.chapter,
    participantMode: evidence.participantMode,
    decisionMode: evidence.decisionMode,
    feedCursorPresent: evidence.feedCursorPresent,
    feedLimit: evidence.feedLimit,
    supabaseRegion: evidence.supabaseRegion,
    connectionPool: evidence.connectionPool,
    workerOwnership: evidence.workerOwnership,
    runDigest: evidence.runDigest,
    viewerDigest: evidence.viewerDigest,
    seatDigest: evidence.seatDigest,
    samplePhase: evidence.samplePhase,
    sampleIndex: evidence.sampleIndex,
    cleanupStatus: evidence.cleanupStatus,
    observation: evidence.observation,
  }, "evidence");
  const evidenceHash = evidenceDigest(evidence.evidenceHash, "evidence.evidenceHash");
  if (evidenceHash !== sha256Canonical(payload)) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      "evidence.evidenceHash",
    );
  }
  return Object.freeze({ ...payload, evidenceHash });
}

function normalizeEvidencePayload(
  value: unknown,
  path: string,
): PressureGameReadAcceptanceEvidencePayloadV1 {
  const payload = evidenceRecord(value, path);
  exactEvidenceKeys(payload, EVIDENCE_PAYLOAD_KEYS, path);
  if (payload.schemaVersion !== PRESSURE_GAME_READ_ACCEPTANCE_EVIDENCE_SCHEMA_V1) {
    invalidField(`${path}.schemaVersion`);
  }
  if (payload.endpoint !== PRESSURE_GAME_READ_ENDPOINT_V1) {
    invalidField(`${path}.endpoint`);
  }
  const branch = evidencePattern(payload.branch, GIT_BRANCH, `${path}.branch`);
  const commitSha = evidencePattern(payload.commitSha, GIT_COMMIT_SHA, `${path}.commitSha`);
  const mode = evidenceEnum(payload.mode, MODES, `${path}.mode`);
  const chapter = evidenceEnum(payload.chapter, CHAPTERS, `${path}.chapter`);
  const participantMode = evidenceEnum(
    payload.participantMode,
    PARTICIPANT_MODES,
    `${path}.participantMode`,
  );
  const decisionMode = evidenceEnum(
    payload.decisionMode,
    DECISION_MODES,
    `${path}.decisionMode`,
  );
  const feedCursorPresent = evidenceBoolean(
    payload.feedCursorPresent,
    `${path}.feedCursorPresent`,
  );
  const feedLimit = evidenceBoundedSafeInteger(payload.feedLimit, 1, 10, `${path}.feedLimit`);
  const supabaseRegion = evidencePattern(
    payload.supabaseRegion,
    SUPABASE_REGION,
    `${path}.supabaseRegion`,
  );
  const connectionPool = normalizeConnectionPool(payload.connectionPool, `${path}.connectionPool`);
  const workerOwnership = normalizeWorkerOwnership(
    payload.workerOwnership,
    `${path}.workerOwnership`,
  );
  const runDigest = evidenceDigest(payload.runDigest, `${path}.runDigest`);
  const viewerDigest = evidenceDigest(payload.viewerDigest, `${path}.viewerDigest`);
  const seatDigest = evidenceDigest(payload.seatDigest, `${path}.seatDigest`);
  const samplePhase = evidenceEnum(
    payload.samplePhase,
    SAMPLE_PHASES,
    `${path}.samplePhase`,
  );
  const sampleIndex = evidenceBoundedSafeInteger(
    payload.sampleIndex,
    0,
    Number.MAX_SAFE_INTEGER,
    `${path}.sampleIndex`,
  );
  const cleanupStatus = evidenceEnum(
    payload.cleanupStatus,
    CLEANUP_STATUSES,
    `${path}.cleanupStatus`,
  );
  const observation = validatePressureGameReadObservationV1(payload.observation);
  if (mode !== observation.mode) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      `${path}.mode`,
    );
  }

  return Object.freeze({
    schemaVersion: PRESSURE_GAME_READ_ACCEPTANCE_EVIDENCE_SCHEMA_V1,
    endpoint: PRESSURE_GAME_READ_ENDPOINT_V1,
    branch,
    commitSha,
    mode,
    chapter,
    participantMode,
    decisionMode,
    feedCursorPresent,
    feedLimit,
    supabaseRegion,
    connectionPool,
    workerOwnership,
    runDigest,
    viewerDigest,
    seatDigest,
    samplePhase,
    sampleIndex,
    cleanupStatus,
    observation,
  });
}

function normalizeConnectionPool(
  value: unknown,
  path: string,
): PressureGameReadConnectionPoolSummaryV1 {
  const pool = evidenceRecord(value, path);
  exactEvidenceKeys(pool, CONNECTION_POOL_KEYS, path);
  return Object.freeze({
    kind: evidenceEnum(pool.kind, CONNECTION_POOL_KINDS, `${path}.kind`),
    connectionLimit: evidenceBoundedSafeInteger(
      pool.connectionLimit,
      1,
      50,
      `${path}.connectionLimit`,
    ),
    poolTimeoutSeconds: evidenceBoundedSafeInteger(
      pool.poolTimeoutSeconds,
      1,
      120,
      `${path}.poolTimeoutSeconds`,
    ),
  });
}

function normalizeWorkerOwnership(
  value: unknown,
  path: string,
): PressureGameReadWorkerOwnershipSummaryV1 {
  const ownership = evidenceRecord(value, path);
  exactEvidenceKeys(ownership, WORKER_OWNERSHIP_KEYS, path);
  const processRole = evidenceEnum(
    ownership.processRole,
    PROCESS_ROLES,
    `${path}.processRole`,
  );
  const configuredOwner = evidenceEnum(
    ownership.configuredOwner,
    CONFIGURED_OWNERS,
    `${path}.configuredOwner`,
  );
  const topology = evidenceEnum(ownership.topology, TOPOLOGIES, `${path}.topology`);
  const ownsWorkerLanes = evidenceBoolean(
    ownership.ownsWorkerLanes,
    `${path}.ownsWorkerLanes`,
  );
  const ready = evidenceBoolean(ownership.ready, `${path}.ready`);
  const expectedTopology = configuredOwner === "embedded_api" ? "embedded" : "independent";
  const expectedOwnsWorkerLanes = configuredOwner === "embedded_api"
    ? processRole === "api"
    : processRole === "independent_worker";
  if (topology !== expectedTopology) {
    inconsistent(`${path}.topology`);
  }
  if ((!ready && ownsWorkerLanes) || (ready && ownsWorkerLanes !== expectedOwnsWorkerLanes)) {
    inconsistent(`${path}.ownsWorkerLanes`);
  }
  return Object.freeze({
    processRole,
    configuredOwner,
    topology,
    ownsWorkerLanes,
    ready,
  });
}

function evidenceRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_OBJECT,
      path,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_OBJECT,
      path,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
      `${path}.*`,
    );
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_OBJECT,
        path,
      );
    }
  }
  return value as Record<string, unknown>;
}

function exactEvidenceKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string,
): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      invalidField(`${path}.${key}`);
    }
  }
  if (Object.keys(record).length !== keys.length) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
      `${path}.*`,
    );
  }
}

function evidenceEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_ENUM,
      path,
    );
  }
  return value as T[number];
}

function evidencePattern(value: unknown, pattern: RegExp, path: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    invalidField(path);
  }
  return value;
}

function evidenceDigest(value: unknown, path: string): string {
  if (!isSha256(value)) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_DIGEST,
      path,
    );
  }
  return value;
}

function evidenceBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    invalidField(path);
  }
  return value;
}

function evidenceBoundedSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path,
    );
  }
  return value as number;
}

function invalidField(path: string): never {
  return failPressureGameReadObservationContractV1(
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_FIELD,
    path,
  );
}

function inconsistent(path: string): never {
  return failPressureGameReadObservationContractV1(
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
    path,
  );
}
