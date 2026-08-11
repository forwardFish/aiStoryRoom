import assert from "node:assert/strict";
import test from "node:test";

import { classifyModelCallErrors } from "./lib/model-call-error-policy.mjs";

test("accepts a failed narrator request when a later attempt succeeds", () => {
  const result = classifyModelCallErrors({
    modelCalls: [
      { turnId: "T01", stage: "narrator", attempt: 1, error: "fetch failed" },
      { turnId: "T01", stage: "narrator", attempt: 2, error: null },
    ],
    turns: [{ turnId: "T01", narrativeOwner: "NARRATOR", narrative: "A scene." }],
    storykeeper: { applied: ["T01"], deadLetters: [] },
  });
  assert.equal(result.unexpected.length, 0);
  assert.equal(result.recovered[0].recovery, "LATER_NARRATOR_ATTEMPT_SUCCEEDED");
});

test("accepts narrator failure only when a committed safe fallback exists", () => {
  const result = classifyModelCallErrors({
    modelCalls: [{ turnId: "T02", stage: "narrator", attempt: 1, error: "fetch failed" }],
    turns: [{
      turnId: "T02",
      narrativeOwner: "FALLBACK",
      fallbackReason: "NARRATOR_UNAVAILABLE",
      narrative: "A deterministic fallback scene.",
    }],
    storykeeper: { applied: ["T02"], deadLetters: [] },
  });
  assert.equal(result.unexpected.length, 0);
  assert.equal(result.recovered[0].recovery, "COMMITTED_SAFE_NARRATIVE_FALLBACK");
});

test("accepts a storykeeper failure only after the turn is applied", () => {
  const result = classifyModelCallErrors({
    modelCalls: [{ turnId: "T14", stage: "storykeeper", attempt: 1, error: "fetch failed" }],
    turns: [{ turnId: "T14", narrativeOwner: "NARRATOR", narrative: "A scene." }],
    storykeeper: { applied: ["T14"], deadLetters: [] },
  });
  assert.equal(result.unexpected.length, 0);
  assert.equal(result.recovered[0].recovery, "STORYKEEPER_EVENTUALLY_APPLIED");
});

test("keeps unrecovered or unknown-stage failures fatal", () => {
  const result = classifyModelCallErrors({
    modelCalls: [
      { turnId: "T03", stage: "narrator", attempt: 1, error: "fetch failed" },
      { turnId: "T04", stage: "options", attempt: 1, error: "invalid response" },
      { turnId: "T05", stage: "storykeeper", attempt: 1, error: "fetch failed" },
    ],
    turns: [
      { turnId: "T03", narrativeOwner: "NARRATOR", narrative: "" },
      { turnId: "T04", narrativeOwner: "NARRATOR", narrative: "A scene." },
      { turnId: "T05", narrativeOwner: "NARRATOR", narrative: "A scene." },
    ],
    storykeeper: { applied: [], deadLetters: ["T05"] },
  });
  assert.equal(result.recovered.length, 0);
  assert.deepEqual(result.unexpected.map((call) => call.stage), [
    "narrator",
    "options",
    "storykeeper",
  ]);
});
