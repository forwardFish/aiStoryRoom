import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platform = readFileSync(new URL("../public/platform.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/platform.css", import.meta.url), "utf8");

test("/game/result loads the real openovel-result-v2 API instead of a hard-coded ending", () => {
  assert.match(platform, /\/api\/v4\/rooms\/\$\{encodeURIComponent\(runId\)\}\/result/);
  assert.match(platform, /openovel-result-v2/);
  assert.match(platform, /authoritativeResultStatus/);
  assert.match(platform, /narrativeStatus/);
  for (const forbidden of [
    "A Republic Without a Master",
    "The Reluctant Architect",
    "Fragile Stability",
    "Brutus",
    "fixture-caesar-finished",
  ]) {
    assert.equal(platform.includes(forbidden), false, `result page must not embed ${forbidden}`);
  }
});

test("result page handles all six narrative statuses while authority remains visible", () => {
  for (const status of [
    "PENDING",
    "GENERATING",
    "VALIDATING",
    "PUBLISHED",
    "FALLBACK_PUBLISHED",
    "FAILED_RETRYABLE",
  ]) {
    assert.match(platform, new RegExp(status));
  }
  assert.match(platform, /权威结局已确认，故事化结局正在生成。/);
  assert.match(platform, /structuredResultReady/);
});

test("result layout stays usable at 390px", () => {
  assert.match(css, /@media\s*\(max-width:520px\)[\s\S]*result-v2/);
  assert.match(css, /\.result-v2[\s\S]*min-width:\s*0/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});
