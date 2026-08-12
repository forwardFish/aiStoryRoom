import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  type DecisionActionV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type { WorkingActionIntentV1 } from "./contracts";

export function canonicalizeWorkingActionIntentV1(
  intent: WorkingActionIntentV1,
): WorkingActionIntentV1 {
  const seatOrder = new Map(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seat, index) => [seat, index]));
  const sortSeats = (seats: readonly SeatIdV1[]) => unique(seats)
    .sort((left, right) => seatOrder.get(left)! - seatOrder.get(right)!);
  return {
    visibility: intent.visibility,
    targetSeatIds: sortSeats(intent.targetSeatIds),
    evidenceRefs: unique(intent.evidenceRefs).sort(compareCanonicalText),
    resourceReservations: [...intent.resourceReservations]
      .map((item) => ({ ...item }))
      .sort((left, right) => compareCanonicalText(left.reservationKey, right.reservationKey)),
    commitmentMutations: [...intent.commitmentMutations]
      .map((item) => ({ ...item, seatIds: sortSeats(item.seatIds) }))
      .sort((left, right) => compareCanonicalText(left.commitmentId, right.commitmentId)),
    knowledgeGrants: [...intent.knowledgeGrants]
      .map((item) => ({ ...item, factRefs: unique(item.factRefs).sort(compareCanonicalText) }))
      .sort((left, right) => seatOrder.get(left.seatId)! - seatOrder.get(right.seatId)!),
    seatArcProgress: [...intent.seatArcProgress]
      .map((item) => ({ ...item }))
      .sort((left, right) => seatOrder.get(left.seatId)! - seatOrder.get(right.seatId)!),
  };
}

export function computeWorkingActionInputFingerprintV1(input: {
  routeHash: string;
  action: DecisionActionV1;
  intent: WorkingActionIntentV1;
}): string {
  return sha256Canonical({
    commandType: "ACCEPT_PRESSURE_FORMAL_INTERACTION_V1",
    routeHash: input.routeHash,
    runId: input.action.runId,
    chapterRuntimeId: input.action.chapterRuntimeId,
    chapterId: input.action.chapterId,
    decisionPointId: input.action.decisionPointId,
    idempotencyKey: input.action.idempotencyKey,
    decisionActionRequestFingerprint: input.action.requestFingerprint,
    sealedActionHash: input.action.sealedHash,
    intent: canonicalizeWorkingActionIntentV1(input.intent),
  });
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
