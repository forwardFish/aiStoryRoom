import { PRESSURE_CHAPTER_SEAT_IDS_V1 } from "@ai-story/shared";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";

export const PRESSURE_OUTBOX_TASK_TYPES = Object.freeze([
  "OPEN_CHAPTER",
  "PROJECT_GENESIS_NARRATIVE",
  "PROJECT_BEAT_NARRATIVE",
  "PROJECT_CHAPTER_NARRATIVE",
  "COMPUTE_FINALE",
  "PROJECT_FINALE_NARRATIVE",
  "INTERACTION_COMPILE_REQUESTED",
  "PUBLISH_RESULT",
] as const);

export const PRESSURE_OUTBOX_STATUSES = Object.freeze([
  "PENDING",
  "LEASED",
  "RETRYABLE",
  "COMPLETED",
  "DEAD_LETTER",
] as const);

export const PRESSURE_OUTBOX_CHECKPOINTS = Object.freeze([
  "PERSISTED",
  "LEASED",
  "HANDLER_STARTED",
  "HANDLER_COMMITTED",
  "PUBLISHED",
  "ACKNOWLEDGED",
  "FAILED_RETRYABLE",
  "DEAD_LETTER",
] as const);

export const PRESSURE_NARRATIVE_STATUSES = Object.freeze([
  "PENDING",
  "GENERATING",
  "VALIDATING",
  "PUBLISHED",
  "FALLBACK_PUBLISHED",
  "FAILED_RETRYABLE",
] as const);

export type PressureOutboxTaskTypeV1 = (typeof PRESSURE_OUTBOX_TASK_TYPES)[number];
export type PressureOutboxStatusV1 = (typeof PRESSURE_OUTBOX_STATUSES)[number];
export type PressureOutboxCheckpointV1 = (typeof PRESSURE_OUTBOX_CHECKPOINTS)[number];
export type PressureNarrativeStatusV1 = (typeof PRESSURE_NARRATIVE_STATUSES)[number];

const OUTBOX_TRANSITIONS: Readonly<Record<PressureOutboxStatusV1, readonly PressureOutboxStatusV1[]>> = {
  PENDING: ["LEASED"],
  LEASED: ["RETRYABLE", "COMPLETED", "DEAD_LETTER"],
  RETRYABLE: ["LEASED"],
  COMPLETED: [],
  DEAD_LETTER: [],
};

const NARRATIVE_TRANSITIONS: Readonly<Record<PressureNarrativeStatusV1, readonly PressureNarrativeStatusV1[]>> = {
  PENDING: ["GENERATING", "FALLBACK_PUBLISHED", "FAILED_RETRYABLE"],
  GENERATING: ["VALIDATING", "FALLBACK_PUBLISHED", "FAILED_RETRYABLE"],
  VALIDATING: ["PUBLISHED", "FALLBACK_PUBLISHED", "FAILED_RETRYABLE"],
  PUBLISHED: [],
  // A fallback remains visible while a provider retry runs out-of-band. The
  // projection changes atomically only when the provider artifact is ready.
  FALLBACK_PUBLISHED: ["PUBLISHED"],
  FAILED_RETRYABLE: ["GENERATING", "FALLBACK_PUBLISHED"],
};

export function assertPressureOutboxTaskType(value: string): asserts value is PressureOutboxTaskTypeV1 {
  if (!(PRESSURE_OUTBOX_TASK_TYPES as readonly string[]).includes(value)) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_VOCABULARY_INVALID,
      `Unknown Pressure Outbox task type: ${value}`,
      { value },
    );
  }
}

export function assertPressureOutboxTransition(
  from: PressureOutboxStatusV1,
  to: PressureOutboxStatusV1,
): void {
  if (!OUTBOX_TRANSITIONS[from].includes(to)) {
    throw new PressurePersistenceError(
      ERROR.INVALID_STATUS_TRANSITION,
      `Illegal Pressure Outbox transition: ${from} -> ${to}`,
      { from, to },
    );
  }
}

export function assertPressureNarrativeTransition(
  from: PressureNarrativeStatusV1,
  to: PressureNarrativeStatusV1,
): void {
  if (!NARRATIVE_TRANSITIONS[from].includes(to)) {
    throw new PressurePersistenceError(
      ERROR.INVALID_STATUS_TRANSITION,
      `Illegal Pressure Narrative transition: ${from} -> ${to}`,
      { from, to },
    );
  }
}

export function pressureAudienceKey(kind: "PUBLIC" | "SEAT", seatId: string | null): string {
  if (kind === "PUBLIC") {
    if (seatId !== null) {
      throw new PressurePersistenceError(
        ERROR.OUTBOX_VOCABULARY_INVALID,
        "PUBLIC audience cannot include a seatId",
        { kind, seatId },
      );
    }
    return "PUBLIC";
  }

  if (!seatId || !(PRESSURE_CHAPTER_SEAT_IDS_V1 as readonly string[]).includes(seatId)) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_VOCABULARY_INVALID,
      "SEAT audience requires one registered Pressure seat",
      { kind, seatId },
    );
  }
  return seatId;
}
