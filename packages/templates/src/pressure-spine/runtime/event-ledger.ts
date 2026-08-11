import { PressureKernelError } from "./errors";
import { PRESSURE_ROOT_EVENT_TYPES, type PressureRootEvent, type PressureRootEventType } from "./types";

const ROOT_EVENT_SET = new Set<string>(PRESSURE_ROOT_EVENT_TYPES);

export function isPressureRootEventType(value: unknown): value is PressureRootEventType {
  return typeof value === "string" && ROOT_EVENT_SET.has(value);
}

export function assertPressureRootEventBatch(events: PressureRootEvent[], expectedFirstSequence?: number): void {
  const dedupeKeys = new Set<string>();
  const eventIds = new Set<string>();
  let previousSequence: number | null = null;
  for (const [index, event] of events.entries()) {
    if (!isPressureRootEventType(event.type)) {
      throw new PressureKernelError("ROOT_EVENT_TYPE_INVALID", `Non-root event type at ${index}: ${String(event.type)}`);
    }
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      throw new PressureKernelError("SETTLEMENT_REPLAY_HASH_MISMATCH", `Invalid root event sequence at ${index}`);
    }
    if (index === 0 && expectedFirstSequence !== undefined && event.sequence !== expectedFirstSequence) {
      throw new PressureKernelError("SETTLEMENT_REPLAY_HASH_MISMATCH", `Root event batch starts at ${event.sequence}, expected ${expectedFirstSequence}`);
    }
    if (previousSequence !== null && event.sequence !== previousSequence + 1) {
      throw new PressureKernelError("SETTLEMENT_REPLAY_HASH_MISMATCH", `Event sequence gap at ${index}`);
    }
    if (dedupeKeys.has(event.dedupeKey)) {
      throw new PressureKernelError("SETTLEMENT_REPLAY_HASH_MISMATCH", `Duplicate root event dedupeKey ${event.dedupeKey}`);
    }
    if (eventIds.has(event.eventId)) {
      throw new PressureKernelError("SETTLEMENT_REPLAY_HASH_MISMATCH", `Duplicate root event id ${event.eventId}`);
    }
    dedupeKeys.add(event.dedupeKey);
    eventIds.add(event.eventId);
    previousSequence = event.sequence;
  }
}

export function assertPressureRootEventLedger(events: PressureRootEvent[]): void {
  assertPressureRootEventBatch(events, 1);
}
