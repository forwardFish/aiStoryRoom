import assert from "node:assert/strict";
import test from "node:test";
import { compileMultiplayerSeatBeatStoryContextV1 } from "./story-context";

test("M3 compiles Beat-specific authorial guidance for only the current viewer seat", () => {
  const governor = compileMultiplayerSeatBeatStoryContextV1({
    chapterId: "N1",
    beatId: "N1.B02",
    viewerSeatId: "zhejiang_governor",
  });
  const administration = compileMultiplayerSeatBeatStoryContextV1({
    chapterId: "N1",
    beatId: "N1.B02",
    viewerSeatId: "zhejiang_administration",
  });
  assert.equal(governor.beatId, "N1.B02");
  assert.equal(governor.title, "第一道令出门");
  assert.ok(governor.storyPurpose.length > 20);
  assert.ok(governor.authorialMaterials.length > 0);
  assert.ok(governor.authorialMaterials.some(
    (item) => item.materialRef === "publicMainline.beatScenes.B02"
      && item.supportedByAuthority,
  ));
  assert.ok(governor.authorialMaterials.some(
    (item) => item.materialRef === "seatLenses.seat.zhejiang_governor.beatScenes.B02",
  ));
  assert.ok(governor.authorialMaterials.every(
    (item) => !item.materialRef.includes("afterPrepareVariants"),
  ));
  assert.ok(governor.authorialMaterials.every((item) => (
    !item.materialRef.includes("seat.zhejiang_administration")
  )));
  assert.ok(administration.authorialMaterials.every((item) => (
    !item.materialRef.includes("seat.zhejiang_governor")
  )));
  assert.ok(administration.authorialMaterials.some(
    (item) => item.materialRef === "seatLenses.seat.zhejiang_administration.beatScenes.B02",
  ));
  assert.ok(administration.authorialMaterials.length > 0);
});

test("M3 story context rejects an unknown Beat instead of inventing content", () => {
  assert.throws(() => compileMultiplayerSeatBeatStoryContextV1({
    chapterId: "N1",
    beatId: "N1.UNKNOWN",
    viewerSeatId: "zhejiang_governor",
  }), /PRESSURE_MULTIPLAYER_STORY_BEAT_NOT_FOUND/u);
});

test("N1 exposes exactly the current Beat scene for each of the three permanent human seats", () => {
  const seats = ["zhejiang_governor", "zhejiang_administration", "jiangnan_merchant"] as const;
  for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
    const beatKey = `B${String(ordinal).padStart(2, "0")}`;
    for (const viewerSeatId of seats) {
      const context = compileMultiplayerSeatBeatStoryContextV1({
        chapterId: "N1",
        beatId: `N1.${beatKey}`,
        viewerSeatId,
      });
      assert.ok(context.authorialMaterials.some(
        (material) => material.materialRef === `publicMainline.beatScenes.${beatKey}`,
      ));
      assert.ok(context.authorialMaterials.some(
        (material) => material.materialRef === `seatLenses.seat.${viewerSeatId}.beatScenes.${beatKey}`,
      ));
      assert.ok(context.authorialMaterials.every((material) => seats.every((seatId) => (
        seatId === viewerSeatId || !material.materialRef.includes(`seat.${seatId}.`)
      ))));
      if (ordinal >= 7) {
        assert.ok(context.authorialMaterials.some(
          (material) => material.materialRef === `seatLenses.seat.${viewerSeatId}.beatNpcPressures.${beatKey}`,
        ));
      }
    }
  }
});
