import assert from "node:assert/strict";
import test from "node:test";
import { planInteractiveNarrativeAudiencesV1 } from "./interactive-audience";

test("solo chapter narratives target only the human seat", () => {
  assert.deepEqual(
    planInteractiveNarrativeAudiencesV1({ humanSeatIds: ["zhejiang_governor"] }),
    [{ kind: "SEAT", seatId: "zhejiang_governor" }],
  );
});

test("multiplayer chapter narratives target every human seat in canonical order", () => {
  assert.deepEqual(
    planInteractiveNarrativeAudiencesV1({
      humanSeatIds: ["jiangnan_merchant", "cabinet_finance"],
    }),
    [
      { kind: "SEAT", seatId: "cabinet_finance" },
      { kind: "SEAT", seatId: "jiangnan_merchant" },
    ],
  );
});

test("interactive audience planning rejects empty, duplicate, or unknown seats", () => {
  assert.throws(() => planInteractiveNarrativeAudiencesV1({ humanSeatIds: [] }));
  assert.throws(() => planInteractiveNarrativeAudiencesV1({
    humanSeatIds: ["zhejiang_governor", "zhejiang_governor"],
  }));
  assert.throws(() => planInteractiveNarrativeAudiencesV1({ humanSeatIds: ["unknown"] }));
});
