import type { WorkingProjectionReaderPort } from "../orchestrator/contracts";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { decodeWorkingLedgerProjectionCacheV1 } from "../working-ledger/projection-cache";

interface FastProjectionRowV1 {
  id: string;
  runId: string;
  chapterId: string;
  routeHash: string;
  workingRevision: number;
  workingStateJson: unknown;
  workingStateHash: string;
  ledgerProjectionJson: unknown;
}

export interface WorkingProjectionFastReaderPrismaClientV1 {
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<FastProjectionRowV1 | null>;
  };
}

/** One-row normal-path reader. Recovery/audit/replay keep using StoryEvent. */
export class WorkingProjectionFastReaderV1 implements WorkingProjectionReaderPort {
  constructor(private readonly prisma: WorkingProjectionFastReaderPrismaClientV1) {}

  async load(input: Parameters<WorkingProjectionReaderPort["load"]>[0]): Promise<WorkingLedgerProjectionV1> {
    const row = await this.prisma.pressureChapterRuntime.findUnique({
      where: { id: input.chapterRuntimeId },
      select: {
        id: true,
        runId: true,
        chapterId: true,
        routeHash: true,
        workingRevision: true,
        workingStateJson: true,
        workingStateHash: true,
        ledgerProjectionJson: true,
      },
    });
    if (!row || row.runId !== input.runId || row.id !== input.chapterRuntimeId) {
      throw new Error("WORKING_PROJECTION_FAST_READER_NOT_FOUND");
    }
    return decodeWorkingLedgerProjectionCacheV1(row.ledgerProjectionJson, {
      runId: row.runId,
      chapterRuntimeId: row.id,
      chapterId: row.chapterId,
      routeHash: row.routeHash,
      workingRevision: row.workingRevision,
      workingState: row.workingStateJson,
      workingStateHash: row.workingStateHash,
    });
  }
}
