import assert from "node:assert/strict";
import test from "node:test";
import { loadSangtianPressureChapterBeatAuthoringV1 } from "@ai-story/templates";
import {
  resolvePressureBeatSubmitPolicyV1,
  usesIndependentSeatBeatFlowV1,
} from "./policy";

test("registered multi-Beat chapters use independent seat progression in Solo and multiplayer", () => {
  for (const participantMode of ["SOLO", "MULTIPLAYER"] as const) {
    assert.equal(resolvePressureBeatSubmitPolicyV1({
      participantMode,
      chapterId: "N1",
    }), "INDEPENDENT_SEAT_BEATS");
    assert.equal(usesIndependentSeatBeatFlowV1({ participantMode, chapterId: "N1" }), true);
  }
});

test("all content chapters compile into the same independent Beat runtime", () => {
  for (const chapterId of ["N1", "N2", "N3", "N4", "N5", "N6", "N7"]) {
    assert.equal(resolvePressureBeatSubmitPolicyV1({
      participantMode: "SOLO",
      chapterId,
    }), "INDEPENDENT_SEAT_BEATS");
    const authoring = loadSangtianPressureChapterBeatAuthoringV1(chapterId);
    assert.equal(authoring.chapterId, chapterId);
    assert.ok(authoring.beats.length > 0);
    assert.equal(authoring.beats.at(-1)?.closesChapter, true);
  }
  assert.equal(
    loadSangtianPressureChapterBeatAuthoringV1("N2").chapterSummary.nextChapterId,
    "N3",
  );
  assert.equal(
    loadSangtianPressureChapterBeatAuthoringV1("N7").chapterSummary.nextChapterId,
    null,
  );
});

test("unknown chapters remain fail-closed until their JSON is added", () => {
  assert.equal(resolvePressureBeatSubmitPolicyV1({
    participantMode: "SOLO",
    chapterId: "N20",
  }), "SHARED_DECISION_CONVERGENCE");
});
