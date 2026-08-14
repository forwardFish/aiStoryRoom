import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1,
  PressureGameReadObservationContractErrorV1,
  createPressureGameReadObservationV1,
  validatePressureGameReadObservationV1,
  type CreatePressureGameReadObservationInputV1,
  type PressureGameReadModeV1,
  type PressureGameReadOutcomeV1,
  type PressureGameReadShadowStatusV1,
} from "./game-read-observation";
import {
  PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1,
  PRESSURE_GAME_READ_PERCENTILE_METHOD_V1,
  summarizePressureGameReadAcceptanceV1,
  type PressureGameReadAcceptanceSampleV1,
} from "./game-read-acceptance-summary";
import {
  PRESSURE_GAME_READ_ENDPOINT_V1,
  computePressureGameReadAcceptanceEvidenceHashV1,
  createPressureGameReadAcceptanceEvidenceV1,
  validatePressureGameReadAcceptanceEvidenceV1,
  type CreatePressureGameReadAcceptanceEvidenceInputV1,
} from "./game-read-acceptance-evidence";
import type { PressureDbRequestMetricsV1 } from "./pressure-db-metrics";

const BASE_COMMIT = "a98ef29c43545ebef985176e952fc756b33bcce1";
const BASE_BRANCH = "codex/chatgpt-pro-pressure-performance-v2";
const SCENARIO_DIGEST = digest("scenario:N1:solo:solo-beat:no-cursor:10");

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validMetrics(
  overrides: Partial<PressureDbRequestMetricsV1> = {},
): PressureDbRequestMetricsV1 {
  return {
    applicationSqlStatementCount: 4,
    databaseProtocolRoundtripCountIncludingBeginCommit: 8,
    transactionAttemptCount: 2,
    committedTransactionCount: 1,
    rolledBackTransactionCount: 1,
    transactionRetryCount: 1,
    queryDurationMs: 12.5,
    queryHashes: [digest("BEGIN"), digest("SELECT projection")],
    ...overrides,
  };
}

function validObservationInput(
  overrides: Partial<CreatePressureGameReadObservationInputV1> = {},
): CreatePressureGameReadObservationInputV1 {
  const mode = overrides.mode ?? "REPLAY";
  const startedAtMs = overrides.startedAtMs ?? 1_000;
  const wallTimeMs = overrides.wallTimeMs ?? 25;
  return {
    mode,
    shadowStatus: overrides.shadowStatus ?? (mode === "SHADOW" ? "MATCH" : "NOT_RUN"),
    outcome: overrides.outcome ?? "SUCCESS",
    requestDigest: overrides.requestDigest ?? digest("request:base"),
    scenarioDigest: overrides.scenarioDigest ?? SCENARIO_DIGEST,
    startedAtMs,
    finishedAtMs: overrides.finishedAtMs ?? startedAtMs + wallTimeMs,
    wallTimeMs,
    metrics: overrides.metrics ?? validMetrics(),
    observabilityFailure: overrides.observabilityFailure ?? false,
  };
}

function assertContractError(
  operation: () => unknown,
  code: string,
  path: string,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof PressureGameReadObservationContractErrorV1);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    assert.equal(error.message, `${code}:${path}`);
    return true;
  });
}

test("constructs every outcome and every legal shadow status without reference leakage", () => {
  const cases: ReadonlyArray<{
    mode: PressureGameReadModeV1;
    shadowStatus: PressureGameReadShadowStatusV1;
    outcome: PressureGameReadOutcomeV1;
  }> = [
    { mode: "REPLAY", shadowStatus: "NOT_RUN", outcome: "SUCCESS" },
    { mode: "FAST", shadowStatus: "NOT_RUN", outcome: "BUSINESS_ERROR" },
    { mode: "SHADOW", shadowStatus: "MATCH", outcome: "DEPENDENCY_ERROR" },
    { mode: "SHADOW", shadowStatus: "MISMATCH", outcome: "INTERNAL_ERROR" },
    { mode: "SHADOW", shadowStatus: "ERROR", outcome: "SUCCESS" },
  ];

  for (const [index, item] of cases.entries()) {
    const input = validObservationInput({
      ...item,
      requestDigest: digest(`request:${index}`),
      observabilityFailure: item.shadowStatus === "ERROR",
    });
    const observation = createPressureGameReadObservationV1(input);
    assert.equal(observation.schemaVersion, "pressure_game_read_observation_v1");
    assert.equal(observation.mode, item.mode);
    assert.equal(observation.shadowStatus, item.shadowStatus);
    assert.equal(observation.outcome, item.outcome);
    assert.equal(observation.wallTimeMs, observation.finishedAtMs - observation.startedAtMs);
    assert.ok(Object.isFrozen(observation));
    assert.ok(Object.isFrozen(observation.metrics));
    assert.ok(Object.isFrozen(observation.metrics.queryHashes));
    assert.deepEqual(structuredClone(observation), JSON.parse(JSON.stringify(observation)));
    assert.deepEqual(validatePressureGameReadObservationV1(observation), observation);
  }
});

test("enforces the REPLAY/FAST/SHADOW status matrix", () => {
  const invalid: ReadonlyArray<[PressureGameReadModeV1, PressureGameReadShadowStatusV1]> = [
    ["REPLAY", "MATCH"],
    ["REPLAY", "MISMATCH"],
    ["FAST", "ERROR"],
    ["SHADOW", "NOT_RUN"],
  ];
  for (const [mode, shadowStatus] of invalid) {
    assertContractError(
      () => createPressureGameReadObservationV1(validObservationInput({ mode, shadowStatus })),
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      "observation.shadowStatus",
    );
  }
});

test("fails closed for invalid timestamps and inconsistent wall time", () => {
  const cases: ReadonlyArray<{
    input: CreatePressureGameReadObservationInputV1;
    code: string;
    path: string;
  }> = [
    {
      input: validObservationInput({ startedAtMs: Number.NaN }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.startedAtMs",
    },
    {
      input: validObservationInput({ startedAtMs: -1, finishedAtMs: 24 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.startedAtMs",
    },
    {
      input: validObservationInput({ finishedAtMs: Number.MAX_SAFE_INTEGER + 1 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.finishedAtMs",
    },
    {
      input: validObservationInput({ finishedAtMs: 1_025, wallTimeMs: Number.NaN }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.wallTimeMs",
    },
    {
      input: validObservationInput({ finishedAtMs: 1_000, wallTimeMs: -1 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.wallTimeMs",
    },
    {
      input: validObservationInput({ finishedAtMs: 1_000, wallTimeMs: Number.MAX_SAFE_INTEGER + 1 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.wallTimeMs",
    },
    {
      input: validObservationInput({ wallTimeMs: 1.5, finishedAtMs: 1_001.5 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.finishedAtMs",
    },
    {
      input: validObservationInput({ startedAtMs: 1_000, finishedAtMs: 999, wallTimeMs: 0 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      path: "observation.wallTimeMs",
    },
    {
      input: validObservationInput({ startedAtMs: 1_000, finishedAtMs: 1_030, wallTimeMs: 29 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      path: "observation.wallTimeMs",
    },
  ];
  for (const item of cases) {
    assertContractError(() => createPressureGameReadObservationV1(item.input), item.code, item.path);
  }
});

test("validates metrics, transaction consistency, lowercase hashes, and cloning", () => {
  const invalidMetrics: ReadonlyArray<{
    metrics: PressureDbRequestMetricsV1;
    code: string;
    path: string;
  }> = [
    {
      metrics: validMetrics({ applicationSqlStatementCount: -1 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.metrics.applicationSqlStatementCount",
    },
    {
      metrics: validMetrics({ databaseProtocolRoundtripCountIncludingBeginCommit: Number.NaN }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.metrics.databaseProtocolRoundtripCountIncludingBeginCommit",
    },
    {
      metrics: validMetrics({ queryDurationMs: Number.NaN }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_NUMBER,
      path: "observation.metrics.queryDurationMs",
    },
    {
      metrics: validMetrics({ applicationSqlStatementCount: 9, databaseProtocolRoundtripCountIncludingBeginCommit: 8 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      path: "observation.metrics.applicationSqlStatementCount",
    },
    {
      metrics: validMetrics({ transactionAttemptCount: 3 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      path: "observation.metrics.transactionAttemptCount",
    },
    {
      metrics: validMetrics({ transactionRetryCount: 2 }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      path: "observation.metrics.transactionRetryCount",
    },
    {
      metrics: validMetrics({
        transactionAttemptCount: 1,
        committedTransactionCount: 0,
        rolledBackTransactionCount: 1,
        transactionRetryCount: 1,
      }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      path: "observation.metrics.transactionRetryCount",
    },
    {
      metrics: validMetrics({ queryHashes: [digest("query").toUpperCase()] }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_DIGEST,
      path: "observation.metrics.queryHashes[0]",
    },
    {
      metrics: validMetrics({ queryHashes: ["a".repeat(63)] }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_DIGEST,
      path: "observation.metrics.queryHashes[0]",
    },
    {
      metrics: validMetrics({ queryHashes: [digest("same"), digest("same")] }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.DUPLICATE_VALUE,
      path: "observation.metrics.queryHashes[1]",
    },
    {
      metrics: validMetrics({
        databaseProtocolRoundtripCountIncludingBeginCommit: 1,
        applicationSqlStatementCount: 1,
        queryHashes: [digest("one"), digest("two")],
      }),
      code: PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
      path: "observation.metrics.queryHashes",
    },
  ];

  for (const item of invalidMetrics) {
    assertContractError(
      () => createPressureGameReadObservationV1(validObservationInput({ metrics: item.metrics })),
      item.code,
      item.path,
    );
  }

  const metrics = validMetrics();
  const originalFirstHash = metrics.queryHashes[0]!;
  const observation = createPressureGameReadObservationV1(validObservationInput({ metrics }));
  metrics.applicationSqlStatementCount = 99;
  metrics.queryHashes[0] = digest("mutated");
  metrics.queryHashes.push(digest("extra"));
  assert.equal(observation.metrics.applicationSqlStatementCount, 4);
  assert.equal(observation.metrics.queryHashes.length, 2);
  assert.equal(observation.metrics.queryHashes[0], originalFirstHash);

  const accessorInput = validObservationInput();
  Object.defineProperty(accessorInput, "mode", {
    enumerable: true,
    get: () => "REPLAY",
  });
  assertContractError(
    () => createPressureGameReadObservationV1(accessorInput),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_OBJECT,
    "input",
  );

  const hiddenFieldInput = validObservationInput();
  Object.defineProperty(hiddenFieldInput, "rawSql", {
    enumerable: false,
    value: "SELECT forbidden",
  });
  assertContractError(
    () => createPressureGameReadObservationV1(hiddenFieldInput),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_OBJECT,
    "input",
  );
});

test("returns explicit insufficiency for empty or fewer than ten warm samples", () => {
  const empty = summarizePressureGameReadAcceptanceV1({ samples: [] });
  assert.deepEqual(empty, {
    schemaVersion: "pressure_game_read_acceptance_summary_v1",
    percentileMethod: PRESSURE_GAME_READ_PERCENTILE_METHOD_V1,
    minimumWarmSampleCount: PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1,
    totalSampleCount: 0,
    coldSampleCount: 0,
    warmSampleCount: 0,
    mode: null,
    scenarioDigest: null,
    status: "INSUFFICIENT_SAMPLES",
    dimensions: null,
  });
  assert.doesNotMatch(JSON.stringify(empty), /p95/u);

  const samples = makeSamples(9, "WARM");
  samples.unshift(makeSample(0, "COLD", 5, 5_000));
  const insufficient = summarizePressureGameReadAcceptanceV1({ samples });
  assert.equal(insufficient.status, "INSUFFICIENT_SAMPLES");
  assert.equal(insufficient.totalSampleCount, 10);
  assert.equal(insufficient.coldSampleCount, 1);
  assert.equal(insufficient.warmSampleCount, 9);
  assert.equal(insufficient.dimensions, null);
  assert.doesNotMatch(JSON.stringify(insufficient), /p95/u);
});

test("summarizes ten warm samples with deterministic nearest-rank p50/p95", () => {
  const samples = Array.from({ length: 10 }, (_, index) => {
    const oneBased = index + 1;
    return makeSample(oneBased, "WARM", oneBased * 10, (10 - index) * 100);
  });
  const summary = summarizePressureGameReadAcceptanceV1({ samples });
  assert.equal(summary.status, "READY");
  assert.equal(summary.percentileMethod, "NEAREST_RANK");
  assert.equal(summary.warmSampleCount, 10);
  assert.equal(summary.mode, "REPLAY");
  assert.equal(summary.scenarioDigest, SCENARIO_DIGEST);
  if (summary.status !== "READY") assert.fail("summary must be READY");

  assert.deepEqual(summary.dimensions.wallTimeMs, {
    count: 10,
    min: 10,
    max: 100,
    p50: 50,
    p95: 100,
  });
  assert.deepEqual(summary.dimensions.applicationSqlStatementCount, {
    count: 10,
    min: 1,
    max: 10,
    p50: 5,
    p95: 10,
  });
  assert.deepEqual(summary.dimensions.databaseProtocolRoundtripCountIncludingBeginCommit, {
    count: 10,
    min: 3,
    max: 12,
    p50: 7,
    p95: 12,
  });
  assert.deepEqual(summary.dimensions.queryDurationMs, {
    count: 10,
    min: 100,
    max: 1_000,
    p50: 500,
    p95: 1_000,
  });
  assert.notEqual(summary.dimensions.wallTimeMs.p50, summary.dimensions.queryDurationMs.p50);
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(summary.dimensions));
  assert.ok(Object.isFrozen(summary.dimensions.wallTimeMs));
});

test("rejects malformed, duplicated, or mixed acceptance samples", () => {
  const first = makeSample(1, "WARM", 10, 100);
  const second = makeSample(2, "WARM", 20, 200);

  assertContractError(
    () => summarizePressureGameReadAcceptanceV1({ samples: [first, { ...second, sampleIndex: 1 }] }),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.DUPLICATE_VALUE,
    "input.samples[1].sampleIndex",
  );
  assertContractError(
    () => summarizePressureGameReadAcceptanceV1({
      samples: [first, { ...second, observation: first.observation }],
    }),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.DUPLICATE_VALUE,
    "input.samples[1].observation.requestDigest",
  );
  assertContractError(
    () => summarizePressureGameReadAcceptanceV1({
      samples: [first, {
        ...second,
        observation: createPressureGameReadObservationV1(validObservationInput({
          mode: "FAST",
          shadowStatus: "NOT_RUN",
          requestDigest: digest("mixed-mode"),
        })),
      }],
    }),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
    "input.samples[1].observation.mode",
  );
  assertContractError(
    () => summarizePressureGameReadAcceptanceV1({
      samples: [first, {
        ...second,
        observation: createPressureGameReadObservationV1(validObservationInput({
          requestDigest: digest("mixed-scenario-request"),
          scenarioDigest: digest("other-scenario"),
        })),
      }],
    }),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
    "input.samples[1].observation.scenarioDigest",
  );
  assertContractError(
    () => summarizePressureGameReadAcceptanceV1({
      samples: [{ ...first, privatePayload: "forbidden" } as PressureGameReadAcceptanceSampleV1],
    }),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
    "input.samples[0].*",
  );
});

test("constructs cleanup success/failure evidence and independently recomputes the hash", () => {
  const succeeded = createPressureGameReadAcceptanceEvidenceV1(validEvidenceInput());
  const failed = createPressureGameReadAcceptanceEvidenceV1(validEvidenceInput({
    sampleIndex: 2,
    cleanupStatus: "FAILED",
  }));

  assert.equal(succeeded.endpoint, PRESSURE_GAME_READ_ENDPOINT_V1);
  assert.equal(succeeded.branch, BASE_BRANCH);
  assert.equal(succeeded.commitSha, BASE_COMMIT);
  assert.equal(succeeded.chapter, "N1");
  assert.equal(succeeded.participantMode, "SOLO");
  assert.equal(succeeded.decisionMode, "SOLO_BEAT");
  assert.equal(succeeded.feedCursorPresent, false);
  assert.equal(succeeded.feedLimit, 10);
  assert.equal(succeeded.supabaseRegion, "ap-northeast-1");
  assert.equal(succeeded.cleanupStatus, "SUCCEEDED");
  assert.equal(failed.cleanupStatus, "FAILED");
  assert.match(succeeded.evidenceHash, /^[a-f0-9]{64}$/u);
  const { evidenceHash, ...payload } = succeeded;
  assert.equal(evidenceHash, computePressureGameReadAcceptanceEvidenceHashV1(payload));
  assert.deepEqual(validatePressureGameReadAcceptanceEvidenceV1(succeeded), succeeded);

  assertContractError(
    () => createPressureGameReadAcceptanceEvidenceV1({
      ...validEvidenceInput(),
      chapter: "N8",
    } as unknown as CreatePressureGameReadAcceptanceEvidenceInputV1),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_ENUM,
    "evidence.chapter",
  );

  const tampered = structuredClone(succeeded);
  (tampered as { sampleIndex: number }).sampleIndex += 1;
  assertContractError(
    () => validatePressureGameReadAcceptanceEvidenceV1(tampered),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INCONSISTENT_VALUE,
    "evidence.evidenceHash",
  );
});

test("evidence rejects raw identifiers and sensitive or unapproved payload fields", () => {
  const rawRunId = "run-private-9f2a";
  const rawSubjectId = "subject-private-b71c";
  const rawSeatId = "seat-private-42";
  const rawSql = "SELECT private_payload FROM secret_table";
  const rawParams = "params-secret-123";
  const connectionString = "postgresql://private:password@example.invalid/database";
  const providerOutput = "provider-private-output";
  const privatePayload = "private-payload-sentinel";
  const evidence = createPressureGameReadAcceptanceEvidenceV1(validEvidenceInput({
    runDigest: digest(rawRunId),
    viewerDigest: digest(rawSubjectId),
    seatDigest: digest(rawSeatId),
  }));
  const serialized = JSON.stringify(evidence);
  for (const secret of [
    rawRunId,
    rawSubjectId,
    rawSeatId,
    rawSql,
    rawParams,
    connectionString,
    providerOutput,
    privatePayload,
  ]) {
    assert.doesNotMatch(serialized, new RegExp(escapeRegExp(secret), "u"));
  }

  const extraTopLevelCases = [
    { field: "runId", value: rawRunId },
    { field: "subjectId", value: rawSubjectId },
    { field: "privatePayload", value: privatePayload },
    { field: "providerOutput", value: providerOutput },
  ] as const;
  for (const item of extraTopLevelCases) {
    const input = { ...validEvidenceInput(), [item.field]: item.value };
    assertContractError(
      () => createPressureGameReadAcceptanceEvidenceV1(input as CreatePressureGameReadAcceptanceEvidenceInputV1),
      PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
      "input.*",
    );
  }

  const withConnectionString = validEvidenceInput();
  (withConnectionString.connectionPool as unknown as Record<string, unknown>).connectionString = connectionString;
  assertContractError(
    () => createPressureGameReadAcceptanceEvidenceV1(withConnectionString),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
    "evidence.connectionPool.*",
  );

  const rawMetricsBase = validEvidenceInput();
  const withRawMetrics = {
    ...rawMetricsBase,
    observation: {
      ...rawMetricsBase.observation,
      metrics: {
        ...rawMetricsBase.observation.metrics,
        rawSql,
        params: rawParams,
      },
    },
  } as CreatePressureGameReadAcceptanceEvidenceInputV1;
  assertContractError(
    () => createPressureGameReadAcceptanceEvidenceV1(withRawMetrics),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.UNKNOWN_FIELD,
    "observation.metrics.*",
  );

  assertContractError(
    () => createPressureGameReadAcceptanceEvidenceV1(validEvidenceInput({
      runDigest: rawRunId,
    })),
    PRESSURE_GAME_READ_OBSERVATION_ERROR_CODES_V1.INVALID_DIGEST,
    "evidence.runDigest",
  );
});

test("evidence clones and freezes all nested mutable inputs", () => {
  const input = validEvidenceInput();
  const pool = input.connectionPool;
  const ownership = input.workerOwnership;
  const evidence = createPressureGameReadAcceptanceEvidenceV1(input);

  (pool as { connectionLimit: number }).connectionLimit = 50;
  (ownership as { ownsWorkerLanes: boolean }).ownsWorkerLanes = false;
  assert.equal(evidence.connectionPool.connectionLimit, 5);
  assert.equal(evidence.workerOwnership.ownsWorkerLanes, true);
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.connectionPool));
  assert.ok(Object.isFrozen(evidence.workerOwnership));
  assert.ok(Object.isFrozen(evidence.observation));
  assert.deepEqual(structuredClone(evidence), JSON.parse(JSON.stringify(evidence)));
});

test("concurrent pure construction does not share mutable state or cross samples", async () => {
  const evidence = await Promise.all(Array.from({ length: 40 }, async (_, index) => {
    await Promise.resolve();
    const observation = createPressureGameReadObservationV1(validObservationInput({
      requestDigest: digest(`concurrent-request:${index}`),
      startedAtMs: 10_000 + index * 100,
      finishedAtMs: 10_010 + index * 100,
      wallTimeMs: 10,
      metrics: validMetrics({
        queryHashes: [digest(`concurrent-query:${index}`)],
      }),
    }));
    return createPressureGameReadAcceptanceEvidenceV1(validEvidenceInput({
      sampleIndex: index,
      observation,
    }));
  }));

  assert.equal(new Set(evidence.map((item) => item.evidenceHash)).size, evidence.length);
  assert.equal(new Set(evidence.map((item) => item.observation.requestDigest)).size, evidence.length);
  for (const [index, item] of evidence.entries()) {
    assert.equal(item.sampleIndex, index);
    assert.equal(item.observation.wallTimeMs, 10);
    assert.equal(item.observation.metrics.queryHashes[0], digest(`concurrent-query:${index}`));
  }
});

function makeSamples(
  count: number,
  phase: "COLD" | "WARM",
): PressureGameReadAcceptanceSampleV1[] {
  return Array.from({ length: count }, (_, index) => (
    makeSample(index + 1, phase, (index + 1) * 10, (index + 1) * 100)
  ));
}

function makeSample(
  sampleIndex: number,
  samplePhase: "COLD" | "WARM",
  wallTimeMs: number,
  queryDurationMs: number,
): PressureGameReadAcceptanceSampleV1 {
  const applicationSqlStatementCount = Math.max(1, sampleIndex);
  return {
    sampleIndex,
    samplePhase,
    observation: createPressureGameReadObservationV1(validObservationInput({
      requestDigest: digest(`summary-request:${sampleIndex}:${samplePhase}`),
      startedAtMs: 100_000 + sampleIndex * 1_000,
      finishedAtMs: 100_000 + sampleIndex * 1_000 + wallTimeMs,
      wallTimeMs,
      metrics: validMetrics({
        applicationSqlStatementCount,
        databaseProtocolRoundtripCountIncludingBeginCommit: applicationSqlStatementCount + 2,
        transactionAttemptCount: 1,
        committedTransactionCount: 1,
        rolledBackTransactionCount: 0,
        transactionRetryCount: 0,
        queryDurationMs,
        queryHashes: [digest(`summary-query:${sampleIndex}:${samplePhase}`)],
      }),
    })),
  };
}

function validEvidenceInput(
  overrides: Partial<CreatePressureGameReadAcceptanceEvidenceInputV1> = {},
): CreatePressureGameReadAcceptanceEvidenceInputV1 {
  const observation = overrides.observation ?? createPressureGameReadObservationV1(
    validObservationInput({ requestDigest: digest(`evidence-request:${overrides.sampleIndex ?? 1}`) }),
  );
  return {
    endpoint: PRESSURE_GAME_READ_ENDPOINT_V1,
    branch: BASE_BRANCH,
    commitSha: BASE_COMMIT,
    mode: observation.mode,
    chapter: "N1",
    participantMode: "SOLO",
    decisionMode: "SOLO_BEAT",
    feedCursorPresent: false,
    feedLimit: 10,
    supabaseRegion: "ap-northeast-1",
    connectionPool: {
      kind: "TRANSACTION_POOLER",
      connectionLimit: 5,
      poolTimeoutSeconds: 20,
    },
    workerOwnership: {
      processRole: "api",
      configuredOwner: "embedded_api",
      topology: "embedded",
      ownsWorkerLanes: true,
      ready: true,
    },
    runDigest: digest("run:acceptance"),
    viewerDigest: digest("viewer:acceptance"),
    seatDigest: digest("seat:acceptance"),
    samplePhase: "WARM",
    sampleIndex: 1,
    cleanupStatus: "SUCCEEDED",
    ...overrides,
    observation,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
