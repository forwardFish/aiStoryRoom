import assert from "node:assert/strict";
import { canonicalJson } from "@ai-story/shared";
import test from "node:test";
import type {
  PressureChapterGameProjectionV1,
  ReadPressureChapterGameProjectionQueryV1,
} from "../game-projection/contracts";
import type {
  GameReadSnapshotResolvedSourcesV1,
  GameReadSnapshotV1,
} from "../game-projection/game-read-snapshot";
import type {
  PressureGameReadModeV1,
  PressureGameReadShadowDiagnosticV1,
} from "../game-projection/game-read-mode-selector";
import type { CaptureGameReadSnapshotV1 } from "../persistence/game-read-snapshot.prisma-adapter";
import {
  composeGameReadSnapshotLocalAuthoritiesV1,
  composePressureGameReadV1,
} from "./game-read-composition";

const RUN_ID = "pressure-m4b-run-1";
const SUBJECT_ID = "pressure-m4b-subject-1";
const NOW_MS = 1_776_000_456_789;
const QUERY: Readonly<ReadPressureChapterGameProjectionQueryV1> = Object.freeze({
  runId: RUN_ID,
  subjectId: SUBJECT_ID,
  feedCursor: "opaque-cursor-m4b",
  feedLimit: 7,
});

const SOURCES = Object.freeze({ marker: "resolved-sources" }) as unknown as
  GameReadSnapshotResolvedSourcesV1;
const SNAPSHOT = Object.freeze({
  schemaVersion: "pressure_game_read_snapshot_v1",
  sources: SOURCES,
}) as unknown as GameReadSnapshotV1;

function projection(marker: string): PressureChapterGameProjectionV1 {
  return {
    schemaVersion: "pressure_chapter_game_projection_v1",
    runId: RUN_ID,
    roomId: RUN_ID,
    marker,
  } as unknown as PressureChapterGameProjectionV1;
}

interface HarnessOptions {
  mode: PressureGameReadModeV1;
  legacy?: PressureChapterGameProjectionV1;
  candidate?: PressureChapterGameProjectionV1;
  legacyError?: Error;
  snapshotError?: Error;
  projectorError?: Error;
  diagnosticError?: Error;
}

function createHarness(options: HarnessOptions) {
  const counts = {
    legacy: 0,
    snapshot: 0,
    projector: 0,
    clock: 0,
    diagnostic: 0,
  };
  let capturedQuery: ReadPressureChapterGameProjectionQueryV1 | null = null;
  let captureInput: CaptureGameReadSnapshotV1 | null = null;
  let projectedSources: GameReadSnapshotResolvedSourcesV1 | null = null;
  const diagnostics: PressureGameReadShadowDiagnosticV1[] = [];
  const legacy = options.legacy ?? projection("legacy");
  const candidate = options.candidate ?? structuredClone(legacy);
  const composition = composePressureGameReadV1({
    mode: options.mode,
    legacy: {
      async read(query) {
        counts.legacy += 1;
        capturedQuery = structuredClone(query);
        if (options.legacyError) throw options.legacyError;
        return legacy;
      },
    },
    snapshots: {
      async capture(input) {
        counts.snapshot += 1;
        captureInput = structuredClone(input);
        if (options.snapshotError) throw options.snapshotError;
        return SNAPSHOT;
      },
    },
    projector: {
      async projectFromResolvedSources(sources) {
        counts.projector += 1;
        projectedSources = sources;
        if (options.projectorError) throw options.projectorError;
        return candidate;
      },
    },
    clock: {
      nowMs() {
        counts.clock += 1;
        return NOW_MS;
      },
    },
    diagnostics: {
      report(diagnostic) {
        counts.diagnostic += 1;
        diagnostics.push(structuredClone(diagnostic));
        if (options.diagnosticError) throw options.diagnosticError;
      },
    },
  });
  return {
    composition,
    legacy,
    candidate,
    counts,
    diagnostics,
    get capturedQuery() { return capturedQuery; },
    get captureInput() { return captureInput; },
    get projectedSources() { return projectedSources; },
  };
}

test("REPLAY binds the selector to one legacy read and preserves exact object/JSON", async () => {
  const harness = createHarness({ mode: "REPLAY" });

  const actual = await harness.composition.reader.read(QUERY);

  assert.strictEqual(actual, harness.legacy);
  assert.deepEqual(actual, harness.legacy);
  assert.equal(canonicalJson(actual), canonicalJson(harness.legacy));
  assert.equal(JSON.stringify(actual), JSON.stringify(harness.legacy));
  assert.deepEqual(Object.keys(harness.composition.reader), ["read"]);
  assert.equal("mode" in harness.composition.reader, false);
  assert.deepEqual(harness.capturedQuery, QUERY);
  assert.deepEqual(harness.counts, {
    legacy: 1,
    snapshot: 0,
    projector: 0,
    clock: 0,
    diagnostic: 0,
  });
});

test("SHADOW MATCH executes M2/M3 once, reports only safe fields and returns legacy", async () => {
  const harness = createHarness({ mode: "SHADOW" });

  const actual = await harness.composition.reader.read(QUERY);

  assert.strictEqual(actual, harness.legacy);
  assert.deepEqual(actual, harness.legacy);
  assert.equal(canonicalJson(actual), canonicalJson(harness.legacy));
  assert.equal(JSON.stringify(actual), JSON.stringify(harness.legacy));
  assert.deepEqual(harness.counts, {
    legacy: 1,
    snapshot: 1,
    projector: 1,
    clock: 1,
    diagnostic: 1,
  });
  assert.deepEqual(harness.captureInput, {
    roomId: RUN_ID,
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    feedCursor: "opaque-cursor-m4b",
    feedLimit: 7,
    capturedAtMs: NOW_MS,
  });
  assert.strictEqual(harness.projectedSources, SOURCES);
  assert.deepEqual(harness.diagnostics, [{
    schemaVersion: "pressure_game_read_shadow_diagnostic_v1",
    mode: "SHADOW",
    outcome: "MATCH",
    stage: "COMPARE",
    deepEqual: true,
    canonicalEqual: true,
  }]);
  assert.deepEqual(
    Object.keys(harness.diagnostics[0]!).sort(),
    [
      "canonicalEqual",
      "deepEqual",
      "mode",
      "outcome",
      "schemaVersion",
      "stage",
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(harness.diagnostics),
    /pressure-m4b-run-1|pressure-m4b-subject-1|opaque-cursor-m4b|SELECT|provider/i,
  );
});

test("SHADOW MISMATCH and candidate ERROR never replace or reject the legacy result", async () => {
  const mismatch = createHarness({
    mode: "SHADOW",
    candidate: projection("candidate-mismatch"),
  });
  assert.strictEqual(await mismatch.composition.reader.read(QUERY), mismatch.legacy);
  assert.equal(mismatch.diagnostics[0]?.outcome, "MISMATCH");

  const snapshotError = new Error("snapshot unavailable");
  const failedSnapshot = createHarness({ mode: "SHADOW", snapshotError });
  assert.strictEqual(
    await failedSnapshot.composition.reader.read(QUERY),
    failedSnapshot.legacy,
  );
  assert.deepEqual(failedSnapshot.counts, {
    legacy: 1,
    snapshot: 1,
    projector: 0,
    clock: 1,
    diagnostic: 1,
  });
  assert.deepEqual(failedSnapshot.diagnostics, [{
    schemaVersion: "pressure_game_read_shadow_diagnostic_v1",
    mode: "SHADOW",
    outcome: "ERROR",
    stage: "SNAPSHOT",
  }]);

  const projectorError = new Error("projector unavailable");
  const failedProjector = createHarness({ mode: "SHADOW", projectorError });
  assert.strictEqual(
    await failedProjector.composition.reader.read(QUERY),
    failedProjector.legacy,
  );
  assert.deepEqual(failedProjector.counts, {
    legacy: 1,
    snapshot: 1,
    projector: 1,
    clock: 1,
    diagnostic: 1,
  });
  assert.deepEqual(failedProjector.diagnostics, [{
    schemaVersion: "pressure_game_read_shadow_diagnostic_v1",
    mode: "SHADOW",
    outcome: "ERROR",
    stage: "PROJECTOR",
  }]);
});

test("SHADOW propagates a legacy error and ignores a diagnostic sink failure", async () => {
  const legacyError = new Error("legacy unavailable");
  const failedLegacy = createHarness({ mode: "SHADOW", legacyError });
  await assert.rejects(
    () => failedLegacy.composition.reader.read(QUERY),
    (error: unknown) => error === legacyError,
  );
  assert.deepEqual(failedLegacy.counts, {
    legacy: 1,
    snapshot: 0,
    projector: 0,
    clock: 0,
    diagnostic: 0,
  });

  const failedSink = createHarness({
    mode: "SHADOW",
    diagnosticError: new Error("sink unavailable"),
  });
  assert.strictEqual(await failedSink.composition.reader.read(QUERY), failedSink.legacy);
  assert.equal(failedSink.counts.diagnostic, 1);
});

test("FAST invokes M2/M3 once, never invokes legacy, and preserves selector defaults", async () => {
  const harness = createHarness({ mode: "FAST" });

  const actual = await harness.composition.reader.read({
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
  });

  assert.strictEqual(actual, harness.candidate);
  assert.deepEqual(harness.counts, {
    legacy: 0,
    snapshot: 1,
    projector: 1,
    clock: 1,
    diagnostic: 0,
  });
  assert.deepEqual(harness.captureInput, {
    roomId: RUN_ID,
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    feedCursor: null,
    feedLimit: 10,
    capturedAtMs: NOW_MS,
  });
});

test("FAST is fail-closed and performs no legacy fallback", async () => {
  const snapshotError = new Error("snapshot failed");
  const harness = createHarness({ mode: "FAST", snapshotError });

  await assert.rejects(
    () => harness.composition.reader.read(QUERY),
    (error: unknown) => error === snapshotError,
  );
  assert.deepEqual(harness.counts, {
    legacy: 0,
    snapshot: 1,
    projector: 0,
    clock: 1,
    diagnostic: 0,
  });
});

test("M2 local-authority composition exposes only captured/package operations", async () => {
  const calls: string[] = [];
  const chapters = {
    async load(input: unknown) {
      calls.push("chapter");
      return input;
    },
  };
  const presentation = {
    chapterTitle(chapterId: unknown) {
      calls.push("title");
      return String(chapterId);
    },
    metrics(world: unknown) {
      calls.push("metrics");
      return [world];
    },
  };
  const seatCatalog = {
    readCatalogFromRoute(input: unknown) {
      calls.push("catalog");
      return input;
    },
    async readCatalog() {
      throw new Error("database reader must not be exposed");
    },
  };
  const authorities = composeGameReadSnapshotLocalAuthoritiesV1({
    chapters: chapters as never,
    presentation: presentation as never,
    seatCatalog: seatCatalog as never,
    compilePrivateProjection(input) {
      calls.push("private");
      return input as never;
    },
  });

  assert.deepEqual(Object.keys(authorities).sort(), [
    "chapters",
    "presentation",
    "privateProjection",
    "seatCatalog",
  ]);
  assert.deepEqual(Object.keys(authorities.seatCatalog), ["readCatalogFromRoute"]);
  assert.deepEqual(Object.keys(authorities.privateProjection), ["compile"]);
  assert.equal("readCatalog" in authorities.seatCatalog, false);
  assert.equal("$transaction" in authorities.seatCatalog, false);

  await authorities.chapters.load({} as never);
  authorities.presentation.chapterTitle("N1");
  authorities.presentation.metrics({} as never);
  authorities.seatCatalog.readCatalogFromRoute({} as never);
  authorities.privateProjection.compile({} as never);
  assert.deepEqual(calls, ["chapter", "title", "metrics", "catalog", "private"]);
});
