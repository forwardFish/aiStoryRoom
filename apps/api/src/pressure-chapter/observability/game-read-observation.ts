import { isSha256 } from "@ai-story/shared";
import type { PressureDbRequestMetricsV1 } from "./pressure-db-metrics";

export const PRESSURE_GAME_READ_OBSERVATION_SCHEMA_V1 =
  "pressure_game_read_observation_v1" as const;

export type PressureGameReadModeV1 = "REPLAY" | "SHADOW" | "FAST";
export type PressureGameReadShadowStatusV1 =
  | "NOT_RUN"
  | "MATCH"
  | "MISMATCH"
  | "ERROR";
export type PressureGameReadOutcomeV1 =
  | "SUCCESS"
  | "BUSINESS_ERROR"
  | "DEPENDENCY_ERROR"
  | "INTERNAL_ERROR";

export type PressureGameReadDbMetricsSnapshotV1 = Readonly<
  Omit<PressureDbRequestMetricsV1, "queryHashes"> & {
    queryHashes: readonly string[];
  }
>;

export interface PressureGameReadObservationV1 {
  readonly schemaVersion: typeof PRESSURE_GAME_READ_OBSERVATION_SCHEMA_V1;
  readonly mode: PressureGameReadModeV1;
  readonly shadowStatus: PressureGameReadShadowStatusV1;
  readonly outcome: PressureGameReadOutcomeV1;
  readonly requestDigest: string;
  readonly scenarioDigest: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly wallTimeMs: number;
  readonly metrics: PressureGameReadDbMetricsSnapshotV1;
  readonly observabilityFailure: boolean;
}

export interface CreatePressureGameReadObservationInputV1 {
  readonly mode: PressureGameReadModeV1;
  readonly shadowStatus: PressureGameReadShadowStatusV1;
  readonly outcome: PressureGameReadOutcomeV1;
  readonly requestDigest: string;
  readonly scenarioDigest: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly wallTimeMs: number;
  readonly metrics: Readonly<PressureDbRequestMetricsV1>;
  readonly observabilityFailure: boolean;
}

export const PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1 = Object.freeze({
  INVALID_OBJECT: "PRESSURE_GAME_READ_OBSERVATION_INVALID_OBJECT",
  INVALID_FIELD: "PRESSURE_GAME_READ_OBSERVATION_INVALID_FIELD",
  UNKNOWN_FIELD: "PRESSURE_GAME_READ_OBSERVATION_UNKNOWN_FIELD",
  INVALID_ENUM: "PRESSURE_GAME_READ_OBSERVATION_INVALID_ENUM",
  INVALID_DIGEST: "PRESSURE_GAME_READ_OBSERVATION_INVALID_DIGEST",
  INVALID_NUMBER: "PRESSURE_GAME_READ_OBSERVATION_INVALID_NUMBER",
  INCONSISTENT_VALUE: "PRESSURE_GAME_READ_OBSERVATION_INCONSISTENT_VALUE",
  DUPLICATE_VALUE: "PRESSURE_GAME_READ_OBSERVATION_DUPLICATE_VALUE",
} as const);

export type PressureGameReadObservationErrorCodeV1 =
  (typeof PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1)[keyof typeof PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1];

export class PressureGameReadObservationContractErrorV1 extends Error {
  readonly name = "PressureGameReadObservationContractErrorV1";

  constructor(
    readonly code: PressureGameReadObservationErrorCodeV1,
    readonly path: string,
  ) {
    super(`${code}:${path}`);
  }
}

export function failPressureGameReadObservationContractV1(
  code: PressureGameReadObservationErrorCodeV1,
  path: string,
): never {
  throw new PressureGameReadObservationContractErrorV1(code, path);
}

const CREATE_INPUT_KEYS = Object.freeze([
  "mode",
  "shadowStatus",
  "outcome",
  "requestDigest",
  "scenarioDigest",
  "startedAtMs",
  "finishedAtMs",
  "wallTimeMs",
  "metrics",
  "observabilityFailure",
] as const);

const OBSERVATION_KEYS = Object.freeze([
  "schemaVersion",
  ...CREATE_INPUT_KEYS,
] as const);

const METRICS_KEYS = Object.freeze([
  "applicationSqlStatementCount",
  "databaseProtocolRoundtripCountIncludingBeginCommit",
  "transactionAttemptCount",
  "committedTransactionCount",
  "rolledBackTransactionCount",
  "transactionRetryCount",
  "queryDurationMs",
  "queryHashes",
] as const);

const MODES = Object.freeze(["REPLAY", "SHADOW", "FAST"] as const);
const SHADOW_STATUSES = Object.freeze([
  "NOT_RUN",
  "MATCH",
  "MISMATCH",
  "ERROR",
] as const);
const OUTCOMES = Object.freeze([
  "SUCCESS",
  "BUSINESS_ERROR",
  "DEPENDENCY_ERROR",
  "INTERNAL_ERROR",
] as const);

export function createPressureGameReadObservationV1(
  value: Readonly<CreatePressureGameReadObservationInputV1>,
): PressureGameReadObservationV1 {
  const input = observationRecord(value, "input");
  exactObservationKeys(input, CREATE_INPUT_KEYS, "input");
  return normalizePressureGameReadObservationV1({
    schemaVersion: PRESSURE_GAME_READ_OBSERVATION_SCHEMA_V1,
    mode: input.mode,
    shadowStatus: input.shadowStatus,
    outcome: input.outcome,
    requestDigest: input.requestDigest,
    scenarioDigest: input.scenarioDigest,
    startedAtMs: input.startedAtMs,
    finishedAtMs: input.finishedAtMs,
    wallTimeMs: input.wallTimeMs,
    metrics: input.metrics,
    observabilityFailure: input.observabilityFailure,
  }, "observation");
}

/** Validates, clones, and freezes an observation received from another pure boundary. */
export function validatePressureGameReadObservationV1(
  value: unknown,
): PressureGameReadObservationV1 {
  return normalizePressureGameReadObservationV1(value, "observation");
}

function normalizePressureGameReadObservationV1(
  value: unknown,
  path: string,
): PressureGameReadObservationV1 {
  const observation = observationRecord(value, path);
  exactObservationKeys(observation, OBSERVATION_KEYS, path);
  if (observation.schemaVersion !== PRESSURE_GAME_READ_OBSERVATION_SCHEMA_V1) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_FIELD,
      `${path}.schemaVersion`,
    );
  }

  const mode = observationEnum(observation.mode, MODES, `${path}.mode`);
  const shadowStatus = observationEnum(
    observation.shadowStatus,
    SHADOW_STATUSES,
    `${path}.shadowStatus`,
  );
  assertShadowStatusMatrix(mode, shadowStatus, `${path}.shadowStatus`);
  const outcome = observationEnum(observation.outcome, OUTCOMES, `${path}.outcome`);
  const requestDigest = observationDigest(
    observation.requestDigest,
    `${path}.requestDigest`,
  );
  const scenarioDigest = observationDigest(
    observation.scenarioDigest,
    `${path}.scenarioDigest`,
  );
  const startedAtMs = observationNonNegativeSafeInteger(
    observation.startedAtMs,
    `${path}.startedAtMs`,
  );
  const finishedAtMs = observationNonNegativeSafeInteger(
    observation.finishedAtMs,
    `${path}.finishedAtMs`,
  );
  const wallTimeMs = observationNonNegativeSafeInteger(
    observation.wallTimeMs,
    `${path}.wallTimeMs`,
  );
  if (finishedAtMs < startedAtMs || finishedAtMs - startedAtMs !== wallTimeMs) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      `${path}.wallTimeMs`,
    );
  }
  const metrics = normalizeMetrics(observation.metrics, `${path}.metrics`);
  const observabilityFailure = observationBoolean(
    observation.observabilityFailure,
    `${path}.observabilityFailure`,
  );

  return Object.freeze({
    schemaVersion: PRESSURE_GAME_READ_OBSERVATION_SCHEMA_V1,
    mode,
    shadowStatus,
    outcome,
    requestDigest,
    scenarioDigest,
    startedAtMs,
    finishedAtMs,
    wallTimeMs,
    metrics,
    observabilityFailure,
  });
}

function normalizeMetrics(
  value: unknown,
  path: string,
): PressureGameReadDbMetricsSnapshotV1 {
  const metrics = observationRecord(value, path);
  exactObservationKeys(metrics, METRICS_KEYS, path);
  const applicationSqlStatementCount = observationNonNegativeSafeInteger(
    metrics.applicationSqlStatementCount,
    `${path}.applicationSqlStatementCount`,
  );
  const databaseProtocolRoundtripCountIncludingBeginCommit =
    observationNonNegativeSafeInteger(
      metrics.databaseProtocolRoundtripCountIncludingBeginCommit,
      `${path}.databaseProtocolRoundtripCountIncludingBeginCommit`,
    );
  const transactionAttemptCount = observationNonNegativeSafeInteger(
    metrics.transactionAttemptCount,
    `${path}.transactionAttemptCount`,
  );
  const committedTransactionCount = observationNonNegativeSafeInteger(
    metrics.committedTransactionCount,
    `${path}.committedTransactionCount`,
  );
  const rolledBackTransactionCount = observationNonNegativeSafeInteger(
    metrics.rolledBackTransactionCount,
    `${path}.rolledBackTransactionCount`,
  );
  const transactionRetryCount = observationNonNegativeSafeInteger(
    metrics.transactionRetryCount,
    `${path}.transactionRetryCount`,
  );
  const queryDurationMs = observationNonNegativeFiniteNumber(
    metrics.queryDurationMs,
    `${path}.queryDurationMs`,
  );
  const queryHashes = observationDigestArray(metrics.queryHashes, `${path}.queryHashes`);

  if (applicationSqlStatementCount > databaseProtocolRoundtripCountIncludingBeginCommit) {
    inconsistentMetric(`${path}.applicationSqlStatementCount`);
  }
  if (
    committedTransactionCount > transactionAttemptCount
    || rolledBackTransactionCount > transactionAttemptCount - committedTransactionCount
    || committedTransactionCount + rolledBackTransactionCount !== transactionAttemptCount
  ) {
    inconsistentMetric(`${path}.transactionAttemptCount`);
  }
  if (transactionRetryCount > rolledBackTransactionCount) {
    inconsistentMetric(`${path}.transactionRetryCount`);
  }
  if (transactionRetryCount > 0 && transactionAttemptCount <= transactionRetryCount) {
    inconsistentMetric(`${path}.transactionRetryCount`);
  }
  if (queryHashes.length > databaseProtocolRoundtripCountIncludingBeginCommit) {
    inconsistentMetric(`${path}.queryHashes`);
  }

  return Object.freeze({
    applicationSqlStatementCount,
    databaseProtocolRoundtripCountIncludingBeginCommit,
    transactionAttemptCount,
    committedTransactionCount,
    rolledBackTransactionCount,
    transactionRetryCount,
    queryDurationMs,
    queryHashes,
  });
}

function assertShadowStatusMatrix(
  mode: PressureGameReadModeV1,
  shadowStatus: PressureGameReadShadowStatusV1,
  path: string,
): void {
  const valid = mode === "SHADOW"
    ? shadowStatus !== "NOT_RUN"
    : shadowStatus === "NOT_RUN";
  if (!valid) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      path,
    );
  }
}

function inconsistentMetric(path: string): never {
  return failPressureGameReadObservationContractV1(
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
    path,
  );
}

function observationRecord(value: unknown, path: string): Record<string, unknown> {
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

function exactObservationKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string,
): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_FIELD,
        `${path}.${key}`,
      );
    }
  }
  if (Object.keys(record).length !== keys.length) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
      `${path}.*`,
    );
  }
}

function observationEnum<const T extends readonly string[]>(
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

function observationDigest(value: unknown, path: string): string {
  if (!isSha256(value)) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_DIGEST,
      path,
    );
  }
  return value;
}

function observationNonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path,
    );
  }
  return value as number;
}

function observationNonNegativeFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function observationBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_FIELD,
      path,
    );
  }
  return value;
}

function observationDigestArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_FIELD,
      path,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
      `${path}.*`,
    );
  }
  assertPlainDenseObservationArray(value, path);

  const seen = new Set<string>();
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const digest = observationDigest(value[index], `${path}[${index}]`);
    if (seen.has(digest)) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.DUPLICATE_VALUE,
        `${path}[${index}]`,
      );
    }
    seen.add(digest);
    result.push(digest);
  }
  return Object.freeze(result);
}

function assertPlainDenseObservationArray(value: readonly unknown[], path: string): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_OBJECT,
      path,
    );
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!expectedKeys.has(key)) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
        `${path}.*`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const validLength = key === "length"
      && descriptor !== undefined
      && "value" in descriptor
      && !descriptor.enumerable;
    const validIndex = key !== "length"
      && descriptor !== undefined
      && "value" in descriptor
      && descriptor.enumerable;
    if (!validLength && !validIndex) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_OBJECT,
        path,
      );
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_FIELD,
        `${path}[${index}]`,
      );
    }
  }
}
