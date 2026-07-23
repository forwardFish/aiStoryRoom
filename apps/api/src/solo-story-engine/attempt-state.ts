import type { AttemptRecord, AttemptStatus, StoryProviderStage } from "./types";

export function createAttemptRecord(input: { attemptId: string; generationKey: string }): AttemptRecord {
  return {
    attemptId: input.attemptId,
    generationKey: input.generationKey,
    providerCallCount: 0,
    narrationProviderCallCount: 0,
    decisionProviderCallCount: 0,
    status: "QUEUED",
    failureCode: null
  };
}

export function transitionAttempt(attempt: AttemptRecord, next: AttemptStatus, failureCode: string | null = null): AttemptRecord {
  const allowed = allowedTransitions[attempt.status];
  if (!allowed.includes(next)) throw new Error(`ATTEMPT_TRANSITION_INVALID:${attempt.status}->${next}`);
  return {
    ...attempt,
    status: next,
    failureCode
  };
}

export function incrementProviderCallCount(
  attempt: AttemptRecord,
  stage: StoryProviderStage
): AttemptRecord {
  if (stage === "NARRATOR") {
    if (attempt.providerCallCount !== 0 || attempt.narrationProviderCallCount !== 0) {
      throw new Error("NARRATOR_PROVIDER_ALREADY_CALLED");
    }
  } else if (
    attempt.providerCallCount !== 1
    || attempt.narrationProviderCallCount !== 1
    || attempt.decisionProviderCallCount !== 0
  ) {
    throw new Error("DECISION_PROVIDER_CALL_OUT_OF_ORDER");
  }
  return {
    ...attempt,
    providerCallCount: attempt.providerCallCount + 1,
    narrationProviderCallCount: attempt.narrationProviderCallCount + (stage === "NARRATOR" ? 1 : 0),
    decisionProviderCallCount: attempt.decisionProviderCallCount + (stage === "DECISION" ? 1 : 0)
  };
}

const allowedTransitions: Record<AttemptStatus, AttemptStatus[]> = {
  QUEUED: ["GENERATING", "REJECTED", "SUPERSEDED"],
  GENERATING: ["SUCCEEDED", "FAILED_RETRYABLE", "REJECTED", "SUPERSEDED"],
  SUCCEEDED: ["PUBLISHED", "SUPERSEDED"],
  FAILED_RETRYABLE: ["SUPERSEDED"],
  REJECTED: ["SUPERSEDED"],
  SUPERSEDED: [],
  PUBLISHED: []
};
