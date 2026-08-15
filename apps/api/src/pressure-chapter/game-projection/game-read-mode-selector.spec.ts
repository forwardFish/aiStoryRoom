import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type {
  PressureChapterGameProjectionV1,
  ReadPressureChapterGameProjectionQueryV1,
} from "./contracts";
import {
  PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
  type GameReadSnapshotResolvedSourcesV1,
  type GameReadSnapshotV1,
} from "./game-read-snapshot";
import {
  PRESSURE_GAME_READ_MODE_ERROR_CODES_V1,
  PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
  PressureGameReadModeErrorV1,
  PressureGameReadModeSelectorV1,
  parsePressureGameReadModeV1,
  type PressureGameReadModeSelectorDependenciesV1,
  type PressureGameReadModeV1,
  type PressureGameReadShadowDiagnosticV1,
  type PressureGameReadSnapshotCaptureRequestV1,
} from "./game-read-mode-selector";

const RUN_ID = "pressure-run-selector-1";
const SUBJECT_ID = "subject-selector-1";
const CAPTURED_AT_MS = 1_776_000_123_456;
const QUERY: Readonly<ReadPressureChapterGameProjectionQueryV1> = Object.freeze({
  runId: RUN_ID,
  subjectId: SUBJECT_ID,
  feedCursor: "opaque-feed-cursor",
  feedLimit: 7,
});

const acceptedModeCases: ReadonlyArray<readonly [unknown, PressureGameReadModeV1]> = [
  [undefined, "REPLAY"],
  ["", "REPLAY"],
  ["REPLAY", "REPLAY"],
  ["SHADOW", "SHADOW"],
  ["FAST", "FAST"],
];

for (const [input, expected] of acceptedModeCases) {
  test(`mode parser accepts ${String(input)} as ${expected}`, () => {
    assert.equal(parsePressureGameReadModeV1(input), expected);
  });
}

const rejectedModeCases: readonly unknown[] = [
  " ",
  "\t",
  "replay",
  "Replay",
  "REPLAY ",
  " REPLAY",
  "shadow",
  "SHADOW\n",
  "fast",
  "FAST ",
  "UNKNOWN",
  null,
  true,
  false,
  0,
  1,
  {},
  [],
];

for (const input of rejectedModeCases) {
  test(`mode parser rejects non-exact value ${JSON.stringify(input)}`, () => {
    assert.throws(
      () => parsePressureGameReadModeV1(input),
      (error: unknown) => (
        error instanceof PressureGameReadModeErrorV1
        && error.code === PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.MODE_INVALID
        && error.message === PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.MODE_INVALID
      ),
    );
  });
}

test("REPLAY invokes only legacy once and returns the exact legacy object", async () => {
  const legacy = projection("legacy");
  const harness = createHarness({ legacy });

  const result = await harness.selector.read("REPLAY", QUERY);

  assert.strictEqual(result, legacy);
  assert.deepEqual(harness.counts, zeroCounts({ legacy: 1 }));
  assert.deepEqual(harness.diagnostics, []);
  assert.equal(harness.snapshotRequest, null);
  assert.equal(harness.projectorSources, null);
});

test("REPLAY propagates the legacy error without touching candidate ports", async () => {
  const legacyError = new Error("legacy unavailable");
  const harness = createHarness({ legacyError });

  await assert.rejects(
    () => harness.selector.read("REPLAY", QUERY),
    (error: unknown) => error === legacyError,
  );
  assert.deepEqual(harness.counts, zeroCounts({ legacy: 1 }));
});

test("SHADOW MATCH executes the candidate fully but returns the exact legacy object", async () => {
  const legacy = projection("match");
  const candidate = structuredClone(legacy);
  const harness = createHarness({ legacy, candidate });

  const result = await harness.selector.read("SHADOW", QUERY);

  assert.strictEqual(result, legacy);
  assert.notStrictEqual(result, candidate);
  assert.deepEqual(result, legacy);
  assert.deepEqual(harness.counts, zeroCounts({
    legacy: 1,
    clock: 1,
    snapshot: 1,
    projector: 1,
    diagnostic: 1,
  }));
  assert.deepEqual(harness.diagnostics, [{
    schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
    mode: "SHADOW",
    outcome: "MATCH",
    stage: "COMPARE",
    deepEqual: true,
    canonicalEqual: true,
  }]);
  assert.strictEqual(harness.projectorSources, harness.sources);
});

test("SHADOW MISMATCH records both comparison dimensions and still returns legacy", async () => {
  const legacy = projection("mismatch");
  const candidate = structuredClone(legacy);
  candidate.situation.goal = "candidate changed the goal";
  const harness = createHarness({ legacy, candidate });

  const result = await harness.selector.read("SHADOW", QUERY);

  assert.strictEqual(result, legacy);
  assert.notStrictEqual(result, candidate);
  assert.deepEqual(harness.counts, zeroCounts({
    legacy: 1,
    clock: 1,
    snapshot: 1,
    projector: 1,
    diagnostic: 1,
  }));
  assert.deepEqual(harness.diagnostics, [{
    schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
    mode: "SHADOW",
    outcome: "MISMATCH",
    stage: "COMPARE",
    deepEqual: false,
    canonicalEqual: false,
  }]);
});

test("SHADOW requires deep and canonical equality rather than either one alone", async () => {
  const legacy = projection("negative-zero");
  legacy.chapter.workingRevision = 0;
  const candidate = structuredClone(legacy);
  candidate.chapter.workingRevision = -0;
  const harness = createHarness({ legacy, candidate });

  const result = await harness.selector.read("SHADOW", QUERY);

  assert.strictEqual(result, legacy);
  assert.deepEqual(harness.diagnostics, [{
    schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
    mode: "SHADOW",
    outcome: "MISMATCH",
    stage: "COMPARE",
    deepEqual: false,
    canonicalEqual: true,
  }]);
});

test("SHADOW snapshot failure records a sanitized ERROR and returns legacy", async () => {
  const legacy = projection("snapshot-error");
  const snapshotError = new Error("candidate snapshot failed");
  const harness = createHarness({ legacy, snapshotError });

  const result = await harness.selector.read("SHADOW", QUERY);

  assert.strictEqual(result, legacy);
  assert.deepEqual(harness.counts, zeroCounts({
    legacy: 1,
    clock: 1,
    snapshot: 1,
    diagnostic: 1,
  }));
  assert.deepEqual(harness.diagnostics, [{
    schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
    mode: "SHADOW",
    outcome: "ERROR",
    stage: "SNAPSHOT",
  }]);
});

test("SHADOW projector failure records ERROR and never returns the candidate", async () => {
  const legacy = projection("projector-error");
  const projectorError = new Error("candidate projector failed");
  const harness = createHarness({ legacy, projectorError });

  const result = await harness.selector.read("SHADOW", QUERY);

  assert.strictEqual(result, legacy);
  assert.deepEqual(harness.counts, zeroCounts({
    legacy: 1,
    clock: 1,
    snapshot: 1,
    projector: 1,
    diagnostic: 1,
  }));
  assert.deepEqual(harness.diagnostics, [{
    schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
    mode: "SHADOW",
    outcome: "ERROR",
    stage: "PROJECTOR",
  }]);
});

test("SHADOW comparison failure records ERROR and returns legacy", async () => {
  const legacy = projection("compare-error");
  const candidate = Object.assign(structuredClone(legacy), {
    unsupportedCanonicalValue: undefined,
  });
  const harness = createHarness({ legacy, candidate });

  const result = await harness.selector.read("SHADOW", QUERY);

  assert.strictEqual(result, legacy);
  assert.deepEqual(harness.diagnostics, [{
    schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
    mode: "SHADOW",
    outcome: "ERROR",
    stage: "COMPARE",
  }]);
});

test("SHADOW invalid clock is isolated as a request-stage candidate error", async () => {
  const legacy = projection("clock-error");
  const harness = createHarness({ legacy, nowMs: Number.NaN });

  const result = await harness.selector.read("SHADOW", QUERY);

  assert.strictEqual(result, legacy);
  assert.deepEqual(harness.counts, zeroCounts({
    legacy: 1,
    clock: 1,
    diagnostic: 1,
  }));
  assert.deepEqual(harness.diagnostics, [{
    schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
    mode: "SHADOW",
    outcome: "ERROR",
    stage: "REQUEST",
  }]);
});

test("SHADOW propagates a legacy failure and does not start the candidate", async () => {
  const legacyError = new Error("legacy authority failed");
  const harness = createHarness({ legacyError });

  await assert.rejects(
    () => harness.selector.read("SHADOW", QUERY),
    (error: unknown) => error === legacyError,
  );
  assert.deepEqual(harness.counts, zeroCounts({ legacy: 1 }));
});

test("SHADOW diagnostic reporter failure cannot change the legacy response", async () => {
  const legacy = projection("diagnostic-error");
  const candidate = structuredClone(legacy);
  const harness = createHarness({
    legacy,
    candidate,
    diagnosticError: new Error("diagnostic sink unavailable"),
  });

  const result = await harness.selector.read("SHADOW", QUERY);

  assert.strictEqual(result, legacy);
  assert.deepEqual(harness.counts, zeroCounts({
    legacy: 1,
    clock: 1,
    snapshot: 1,
    projector: 1,
    diagnostic: 1,
  }));
});

test("SHADOW diagnostics contain only the fixed safe contract", async () => {
  const secret = {
    payload: "PRIVATE_PAYLOAD_92831",
    sql: "SELECT * FROM hidden_table_92831",
    credential: "DATABASE_PASSWORD_92831",
    provider: "PROVIDER_RAW_92831",
    peer: "other-seat-private-92831",
  };
  const snapshotError = new Error(Object.values(secret).join("|"));
  const harness = createHarness({
    legacy: Object.assign(projection("redaction"), secret),
    snapshotError,
  });

  const result = await harness.selector.read("SHADOW", QUERY);
  const serialized = JSON.stringify(harness.diagnostics);

  assert.strictEqual(result, harness.legacy);
  assert.deepEqual(Object.keys(harness.diagnostics[0] ?? {}).sort(), [
    "mode",
    "outcome",
    "schemaVersion",
    "stage",
  ]);
  for (const value of Object.values(secret)) {
    assert.equal(serialized.includes(value), false);
  }
  assert.doesNotMatch(
    serialized,
    /payload|sql|credential|password|provider|other-seat|runId|subjectId/iu,
  );
});

test("FAST invokes snapshot and projector once, legacy never, and returns candidate", async () => {
  const candidate = projection("fast");
  const harness = createHarness({ candidate });

  const result = await harness.selector.read("FAST", QUERY);

  assert.strictEqual(result, candidate);
  assert.deepEqual(harness.counts, zeroCounts({
    clock: 1,
    snapshot: 1,
    projector: 1,
  }));
  assert.deepEqual(harness.diagnostics, []);
  assert.strictEqual(harness.projectorSources, harness.sources);
});

test("FAST propagates snapshot failure with no legacy read", async () => {
  const snapshotError = new Error("snapshot failed closed");
  const harness = createHarness({ snapshotError });

  await assert.rejects(
    () => harness.selector.read("FAST", QUERY),
    (error: unknown) => error === snapshotError,
  );
  assert.deepEqual(harness.counts, zeroCounts({ clock: 1, snapshot: 1 }));
});

test("FAST propagates projector failure with no legacy read", async () => {
  const projectorError = new Error("projector failed closed");
  const harness = createHarness({ projectorError });

  await assert.rejects(
    () => harness.selector.read("FAST", QUERY),
    (error: unknown) => error === projectorError,
  );
  assert.deepEqual(harness.counts, zeroCounts({
    clock: 1,
    snapshot: 1,
    projector: 1,
  }));
});

test("FAST rejects an invalid clock before snapshot access and never reads legacy", async () => {
  const harness = createHarness({ nowMs: -1 });

  await assert.rejects(
    () => harness.selector.read("FAST", QUERY),
    (error: unknown) => (
      error instanceof PressureGameReadModeErrorV1
      && error.code === PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.CLOCK_INVALID
    ),
  );
  assert.deepEqual(harness.counts, zeroCounts({ clock: 1 }));
});

test("runtime-invalid selector mode fails closed before every port", async () => {
  const harness = createHarness();

  await assert.rejects(
    () => harness.selector.read("fast" as PressureGameReadModeV1, QUERY),
    (error: unknown) => (
      error instanceof PressureGameReadModeErrorV1
      && error.code === PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.MODE_INVALID
    ),
  );
  assert.deepEqual(harness.counts, zeroCounts());
});

test("explicit query fields map exactly into the one snapshot request", async () => {
  const harness = createHarness({ nowMs: CAPTURED_AT_MS });

  await harness.selector.read("FAST", QUERY);

  assert.deepEqual(harness.snapshotRequest, {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
    roomId: RUN_ID,
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    feedCursor: "opaque-feed-cursor",
    feedLimit: 7,
    capturedAtMs: CAPTURED_AT_MS,
  });
  assert.equal(harness.snapshotRequest?.roomId, harness.snapshotRequest?.runId);
});

test("undefined cursor and limit map to the legacy-compatible snapshot defaults", async () => {
  const query = Object.freeze({
    runId: "pressure-run-defaults",
    subjectId: "subject-defaults",
  });
  const harness = createHarness({ nowMs: 0 });

  await harness.selector.read("FAST", query);

  assert.deepEqual(harness.snapshotRequest, {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
    roomId: query.runId,
    runId: query.runId,
    subjectId: query.subjectId,
    feedCursor: null,
    feedLimit: 10,
    capturedAtMs: 0,
  });
});

test("production selector has no environment, database, mutation, or alternate-path capability", () => {
  const source = readFileSync(
    resolve(__dirname, "game-read-mode-selector.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /process\s*\.\s*env/u);
  assert.doesNotMatch(source, /\bPrisma(?:Client)?\b/iu);
  assert.doesNotMatch(source, /\$(?:queryRaw|executeRaw)/u);
  assert.doesNotMatch(
    source,
    /["'`]\s*(?:SELECT\b|INSERT\s+INTO\b|UPDATE\s+\S+\s+SET\b|DELETE\s+FROM\b|WITH\s+\S+\s+AS\b)/iu,
  );
  assert.doesNotMatch(source, /\bwrite\b/iu);
  assert.doesNotMatch(source, /\bfallback\b/iu);
  assert.doesNotMatch(source, /\bretry\b/iu);
  assert.doesNotMatch(source, /\b(?:cache|memoize)\b/iu);
  assert.doesNotMatch(source, /\b(?:setInterval|setTimeout)\b/u);
});

interface CallCountsV1 {
  legacy: number;
  clock: number;
  snapshot: number;
  projector: number;
  diagnostic: number;
}

interface HarnessOptionsV1 {
  legacy?: PressureChapterGameProjectionV1;
  candidate?: PressureChapterGameProjectionV1;
  legacyError?: Error;
  snapshotError?: Error;
  projectorError?: Error;
  diagnosticError?: Error;
  nowMs?: number;
}

interface HarnessV1 {
  selector: PressureGameReadModeSelectorV1;
  legacy: PressureChapterGameProjectionV1;
  candidate: PressureChapterGameProjectionV1;
  sources: GameReadSnapshotResolvedSourcesV1;
  counts: CallCountsV1;
  diagnostics: PressureGameReadShadowDiagnosticV1[];
  snapshotRequest: PressureGameReadSnapshotCaptureRequestV1 | null;
  projectorSources: GameReadSnapshotResolvedSourcesV1 | null;
}

function createHarness(options: Readonly<HarnessOptionsV1> = {}): HarnessV1 {
  const legacy = options.legacy ?? projection("legacy-default");
  const candidate = options.candidate ?? projection("candidate-default");
  const sources: GameReadSnapshotResolvedSourcesV1 = Object.freeze(
    Object.assign(Object.create(null), {
      testMarker: "resolved-sources-reference",
    }),
  );
  const counts = zeroCounts();
  const diagnostics: PressureGameReadShadowDiagnosticV1[] = [];
  const state: {
    snapshotRequest: PressureGameReadSnapshotCaptureRequestV1 | null;
    projectorSources: GameReadSnapshotResolvedSourcesV1 | null;
  } = {
    snapshotRequest: null,
    projectorSources: null,
  };

  const dependencies: PressureGameReadModeSelectorDependenciesV1 = {
    legacy: {
      async read() {
        counts.legacy += 1;
        if (options.legacyError) throw options.legacyError;
        return legacy;
      },
    },
    clock: {
      nowMs() {
        counts.clock += 1;
        return options.nowMs ?? CAPTURED_AT_MS;
      },
    },
    snapshots: {
      async readSnapshot(request) {
        counts.snapshot += 1;
        state.snapshotRequest = structuredClone(request);
        if (options.snapshotError) throw options.snapshotError;
        return { sources } as GameReadSnapshotV1;
      },
    },
    projector: {
      async projectFromResolvedSources(input) {
        counts.projector += 1;
        state.projectorSources = input;
        if (options.projectorError) throw options.projectorError;
        return candidate;
      },
    },
    diagnostics: {
      report(diagnostic) {
        counts.diagnostic += 1;
        diagnostics.push(structuredClone(diagnostic));
        if (options.diagnosticError) throw options.diagnosticError;
      },
    },
  };
  const selector = new PressureGameReadModeSelectorV1(dependencies);

  return {
    selector,
    legacy,
    candidate,
    sources,
    counts,
    diagnostics,
    get snapshotRequest() {
      return state.snapshotRequest;
    },
    get projectorSources() {
      return state.projectorSources;
    },
  };
}

function zeroCounts(overrides: Partial<CallCountsV1> = {}): CallCountsV1 {
  return {
    legacy: 0,
    clock: 0,
    snapshot: 0,
    projector: 0,
    diagnostic: 0,
    ...overrides,
  };
}

function projection(label: string): PressureChapterGameProjectionV1 {
  const digest = (character: string): string => character.repeat(64).slice(0, 64);
  return {
    schemaVersion: "pressure_chapter_game_projection_v1",
    projectionVersion: 1,
    roomId: RUN_ID,
    runId: RUN_ID,
    route: {
      routeHash: digest("a"),
      participantMode: "SOLO",
      runtimeProfile: `runtime-${label}`,
      contentPackageVersion: "content-v1",
      controlTopologyVersion: "control-v1",
    },
    chapter: {
      chapterRuntimeId: `chapter-runtime-${label}`,
      chapterId: "N1",
      chapterNumber: 1,
      title: `Chapter ${label}`,
      phase: "ACTIVE",
      workingRevision: 1,
    },
    viewer: {
      seatId: "cabinet_finance",
      roleName: "Cabinet Finance",
      control: {
        mode: "HUMAN_ACTIVE",
        controlEpoch: 1,
        canSubmit: true,
        canReclaim: false,
        submissionFenceToken: `submit-${label}`,
        reclaimFenceToken: null,
      },
    },
    metrics: [],
    situation: {
      goal: `Goal ${label}`,
      risk: `Risk ${label}`,
      judgment: `Judgment ${label}`,
    },
    resources: [],
    tokens: [],
    decision: null,
    capabilities: {
      canSubmitDecision: true,
      canTalk: true,
      canInvestigate: true,
      canUseToken: true,
      canPlan: true,
      canReclaimControl: false,
      allowedActionTypes: ["FORMAL_ACTION"],
    },
    narrative: {
      status: "PENDING",
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: digest("b"),
      sourceCommitHash: digest("c"),
      text: null,
      contentHash: null,
      renderMode: null,
    },
    chapterSummary: null,
    feedPage: {
      schemaVersion: "a_emotion_feed_page_v1",
      roomId: RUN_ID,
      runId: RUN_ID,
      viewerSeatId: "cabinet_finance",
      items: [],
      unreadCount: 0,
      nextCursor: null,
      serverSequence: 0,
    },
    projectionHash: digest("d"),
  };
}
