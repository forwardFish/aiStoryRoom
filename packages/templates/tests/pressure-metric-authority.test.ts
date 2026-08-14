import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PRESSURE_METRIC_AUTHORITY_ERROR_CODES_V1 as ERROR,
  PressureMetricAuthorityErrorV1,
  assertPressureFinaleScaleCompatibleV1,
  assertPressureMetricReplayCompatibleV1,
  auditPressureFinaleScaleV1,
  compilePressureMetricChangeAuditV1,
  compilePublicTrackMetricDefinitionsV1,
  projectPressureMetricDefinitionsForViewerV1,
  validatePressureMetricDefinitionsV1,
  type PressureMetricDefinitionV1,
} from "../src/pressure-chapter/metric-authority";

function metric(
  metricId: string,
  overrides: Partial<PressureMetricDefinitionV1> = {},
): PressureMetricDefinitionV1 {
  return {
    metricId,
    scope: "WORLD",
    scopeRef: "world",
    visibility: "PUBLIC",
    visibleToSeatIds: [],
    valueType: "NUMBER",
    initialValue: 50,
    bounds: { min: 0, max: 100 },
    updateRuleRef: "chapter_settlement.track_delta_v1",
    finaleRuleRefs: ["finale.rules.v1"],
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal(error instanceof PressureMetricAuthorityErrorV1, true);
    assert.equal((error as PressureMetricAuthorityErrorV1).code, code);
    return true;
  });
}

test("metric contract is count-independent and rejects duplicate identities", () => {
  assert.equal(validatePressureMetricDefinitionsV1([metric("a"), metric("b")]).length, 2);
  assert.equal(validatePressureMetricDefinitionsV1(Array.from(
    { length: 7 },
    (_, index) => metric(`m${index + 1}`),
  )).length, 7);
  expectCode(
    () => validatePressureMetricDefinitionsV1([metric("a"), metric("a")]),
    ERROR.CONTRACT_INVALID,
  );
});

test("PUBLIC, SEAT_PRIVATE and SYSTEM_ONLY metrics are viewer isolated", () => {
  const definitions = [
    metric("public"),
    metric("private.a", {
      scope: "SEAT",
      scopeRef: "seat-a",
      visibility: "SEAT_PRIVATE",
      visibleToSeatIds: ["seat-a"],
    }),
    metric("private.b", {
      scope: "SEAT",
      scopeRef: "seat-b",
      visibility: "SEAT_PRIVATE",
      visibleToSeatIds: ["seat-b"],
    }),
    metric("system", { visibility: "SYSTEM_ONLY" }),
  ];
  assert.deepEqual(
    projectPressureMetricDefinitionsForViewerV1(definitions, "seat-a")
      .map((definition) => definition.metricId),
    ["private.a", "public"],
  );
  assert.deepEqual(
    projectPressureMetricDefinitionsForViewerV1(definitions, "seat-b")
      .map((definition) => definition.metricId),
    ["private.b", "public"],
  );
});

test("Settlement audit proves before plus delta equals after and replay is immutable", () => {
  const definitions = [metric("civilian_land"), metric("fiscal_military", {
    initialValue: 45,
  })];
  const audit = compilePressureMetricChangeAuditV1({
    definitions,
    before: { civilian_land: 50, fiscal_military: 45 },
    delta: { civilian_land: 15, fiscal_military: 5 },
    after: { civilian_land: 65, fiscal_military: 50 },
    settlementBranchRef: "N1.HIGH",
    applicationKey: "run-1:N1:settlement-1",
  });
  assert.deepEqual(audit.changes.map(({ metricId, before, delta, after }) => ({
    metricId,
    before,
    delta,
    after,
  })), [
    { metricId: "civilian_land", before: 50, delta: 15, after: 65 },
    { metricId: "fiscal_military", before: 45, delta: 5, after: 50 },
  ]);
  assertPressureMetricReplayCompatibleV1(audit, structuredClone(audit));
  expectCode(() => compilePressureMetricChangeAuditV1({
    definitions,
    before: { civilian_land: 50, fiscal_military: 45 },
    delta: { civilian_land: 15, fiscal_military: 5 },
    after: { civilian_land: 64, fiscal_military: 50 },
    settlementBranchRef: "N1.HIGH",
    applicationKey: "run-1:N1:settlement-1",
  }), ERROR.CHANGE_ARITHMETIC_MISMATCH);
  expectCode(() => assertPressureMetricReplayCompatibleV1(
    audit,
    { ...structuredClone(audit), applicationKey: "different" },
  ), ERROR.APPLICATION_REPLAY_MISMATCH);
});

test("Finale accepts only an unambiguous delta-from-Genesis frozen chain", () => {
  const definitions = [metric("a", { initialValue: 50 }), metric("b", {
    initialValue: 45,
  })];
  const normalized = {
    definitions,
    chapters: [
      {
        chapterId: "C1",
        snapshotValues: { a: 0, b: 0 },
        snapshotEvidenceRef: "bundle-c1",
        settlementBranches: [
          { branchRef: "C1.MID", delta: {} },
          { branchRef: "C1.HIGH", delta: { a: 5, b: 5 } },
        ],
      },
      {
        chapterId: "C2",
        snapshotValues: { a: 5, b: 5 },
        snapshotEvidenceRef: "bundle-c2",
        settlementBranches: [
          { branchRef: "C2.MID", delta: {} },
          { branchRef: "C2.HIGH", delta: { a: 5, b: 5 } },
        ],
      },
    ],
  };
  const audit = assertPressureFinaleScaleCompatibleV1(normalized);
  assert.equal(audit.status, "COMPATIBLE");
  assert.equal(audit.inputScale, "DELTA_FROM_GENESIS");
  assert.deepEqual(audit.matchedSettlementBranchRefs, ["C1.MID", "C2.HIGH"]);
});

test("absolute 0-100 Finale input and unproven chains fail closed", () => {
  const definitions = [metric("a", { initialValue: 50 }), metric("b", {
    initialValue: 45,
  })];
  const absolute = {
    definitions,
    chapters: [
      {
        chapterId: "C1",
        snapshotValues: { a: 50, b: 45 },
        snapshotEvidenceRef: "bundle-c1",
        settlementBranches: [{ branchRef: "C1.MID", delta: {} }],
      },
      {
        chapterId: "C2",
        snapshotValues: { a: 55, b: 50 },
        snapshotEvidenceRef: "bundle-c2",
        settlementBranches: [{ branchRef: "C2.HIGH", delta: { a: 5, b: 5 } }],
      },
    ],
  };
  assert.equal(auditPressureFinaleScaleV1(absolute).status, "MISMATCH");
  expectCode(
    () => assertPressureFinaleScaleCompatibleV1(absolute),
    ERROR.FINALE_SCALE_MISMATCH,
  );
  const unproven = structuredClone(absolute);
  unproven.chapters[1]!.snapshotValues.a = 54;
  assert.equal(auditPressureFinaleScaleV1(unproven).status, "UNPROVEN");
  expectCode(
    () => assertPressureFinaleScaleCompatibleV1(unproven),
    ERROR.FINALE_SCALE_UNPROVEN,
  );
});

test("accepted Sangtian content proves the production frozen chain is absolute and incompatible", () => {
  const content = JSON.parse(readFileSync(path.resolve(
    __dirname,
    "../config/sangtian/pressure-chapter-v1/content.json",
  ), "utf8")) as {
    genesis: { tracks: Array<{ trackId: string; initialValue: number }> };
    finale: { worldOutcomeRuleRefs: string[] };
    chapters: Array<{
      chapterId: string;
      settlementPolicy: {
        branches: Array<{ branchId: string; trackDelta: Record<string, number> }>;
      };
    }>;
  };
  const definitions = compilePublicTrackMetricDefinitionsV1(
    content.genesis.tracks,
    content.finale.worldOutcomeRuleRefs,
  );
  let values = Object.fromEntries(content.genesis.tracks.map((track) => [
    track.trackId,
    track.initialValue,
  ]));
  const chapters = content.chapters.map((chapter, index) => {
    const branchId = index === content.chapters.length - 1
      ? `${chapter.chapterId}.HIGH`
      : `${chapter.chapterId}.MID`;
    const selected = chapter.settlementPolicy.branches.find((branch) => branch.branchId === branchId);
    assert.ok(selected);
    values = Object.fromEntries(definitions.map((definition) => [
      definition.metricId,
      values[definition.metricId]! + (selected.trackDelta[definition.metricId] ?? 0),
    ]));
    return {
      chapterId: chapter.chapterId,
      snapshotValues: structuredClone(values),
      snapshotEvidenceRef: `bundle-${chapter.chapterId}`,
      settlementBranches: chapter.settlementPolicy.branches.map((branch) => ({
        branchRef: branch.branchId,
        delta: branch.trackDelta,
      })),
    };
  });
  const audit = auditPressureFinaleScaleV1({ definitions, chapters });
  assert.equal(audit.status, "MISMATCH");
  assert.equal(audit.inputScale, "ABSOLUTE");
  assert.deepEqual(audit.matchedSettlementBranchRefs, [
    "N1.MID",
    "N2.MID",
    "N3.MID",
    "N4.MID",
    "N5.MID",
    "N6.MID",
    "N7.HIGH",
  ]);
  expectCode(
    () => assertPressureFinaleScaleCompatibleV1({ definitions, chapters }),
    ERROR.FINALE_SCALE_MISMATCH,
  );
});
