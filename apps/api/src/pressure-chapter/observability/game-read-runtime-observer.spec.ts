import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setImmediate } from "node:timers";
import type {
  PressureGameReadShadowDiagnosticV1,
} from "../game-projection/game-read-mode-selector";
import {
  recordPressureDbQueryV1,
  withPressureDbRequestMetricsV1,
} from "./pressure-db-metrics";
import {
  EnvironmentPressureGameReadObservationSinkV1,
  PRESSURE_GAME_READ_OBSERVATION_LOG_ENV_V1,
  PressureGameReadRuntimeObserverV1,
  classifyPressureGameReadOutcomeV1,
  type PressureGameReadObservationSinkV1,
  type PressureGameReadSafeRequestInputV1,
} from "./game-read-runtime-observer";
import type {
  PressureGameReadModeV1,
  PressureGameReadObservationV1,
  PressureGameReadShadowStatusV1,
} from "./game-read-observation";

const SAFE_INPUT: PressureGameReadSafeRequestInputV1 = Object.freeze({
  roomId: "room-secret-alpha",
  principal: Object.freeze({
    subjectId: "subject-secret-alpha",
    viewerId: "viewer-secret-alpha",
  }),
  query: Object.freeze({
    feedCursor: "cursor-secret-alpha",
    feedLimit: 7,
  }),
});

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function queryHash(query: string): string {
  return sha256(query.replace(/\s+/gu, " ").trim().toUpperCase());
}

function sequenceClock(start = 1_000) {
  let value = start;
  return { nowMs: () => value++ };
}

function sequenceNonce(prefix = "nonce") {
  let value = 0;
  return { createNonce: () => `${prefix}-${value++}` };
}

function diagnostic(
  status: Exclude<PressureGameReadShadowStatusV1, "NOT_RUN">,
): PressureGameReadShadowDiagnosticV1 {
  if (status === "ERROR") {
    return Object.freeze({
      schemaVersion: "pressure_game_read_shadow_diagnostic_v1",
      mode: "SHADOW",
      outcome: "ERROR",
      stage: "SNAPSHOT",
    });
  }
  const match = status === "MATCH";
  return Object.freeze({
    schemaVersion: "pressure_game_read_shadow_diagnostic_v1",
    mode: "SHADOW",
    outcome: status,
    stage: "COMPARE",
    deepEqual: match,
    canonicalEqual: true,
  });
}

async function observed<T>(input: {
  observer: PressureGameReadRuntimeObserverV1;
  mode: PressureGameReadModeV1;
  operation: () => Promise<T>;
  safeInput?: PressureGameReadSafeRequestInputV1;
}): Promise<T> {
  try {
    return await withPressureDbRequestMetricsV1(() => input.observer.observe(
      input.mode,
      input.safeInput ?? SAFE_INPUT,
      input.operation,
    ));
  } finally {
    await flushObservationDelivery();
  }
}

async function flushObservationDelivery(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("success preserves the exact result and captures request-local DB metrics plus integer wall time", async () => {
  const observations: PressureGameReadObservationV1[] = [];
  const times = [10_000, 10_025];
  const observer = new PressureGameReadRuntimeObserverV1({
    sink: { write: (value) => { observations.push(value); } },
    clock: { nowMs: () => times.shift()! },
    nonce: { createNonce: () => "success-nonce" },
  });
  const result = Object.freeze({ exact: "business-result" });

  const returned = await observed({
    observer,
    mode: "REPLAY",
    operation: async () => {
      recordPressureDbQueryV1(" select  *   from pressure_read ", 3.5);
      return result;
    },
  });

  assert.equal(returned, result);
  assert.equal(observations.length, 1);
  const value = observations[0]!;
  assert.equal(value.mode, "REPLAY");
  assert.equal(value.shadowStatus, "NOT_RUN");
  assert.equal(value.outcome, "SUCCESS");
  assert.equal(value.startedAtMs, 10_000);
  assert.equal(value.finishedAtMs, 10_025);
  assert.equal(value.wallTimeMs, 25);
  assert.equal(value.finishedAtMs - value.startedAtMs, value.wallTimeMs);
  assert.deepEqual(value.metrics, {
    applicationSqlStatementCount: 1,
    databaseProtocolRoundtripCountIncludingBeginCommit: 1,
    transactionAttemptCount: 0,
    committedTransactionCount: 0,
    rolledBackTransactionCount: 0,
    transactionRetryCount: 0,
    queryDurationMs: 3.5,
    queryHashes: [queryHash(" select  *   from pressure_read ")],
  });
  assert.equal(value.observabilityFailure, false);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.metrics));
  assert.ok(Object.isFrozen(value.metrics.queryHashes));
});

test("classifies and rethrows the exact error object for every non-success outcome", async () => {
  const cases: ReadonlyArray<{
    expected: "BUSINESS_ERROR" | "DEPENDENCY_ERROR" | "INTERNAL_ERROR";
    error: unknown;
  }> = [
    {
      expected: "BUSINESS_ERROR",
      error: Object.assign(new Error("private invalid request"), {
        code: "PRESSURE_HTTP_INPUT_INVALID",
      }),
    },
    {
      expected: "DEPENDENCY_ERROR",
      error: Object.assign(new Error("private database address"), { code: "P1001" }),
    },
    {
      expected: "INTERNAL_ERROR",
      error: new Error("private programmer failure"),
    },
  ];

  for (const [index, item] of cases.entries()) {
    const observations: PressureGameReadObservationV1[] = [];
    const observer = new PressureGameReadRuntimeObserverV1({
      sink: { write: (value) => { observations.push(value); } },
      clock: sequenceClock(20_000 + index * 10),
      nonce: { createNonce: () => `outcome-${index}` },
    });
    let caught: unknown;
    try {
      await observed({
        observer,
        mode: "FAST",
        operation: async () => { throw item.error; },
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, item.error, "observer must rethrow the identical object");
    assert.equal(observations.length, 1);
    assert.equal(observations[0]!.outcome, item.expected);
    assert.equal(observations[0]!.mode, "FAST");
    assert.equal(observations[0]!.shadowStatus, "NOT_RUN");
    assert.equal(JSON.stringify(observations).includes("private"), false);
  }

  assert.equal(
    classifyPressureGameReadOutcomeV1({
      code: "PRESSURE_HTTP_DEPENDENCY_FAILURE",
    }),
    "DEPENDENCY_ERROR",
  );
  assert.equal(
    classifyPressureGameReadOutcomeV1({ code: "P2002" }),
    "BUSINESS_ERROR",
    "Prisma unique conflicts map to the same public business outcome as HTTP",
  );
});

test("enforces REPLAY/FAST NOT_RUN and captures each SHADOW result fail-closed", async () => {
  const observations: PressureGameReadObservationV1[] = [];
  const observer = new PressureGameReadRuntimeObserverV1({
    sink: { write: (value) => { observations.push(value); } },
    clock: sequenceClock(30_000),
    nonce: sequenceNonce("status"),
  });

  for (const mode of ["REPLAY", "FAST"] as const) {
    await observed({ observer, mode, operation: async () => mode });
  }
  for (const status of ["MATCH", "MISMATCH", "ERROR"] as const) {
    await observed({
      observer,
      mode: "SHADOW",
      operation: async () => {
        observer.report(diagnostic(status));
        return status;
      },
    });
  }
  await observed({
    observer,
    mode: "SHADOW",
    operation: async () => "missing-diagnostic",
  });

  assert.deepEqual(
    observations.map((value) => [
      value.mode,
      value.shadowStatus,
      value.observabilityFailure,
    ]),
    [
      ["REPLAY", "NOT_RUN", false],
      ["FAST", "NOT_RUN", false],
      ["SHADOW", "MATCH", false],
      ["SHADOW", "MISMATCH", false],
      ["SHADOW", "ERROR", true],
      ["SHADOW", "ERROR", true],
    ],
  );
});

test("invalid or duplicate SHADOW diagnostics become ERROR without changing the business result", async () => {
  const observations: PressureGameReadObservationV1[] = [];
  const observer = new PressureGameReadRuntimeObserverV1({
    sink: { write: (value) => { observations.push(value); } },
    clock: sequenceClock(40_000),
    nonce: sequenceNonce("invalid-diagnostic"),
  });
  const result = { exact: true };

  const first = await observed({
    observer,
    mode: "SHADOW",
    operation: async () => {
      observer.report({
        ...diagnostic("MATCH"),
        outcome: "MISMATCH",
      } as PressureGameReadShadowDiagnosticV1);
      return result;
    },
  });
  const second = await observed({
    observer,
    mode: "SHADOW",
    operation: async () => {
      observer.report(diagnostic("MATCH"));
      observer.report(diagnostic("MATCH"));
      return result;
    },
  });

  assert.equal(first, result);
  assert.equal(second, result);
  assert.deepEqual(
    observations.map((value) => [value.shadowStatus, value.observabilityFailure]),
    [["ERROR", true], ["ERROR", true]],
  );
});

test("clock, nonce, and request-material failures stay isolated and still emit a valid failure-marked observation", async () => {
  const observations: PressureGameReadObservationV1[] = [];
  const observer = new PressureGameReadRuntimeObserverV1({
    sink: { write: (value) => { observations.push(value); } },
    clock: { nowMs: () => { throw new Error("private clock failure"); } },
    nonce: { createNonce: () => { throw new Error("private nonce failure"); } },
  });
  const hostile = new Proxy(Object.create(null) as object, {
    ownKeys: () => { throw new Error("private request material failure"); },
  });
  const exact = Object.freeze({ exact: "clock-nonce-material-result" });

  const result = await observed({
    observer,
    mode: "FAST",
    safeInput: { roomId: hostile, principal: hostile, query: hostile },
    operation: async () => exact,
  });

  assert.equal(result, exact);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]!.mode, "FAST");
  assert.equal(observations[0]!.shadowStatus, "NOT_RUN");
  assert.equal(observations[0]!.outcome, "SUCCESS");
  assert.equal(observations[0]!.observabilityFailure, true);
  assert.equal(observations[0]!.finishedAtMs, observations[0]!.startedAtMs);
  assert.equal(observations[0]!.wallTimeMs, 0);
  assert.match(observations[0]!.requestDigest, /^[0-9a-f]{64}$/u);
  assert.match(observations[0]!.scenarioDigest, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(observations).includes("private"), false);
});

test("missing metrics emit a valid zero snapshot marked as an observability failure", async () => {
  const observations: PressureGameReadObservationV1[] = [];
  const observer = new PressureGameReadRuntimeObserverV1({
    sink: { write: (value) => { observations.push(value); } },
    clock: sequenceClock(50_000),
    nonce: { createNonce: () => "missing-metrics" },
  });
  const exact = { value: 1 };

  const result = await observer.observe("REPLAY", SAFE_INPUT, async () => exact);
  await flushObservationDelivery();

  assert.equal(result, exact);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0]!.metrics, {
    applicationSqlStatementCount: 0,
    databaseProtocolRoundtripCountIncludingBeginCommit: 0,
    transactionAttemptCount: 0,
    committedTransactionCount: 0,
    rolledBackTransactionCount: 0,
    transactionRetryCount: 0,
    queryDurationMs: 0,
    queryHashes: [],
  });
  assert.equal(observations[0]!.observabilityFailure, true);
});

test("synchronous and asynchronous sink failures never delay, replace, or swallow business settlement", async () => {
  const deliveryOrder: string[] = [];
  const timingObserver = new PressureGameReadRuntimeObserverV1({
    sink: { write: () => { deliveryOrder.push("sink"); } },
    clock: sequenceClock(59_000),
    nonce: { createNonce: () => "deferred-sink" },
  });
  const exactTimingResult = Object.freeze({ exact: "settled-before-sink" });
  assert.equal(
    await withPressureDbRequestMetricsV1(() => timingObserver.observe(
      "REPLAY",
      SAFE_INPUT,
      async () => exactTimingResult,
    )),
    exactTimingResult,
  );
  assert.deepEqual(deliveryOrder, []);
  await flushObservationDelivery();
  assert.deepEqual(deliveryOrder, ["sink"]);

  const sinkErrors = [
    new Error("private synchronous sink failure"),
    new Error("private asynchronous sink failure"),
  ];
  const sinks: PressureGameReadObservationSinkV1[] = [
    { write: () => { throw sinkErrors[0]; } },
    { write: () => Promise.reject(sinkErrors[1]) },
  ];

  for (const [index, sink] of sinks.entries()) {
    const observer = new PressureGameReadRuntimeObserverV1({
      sink,
      clock: sequenceClock(60_000 + index * 10),
      nonce: { createNonce: () => `sink-${index}` },
    });
    const exact = { sink: index };
    assert.equal(
      await observed({ observer, mode: "REPLAY", operation: async () => exact }),
      exact,
    );

    const businessError = new Error(`business-${index}`);
    let caught: unknown;
    try {
      await observed({
        observer,
        mode: "REPLAY",
        operation: async () => { throw businessError; },
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, businessError);
  }
  await flushObservationDelivery();
});

test("scenario digests are stable, request digests are unique, and no raw request/SQL/error values escape", async () => {
  const observations: PressureGameReadObservationV1[] = [];
  const observer = new PressureGameReadRuntimeObserverV1({
    sink: { write: (value) => { observations.push(value); } },
    clock: sequenceClock(70_000),
    nonce: sequenceNonce("digest"),
  });

  await observed({
    observer,
    mode: "FAST",
    operation: async () => {
      recordPressureDbQueryV1("SELECT 'sql-secret-alpha'", 1);
      return undefined;
    },
  });
  await observed({ observer, mode: "FAST", operation: async () => undefined });
  await observed({
    observer,
    mode: "FAST",
    safeInput: {
      ...SAFE_INPUT,
      principal: {
        subjectId: "subject-secret-alpha",
        viewerId: "viewer-secret-beta",
      },
    },
    operation: async () => undefined,
  });
  await observed({ observer, mode: "REPLAY", operation: async () => undefined });

  assert.equal(observations[0]!.scenarioDigest, observations[1]!.scenarioDigest);
  assert.notEqual(observations[1]!.scenarioDigest, observations[2]!.scenarioDigest);
  assert.notEqual(observations[1]!.scenarioDigest, observations[3]!.scenarioDigest);
  assert.equal(
    new Set(observations.map((value) => value.requestDigest)).size,
    observations.length,
  );
  const serialized = JSON.stringify(observations);
  for (const forbidden of [
    "room-secret-alpha",
    "subject-secret-alpha",
    "viewer-secret-alpha",
    "viewer-secret-beta",
    "cursor-secret-alpha",
    "sql-secret-alpha",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("40 interleaved SHADOW requests keep diagnostic and Prisma metrics context isolated", async () => {
  const inputs = Array.from({ length: 40 }, (_, index) => ({
    roomId: `room-${index}`,
    principal: { subjectId: `subject-${index}`, viewerId: `viewer-${index}` },
    query: { feedCursor: `cursor-${index}`, feedLimit: (index % 10) + 1 },
  } satisfies PressureGameReadSafeRequestInputV1));

  const scenarioToIndex = new Map<string, number>();
  const mapping: PressureGameReadObservationV1[] = [];
  const mappingObserver = new PressureGameReadRuntimeObserverV1({
    sink: { write: (value) => { mapping.push(value); } },
    clock: sequenceClock(80_000),
    nonce: sequenceNonce("mapping"),
  });
  for (const [index, safeInput] of inputs.entries()) {
    await observed({
      observer: mappingObserver,
      mode: "SHADOW",
      safeInput,
      operation: async () => {
        mappingObserver.report(diagnostic("MATCH"));
        return index;
      },
    });
    scenarioToIndex.set(mapping.at(-1)!.scenarioDigest, index);
  }
  assert.equal(scenarioToIndex.size, 40);

  const observations: PressureGameReadObservationV1[] = [];
  const observer = new PressureGameReadRuntimeObserverV1({
    sink: { write: (value) => { observations.push(value); } },
    clock: sequenceClock(90_000),
    nonce: sequenceNonce("concurrent"),
  });
  const statuses = ["MATCH", "MISMATCH", "ERROR"] as const;

  const results = await Promise.all(inputs.map((safeInput, index) => observed({
    observer,
    mode: "SHADOW",
    safeInput,
    operation: async () => {
      await Promise.resolve();
      observer.report(diagnostic(statuses[index % statuses.length]!));
      await flushObservationDelivery();
      recordPressureDbQueryV1(`select ${index} as request_marker`, index);
      return index;
    },
  })));

  assert.deepEqual(results, Array.from({ length: 40 }, (_, index) => index));
  assert.equal(observations.length, 40);
  assert.equal(
    new Set(observations.map((value) => value.requestDigest)).size,
    40,
  );
  for (const value of observations) {
    const index = scenarioToIndex.get(value.scenarioDigest);
    assert.notEqual(index, undefined);
    const expectedIndex = index!;
    const expectedStatus = statuses[expectedIndex % statuses.length]!;
    assert.equal(value.shadowStatus, expectedStatus);
    assert.equal(value.observabilityFailure, expectedStatus === "ERROR");
    assert.equal(value.metrics.applicationSqlStatementCount, 1);
    assert.equal(value.metrics.databaseProtocolRoundtripCountIncludingBeginCommit, 1);
    assert.equal(value.metrics.queryDurationMs, expectedIndex);
    assert.deepEqual(value.metrics.queryHashes, [
      queryHash(`select ${expectedIndex} as request_marker`),
    ]);
  }
});

test("environment sink is no-op by default and writes one validated JSON line only when enabled", () => {
  const lines: string[] = [];
  const observation = Object.freeze({
    schemaVersion: "pressure_game_read_observation_v1",
    mode: "REPLAY",
    shadowStatus: "NOT_RUN",
    outcome: "SUCCESS",
    requestDigest: sha256("request"),
    scenarioDigest: sha256("scenario"),
    startedAtMs: 1,
    finishedAtMs: 2,
    wallTimeMs: 1,
    metrics: Object.freeze({
      applicationSqlStatementCount: 0,
      databaseProtocolRoundtripCountIncludingBeginCommit: 0,
      transactionAttemptCount: 0,
      committedTransactionCount: 0,
      rolledBackTransactionCount: 0,
      transactionRetryCount: 0,
      queryDurationMs: 0,
      queryHashes: Object.freeze([]),
    }),
    observabilityFailure: false,
  }) satisfies PressureGameReadObservationV1;

  new EnvironmentPressureGameReadObservationSinkV1({}, (line) => lines.push(line))
    .write(observation);
  new EnvironmentPressureGameReadObservationSinkV1(
    { [PRESSURE_GAME_READ_OBSERVATION_LOG_ENV_V1]: "1" },
    (line) => lines.push(line),
  ).write(observation);

  assert.deepEqual(lines, [JSON.stringify(observation)]);
  assert.deepEqual(JSON.parse(lines[0]!), observation);
});
