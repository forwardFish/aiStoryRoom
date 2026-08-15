import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type {
  PressureChapterBeatAuthoringPackageV1,
  PressureChapterBeatDecisionBindingV1,
} from "../src/pressure-spine/beat-authoring-contracts";
import {
  PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1 as ERROR,
  PressureBeatProgressionErrorV1,
  planPressureBeatProgressionV1,
} from "../src/pressure-spine/beat-progression";

const BINDINGS_PATH = path.resolve(
  __dirname,
  "../config/sangtian/pressure-chapter-v1/authoring/n1-beat-bindings-v1.json",
);

test("real N1 B01 through B08 advances seven NEXT_BEAT plans and only B08 becomes summary-ready", () => {
  const pack = n1Package();
  let revision = 0;
  for (let index = 0; index < pack.beats.length; index += 1) {
    const beat = pack.beats[index]!;
    const next = pack.beats[index + 1] ?? null;
    const plan = planPressureBeatProgressionV1({
      package: pack,
      chapterRuntimeId: "runtime-n1",
      currentBeatId: beat.beatId,
      currentDecisionPointId: beat.catalogDecisionPointRef,
      nextDecisionPin: next ? { decisionPointId: next.catalogDecisionPointRef } : null,
      expectedAuthorityRevision: revision,
      actualAuthorityRevision: revision,
      expectedFenceToken: "fence-n1",
      actualFenceToken: "fence-n1",
    });
    assert.equal(plan.chapterId, "N1");
    assert.equal(plan.authorityRevisionAfter, revision + 1);
    if (index < 7) {
      assert.equal(plan.kind, "NEXT_BEAT");
      assert.equal(plan.nextBeatId, `N1.B${String(index + 2).padStart(2, "0")}`);
      assert.equal(plan.nextDecisionPointId, next!.catalogDecisionPointRef);
    } else {
      assert.equal(plan.kind, "CHAPTER_SUMMARY_READY");
      assert.equal(plan.nextBeatId, null);
    }
    const replay = planPressureBeatProgressionV1({
      package: pack,
      chapterRuntimeId: "runtime-n1",
      currentBeatId: beat.beatId,
      currentDecisionPointId: beat.catalogDecisionPointRef,
      nextDecisionPin: next ? { decisionPointId: next.catalogDecisionPointRef } : null,
      expectedAuthorityRevision: revision,
      actualAuthorityRevision: revision,
      expectedFenceToken: "fence-n1",
      actualFenceToken: "fence-n1",
    });
    assert.equal(replay.planHash, plan.planHash);
    revision += 1;
  }
});

test("revision/fence conflicts, repeated decisions and premature close fail closed", () => {
  const pack = n1Package();
  const first = pack.beats[0]!;
  codeOf(() => planPressureBeatProgressionV1({
    package: pack,
    chapterRuntimeId: "runtime-n1",
    currentBeatId: first.beatId,
    currentDecisionPointId: first.catalogDecisionPointRef,
    nextDecisionPin: { decisionPointId: pack.beats[1]!.catalogDecisionPointRef },
    expectedAuthorityRevision: 1,
    actualAuthorityRevision: 2,
    expectedFenceToken: "fence",
    actualFenceToken: "fence",
  }), ERROR.CONFLICT);
  codeOf(() => planPressureBeatProgressionV1({
    package: pack,
    chapterRuntimeId: "runtime-n1",
    currentBeatId: first.beatId,
    currentDecisionPointId: first.catalogDecisionPointRef,
    nextDecisionPin: { decisionPointId: pack.beats[1]!.catalogDecisionPointRef },
    expectedAuthorityRevision: 1,
    actualAuthorityRevision: 1,
    expectedFenceToken: "fence-a",
    actualFenceToken: "fence-b",
  }), ERROR.CONFLICT);
  codeOf(() => planPressureBeatProgressionV1({
    package: pack,
    chapterRuntimeId: "runtime-n1",
    currentBeatId: first.beatId,
    currentDecisionPointId: first.catalogDecisionPointRef,
    nextDecisionPin: { decisionPointId: first.catalogDecisionPointRef },
    expectedAuthorityRevision: 1,
    actualAuthorityRevision: 1,
    expectedFenceToken: "fence",
    actualFenceToken: "fence",
  }), ERROR.ILLEGAL_REPEAT);
  codeOf(() => planPressureBeatProgressionV1({
    package: pack,
    chapterRuntimeId: "runtime-n1",
    currentBeatId: first.beatId,
    currentDecisionPointId: first.catalogDecisionPointRef,
    nextDecisionPin: null,
    expectedAuthorityRevision: 1,
    actualAuthorityRevision: 1,
    expectedFenceToken: "fence",
    actualFenceToken: "fence",
  }), ERROR.PREMATURE_CLOSE);
});

function n1Package(): PressureChapterBeatAuthoringPackageV1 {
  const source = JSON.parse(readFileSync(BINDINGS_PATH, "utf8")) as {
    decisionContracts: PressureChapterBeatDecisionBindingV1[];
  };
  const beats = source.decisionContracts.map((binding, index) => ({
    beatId: `N1.B${String(index + 1).padStart(2, "0")}`,
    ordinal: index + 1,
    phase: index === 0 ? "OPENING" as const : index >= 6 ? "COMMIT" as const : "DEVELOPMENT" as const,
    title: `N1 Beat ${index + 1}`,
    storyPurpose: "Use the accepted N1 authoring decision sequence.",
    sourceMaterialRefs: ["material.public"],
    decisionContractRef: binding.decisionContractRef,
    successorBeatIds: index === 7 ? [] : [`N1.B${String(index + 2).padStart(2, "0")}`],
    closesChapter: index === 7,
    catalogDecisionPointRef: binding.catalogDecisionPointRef,
    actionPhase: binding.actionPhase,
    pressure: binding.pressure,
    advanceCondition: binding.advanceCondition,
    legalActionRefs: [`${binding.catalogDecisionPointRef}#DEFAULT_PASS`],
    sourceMaterials: [{ materialRef: "material.public", visibility: "PUBLIC" as const, authorizedSeatIds: [] }],
  }));
  return {
    schemaVersion: "pressure_chapter_beat_authoring_package_v1",
    contentStatus: "READY_FOR_IMPORT",
    chapterId: "N1",
    title: "九堰将决",
    entryBeatId: "N1.B01",
    beats,
    chapterSummary: {
      outcomeFrameRefs: { HIGH: "summary.high", MID: "summary.mid", LOW: "summary.low" },
      nextChapterId: "N2",
      materialRefs: [],
    },
    packageHash: "A".repeat(64),
  };
}

function codeOf(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => (
    error instanceof PressureBeatProgressionErrorV1 && error.code === code
  ));
}
