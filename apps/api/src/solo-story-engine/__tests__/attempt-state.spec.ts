import assert from "node:assert/strict";
import { createAttemptRecord, incrementProviderCallCount, transitionAttempt } from "../attempt-state";

let attempt = createAttemptRecord({ attemptId: "a1", generationKey: "g1" });
attempt = transitionAttempt(attempt, "GENERATING");
attempt = incrementProviderCallCount(attempt);
attempt = transitionAttempt(attempt, "SUCCEEDED");
attempt = transitionAttempt(attempt, "PUBLISHED");
assert.equal(attempt.status, "PUBLISHED");
assert.equal(attempt.providerCallCount, 1);

let failed = createAttemptRecord({ attemptId: "a2", generationKey: "g2" });
failed = transitionAttempt(failed, "GENERATING");
failed = incrementProviderCallCount(failed);
failed = transitionAttempt(failed, "FAILED_RETRYABLE", "MODEL_JSON_INVALID");
assert.equal(failed.failureCode, "MODEL_JSON_INVALID");

assert.throws(() => incrementProviderCallCount(failed), /PROVIDER_ALREADY_CALLED/);

console.log("solo story engine attempt state: PASS");
