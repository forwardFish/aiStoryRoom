import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type { DecisionPin } from "@ai-story/templates";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";

export interface PressureMvpDecisionStateV1 {
  schemaVersion: "pressure_mvp_decision_state_v1";
  workingRevision: number;
  state: "OPEN" | "NONE";
  activeDecisionPointId: string | null;
  allowedActionTypes: string[];
  requiredSeatIds: SeatIdV1[];
  pin: DecisionPin | null;
  policyHash: string | null;
  orchestratorHash: string | null;
  decisionStateHash: string;
}

export function buildPressureMvpDecisionStateV1(input: {
  workingRevision: number;
  pin: DecisionPin | null;
  requiredSeatIds?: readonly SeatIdV1[];
  policyHash?: string | null;
  orchestratorHash?: string | null;
}): PressureMvpDecisionStateV1 {
  const requiredSeatIds = orderedSeats(input.requiredSeatIds ?? []);
  const body = {
    schemaVersion: "pressure_mvp_decision_state_v1" as const,
    workingRevision: input.workingRevision,
    state: input.pin ? "OPEN" as const : "NONE" as const,
    activeDecisionPointId: input.pin?.decisionPointId ?? null,
    allowedActionTypes: input.pin ? [...input.pin.optionIds] : [],
    requiredSeatIds: input.pin ? requiredSeatIds : [],
    pin: input.pin ? structuredClone(input.pin) : null,
    policyHash: input.pin ? input.policyHash ?? null : null,
    orchestratorHash: input.pin ? input.orchestratorHash ?? null : null,
  };
  return { ...body, decisionStateHash: sha256Canonical(body) };
}

export function decodePressureMvpDecisionStateV1(
  value: unknown,
): PressureMvpDecisionStateV1 {
  if (!value || typeof value !== "object") return invalid("OBJECT");
  const record = structuredClone(value) as PressureMvpDecisionStateV1;
  const { decisionStateHash, ...body } = record;
  if (
    record.schemaVersion !== "pressure_mvp_decision_state_v1"
    || !Number.isSafeInteger(record.workingRevision)
    || record.workingRevision < 0
    || (record.state !== "OPEN" && record.state !== "NONE")
    || !Array.isArray(record.allowedActionTypes)
    || record.allowedActionTypes.some((item) => typeof item !== "string" || !item)
    || !Array.isArray(record.requiredSeatIds)
    || orderedSeats(record.requiredSeatIds).join("\0") !== record.requiredSeatIds.join("\0")
    || !nullableHash(record.policyHash)
    || !nullableHash(record.orchestratorHash)
    || decisionStateHash !== sha256Canonical(body)
  ) return invalid("SHAPE_OR_HASH");
  if (
    (record.state === "NONE" && (
      record.activeDecisionPointId !== null
      || record.pin !== null
      || record.allowedActionTypes.length !== 0
      || record.requiredSeatIds.length !== 0
    ))
    || (record.state === "OPEN" && (
      typeof record.activeDecisionPointId !== "string"
      || !record.activeDecisionPointId
      || !record.pin
      || record.pin.decisionPointId !== record.activeDecisionPointId
      || record.allowedActionTypes.join("\0") !== record.pin.optionIds.join("\0")
    ))
  ) return invalid("STATE_BINDING");
  return record;
}

function orderedSeats(values: readonly string[]): SeatIdV1[] {
  const selected = new Set(values);
  if (selected.size !== values.length) return invalid("DUPLICATE_REQUIRED_SEAT");
  if ([...selected].some((seatId) => !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId as SeatIdV1))) {
    return invalid("UNKNOWN_REQUIRED_SEAT");
  }
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => selected.has(seatId));
}

function nullableHash(value: unknown): boolean {
  return value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}

function invalid(detail: string): never {
  throw new PressurePersistenceError(
    ERROR.RECORD_INVALID,
    "PressureChapterRuntime decisionStateJson is invalid",
    { detail },
  );
}
