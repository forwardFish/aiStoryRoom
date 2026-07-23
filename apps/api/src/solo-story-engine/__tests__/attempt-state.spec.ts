import assert from "node:assert/strict";
import { createAttemptRecord, incrementProviderCallCount, transitionAttempt } from "../attempt-state";

let attempt = createAttemptRecord({ attemptId: "a1", generationKey: "g1" });
attempt = transitionAttempt(attempt, "GENERATING");
attempt = incrementProviderCallCount(attempt, "NARRATOR");
attempt = incrementProviderCallCount(attempt, "DECISION");
attempt = transitionAttempt(attempt, "SUCCEEDED");
attempt = transitionAttempt(attempt, "PUBLISHED");
assert.equal(attempt.status, "PUBLISHED");
assert.equal(attempt.providerCallCount, 2);
assert.equal(attempt.narrationProviderCallCount, 1);
assert.equal(attempt.decisionProviderCallCount, 1);

let failed = createAttemptRecord({ attemptId: "a2", generationKey: "g2" });
failed = transitionAttempt(failed, "GENERATING");
failed = incrementProviderCallCount(failed, "NARRATOR");
failed = transitionAttempt(failed, "FAILED_RETRYABLE", "NARRATOR_OUTPUT_INVALID");
assert.equal(failed.failureCode, "NARRATOR_OUTPUT_INVALID");
assert.throws(
  () => incrementProviderCallCount(failed, "NARRATOR"),
  /NARRATOR_PROVIDER_ALREADY_CALLED/
);

let wrongOrder = createAttemptRecord({ attemptId: "a3", generationKey: "g3" });
wrongOrder = transitionAttempt(wrongOrder, "GENERATING");
assert.throws(
  () => incrementProviderCallCount(wrongOrder, "DECISION"),
  /DECISION_PROVIDER_CALL_OUT_OF_ORDER/
);

console.log("solo story engine two-stage attempt state: PASS");
