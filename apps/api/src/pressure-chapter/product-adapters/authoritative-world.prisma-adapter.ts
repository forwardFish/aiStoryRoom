import { Prisma } from "@prisma/client";
import {
  validateFrozenChapterBundleV1,
  type WorldStateV1,
} from "@ai-story/shared";
import type { PrismaService } from "../../prisma.service";
import { validateAtomicChapterCommitRecordV1 } from "../chapter-settlement";
import { validateCommittedGenesis } from "../genesis";
import type { AuthoritativeChapterWorldReaderPort } from "../integration";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";
import { readPinnedPressureRouteV1 } from "./route-authority";

export class PrismaAuthoritativeChapterWorldReaderV1
implements AuthoritativeChapterWorldReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async readAuthorityBase(input: Readonly<{
    runId: string;
    routeHash: string;
    baseWorldSequence: number;
    baseWorldStateHash: string;
    previousFrozenHash: string;
  }>): Promise<Readonly<{
    routeHash: string;
    sourceFrozenHash: string;
    worldState: WorldStateV1;
  }> | null> {
    if (!Number.isSafeInteger(input.baseWorldSequence) || input.baseWorldSequence < 0 || input.baseWorldSequence > 7) {
      return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "baseWorldSequence");
    }
    return this.prisma.$transaction(async (tx) => {
      const route = await readPinnedPressureRouteV1(tx, input.runId, input.routeHash);
      if (input.baseWorldSequence === 0) {
        const row = await tx.pressureGenesisCommit.findUnique({
          where: { runId: input.runId },
          select: { runId: true, commitManifestJson: true },
        });
        if (!row) return null;
        let committed;
        try {
          committed = validateCommittedGenesis(
            row.commitManifestJson as unknown as Parameters<typeof validateCommittedGenesis>[0],
          );
        } catch (cause) {
          return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "PressureGenesisCommit.commitManifestJson", String(cause));
        }
        const world = committed.record.snapshot.initialWorldState;
        if (
          row.runId !== input.runId
          || committed.record.runId !== input.runId
          || committed.record.commit.routeHash !== route.snapshot.routeHash
          || committed.record.snapshot.genesisHash !== input.previousFrozenHash
          || world.worldSequence !== 0
          || world.stateHash !== input.baseWorldStateHash
        ) {
          return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "PressureGenesisCommit", "BASE_BINDING");
        }
        return {
          routeHash: route.snapshot.routeHash,
          sourceFrozenHash: committed.record.snapshot.genesisHash,
          worldState: structuredClone(world),
        };
      }

      const row = await tx.pressureChapterSettlement.findUnique({
        where: {
          runId_committedWorldSequence: {
            runId: input.runId,
            committedWorldSequence: input.baseWorldSequence,
          },
        },
        select: { runId: true, chapterSequence: true, commitManifestJson: true },
      });
      if (!row) return null;
      let record;
      try {
        record = validateAtomicChapterCommitRecordV1(row.commitManifestJson);
        validateFrozenChapterBundleV1(record.frozenChapterBundle);
      } catch (cause) {
        return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "PressureChapterSettlement.commitManifestJson", String(cause));
      }
      const bundle = record.frozenChapterBundle;
      if (
        row.runId !== input.runId
        || record.runId !== input.runId
        || row.chapterSequence !== input.baseWorldSequence
        || bundle.chapterSequence !== input.baseWorldSequence
        || bundle.committedWorldSequence !== input.baseWorldSequence
        || record.sealedInput.runRouteHash !== route.snapshot.routeHash
        || bundle.bundleHash !== input.previousFrozenHash
        || bundle.frozenWorldState.worldSequence !== input.baseWorldSequence
        || bundle.frozenWorldState.stateHash !== input.baseWorldStateHash
      ) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "PressureChapterSettlement", "BASE_BINDING");
      }
      return {
        routeHash: route.snapshot.routeHash,
        sourceFrozenHash: bundle.bundleHash,
        worldState: structuredClone(bundle.frozenWorldState),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
