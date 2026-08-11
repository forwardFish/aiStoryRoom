import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ManeuverStoreV1,
  ManeuverTransactionV1,
} from "./maneuver-v1.core";
import { readManeuverContextV1, readManeuverProjectionV1 } from "./maneuver-v1.prisma-read";
import { createCommittedManeuverV1, findCommittedManeuverV1 } from "./maneuver-v1.prisma-write";
import { isRetryableTransactionError } from "./maneuver-v1.prisma-utils";
import { PrismaService } from "../prisma.service";

@Injectable()
export class ManeuverV1PrismaStore implements ManeuverStoreV1 {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  readContext(userId: string, runId: string) {
    return readManeuverContextV1(this.prisma, userId, runId);
  }

  readProjection(userId: string, runId: string) {
    return readManeuverProjectionV1(this.prisma, userId, runId);
  }

  async serializable<T>(operation: (tx: ManeuverTransactionV1) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => operation({
          readContext: (userId, runId) => readManeuverContextV1(tx, userId, runId),
          findByIdempotencyKey: (userId, runId, key) => findCommittedManeuverV1(tx, userId, runId, key),
          createAction: (input) => createCommittedManeuverV1(tx, input),
        }), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });
      } catch (error: any) {
        if (!isRetryableTransactionError(error) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1) ** 2));
      }
    }
    throw new Error("UNREACHABLE_MANEUVER_TRANSACTION_RETRY");
  }
}
