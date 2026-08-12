import { createHash } from "node:crypto";

import { compareCanonicalText } from "@ai-story/shared";

const AUTHORITY_KEYS = new Set([
  "worldsequence",
  "worldstate",
  "frozenchapterbundle",
  "chaptersettlement",
  "finaledecision",
  "seatverdicts",
]);

export function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? "null";
}

export function stableSha256(value: unknown): string {
  return createHash("sha256")
    .update(stableCanonicalJson(value))
    .digest("hex")
    .toUpperCase();
}

export function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

export function assertWorkingOnly(value: unknown, path = "workingDelta"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertWorkingOnly(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (AUTHORITY_KEYS.has(key.toLowerCase())) {
      throw new Error(`PRESSURE_CHAPTER_AUTHORITY_FIELD_FORBIDDEN:${path}.${key}`);
    }
    assertWorkingOnly(entry, `${path}.${key}`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCanonicalText(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}
