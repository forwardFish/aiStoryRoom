import { Prisma, type Prisma as PrismaNamespace } from "@prisma/client";

type Tx = PrismaNamespace.TransactionClient;

export type SerializableTransactionHost = {
  $transaction<T>(
    operation: (tx: Tx) => Promise<T>,
    options: { isolationLevel: PrismaNamespace.TransactionIsolationLevel; maxWait: number; timeout: number }
  ): Promise<T>;
};

export type ContinuousStorySerializableOptions = {
  attempts?: number;
  maxWaitMs?: number;
  timeoutMs?: number;
  retryDelayMs?: (attempt: number) => number;
};

/**
 * One authoritative retry boundary for every Continuous Story V2 transaction.
 * The whole operation is replayed after PostgreSQL serialization/deadlock
 * conflicts; callers must therefore keep every mutation idempotent.
 */
export async function continuousStoryV2Serializable<T>(
  prisma: SerializableTransactionHost,
  operation: (tx: Tx) => Promise<T>,
  options: ContinuousStorySerializableOptions = {}
): Promise<T> {
  const attempts = Math.max(1, Math.min(10, Math.trunc(options.attempts || 4)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: options.maxWaitMs || 10_000,
        timeout: options.timeoutMs || 45_000
      });
    } catch (error) {
      if (!isRetryableSerializableError(error) || attempt === attempts - 1) throw error;
      const delayMs = options.retryDelayMs?.(attempt) ?? 25 * (attempt + 1);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("unreachable serializable retry state");
}

export function isRetryableSerializableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code || "");
  const message = String((error as { message?: unknown }).message || "");
  return code === "P2034"
    || code === "P2002"
    || code === "P2028"
    || /40P01|40001|deadlock|write conflict|serialization failure/i.test(message);
}
