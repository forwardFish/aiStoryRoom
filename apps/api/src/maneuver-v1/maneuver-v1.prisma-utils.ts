import { ManeuverDomainErrorV1, type ManeuverSlotV1 } from "./maneuver-v1.core";

export type JsonRecord = Record<string, unknown>;
export const MANEUVER_SLOTS: ManeuverSlotV1[] = ["MANEUVER_1", "MANEUVER_2"];
export const COMMITTED_ACTION_STATUSES = ["PENDING", "RESOLVED", "COMMITTED", "IN_PROGRESS"];

export function domain(code: string, message: string, status: number, recoverable = true) {
  return new ManeuverDomainErrorV1(code, message, status, recoverable);
}

export function record(value: unknown, path = "object"): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw domain("MANEUVER_CONTEXT_INVALID", `${path} must be an object.`, 500, false);
  }
  return value as JsonRecord;
}

export function optionalRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

export function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw domain("MANEUVER_CONTEXT_INVALID", `${path} is required.`, 500, false);
  }
  return value.trim();
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim());
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function uniqueSlots(values: unknown[]): ManeuverSlotV1[] {
  const result: ManeuverSlotV1[] = [];
  for (const value of values) {
    if (!MANEUVER_SLOTS.includes(value as ManeuverSlotV1)) continue;
    if (!result.includes(value as ManeuverSlotV1)) result.push(value as ManeuverSlotV1);
  }
  return result;
}

export function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw domain("MANEUVER_ACTION_CORRUPT", `${path} is invalid.`, 500, false);
  }
  return Number(value);
}

export function isRetryableTransactionError(error: any): boolean {
  const message = String(error?.message || error || "");
  return ["P2034", "P2028", "P2002"].includes(error?.code)
    || /40001|40P01|deadlock detected|serialization failure|write conflict/i.test(message);
}
