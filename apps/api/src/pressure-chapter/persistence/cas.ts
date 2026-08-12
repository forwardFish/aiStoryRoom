import type { Prisma } from "@prisma/client";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  assertPressureNarrativeTransition,
  assertPressureOutboxTransition,
  type PressureNarrativeStatusV1,
} from "./vocabulary";

export type PressurePersistenceTx = Prisma.TransactionClient;

export type FingerprintDisposition = "CREATE" | "REPLAY";

export function assertIdempotencyFingerprint(
  existing: { requestFingerprint: string } | null,
  requestFingerprint: string,
  scope: Readonly<Record<string, unknown>> = {},
): FingerprintDisposition {
  if (!existing) return "CREATE";
  if (existing.requestFingerprint === requestFingerprint) return "REPLAY";
  throw new PressurePersistenceError(
    ERROR.FINGERPRINT_MISMATCH,
    "An idempotency key was reused with a different canonical request fingerprint",
    { ...scope, storedFingerprint: existing.requestFingerprint, requestFingerprint },
  );
}

export function assertSingleStepAdvance(
  base: number,
  committed: number,
  label: "workingRevision" | "worldSequence",
  maximum?: number,
): void {
  if (!Number.isInteger(base) || !Number.isInteger(committed) || base < 0 || committed !== base + 1) {
    throw new PressurePersistenceError(
      ERROR.INVALID_SEQUENCE_ADVANCE,
      `${label} must advance by exactly one`,
      { label, base, committed },
    );
  }
  if (maximum !== undefined && committed > maximum) {
    throw new PressurePersistenceError(
      ERROR.INVALID_SEQUENCE_ADVANCE,
      `${label} exceeds its frozen maximum`,
      { label, base, committed, maximum },
    );
  }
}

export async function casAdvanceWorkingRevision(
  tx: PressurePersistenceTx,
  input: {
    runId: string;
    chapterRuntimeId: string;
    expectedWorkingRevision: number;
    committedWorkingRevision: number;
    expectedWorkingStateHash: string;
    committedWorkingStateHash: string;
    committedWorkingStateJson: Prisma.InputJsonValue;
  },
): Promise<number> {
  assertSingleStepAdvance(
    input.expectedWorkingRevision,
    input.committedWorkingRevision,
    "workingRevision",
  );

  const result = await tx.pressureChapterRuntime.updateMany({
    where: {
      id: input.chapterRuntimeId,
      runId: input.runId,
      workingRevision: input.expectedWorkingRevision,
      workingStateHash: input.expectedWorkingStateHash,
      state: { not: "CHAPTER_FROZEN" },
    },
    data: {
      workingRevision: input.committedWorkingRevision,
      workingStateHash: input.committedWorkingStateHash,
      workingStateJson: input.committedWorkingStateJson,
      lockVersion: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    throw new PressurePersistenceError(
      ERROR.WORKING_REVISION_MISMATCH,
      "Pressure chapter working-state CAS did not match exactly one active chapter",
      input,
    );
  }
  return input.committedWorkingRevision;
}

export async function casAdvanceWorldSequence(
  tx: PressurePersistenceTx,
  input: {
    runId: string;
    expectedWorldSequence: number;
    committedWorldSequence: number;
  },
): Promise<number> {
  assertSingleStepAdvance(
    input.expectedWorldSequence,
    input.committedWorldSequence,
    "worldSequence",
    7,
  );

  const result = await tx.storyRun.updateMany({
    where: {
      id: input.runId,
      worldSequence: input.expectedWorldSequence,
      pressureRouteSnapshot: { isNot: null },
    },
    data: {
      worldSequence: input.committedWorldSequence,
      reservedWorldSequence: input.committedWorldSequence,
    },
  });

  if (result.count !== 1) {
    throw new PressurePersistenceError(
      ERROR.WORLD_SEQUENCE_MISMATCH,
      "Pressure worldSequence CAS did not match exactly one routed run",
      input,
    );
  }
  return input.committedWorldSequence;
}

export async function casClaimOutboxTask(
  tx: PressurePersistenceTx,
  input: {
    taskId: string;
    workerId: string;
    now: Date;
    leaseExpiresAt: Date;
    expectedLeaseVersion: number;
  },
) {
  if (input.leaseExpiresAt.getTime() <= input.now.getTime()) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_LEASE_LOST,
      "Pressure Outbox lease expiry must be later than claim time",
      input,
    );
  }

  const candidate = await tx.pressureOutboxTask.findUnique({
    where: { id: input.taskId },
    select: { attempt: true, maxAttempts: true },
  });
  if (!candidate || candidate.attempt >= candidate.maxAttempts) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_ATTEMPTS_EXHAUSTED,
      "Pressure Outbox task has exhausted its frozen attempt budget",
      { ...input, attempt: candidate?.attempt, maxAttempts: candidate?.maxAttempts },
    );
  }

  const result = await tx.pressureOutboxTask.updateMany({
    where: {
      id: input.taskId,
      leaseVersion: input.expectedLeaseVersion,
      attempt: candidate.attempt,
      OR: [
        { status: { in: ["PENDING", "RETRYABLE"] }, availableAt: { lte: input.now } },
        { status: "LEASED", leaseExpiresAt: { lte: input.now } },
      ],
    },
    data: {
      status: "LEASED",
      checkpoint: "LEASED",
      leaseOwner: input.workerId,
      leaseExpiresAt: input.leaseExpiresAt,
      leaseVersion: { increment: 1 },
      attempt: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_LEASE_LOST,
      "Pressure Outbox claim lost its lease/fence CAS",
      input,
    );
  }

  return tx.pressureOutboxTask.findUniqueOrThrow({ where: { id: input.taskId } });
}

export async function casDeadLetterOutboxTask(
  tx: PressurePersistenceTx,
  input: {
    taskId: string;
    workerId: string;
    leaseVersion: number;
    now: Date;
    lastError: string;
  },
): Promise<void> {
  assertPressureOutboxTransition("LEASED", "DEAD_LETTER");
  const result = await tx.pressureOutboxTask.updateMany({
    where: {
      id: input.taskId,
      status: "LEASED",
      leaseOwner: input.workerId,
      leaseVersion: input.leaseVersion,
      leaseExpiresAt: { gt: input.now },
    },
    data: {
      status: "DEAD_LETTER",
      checkpoint: "DEAD_LETTER",
      completedAt: input.now,
      lastError: input.lastError,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  if (result.count !== 1) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_LEASE_LOST,
      "Pressure Outbox dead-letter transition lost its lease/fence CAS",
      input,
    );
  }
}

export async function casCompleteOutboxTask(
  tx: PressurePersistenceTx,
  input: {
    taskId: string;
    workerId: string;
    leaseVersion: number;
    completedAt: Date;
  },
): Promise<void> {
  assertPressureOutboxTransition("LEASED", "COMPLETED");
  const result = await tx.pressureOutboxTask.updateMany({
    where: {
      id: input.taskId,
      status: "LEASED",
      leaseOwner: input.workerId,
      leaseVersion: input.leaseVersion,
      leaseExpiresAt: { gt: input.completedAt },
    },
    data: {
      status: "COMPLETED",
      checkpoint: "ACKNOWLEDGED",
      completedAt: input.completedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  if (result.count !== 1) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_LEASE_LOST,
      "Pressure Outbox completion lost its lease/fence CAS",
      input,
    );
  }
}

export async function casRetryOutboxTask(
  tx: PressurePersistenceTx,
  input: {
    taskId: string;
    workerId: string;
    leaseVersion: number;
    now: Date;
    nextRetryAt: Date;
    lastError: string;
  },
): Promise<void> {
  assertPressureOutboxTransition("LEASED", "RETRYABLE");
  const result = await tx.pressureOutboxTask.updateMany({
    where: {
      id: input.taskId,
      status: "LEASED",
      leaseOwner: input.workerId,
      leaseVersion: input.leaseVersion,
      leaseExpiresAt: { gt: input.now },
    },
    data: {
      status: "RETRYABLE",
      checkpoint: "FAILED_RETRYABLE",
      availableAt: input.nextRetryAt,
      lastError: input.lastError,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  if (result.count !== 1) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_LEASE_LOST,
      "Pressure Outbox retry lost its lease/fence CAS",
      input,
    );
  }
}

export async function casAdvanceNarrativeProjection(
  tx: PressurePersistenceTx,
  input: {
    projectionId: string;
    expectedStatus: PressureNarrativeStatusV1;
    nextStatus: PressureNarrativeStatusV1;
    expectedLeaseVersion: number;
    workerId: string;
    now: Date;
    artifactJson?: unknown;
    artifactContentHash?: string;
  },
): Promise<void> {
  assertPressureNarrativeTransition(input.expectedStatus, input.nextStatus);
  const published = input.nextStatus === "PUBLISHED" || input.nextStatus === "FALLBACK_PUBLISHED";
  if (published && (!input.artifactJson || !input.artifactContentHash)) {
    throw new PressurePersistenceError(
      ERROR.INVALID_STATUS_TRANSITION,
      "A published Pressure Narrative projection must reference its immutable artifact",
      input,
    );
  }
  const result = await tx.pressureNarrativeProjection.updateMany({
    where: {
      id: input.projectionId,
      status: input.expectedStatus,
      leaseVersion: input.expectedLeaseVersion,
      leaseOwner: input.workerId,
      leaseExpiresAt: { gt: input.now },
    },
    data: {
      status: input.nextStatus,
      ...(published
        ? {
            checkpoint: "PUBLISHED" as const,
            publishedAt: input.now,
            artifactJson: input.artifactJson as Prisma.InputJsonValue,
            artifactContentHash: input.artifactContentHash,
          }
        : {}),
    },
  });
  if (result.count !== 1) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_LEASE_LOST,
      "Pressure Narrative projection lost its lease/status CAS",
      input,
    );
  }
}
