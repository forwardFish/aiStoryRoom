import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptFinaleForExpression,
  type FinaleResultV1,
} from "../src/sangtian-pressure-finale.js";

test("Finale expression adapter preserves deterministic world and seat results exactly", () => {
  const result = makeFinaleResult();
  const expression = adaptFinaleForExpression(result);

  assert.equal(expression.schemaVersion, "finale_expression_v1");
  assert.equal(expression.sourceContentHash, result.contentHash);
  assert.equal(expression.worldOutcomeId, result.worldOutcomeId);
  assert.deepEqual(expression.trackBands, result.trackBands);
  assert.deepEqual(expression.seatVerdicts, result.seatVerdicts);
  assert.deepEqual(expression.causes, result.causes);
  assert.deepEqual(expression.replayHook, result.replayHook);
  assert.deepEqual(expression.inputFrozenResultIds, result.inputFrozenResultIds);
  assert.equal("ranking" in expression, false);
  assert.equal("score" in expression, false);
  assert.equal("freeSpeech" in expression, false);
  assert.ok(Object.isFrozen(expression));
  assert.ok(Object.isFrozen(expression.seatVerdicts));
});

test("adapter cannot promote a LOSS or COSTLY_WIN into WIN", () => {
  const result = makeFinaleResult();
  const expression = adaptFinaleForExpression(result);
  assert.deepEqual(
    expression.seatVerdicts.map((item) => [item.seatId, item.verdict]),
    [
      ["seat-governor", "COSTLY_WIN"],
      ["seat-merchant", "LOSS"],
      ["seat-law", "WIN"],
      ["seat-province", "COSTLY_WIN"],
      ["seat-weaving", "LOSS"],
      ["seat-cabinet", "WIN"],
    ],
  );

  result.seatVerdicts[0]!.verdict = "LOSS";
  const changedAuthority = adaptFinaleForExpression(result);
  assert.equal(changedAuthority.seatVerdicts[0]!.verdict, "LOSS");
});

test("adapter rejects incomplete or invalid authority results instead of adjudicating them", () => {
  assert.throws(() => adaptFinaleForExpression({
    ...makeFinaleResult(),
    inputFrozenResultIds: [],
  }), /FINALE_FROZEN_INPUT_REQUIRED/);

  assert.throws(() => adaptFinaleForExpression({
    ...makeFinaleResult(),
    seatVerdicts: makeFinaleResult().seatVerdicts.map((item, index) => index === 0 ? { ...item, verdict: "RANK_1" as never } : item),
  }), /FINALE_VERDICT_INVALID/);

  assert.throws(() => adaptFinaleForExpression({
    ...makeFinaleResult(),
    trackBands: makeFinaleResult().trackBands.slice(0, 4),
  }), /FINALE_TRACK_BAND_COUNT_INVALID/);

  assert.throws(() => adaptFinaleForExpression({
    ...makeFinaleResult(),
    seatVerdicts: makeFinaleResult().seatVerdicts.slice(0, 5),
  }), /FINALE_SEAT_VERDICT_COUNT_INVALID/);
});

test("adapter is world-neutral and only transports an existing deterministic result", () => {
  const result: FinaleResultV1 = {
    schemaVersion: "finale_result_v1",
    worldOutcomeId: "habitat-survives-radiation-window",
    trackBands: [
      { trackId: "oxygen", band: "LOW" },
      { trackId: "crew-trust", band: "MEDIUM" },
      { trackId: "thermal-control", band: "HIGH" },
      { trackId: "navigation", band: "MEDIUM" },
      { trackId: "power-reserve", band: "LOW" },
    ],
    seatVerdicts: [
      { seatId: "seat-engineer", verdict: "WIN" },
      { seatId: "seat-command", verdict: "COSTLY_WIN" },
      { seatId: "seat-medical", verdict: "WIN" },
      { seatId: "seat-navigation", verdict: "LOSS" },
      { seatId: "seat-science", verdict: "COSTLY_WIN" },
      { seatId: "seat-communications", verdict: "WIN" },
    ],
    causes: ["valve-sealed", "reserve-used"],
    replayHook: { scenarioId: "orbit-7" },
    inputFrozenResultIds: ["frozen-orbit-1", "frozen-orbit-2"],
    contentHash: "content-hash-orbit",
  };

  const expression = adaptFinaleForExpression(result);
  assert.equal(expression.worldOutcomeId, "habitat-survives-radiation-window");
  assert.equal(expression.seatVerdicts[1]!.verdict, "COSTLY_WIN");
});

function makeFinaleResult(): FinaleResultV1 {
  return {
    schemaVersion: "finale_result_v1",
    worldOutcomeId: "evidence-reaches-capital-with-cost",
    trackBands: [
      { trackId: "people-and-land", band: "MEDIUM" },
      { trackId: "evidence-and-responsibility", band: "HIGH" },
      { trackId: "mulberry-and-silk", band: "MEDIUM" },
      { trackId: "treasury-and-pay", band: "LOW" },
      { trackId: "court-and-imperial-face", band: "MEDIUM" },
    ],
    seatVerdicts: [
      { seatId: "seat-governor", verdict: "COSTLY_WIN" },
      { seatId: "seat-merchant", verdict: "LOSS" },
      { seatId: "seat-law", verdict: "WIN" },
      { seatId: "seat-province", verdict: "COSTLY_WIN" },
      { seatId: "seat-weaving", verdict: "LOSS" },
      { seatId: "seat-cabinet", verdict: "WIN" },
    ],
    causes: ["cause-report-dispatched", "cause-ledger-preserved"],
    replayHook: { runFromNode: "N4" },
    inputFrozenResultIds: ["frozen-n1", "frozen-n2", "frozen-n7"],
    contentHash: "finale-content-hash-1",
  };
}
