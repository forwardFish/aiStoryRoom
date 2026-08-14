import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical, type SeatIdV1 } from "@ai-story/shared";
import {
  PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1 as E,
  PressureViewerStoryPackCompileErrorV1,
  compilePressureViewerStoryPackV1,
  type CompilePressureViewerStoryPackInputV1,
} from "./viewer-story-pack";

const H = "a".repeat(64);
function fixture(seat: SeatIdV1): CompilePressureViewerStoryPackInputV1 {
  return {
    runId: "run-1", chapterRuntimeId: "runtime-1", chapterId: "C42", beatId: "C42.B02",
    ordinal: 2, previousBeatId: "C42.B01", viewerSeatId: seat, authorityRevision: 7,
    stateAfterHash: H, authorityHash: H,
    facts: [
      { factRef: "fact.public", text: "Public fact.", source: "STATE_AFTER", visibility: "PUBLIC", authorizedSeatIds: [] },
      { factRef: `fact.private.${seat}`, text: `Private ${seat}.`, source: "WORKING_DELTA", visibility: "SEAT_PRIVATE", authorizedSeatIds: [seat] },
    ],
    metrics: Array.from({ length: 7 }, (_, i) => ({
      metricRef: `metric.${i}`, label: `Metric ${i}`, displayValue: String(i),
      visibility: "PUBLIC" as const, authorizedSeatIds: [],
    })),
    allowedClaims: [{ kind: "FACT", refId: "fact.public", statement: "Public fact.", required: true, visibility: "PUBLIC", authorizedSeatIds: [] }],
    allowedAuthorialFactRefs: ["authorial.public", `authorial.private.${seat}`],
    authorialMaterials: [
      { materialRef: "m.public", title: "Public", text: "Public scene.", factRefs: ["authorial.public"], stopCondition: "Stop before action.", visibility: "PUBLIC", authorizedSeatIds: [] },
      { materialRef: `m.private.${seat}`, title: "Private", text: `Only ${seat}.`, factRefs: [`authorial.private.${seat}`], stopCondition: null, visibility: "SEAT_PRIVATE", authorizedSeatIds: [seat] },
    ],
    previousNarrative: { sourceCommitHash: H, text: "Previous turn.", authority: "CONTINUITY_ONLY" },
    sealedViewerAction: { runId: "run-1", chapterRuntimeId: "runtime-1", sourceBeatId: "C42.B01", authorityRevision: 7, viewerSeatId: seat, actionId: `action-${seat}`, actionType: "ACT_A", summary: "Committed A." },
    visibleSeatResults: [{ runId: "run-1", chapterRuntimeId: "runtime-1", sourceBeatId: "C42.B01", authorityRevision: 7, sourceSeatId: seat, actionId: `action-${seat}`, summary: "Visible result.", resultFactRefs: ["fact.public"], visibility: "SEAT_PRIVATE", authorizedSeatIds: [seat] }],
    nextDecision: { decisionContractRef: "C42.decision.02", decisionPointRef: "C42.catalog.02", legalActionRefs: ["C42.catalog.02#ACT_A", "C42.catalog.02#ACT_B"], catalogActions: [
      { actionRef: "C42.catalog.02#ACT_A", actionType: "ACT_A", label: "A", description: "Attempt A." },
      { actionRef: "C42.catalog.02#ACT_B", actionType: "ACT_B", label: "B", description: "Attempt B." },
    ] },
  };
}
function code(fn: () => unknown, expected: string) {
  assert.throws(fn, (error: unknown) => {
    assert.equal(error instanceof PressureViewerStoryPackCompileErrorV1, true);
    assert.equal((error as PressureViewerStoryPackCompileErrorV1).code, expected);
    return true;
  });
}

test("arbitrary chapter compiles a dynamic immutable Story Pack", () => {
  const input = fixture("zhejiang_governor");
  const pack = compilePressureViewerStoryPackV1(input);
  assert.equal(pack.identity.chapterId, "C42");
  assert.equal(pack.providerInput.authority.metrics.length, 7);
  assert.equal(pack.storyPackHash, sha256Canonical((({ storyPackHash: _, ...body }) => body)(pack)));
  assert.equal(Object.isFrozen(pack.providerInput.authorialMaterials), true);
});

test("three viewers never share private material or cache identity", async () => {
  const seats = ["zhejiang_governor", "qingliu_law", "jiangnan_merchant"] as const;
  const packs = await Promise.all(seats.map(async (seat) => compilePressureViewerStoryPackV1(fixture(seat))));
  assert.equal(new Set(packs.map((pack) => pack.cacheKey)).size, 3);
  seats.forEach((seat, index) => {
    const json = JSON.stringify(packs[index]);
    assert.match(json, new RegExp(`Private ${seat}`));
    seats.filter((other) => other !== seat).forEach((other) => assert.doesNotMatch(json, new RegExp(`Private ${other}`)));
  });
});

test("other-seat, SYSTEM_ONLY and unknown authorial facts fail closed", () => {
  const other = fixture("zhejiang_governor");
  other.authorialMaterials[1]!.authorizedSeatIds = ["qingliu_law"];
  code(() => compilePressureViewerStoryPackV1(other), E.SCOPE);
  const system = fixture("zhejiang_governor");
  system.metrics[0]!.visibility = "SYSTEM_ONLY";
  code(() => compilePressureViewerStoryPackV1(system), E.SCOPE);
  const unknown = fixture("zhejiang_governor");
  unknown.authorialMaterials[0]!.factRefs = ["authorial.unknown"];
  code(() => compilePressureViewerStoryPackV1(unknown), E.REFERENCE);
});

test("run, chapter runtime, Beat and revision are strict prior-result boundaries", () => {
  for (const mutate of [
    (x: CompilePressureViewerStoryPackInputV1) => { x.visibleSeatResults[0]!.runId = "other"; },
    (x: CompilePressureViewerStoryPackInputV1) => { x.visibleSeatResults[0]!.chapterRuntimeId = "other"; },
    (x: CompilePressureViewerStoryPackInputV1) => { x.visibleSeatResults[0]!.sourceBeatId = "C42.B00"; },
    (x: CompilePressureViewerStoryPackInputV1) => { x.visibleSeatResults[0]!.authorityRevision = 6; },
  ]) {
    const value = fixture("zhejiang_governor"); mutate(value);
    code(() => compilePressureViewerStoryPackV1(value), E.IDENTITY);
  }
});

test("opening boundary and Catalog action binding fail closed", () => {
  const opening = fixture("zhejiang_governor"); opening.ordinal = 1;
  code(() => compilePressureViewerStoryPackV1(opening), E.IDENTITY);
  const catalog = fixture("zhejiang_governor"); catalog.nextDecision.catalogActions.pop();
  code(() => compilePressureViewerStoryPackV1(catalog), E.CATALOG);
});
