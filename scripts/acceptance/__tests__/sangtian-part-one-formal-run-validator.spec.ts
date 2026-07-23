import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACCEPTANCE_CHECKPOINTS,
  validateFormalRunDirectory
} from "../sangtian-part-one-formal-run-validator.ts";

test("formal run contract requires G00 plus every generated turn T01 through T20", () => {
  assert.equal(ACCEPTANCE_CHECKPOINTS.length, 21);
  assert.equal(ACCEPTANCE_CHECKPOINTS[0], "G00");
  assert.equal(ACCEPTANCE_CHECKPOINTS.at(-1), "T20");
  assert.equal(new Set(ACCEPTANCE_CHECKPOINTS).size, 21);
});

test("an incomplete run fails closed instead of turning a partial player sample into acceptance", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "sangtian-formal-run-incomplete-"));
  try {
    const result = await validateFormalRunDirectory(runDir);
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.actualPlayerReviewCount, 0);
    assert.equal(result.actualChoiceBindingCount, 0);
    assert.match(result.errors.join("\n"), /missing checkpoint directory.*G00/);
    assert.match(result.errors.join("\n"), /missing checkpoint directory.*turn-07/);
    assert.match(result.errors.join("\n"), /independent blind-player review count/);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
