import { ConflictException } from "@nestjs/common";

export const LEGACY_TERMINAL_TURN_NUMBER = 20 as const;
export const LEGACY_TERMINAL_PREDECESSOR_TURN = 19 as const;

/**
 * T20 is a historical read boundary, not an active authored head. New active
 * runs commit structured authority from T19 and project the last scene later.
 */
export class LegacyT20HeadGuard {
  shouldAdaptUnfinished(currentTurnNumber: number): boolean {
    return currentTurnNumber === LEGACY_TERMINAL_PREDECESSOR_TURN;
  }

  assertNoNewT20Head(nextTurnNumber: number, operation: "CREATE" | "REPLAY" | "RESTART" | "ADVANCE"): void {
    if (nextTurnNumber < LEGACY_TERMINAL_TURN_NUMBER) return;
    throw new ConflictException({
      code: "LEGACY_T20_HEAD_DISABLED",
      message: "New legacy T20 heads are disabled; commit the authoritative terminal result from T19 instead.",
      operation,
      nextTurnNumber,
      recoverable: false,
    });
  }

  assertCompletedHistoryReadOnly(status: string): void {
    if (status !== "completed") return;
    throw new ConflictException({
      code: "LEGACY_COMPLETED_RUN_READ_ONLY",
      message: "Completed historical runs are read-only.",
      recoverable: false,
    });
  }
}
