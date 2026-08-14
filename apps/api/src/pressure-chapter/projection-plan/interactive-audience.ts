import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type NarrativeAudienceV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";

/**
 * Selects only audiences that can consume a chapter narrative in the active run.
 * AI-controlled seats still act and settle; they do not need private literary
 * projections on the player-facing critical path.
 */
export function planInteractiveNarrativeAudiencesV1(input: Readonly<{
  humanSeatIds: readonly string[];
}>): NarrativeAudienceV1[] {
  const requested = new Set(input.humanSeatIds);
  if (requested.size === 0 || requested.size !== input.humanSeatIds.length) {
    throw invalid("Interactive narrative audiences must contain unique human seats");
  }
  if ([...requested].some((seatId) =>
    !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId as SeatIdV1))) {
    throw invalid("Interactive narrative audience contains an unknown seat");
  }
  return PRESSURE_CHAPTER_SEAT_IDS_V1
    .filter((seatId) => requested.has(seatId))
    .map((seatId) => ({ kind: "SEAT" as const, seatId }));
}

function invalid(message: string): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message);
}
