import type { SeatIdV1 } from "@ai-story/shared";
import type {
  AEmotionInteractionEventPortV1,
  AEmotionProjectionCommitPortV1,
} from "../a-emotion/ports";

export interface AEmotionDeliveryBindingV1 {
  userId: string;
  roleId: string | null;
}

export interface AEmotionSeatDeliveryBindingPortV1 {
  resolve(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
  }): Promise<AEmotionDeliveryBindingV1 | null>;
}

export interface AEmotionStoryDayPortV1 {
  resolve(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1 | null;
    stageId: string;
    occurredAt: string;
    eventSequence: number;
  }): Promise<number>;
}

export interface AEmotionInteractionJournalPortV1 {
  readCommitted(idempotencyKey: string): Promise<AEmotionInteractionEventPortV1 | null>;
  append(input: {
    event: AEmotionInteractionEventPortV1;
    storyDay: number;
  }): Promise<{
    status: "COMMITTED" | "REPLAYED";
    event: AEmotionInteractionEventPortV1;
  }>;
}

export interface AEmotionDeliverySeedV1 {
  eventId: string;
  projectionVersion: number;
  viewerSeatId: SeatIdV1;
  aggregationKey: string;
  storyDay: number;
}

export interface AEmotionAggregateEnvelopeV1 {
  idempotencyKey: string;
  inputFingerprint: string;
  expectedAggregateVersion: number;
  commit: AEmotionProjectionCommitPortV1;
  storyDay: number;
}
