import {
  casClaimOutboxTask,
  casCompleteOutboxTask,
  casDeadLetterOutboxTask,
  casRetryOutboxTask,
} from "../persistence/cas";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";
import {
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "../persistence/transaction";
import type {
  ProgressOutboxClaimV1,
  ProgressOutboxPortV1,
  ProgressOutboxStoredTaskV1,
} from "./ports";

interface ProgressOutboxRow {
  id: string;
  runId: string;
  taskType: string;
  status: string;
  dedupeKey: string;
  sourceAuthority: string;
  sourceId: string;
  sourceCommitHash: string;
  payloadJson: unknown;
  payloadHash: string;
  attempt: number;
  maxAttempts: number;
  availableAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseVersion: number;
  createdAt: Date;
  lastError: string | null;
  completedAt: Date | null;
}

interface ProgressOutboxTransaction {
  pressureOutboxTask: {
    findFirst(input: Record<string, unknown>): Promise<ProgressOutboxRow | null>;
    findUnique(input: Record<string, unknown>): Promise<ProgressOutboxRow | null>;
    findUniqueOrThrow(input: Record<string, unknown>): Promise<ProgressOutboxRow>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type ProgressOutboxPrismaClientV1 =
  PressureSerializableClient<ProgressOutboxTransaction>;

const SUPPORTED_TASK_TYPES = Object.freeze(["OPEN_CHAPTER", "COMPUTE_FINALE"] as const);

export class PrismaProgressOutboxRepositoryV1 implements ProgressOutboxPortV1 {
  constructor(private readonly prisma: ProgressOutboxPrismaClientV1) {}

  async claimNext(request: {
    workerId: string;
    nowMs: number;
    leaseMs: number;
  }): Promise<ProgressOutboxClaimV1> {
    validateClaimRequest(request);
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const now = new Date(request.nowMs);
      const candidate = await tx.pressureOutboxTask.findFirst({
        where: {
          sourceAuthority: "CHAPTER_FROZEN",
          taskType: { in: [...SUPPORTED_TASK_TYPES] },
          OR: [
            { status: { in: ["PENDING", "RETRYABLE"] }, availableAt: { lte: now } },
            { status: "LEASED", leaseExpiresAt: { lte: now } },
          ],
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: rowSelect(),
      });
      if (!candidate) {
        const future = await tx.pressureOutboxTask.findFirst({
          where: {
            sourceAuthority: "CHAPTER_FROZEN",
            taskType: { in: [...SUPPORTED_TASK_TYPES] },
            status: { in: ["PENDING", "RETRYABLE", "LEASED"] },
          },
          orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: rowSelect(),
        });
        if (!future) return { kind: "EMPTY" };
        return {
          kind: "BUSY",
          retryAtMs: Math.max(
            request.nowMs,
            future.status === "LEASED"
              ? future.leaseExpiresAt?.getTime() ?? request.nowMs
              : future.availableAt.getTime(),
          ),
        };
      }

      if (candidate.attempt >= candidate.maxAttempts) {
        const dead = await tx.pressureOutboxTask.updateMany({
          where: {
            id: candidate.id,
            leaseVersion: candidate.leaseVersion,
            attempt: candidate.attempt,
          },
          data: {
            status: "DEAD_LETTER",
            checkpoint: "DEAD_LETTER",
            completedAt: now,
            lastError: ERROR.OUTBOX_ATTEMPTS_EXHAUSTED,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return dead.count === 1 ? { kind: "EMPTY" } : { kind: "BUSY", retryAtMs: request.nowMs };
      }

      const claimed = await casClaimOutboxTask(tx as never, {
        taskId: candidate.id,
        workerId: request.workerId,
        now,
        leaseExpiresAt: new Date(request.nowMs + request.leaseMs),
        expectedLeaseVersion: candidate.leaseVersion,
      }) as unknown as ProgressOutboxRow;

      return {
        kind: "CLAIMED",
        outboxId: claimed.id,
        fence: claimed.leaseVersion,
        attemptCount: claimed.attempt,
        maxAttempts: claimed.maxAttempts,
        task: mapStoredTask(claimed),
      };
    });
  }

  async acknowledge(request: {
    outboxId: string;
    fence: number;
    workerId: string;
    completedAtMs: number;
  }): Promise<void> {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      await casCompleteOutboxTask(tx as never, {
        taskId: request.outboxId,
        workerId: request.workerId,
        leaseVersion: request.fence,
        completedAt: new Date(request.completedAtMs),
      });
    });
  }

  async retry(request: {
    outboxId: string;
    fence: number;
    workerId: string;
    nowMs: number;
    nextAttemptAtMs: number;
    reasonCode: string;
  }): Promise<void> {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      await casRetryOutboxTask(tx as never, {
        taskId: request.outboxId,
        workerId: request.workerId,
        leaseVersion: request.fence,
        now: new Date(request.nowMs),
        nextRetryAt: new Date(request.nextAttemptAtMs),
        lastError: request.reasonCode,
      });
    });
  }

  async deadLetter(request: {
    outboxId: string;
    fence: number;
    workerId: string;
    nowMs: number;
    reasonCode: string;
  }): Promise<void> {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      await casDeadLetterOutboxTask(tx as never, {
        taskId: request.outboxId,
        workerId: request.workerId,
        leaseVersion: request.fence,
        now: new Date(request.nowMs),
        lastError: request.reasonCode,
      });
    });
  }
}

function mapStoredTask(row: ProgressOutboxRow): ProgressOutboxStoredTaskV1 {
  return {
    outboxId: row.id,
    runId: row.runId,
    taskType: row.taskType,
    dedupeKey: row.dedupeKey,
    sourceAuthority: row.sourceAuthority,
    sourceId: row.sourceId,
    sourceCommitHash: row.sourceCommitHash,
    payloadJson: structuredClone(row.payloadJson),
    payloadHash: row.payloadHash,
    attemptCount: row.attempt,
    maxAttempts: row.maxAttempts,
  };
}

function validateClaimRequest(
  request: { workerId: string; nowMs: number; leaseMs: number },
): void {
  if (!request.workerId.trim()) {
    throw invalid("Progress outbox workerId is required");
  }
  if (!Number.isSafeInteger(request.nowMs) || request.nowMs < 0) {
    throw invalid("Progress outbox nowMs is invalid");
  }
  if (!Number.isSafeInteger(request.leaseMs) || request.leaseMs <= 0) {
    throw invalid("Progress outbox leaseMs is invalid");
  }
}

function rowSelect(): Record<string, true> {
  return {
    id: true,
    runId: true,
    taskType: true,
    status: true,
    dedupeKey: true,
    sourceAuthority: true,
    sourceId: true,
    sourceCommitHash: true,
    payloadJson: true,
    payloadHash: true,
    attempt: true,
    maxAttempts: true,
    availableAt: true,
    leaseOwner: true,
    leaseExpiresAt: true,
    leaseVersion: true,
    createdAt: true,
    lastError: true,
    completedAt: true,
  };
}

function invalid(message: string): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message);
}

