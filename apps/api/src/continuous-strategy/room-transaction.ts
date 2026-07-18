import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";

type Tx = Prisma.TransactionClient;

export type RoomTransactionOptions = {
  attempts?: number;
  maxWaitMs?: number;
  timeoutMs?: number;
};

/**
 * Serialize mutations for one running room at the database boundary.
 *
 * Human commands, Role-Agent seals and resolution checkpoints all touch the
 * same run/event cursor rows. Supabase may route those transactions through
 * different pooled connections, so process-local mutexes are insufficient.
 */
export async function roomSerializableTransaction<T>(
  prisma: PrismaService,
  roomId: string,
  operation: (tx: Tx) => Promise<T>,
  options: RoomTransactionOptions = {}
): Promise<T> {
  const attempts = Math.max(1, Math.min(20, Math.trunc(options.attempts || 10)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Prisma cannot deserialize PostgreSQL's `void` return type, so expose
        // the completed transaction-scoped lock as a supported boolean.
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`continuous-strategy:${roomId}`}, 0)) IS NULL AS acquired`);
        return operation(tx);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: options.maxWaitMs || 10_000,
        timeout: options.timeoutMs || 30_000
      });
    } catch (error: any) {
      const message = String(error?.message || error);
      const transient = error?.code === "P2034" || /40P01|40001|deadlock detected|write conflict/i.test(message);
      if (!transient || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, continuousSerializableRetryDelayMs(attempt)));
    }
  }
  throw new Error("unreachable room transaction retry state");
}

export function continuousSerializableRetryDelayMs(attempt: number, randomValue = Math.random()): number {
  const exponential = Math.min(2_000, 50 * 2 ** Math.max(0, attempt));
  const jitter = Math.max(0, Math.min(1, randomValue));
  return Math.floor(exponential / 2 + (exponential / 2) * jitter);
}
