import { recomputeAuthorityResultSnapshotHashV1 } from "@ai-story/shared";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "./errors";
import {
  validateAuthoritativePressureResultSnapshotV1,
  validatePressureResultNarrativeReadSetV1,
  validatePressureResultReadModelInputV1,
  validatePressureResultReadModelSourceV1,
  type PressureResultReadModelInputReaderPort,
  type PressureResultReadModelReaderPort,
  type PressureResultReadModelSourceV1,
} from "./ports";

/**
 * Read-only authority+narrative composer. The dependency surface intentionally
 * has no Settlement, Finale, Provider, clock or persistence writer capability.
 */
export class PressureResultReadModelComposerV1
implements PressureResultReadModelReaderPort {
  constructor(
    private readonly inputReader: PressureResultReadModelInputReaderPort,
  ) {}

  async readFinalized(runId: string): Promise<PressureResultReadModelSourceV1 | null> {
    const rawInput = await this.inputReader.readConsistentSource(runId);
    if (rawInput === null) return null;
    const input = validatePressureResultReadModelInputV1(rawInput);
    const authority = validateAuthoritativePressureResultSnapshotV1(input.authority, runId);
    const authorityHashBeforeJoin = authority.snapshotHash;
    if (recomputeAuthorityResultSnapshotHashV1(authority) !== authorityHashBeforeJoin) {
      failPressureResultRead(
        ERROR.RESULT_STORED_RECORD_INVALID,
        "authorityResultSnapshot.snapshotHash",
        "HASH_MISMATCH",
      );
    }

    if (input.narrativeReadSet === null) {
      failPressureResultRead(
        ERROR.RESULT_STORED_RECORD_INVALID,
        "narrativeReadSet",
        "FINALIZED_AUTHORITY_REQUIRES_SIX_PROJECTIONS",
      );
    }
    const narrativeReadSet = validatePressureResultNarrativeReadSetV1(
      input.narrativeReadSet,
      authority,
    );
    const readModel = validatePressureResultReadModelSourceV1({
      authority,
      narratives: narrativeReadSet.narratives,
    }, runId);

    if (
      readModel.authority.snapshotHash !== authorityHashBeforeJoin ||
      recomputeAuthorityResultSnapshotHashV1(readModel.authority) !== authorityHashBeforeJoin
    ) {
      failPressureResultRead(
        ERROR.RESULT_STORED_RECORD_INVALID,
        "resultReadModel.authority.snapshotHash",
        "NARRATIVE_JOIN_MUTATED_AUTHORITY",
      );
    }
    return deepFreeze(readModel);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
