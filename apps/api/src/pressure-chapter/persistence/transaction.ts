import { Prisma } from "@prisma/client";
import {
  recordPressureDbTransactionAttemptV1,
  recordPressureDbTransactionCommitV1,
  recordPressureDbTransactionRetryV1,
  recordPressureDbTransactionRollbackV1,
} from "../observability/pressure-db-metrics";

export interface PressureSerializableClient<TTransaction> {
  $transaction<T>(
    operation: (tx: TTransaction) => Promise<T>,
    options: typeof PRESSURE_TRANSACTION_OPTIONS,
  ): Promise<T>;
}

export const PRESSURE_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 30_000,
});

export async function pressureSerializableTransaction<TTransaction, TResult>(
  prisma: PressureSerializableClient<TTransaction>,
  operation: (tx: TTransaction) => Promise<TResult>,
  retries = 3,
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    recordPressureDbTransactionAttemptV1();
    try {
      const result = await prisma.$transaction(operation, PRESSURE_TRANSACTION_OPTIONS);
      recordPressureDbTransactionCommitV1();
      return result;
    } catch (error) {
      recordPressureDbTransactionRollbackV1();
      lastError = error;
      if (!isSerializableRetry(error) || attempt === retries) throw error;
      recordPressureDbTransactionRetryV1();
    }
  }
  throw lastError;
}

export function isSerializableRetry(error: unknown): boolean {
  if (prismaErrorCode(error) === "P2034") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /40001|40P01|serialization|deadlock detected|write conflict/i.test(message);
}

export function isUniqueConflict(error: unknown): boolean {
  return prismaErrorCode(error) === "P2002";
}

export function prismaErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
