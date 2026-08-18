import assert from "node:assert/strict";
import test from "node:test";
import { PressureMainGameStorageV1 } from "../public/pressure-main-game-storage-v1.js";

const HASH = "a".repeat(64);

test("Narrative event overlays only Narrative and preserves authoritative projection hash", () => {
  const projection = makeProjection();
  const storage = new PressureMainGameStorageV1({
    runId: projection.runId,
    initialProjection: projection,
    fetchImpl: async () => { throw new Error("unexpected fetch"); },
  });
  const before = storage.toView(storage.projection);
  const updated = storage.acceptNarrativeEvent({
    schemaVersion: "pressure_narrative_published_event_v1",
    runId: projection.runId,
    routeHash: projection.route.routeHash,
    viewerSeatId: projection.viewer.seatId,
    chapterRuntimeId: projection.chapter.chapterRuntimeId,
    decisionPointId: projection.decision.decisionPointId,
    workingRevision: projection.chapter.workingRevision,
    sourceId: projection.narrative.sourceId,
    projectionKind: projection.narrative.projectionKind,
    status: "PUBLISHED",
    deliverySequence: 1,
    identityHash: projection.narrative.identityHash,
    cursor: "opaque-cursor-1",
    narrative: {
      ...projection.narrative,
      status: "PUBLISHED",
      text: "这是一段已经正式发布、长度足够并且只用于替换剧情显示区域的叙事文本。",
      contentHash: HASH,
      renderMode: "PROVIDER",
    },
  });
  assert.ok(updated);
  assert.equal(storage.projection.narrative.status, "PENDING");
  assert.equal(storage.projection.projectionHash, HASH);
  assert.equal(updated.pressureProjection.projectionHash, HASH);
  assert.deepEqual(updated.dashboard.statusMetrics, before.dashboard.statusMetrics);
  assert.match(updated.decisionNarrative, /正式发布/u);
  assert.equal(storage.acceptNarrativeEvent({
    ...updatedEvent(projection), deliverySequence: 1,
  }), null, "duplicate delivery is idempotent");
});

test("Narrative event rejects stale revision and wrong identity", () => {
  const projection = makeProjection();
  const storage = new PressureMainGameStorageV1({
    runId: projection.runId,
    initialProjection: projection,
    fetchImpl: async () => { throw new Error("unexpected fetch"); },
  });
  assert.throws(() => storage.acceptNarrativeEvent({
    ...updatedEvent(projection), identityHash: "b".repeat(64),
  }), /authority mismatch/u);
});

function updatedEvent(projection) {
  return {
    schemaVersion: "pressure_narrative_published_event_v1",
    runId: projection.runId,
    routeHash: projection.route.routeHash,
    viewerSeatId: projection.viewer.seatId,
    chapterRuntimeId: projection.chapter.chapterRuntimeId,
    decisionPointId: projection.decision.decisionPointId,
    workingRevision: projection.chapter.workingRevision,
    sourceId: projection.narrative.sourceId,
    projectionKind: projection.narrative.projectionKind,
    status: "PUBLISHED",
    deliverySequence: 2,
    identityHash: projection.narrative.identityHash,
    narrative: {
      ...projection.narrative, status: "PUBLISHED", text: "足够长的正式发布剧情文本，用来验证身份拒绝。",
      contentHash: HASH, renderMode: "PROVIDER",
    },
  };
}

function makeProjection() {
  return {
    schemaVersion: "pressure_chapter_game_projection_v1",
    projectionVersion: 1,
    roomId: "run-1",
    runId: "run-1",
    route: { routeHash: HASH, participantMode: "SOLO", runtimeProfile: "pressure", contentPackageVersion: "v1", controlTopologyVersion: "v1" },
    chapter: { chapterRuntimeId: "chapter-runtime-1", chapterId: "N1", chapterNumber: 1, title: "第一章", phase: "ACTIVE", workingRevision: 2 },
    viewer: { seatId: "zhejiang_governor", roleName: "胡宗宪", control: { mode: "HUMAN_ACTIVE", controlEpoch: 1, submissionFenceToken: HASH } },
    metrics: [
      { trackId: "fiscal_military", label: "国库银两", value: 1, displayValue: "1", tone: "DEFAULT" },
      { trackId: "civilian_land", label: "民心", value: 2, displayValue: "2", tone: "DEFAULT" },
      { trackId: "evidence_responsibility", label: "真相进展", value: 3, displayValue: "3", tone: "DEFAULT" },
      { trackId: "mulberry_silk", label: "改桑进度", value: 4, displayValue: "4", tone: "DEFAULT" },
      { trackId: "court_imperial_face", label: "皇帝信任", value: 5, displayValue: "5", tone: "DEFAULT" },
    ],
    situation: { goal: "目标", risk: "风险", judgment: "判断" },
    resources: [], tokens: [],
    decision: { decisionPointId: "N1.D2", title: "如何处理", summary: "等待剧情", expectedWorkingRevision: 2, options: [{ code: "A", label: "选择", description: "说明", preferredEntry: "DEFER" }] },
    capabilities: { canSubmitDecision: true, canInvestigate: false },
    narrative: { status: "PENDING", projectionKind: "BEAT_NARRATIVE", sourceAuthority: "CHAPTER_WORKING", sourceId: HASH, sourceCommitHash: HASH, text: null, contentHash: null, renderMode: null, identityHash: HASH },
    chapterSummary: null,
    feedPage: { items: [] },
    projectionHash: HASH,
  };
}
