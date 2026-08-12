import { Prisma } from "@prisma/client";
import {
  sha256Canonical,
  validateReplayCreationReceiptV1,
  type ReplayCreationReceiptV1,
} from "@ai-story/shared";
import {
  validateStoredReplayExecutionV1,
  type ReplayCreationRequestV1,
  type ReplayCreationTransactionPort,
  type ReplayExecutionReaderPort,
  type StoredReplayExecutionV1,
} from "../replay/ports";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";

interface ReplayReceiptRow {
  sourceRunId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  receiptJson: unknown;
  receiptHash: string;
}

export interface ReplayReceiptDelegateV1 {
  findUnique(input: Record<string, unknown>): Promise<ReplayReceiptRow | null>;
  create(input: { data: Record<string, unknown> }): Promise<ReplayReceiptRow>;
}

export interface ReplayReceiptTransactionV1 {
  pressureReplayCommandReceipt: ReplayReceiptDelegateV1;
}

export interface ReplayTargetCreationV1 {
  createdRunId: string | null;
  createdLobbyId: string | null;
}

/**
 * The implementation injected here owns new-target creation only. It must not
 * receive source-run mutation data; the source id is provenance, not a write
 * target. Its work executes inside the same transaction as the receipt.
 */
export interface ReplayNewTargetFactoryPortV1<TTransaction> {
  createRun(
    tx: TTransaction,
    request: Readonly<ReplayCreationRequestV1>,
  ): Promise<{ createdRunId: string }>;
  createLobby(
    tx: TTransaction,
    request: Readonly<ReplayCreationRequestV1>,
  ): Promise<{ createdLobbyId: string }>;
}

export type ReplayPrismaClient<TTransaction extends ReplayReceiptTransactionV1> =
  PressureSerializableClient<TTransaction>;

export class PrismaReplayExecutionReader<TTransaction extends ReplayReceiptTransactionV1>
implements ReplayExecutionReaderPort {
  constructor(private readonly prisma: ReplayPrismaClient<TTransaction>) {}

  async readExecution(
    sourceRunId: string,
    idempotencyKey: string,
  ): Promise<StoredReplayExecutionV1 | null> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.pressureReplayCommandReceipt.findUnique({
        where: { sourceRunId_idempotencyKey: { sourceRunId, idempotencyKey } },
        select: replayReceiptSelect(),
      });
      return row ? decodeExecution(row, sourceRunId, idempotencyKey) : null;
    });
  }
}

/** Atomic new-target + immutable receipt; never updates the source Run. */
export class PrismaReplayCreationTransaction<TTransaction extends ReplayReceiptTransactionV1>
implements ReplayCreationTransactionPort {
  constructor(
    private readonly prisma: ReplayPrismaClient<TTransaction>,
    private readonly targetFactory: ReplayNewTargetFactoryPortV1<TTransaction>,
  ) {}

  async createOnce(requestValue: Readonly<ReplayCreationRequestV1>): Promise<ReplayCreationReceiptV1> {
    const request = structuredClone(requestValue);
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        const prior = await tx.pressureReplayCommandReceipt.findUnique({
          where: {
            sourceRunId_idempotencyKey: {
              sourceRunId: request.sourceRunId,
              idempotencyKey: request.idempotencyKey,
            },
          },
          select: replayReceiptSelect(),
        });
        if (prior) return assertReplayRequest(decodeExecution(
          prior,
          request.sourceRunId,
          request.idempotencyKey,
        ), request).receipt;

        let target: ReplayTargetCreationV1 = {
          createdRunId: null,
          createdLobbyId: null,
        };
        if (request.action.launchKind === "CREATE_RUN") {
          if (!request.target) throw invalid("CREATE_RUN replay target is missing");
          const created = await this.targetFactory.createRun(tx, request);
          if (!created.createdRunId.trim()) throw invalid("Replay factory returned no Run id");
          target = { createdRunId: created.createdRunId, createdLobbyId: null };
        } else if (request.action.launchKind === "CREATE_LOBBY") {
          if (!request.target) throw invalid("CREATE_LOBBY replay target is missing");
          const created = await this.targetFactory.createLobby(tx, request);
          if (!created.createdLobbyId.trim()) throw invalid("Replay factory returned no Lobby id");
          target = { createdRunId: null, createdLobbyId: created.createdLobbyId };
        } else if (request.target !== null || !request.action.href) {
          throw invalid("NAVIGATE replay must use only the server action href");
        }

        const receipt = buildReceipt(request, target);
        const execution: StoredReplayExecutionV1 = {
          sourceRunId: request.sourceRunId,
          idempotencyKey: request.idempotencyKey,
          requestFingerprint: request.requestFingerprint,
          receipt,
        };
        const row = await tx.pressureReplayCommandReceipt.create({
          data: {
            sourceRunId: request.sourceRunId,
            idempotencyKey: request.idempotencyKey,
            requestFingerprint: request.requestFingerprint,
            actionId: request.action.actionId,
            actionFingerprint: request.action.actionFingerprint,
            launchKind: request.action.launchKind,
            createdRunId: receipt.createdRunId,
            createdLobbyId: receipt.createdLobbyId,
            navigationTarget: receipt.navigationTarget,
            frozenTargetRouteHash: receipt.frozenTargetRouteHash,
            receiptJson: json(execution),
            receiptHash: receipt.receiptHash,
          },
        });
        return assertReplayRequest(decodeExecution(
          row,
          request.sourceRunId,
          request.idempotencyKey,
        ), request).receipt;
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const reader = new PrismaReplayExecutionReader(this.prisma);
      const concurrent = await reader.readExecution(
        request.sourceRunId,
        request.idempotencyKey,
      );
      if (!concurrent) throw error;
      return assertReplayRequest(concurrent, request).receipt;
    }
  }
}

function buildReceipt(
  request: ReplayCreationRequestV1,
  target: ReplayTargetCreationV1,
): ReplayCreationReceiptV1 {
  const withoutHash = {
    schemaVersion: "replay_creation_receipt_v1" as const,
    sourceRunId: request.sourceRunId,
    actionId: request.action.actionId,
    launchKind: request.action.launchKind,
    createdRunId: target.createdRunId,
    createdLobbyId: target.createdLobbyId,
    navigationTarget: request.action.launchKind === "NAVIGATE"
      ? request.action.href
      : null,
    // Shared V1 kept the historical field name. Its value is the immutable
    // replay target descriptor hash; the actual new Run routeHash is produced
    // later from the pinned registration + new runSeed + final human seats.
    frozenTargetRouteHash: request.action.launchKind === "NAVIGATE"
      ? null
      : request.target?.targetDescriptorHash ?? null,
  };
  return validateReplayCreationReceiptV1({
    ...withoutHash,
    receiptHash: sha256Canonical(withoutHash),
  });
}

function decodeExecution(
  row: ReplayReceiptRow,
  sourceRunId: string,
  idempotencyKey: string,
): StoredReplayExecutionV1 {
  try {
    const execution = validateStoredReplayExecutionV1(
      row.receiptJson,
      sourceRunId,
      idempotencyKey,
    );
    if (
      row.sourceRunId !== sourceRunId
      || row.idempotencyKey !== idempotencyKey
      || row.requestFingerprint !== execution.requestFingerprint
      || row.receiptHash !== execution.receipt.receiptHash
    ) throw new Error("ROW_BINDING_MISMATCH");
    return structuredClone(execution);
  } catch (cause) {
    throw invalid("Stored replay receipt is invalid", {
      sourceRunId,
      idempotencyKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function assertReplayRequest(
  execution: StoredReplayExecutionV1,
  request: ReplayCreationRequestV1,
): StoredReplayExecutionV1 {
  if (
    execution.requestFingerprint !== request.requestFingerprint
    || execution.receipt.actionId !== request.action.actionId
    || execution.receipt.launchKind !== request.action.launchKind
  ) {
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "Replay idempotency key was already used by another request",
      { sourceRunId: request.sourceRunId, idempotencyKey: request.idempotencyKey },
    );
  }
  return structuredClone(execution);
}

function replayReceiptSelect(): Record<string, true> {
  return {
    sourceRunId: true,
    idempotencyKey: true,
    requestFingerprint: true,
    receiptJson: true,
    receiptHash: true,
  };
}

function invalid(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
