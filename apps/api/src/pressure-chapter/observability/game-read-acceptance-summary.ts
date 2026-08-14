import {
  PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1,
  failPressureGameReadObservationContractV1,
  validatePressureGameReadObservationV1,
  type PressureGameReadModeV1,
  type PressureGameReadObservationV1,
} from "./game-read-observation";

export const PRESSURE_GAME_READ_ACCEPTANCE_SUMMARY_SCHEMA_V1 =
  "pressure_game_read_acceptance_summary_v1" as const;
export const PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1 = 10 as const;
export const PRESSURE_GAME_READ_PERCENTILE_METHOD_V1 = "NEAREST_RANK" as const;

export type PressureGameReadSamplePhaseV1 = "COLD" | "WARM";

export interface PressureGameReadAcceptanceSampleV1 {
  readonly sampleIndex: number;
  readonly samplePhase: PressureGameReadSamplePhaseV1;
  readonly observation: PressureGameReadObservationV1;
}

export interface PressureGameReadAcceptanceSummaryInputV1 {
  readonly samples: readonly PressureGameReadAcceptanceSampleV1[];
}

export interface PressureGameReadMetricStatisticsV1 {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
}

export interface PressureGameReadAcceptanceDimensionsV1 {
  readonly wallTimeMs: PressureGameReadMetricStatisticsV1;
  readonly applicationSqlStatementCount: PressureGameReadMetricStatisticsV1;
  readonly databaseProtocolRoundtripCountIncludingBeginCommit: PressureGameReadMetricStatisticsV1;
  readonly transactionAttemptCount: PressureGameReadMetricStatisticsV1;
  readonly committedTransactionCount: PressureGameReadMetricStatisticsV1;
  readonly rolledBackTransactionCount: PressureGameReadMetricStatisticsV1;
  readonly transactionRetryCount: PressureGameReadMetricStatisticsV1;
  readonly queryDurationMs: PressureGameReadMetricStatisticsV1;
}

interface PressureGameReadAcceptanceSummaryCommonV1 {
  readonly schemaVersion: typeof PRESSURE_GAME_READ_ACCEPTANCE_SUMMARY_SCHEMA_V1;
  readonly percentileMethod: typeof PRESSURE_GAME_READ_PERCENTILE_METHOD_V1;
  readonly minimumWarmSampleCount: typeof PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1;
  readonly totalSampleCount: number;
  readonly coldSampleCount: number;
  readonly warmSampleCount: number;
  readonly mode: PressureGameReadModeV1 | null;
  readonly scenarioDigest: string | null;
}

export type PressureGameReadAcceptanceSummaryV1 =
  | (PressureGameReadAcceptanceSummaryCommonV1 & {
    readonly status: "INSUFFICIENT_SAMPLES";
    readonly dimensions: null;
  })
  | (PressureGameReadAcceptanceSummaryCommonV1 & {
    readonly status: "READY";
    readonly mode: PressureGameReadModeV1;
    readonly scenarioDigest: string;
    readonly dimensions: PressureGameReadAcceptanceDimensionsV1;
  });

const SUMMARY_INPUT_KEYS = Object.freeze(["samples"] as const);
const SAMPLE_KEYS = Object.freeze([
  "sampleIndex",
  "samplePhase",
  "observation",
] as const);
const SAMPLE_PHASES = Object.freeze(["COLD", "WARM"] as const);

export function summarizePressureGameReadAcceptanceV1(
  value: Readonly<PressureGameReadAcceptanceSummaryInputV1>,
): PressureGameReadAcceptanceSummaryV1 {
  const input = summaryRecord(value, "input");
  exactSummaryKeys(input, SUMMARY_INPUT_KEYS, "input");
  const samples = normalizeSamples(input.samples, "input.samples");
  const warm = samples.filter((sample) => sample.samplePhase === "WARM");
  const coldSampleCount = samples.length - warm.length;
  const mode = samples[0]?.observation.mode ?? null;
  const scenarioDigest = samples[0]?.observation.scenarioDigest ?? null;
  const common = {
    schemaVersion: PRESSURE_GAME_READ_ACCEPTANCE_SUMMARY_SCHEMA_V1,
    percentileMethod: PRESSURE_GAME_READ_PERCENTILE_METHOD_V1,
    minimumWarmSampleCount: PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1,
    totalSampleCount: samples.length,
    coldSampleCount,
    warmSampleCount: warm.length,
    mode,
    scenarioDigest,
  } as const;

  if (warm.length < PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1) {
    return Object.freeze({
      ...common,
      status: "INSUFFICIENT_SAMPLES" as const,
      dimensions: null,
    });
  }

  const dimensions = Object.freeze({
    wallTimeMs: statistics(warm.map((sample) => sample.observation.wallTimeMs)),
    applicationSqlStatementCount: statistics(warm.map(
      (sample) => sample.observation.metrics.applicationSqlStatementCount,
    )),
    databaseProtocolRoundtripCountIncludingBeginCommit: statistics(warm.map(
      (sample) => sample.observation.metrics.databaseProtocolRoundtripCountIncludingBeginCommit,
    )),
    transactionAttemptCount: statistics(warm.map(
      (sample) => sample.observation.metrics.transactionAttemptCount,
    )),
    committedTransactionCount: statistics(warm.map(
      (sample) => sample.observation.metrics.committedTransactionCount,
    )),
    rolledBackTransactionCount: statistics(warm.map(
      (sample) => sample.observation.metrics.rolledBackTransactionCount,
    )),
    transactionRetryCount: statistics(warm.map(
      (sample) => sample.observation.metrics.transactionRetryCount,
    )),
    queryDurationMs: statistics(warm.map(
      (sample) => sample.observation.metrics.queryDurationMs,
    )),
  });

  return Object.freeze({
    ...common,
    status: "READY" as const,
    mode: mode!,
    scenarioDigest: scenarioDigest!,
    dimensions,
  });
}

function normalizeSamples(value: unknown, path: string): readonly PressureGameReadAcceptanceSampleV1[] {
  if (!Array.isArray(value)) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_FIELD,
      path,
    );
  }
  assertDenseSummaryArray(value, path);
  const result: PressureGameReadAcceptanceSampleV1[] = [];
  const sampleIndices = new Set<number>();
  const requestDigests = new Set<string>();
  let expectedMode: PressureGameReadModeV1 | null = null;
  let expectedScenarioDigest: string | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const samplePath = `${path}[${index}]`;
    const sample = summaryRecord(value[index], samplePath);
    exactSummaryKeys(sample, SAMPLE_KEYS, samplePath);
    const sampleIndex = summaryNonNegativeSafeInteger(
      sample.sampleIndex,
      `${samplePath}.sampleIndex`,
    );
    if (sampleIndices.has(sampleIndex)) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.DUPLICATE_VALUE,
        `${samplePath}.sampleIndex`,
      );
    }
    sampleIndices.add(sampleIndex);
    const samplePhase = summaryEnum(
      sample.samplePhase,
      SAMPLE_PHASES,
      `${samplePath}.samplePhase`,
    );
    const observation = validatePressureGameReadObservationV1(sample.observation);
    if (requestDigests.has(observation.requestDigest)) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.DUPLICATE_VALUE,
        `${samplePath}.observation.requestDigest`,
      );
    }
    requestDigests.add(observation.requestDigest);

    expectedMode ??= observation.mode;
    expectedScenarioDigest ??= observation.scenarioDigest;
    if (observation.mode !== expectedMode) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
        `${samplePath}.observation.mode`,
      );
    }
    if (observation.scenarioDigest !== expectedScenarioDigest) {
      failPressureGameReadObservationContractV1(
        PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
        `${samplePath}.observation.scenarioDigest`,
      );
    }
    result.push(Object.freeze({ sampleIndex, samplePhase, observation }));
  }
  return Object.freeze(result);
}

function statistics(values: readonly number[]): PressureGameReadMetricStatisticsV1 {
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
  });
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  const oneBasedRank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[oneBasedRank - 1]!;
}

function summaryRecord(value: unknown, path: string): Record<string, unknown> {
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

function exactSummaryKeys(
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

function summaryEnum<const T extends readonly string[]>(
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

function summaryNonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    failPressureGameReadObservationContractV1(
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path,
    );
  }
  return value as number;
}

function assertDenseSummaryArray(value: readonly unknown[], path: string): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
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
