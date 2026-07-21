import type { AttemptRecord, AttemptStatus } from "./types";

export function createAttemptRecord(input: { attemptId: string; generationKey: string }): AttemptRecord {
  return {
    attemptId: input.attemptId,
    generationKey: input.generationKey,
    providerCallCount: 0,
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

export function incrementProviderCallCount(attempt: AttemptRecord): AttemptRecord {
  if (attempt.providerCallCount >= 1) throw new Error("PROVIDER_ALREADY_CALLED");
  return {
    ...attempt,
    providerCallCount: attempt.providerCallCount + 1
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
