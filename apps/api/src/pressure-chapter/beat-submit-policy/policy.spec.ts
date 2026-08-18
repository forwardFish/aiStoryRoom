import assert from "node:assert/strict";
import test from "node:test";
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

test("chapters without a registered multi-Beat package retain shared convergence", () => {
  assert.equal(resolvePressureBeatSubmitPolicyV1({
    participantMode: "SOLO",
    chapterId: "N2",
  }), "SHARED_DECISION_CONVERGENCE");
});
