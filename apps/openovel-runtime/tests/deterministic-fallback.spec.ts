import assert from "node:assert/strict";
import test from "node:test";
import { renderDeterministicFallback } from "../src/deterministic-fallback.js";

test("fallback renders only the server-selected beat when a protected outcome exists", () => {
  const result = renderDeterministicFallback({
    protectedPlayerOutcomePresent: true,
    seed: {
      playerOutcome: "总督已经定下复核主持权。",
      npcOrWorldPressure: "巡抚幕僚当面要求明确见证人的权限。",
      stopCondition: "县册原件与副本接下来由谁保管？",
    },
  });
  assert.equal(
    result,
    "巡抚幕僚当面要求明确见证人的权限。\n\n县册原件与副本接下来由谁保管？",
  );
  assert.doesNotMatch(result, /粮价|灾民|另遣|已经送达/u);
});

test("the same fallback contract works in a second world without core branching", () => {
  const result = renderDeterministicFallback({
    protectedPlayerOutcomePresent: false,
    seed: {
      playerOutcome: "The commander keeps the damaged shuttle docked.",
      npcOrWorldPressure: "The station engineer asks which inspection team gets access.",
      stopCondition: "Who will control the inspection log?",
    },
  });
  assert.equal(
    result,
    [
      "The commander keeps the damaged shuttle docked.",
      "The station engineer asks which inspection team gets access.",
      "Who will control the inspection log?",
    ].join("\n\n"),
  );
});
