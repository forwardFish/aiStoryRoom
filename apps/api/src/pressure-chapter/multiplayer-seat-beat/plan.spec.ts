import assert from "node:assert/strict";
import test from "node:test";
import { loadSangtianPressureChapterBeatAuthoringV1 } from "@ai-story/templates";
import { planMultiplayerSeatBeatCursorV1 } from "./plan";

const authoring = loadSangtianPressureChapterBeatAuthoringV1("N1");
const seatId = "zhejiang_governor" as const;

test("multiplayer seat starts at the authorial entry Beat", () => {
  const plan = planMultiplayerSeatBeatCursorV1({
    participantMode: "MULTIPLAYER",
    chapterRuntimeId: "chapter-runtime-1",
    seatId,
    package: authoring,
    acceptedActions: [],
  });
  assert.equal(plan.status, "AWAITING_DECISION");
  assert.equal(plan.beatId, "N1.B01");
  assert.equal(plan.decisionPointId, "N1.weir_crisis");
});

test("one seat advances without changing another seat cursor", () => {
  const firstAction = [{ decisionPointId: "N1.weir_crisis", actionId: "action-a" }];
  const advanced = planMultiplayerSeatBeatCursorV1({
    participantMode: "MULTIPLAYER",
    chapterRuntimeId: "chapter-runtime-1",
    seatId,
    package: authoring,
    acceptedActions: firstAction,
  });
  const untouched = planMultiplayerSeatBeatCursorV1({
    participantMode: "MULTIPLAYER",
    chapterRuntimeId: "chapter-runtime-1",
    seatId: "zhejiang_administration",
    package: authoring,
    acceptedActions: [],
  });
  assert.equal(advanced.decisionPointId, "N1.dispatch_route");
  assert.equal(untouched.decisionPointId, "N1.weir_crisis");
});

test("all authored Beats make only that seat ready for chapter convergence", () => {
  const plan = planMultiplayerSeatBeatCursorV1({
    participantMode: "MULTIPLAYER",
    chapterRuntimeId: "chapter-runtime-1",
    seatId,
    package: authoring,
    acceptedActions: authoring.beats.map((beat, index) => ({
      decisionPointId: beat.catalogDecisionPointRef,
      actionId: `action-${index + 1}`,
    })),
  });
  assert.equal(plan.status, "CHAPTER_READY_FOR_CONVERGENCE");
  assert.equal(plan.decisionPointId, null);
});

test("solo is rejected so multiplayer progression cannot affect Solo", () => {
  assert.throws(
    () => planMultiplayerSeatBeatCursorV1({
      participantMode: "SOLO",
      chapterRuntimeId: "chapter-runtime-1",
      seatId,
      package: authoring,
      acceptedActions: [],
    }),
    /PRESSURE_MULTIPLAYER_SEAT_BEAT_MODE_INVALID/,
  );
});

test("a skipped or reordered Beat is rejected", () => {
  assert.throws(
    () => planMultiplayerSeatBeatCursorV1({
      participantMode: "MULTIPLAYER",
      chapterRuntimeId: "chapter-runtime-1",
      seatId,
      package: authoring,
      acceptedActions: [{ decisionPointId: "N1.dispatch_route", actionId: "action-a" }],
    }),
    /PRESSURE_MULTIPLAYER_SEAT_BEAT_ACTION_SEQUENCE_INVALID/,
  );
});
