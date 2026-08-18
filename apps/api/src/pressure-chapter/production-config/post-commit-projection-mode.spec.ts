import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePressurePostCommitProjectionModeV1,
} from "./post-commit-projection-mode";

test("post-commit projection mode is independent, exact and defaults to REPLAY", () => {
  assert.equal(resolvePressurePostCommitProjectionModeV1({}), "REPLAY");
  assert.equal(resolvePressurePostCommitProjectionModeV1({ PRESSURE_POST_COMMIT_PROJECTION_MODE: "SHADOW" }), "SHADOW");
  assert.equal(resolvePressurePostCommitProjectionModeV1({ PRESSURE_POST_COMMIT_PROJECTION_MODE: "FAST", PRESSURE_GAME_READ_MODE: "REPLAY" }), "FAST");
  assert.throws(
    () => resolvePressurePostCommitProjectionModeV1({ PRESSURE_POST_COMMIT_PROJECTION_MODE: "fast" }),
    /PRESSURE_POST_COMMIT_PROJECTION_MODE_INVALID/u,
  );
});
