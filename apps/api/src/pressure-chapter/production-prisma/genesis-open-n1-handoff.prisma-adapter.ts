import {
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
} from "@ai-story/shared";
import { validateCommittedGenesis } from "../genesis";
import type { RuntimeChapterHandoffStartPortV1 } from "../runtime/contracts";
import {
  buildGenesisOpenN1OutboxDedupeKeyV1,
  type OpenPressureN1FromGenesisHandoffCommandV1,
  type RuntimeGenesisN1HandoffPortV1,
} from "../runtime/contracts";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";
import { pressureSerializableTransaction } from "../persistence/transaction";
import type {
  GenesisOpenN1HandoffPrismaClient,
  GenesisOpenN1OutboxRow,
} from "./prisma-ports";

export interface GenesisOpenN1HandoffConsumerOptionsV1 {
  workerId: string;
  leaseMs: number;
}

const DEFAULT_OPTIONS: GenesisOpenN1HandoffConsumerOptionsV1 = {
  workerId: "pressure-genesis-open-n1",
  leaseMs: 30_000,
};

type ClaimedHandoff = {
  row: GenesisOpenN1OutboxRow;
  fence: number | null;
  leaseOwner: string | null;
  status: "OPENED" | "REPLAYED";
};

/** The only concrete production path from the durable Genesis row to N1. */
export class PrismaGenesisOpenN1HandoffConsumerAdapter
implements RuntimeGenesisN1HandoffPortV1 {
  private readonly options: GenesisOpenN1HandoffConsumerOptionsV1;

  constructor(
    private readonly prisma: GenesisOpenN1HandoffPrismaClient,
    private readonly starter: RuntimeChapterHandoffStartPortV1,
    options: Partial<GenesisOpenN1HandoffConsumerOptionsV1> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (!this.options.workerId.trim() || !positiveInteger(this.options.leaseMs)) {
      throw invalid("Genesis OPEN_CHAPTER consumer options are invalid");
    }
  }

  async openFromGenesisHandoff(
    commandValue: Readonly<OpenPressureN1FromGenesisHandoffCommandV1>,
  ) {
    const command = normalizeCommand(commandValue);
    const workerId = `${this.options.workerId}:${command.requestFingerprint.slice(0, 16)}`;
    const claimed = await this.claim(command, workerId);
    let chapter;
    try {
      chapter = validateOrchestratorStateV1(
        await this.starter.start({
          routeSnapshot: structuredClone(command.routeSnapshot),
          genesisWorldStateHash:
            command.genesis.record.snapshot.initialWorldState.stateHash,
          genesisHash: command.genesis.record.snapshot.genesisHash,
          nowMs: command.nowMs,
        }),
      );
      if (
        chapter.runId !== command.handoff.runId ||
        chapter.routeHash !== command.routeSnapshot.routeHash ||
        chapter.currentChapterId !== "N1"
      ) {
        throw invalid("Handoff starter returned a different chapter authority", {
          runId: command.handoff.runId,
        });
      }
    } catch (cause) {
      if (claimed.fence !== null && claimed.leaseOwner) {
        await this.releaseRetryable(claimed, command.nowMs, cause).catch(() => undefined);
      }
      throw cause;
    }

    if (claimed.fence !== null && claimed.leaseOwner) {
      await this.acknowledge(claimed, command.nowMs);
    }
    return {
      status: claimed.status,
      sourceTaskType: "OPEN_CHAPTER" as const,
      sourceAuthority: "GENESIS_FROZEN" as const,
      sourceDedupeKey: command.handoff.outboxDedupeKey,
      sourceCommitHash: command.handoff.sourceCommitHash,
      outboxStatus: "ACKNOWLEDGED" as const,
      chapter: structuredClone(chapter),
    };
  }

  private async claim(
    command: OpenPressureN1FromGenesisHandoffCommandV1,
    workerId: string,
  ): Promise<ClaimedHandoff> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.pressureOutboxTask.findUnique({
        where: { dedupeKey: command.handoff.outboxDedupeKey },
        select: outboxSelect(),
      });
      if (!row) {
        throw new PressurePersistenceError(
          ERROR.RECORD_NOT_FOUND,
          "The exact Genesis OPEN_CHAPTER handoff row was not found",
          { dedupeKey: command.handoff.outboxDedupeKey },
        );
      }
      assertExactGenesisHandoffRow(row, command);
      if (row.status === "COMPLETED" && row.checkpoint === "ACKNOWLEDGED") {
        return { row, fence: null, leaseOwner: null, status: "REPLAYED" };
      }
      if (row.attempt >= row.maxAttempts) {
        const dead = await tx.pressureOutboxTask.updateMany({
          where: {
            id: row.id,
            dedupeKey: row.dedupeKey,
            leaseVersion: row.leaseVersion,
            attempt: row.attempt,
          },
          data: {
            status: "DEAD_LETTER",
            checkpoint: "DEAD_LETTER",
            lastError: "OPEN_N1_ATTEMPTS_EXHAUSTED",
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: new Date(command.nowMs),
          },
        });
        if (dead.count !== 1) throw leaseLost(row);
        throw new PressurePersistenceError(
          ERROR.OUTBOX_ATTEMPTS_EXHAUSTED,
          "Genesis OPEN_CHAPTER handoff exhausted its attempt budget",
          { outboxId: row.id },
        );
      }

      const now = new Date(command.nowMs);
      const available =
        row.status === "PENDING" ||
        (row.status === "RETRYABLE" &&
          row.availableAt.getTime() <= command.nowMs) ||
        (row.status === "LEASED" &&
          row.leaseExpiresAt !== null &&
          row.leaseExpiresAt.getTime() <= command.nowMs);
      if (!available) throw leaseLost(row);
      const nextFence = row.leaseVersion + 1;
      const claimed = await tx.pressureOutboxTask.updateMany({
        where: {
          id: row.id,
          runId: row.runId,
          taskType: "OPEN_CHAPTER",
          dedupeKey: row.dedupeKey,
          sourceAuthority: "GENESIS_FROZEN",
          sourceCommitHash: row.sourceCommitHash,
          status: row.status,
          leaseVersion: row.leaseVersion,
          attempt: row.attempt,
          ...(row.status === "LEASED"
            ? { leaseExpiresAt: { lte: now } }
            : row.status === "RETRYABLE"
              ? { availableAt: { lte: now } }
              : {}),
        },
        data: {
          status: "LEASED",
          checkpoint: "HANDLER_STARTED",
          leaseOwner: workerId,
          leaseExpiresAt: new Date(command.nowMs + this.options.leaseMs),
          leaseVersion: { increment: 1 },
          attempt: { increment: 1 },
          lastError: null,
        },
      });
      if (claimed.count !== 1) throw leaseLost(row);
      const readback = await tx.pressureOutboxTask.findUnique({
        where: { id: row.id },
        select: outboxSelect(),
      });
      if (
        !readback ||
        readback.status !== "LEASED" ||
        readback.leaseVersion !== nextFence ||
        readback.leaseOwner !== workerId
      ) {
        throw leaseLost(row);
      }
      return {
        row: readback,
        fence: nextFence,
        leaseOwner: workerId,
        status: row.attempt === 0 ? "OPENED" : "REPLAYED",
      };
    });
  }

  private async acknowledge(claimed: ClaimedHandoff, completedAtMs: number) {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      const updated = await tx.pressureOutboxTask.updateMany({
        where: {
          id: claimed.row.id,
          runId: claimed.row.runId,
          taskType: "OPEN_CHAPTER",
          dedupeKey: claimed.row.dedupeKey,
          sourceAuthority: "GENESIS_FROZEN",
          sourceCommitHash: claimed.row.sourceCommitHash,
          status: "LEASED",
          leaseOwner: claimed.leaseOwner,
          leaseVersion: claimed.fence,
          leaseExpiresAt: { gt: new Date(completedAtMs) },
        },
        data: {
          status: "COMPLETED",
          checkpoint: "ACKNOWLEDGED",
          completedAt: new Date(completedAtMs),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      if (updated.count === 1) return;
      const current = await tx.pressureOutboxTask.findUnique({
        where: { id: claimed.row.id },
        select: outboxSelect(),
      });
      if (
        current?.dedupeKey === claimed.row.dedupeKey &&
        current.status === "COMPLETED" &&
        current.checkpoint === "ACKNOWLEDGED"
      ) return;
      throw leaseLost(claimed.row);
    });
  }

  private async releaseRetryable(
    claimed: ClaimedHandoff,
    nowMs: number,
    cause: unknown,
  ): Promise<void> {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      const updated = await tx.pressureOutboxTask.updateMany({
        where: {
          id: claimed.row.id,
          status: "LEASED",
          leaseOwner: claimed.leaseOwner,
          leaseVersion: claimed.fence,
        },
        data: {
          status: "RETRYABLE",
          checkpoint: "FAILED_RETRYABLE",
          availableAt: new Date(nowMs),
          lastError: readErrorCode(cause),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (updated.count !== 1) throw leaseLost(claimed.row);
    });
  }
}

function normalizeCommand(
  commandValue: Readonly<OpenPressureN1FromGenesisHandoffCommandV1>,
): OpenPressureN1FromGenesisHandoffCommandV1 {
  const routeSnapshot = validateRunRouteSnapshotV1(commandValue.routeSnapshot);
  const genesis = validateCommittedGenesis(commandValue.genesis);
  const handoff = structuredClone(commandValue.handoff);
  const expectedKey = buildGenesisOpenN1OutboxDedupeKeyV1(
    genesis.record.runId,
    genesis.record.commit.commitHash,
  );
  if (
    handoff?.schemaVersion !== "pressure_genesis_n1_handoff_v1" ||
    handoff.taskType !== "OPEN_CHAPTER" ||
    handoff.checkpoint !== "PERSISTED" ||
    handoff.sourceAuthority !== "GENESIS_FROZEN" ||
    handoff.chapterId !== "N1" ||
    handoff.runId !== routeSnapshot.runId ||
    handoff.runId !== genesis.record.runId ||
    handoff.genesisHash !== genesis.record.snapshot.genesisHash ||
    handoff.sourceCommitHash !== genesis.record.commit.commitHash ||
    handoff.outboxDedupeKey !== expectedKey ||
    genesis.record.snapshot.routeHash !== routeSnapshot.routeHash
  ) {
    throw new PressurePersistenceError(
      ERROR.AUTHORITY_FENCE_MISMATCH,
      "Genesis OPEN_CHAPTER handoff authority does not match route/Genesis",
      { expectedKey },
    );
  }
  if (!commandValue.idempotencyKey?.trim() || !isSha256(commandValue.requestFingerprint)) {
    throw invalid("Genesis OPEN_CHAPTER idempotency fields are invalid");
  }
  if (!Number.isSafeInteger(commandValue.nowMs) || commandValue.nowMs < 0) {
    throw invalid("Genesis OPEN_CHAPTER nowMs is invalid");
  }
  return {
    routeSnapshot: structuredClone(routeSnapshot),
    genesis: structuredClone(genesis),
    handoff,
    idempotencyKey: commandValue.idempotencyKey.trim(),
    requestFingerprint: commandValue.requestFingerprint,
    nowMs: commandValue.nowMs,
  };
}

function assertExactGenesisHandoffRow(
  row: GenesisOpenN1OutboxRow,
  command: OpenPressureN1FromGenesisHandoffCommandV1,
): void {
  const expectedPayload = {
    schemaVersion: "pressure_open_chapter_task_v1",
    runId: command.handoff.runId,
    chapterId: "N1",
    genesisHash: command.handoff.genesisHash,
    sourceCommitHash: command.handoff.sourceCommitHash,
  };
  if (
    row.runId !== command.handoff.runId ||
    row.taskType !== "OPEN_CHAPTER" ||
    row.dedupeKey !== command.handoff.outboxDedupeKey ||
    row.sourceAuthority !== "GENESIS_FROZEN" ||
    row.sourceId !== command.handoff.genesisHash ||
    row.sourceCommitHash !== command.handoff.sourceCommitHash ||
    row.payloadHash !== sha256Canonical(expectedPayload) ||
    sha256Canonical(row.payloadJson) !== row.payloadHash
  ) {
    throw new PressurePersistenceError(
      ERROR.AUTHORITY_FENCE_MISMATCH,
      "Stored OPEN_CHAPTER row is not the exact Genesis handoff",
      { outboxId: row.id, dedupeKey: row.dedupeKey },
    );
  }
}

function outboxSelect(): Record<string, true> {
  return {
    id: true,
    runId: true,
    taskType: true,
    status: true,
    checkpoint: true,
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
    lastError: true,
    completedAt: true,
  };
}

function leaseLost(row: Pick<GenesisOpenN1OutboxRow, "id" | "dedupeKey">) {
  return new PressurePersistenceError(
    ERROR.OUTBOX_LEASE_LOST,
    "Genesis OPEN_CHAPTER claim/ack lost its lease fence",
    { outboxId: row.id, dedupeKey: row.dedupeKey },
  );
}

function invalid(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (code) return code;
  }
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}
