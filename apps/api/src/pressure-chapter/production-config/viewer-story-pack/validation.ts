import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  isSha256,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1 as ERROR,
  PRESSURE_VIEWER_STORY_VISIBILITIES_V1,
  PressureViewerStoryPackCompileErrorV1,
  type PressureViewerStoryAclV1,
} from "./contracts";

export function storyText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) fail(ERROR.INVALID, path, "NON_EMPTY_STRING");
  return value.trim();
}

export function storyInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(ERROR.INVALID, path, "NON_NEGATIVE_SAFE_INTEGER");
  }
  return Number(value);
}

export function storyHash(value: unknown, path: string): string {
  if (!isSha256(value)) fail(ERROR.INVALID, path, "SHA256");
  return value;
}

export function storySeat(value: unknown, path: string): SeatIdV1 {
  if (
    typeof value !== "string"
    || !(PRESSURE_CHAPTER_SEAT_IDS_V1 as readonly string[]).includes(value)
  ) fail(ERROR.INVALID, path, "SEAT_ID");
  return value as SeatIdV1;
}

export function storyStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(ERROR.INVALID, path, "ARRAY");
  const result = value.map((item, index) => storyText(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) fail(ERROR.INVALID, path, "DUPLICATE");
  return result;
}

export function assertViewerVisible(
  value: PressureViewerStoryAclV1,
  viewerSeatId: SeatIdV1,
  path: string,
): void {
  if (!PRESSURE_VIEWER_STORY_VISIBILITIES_V1.includes(value.visibility)) {
    fail(ERROR.INVALID, `${path}.visibility`, "ENUM");
  }
  const authorized = value.authorizedSeatIds.map((seat, index) =>
    storySeat(seat, `${path}.authorizedSeatIds[${index}]`));
  if (new Set(authorized).size !== authorized.length) {
    fail(ERROR.INVALID, `${path}.authorizedSeatIds`, "DUPLICATE");
  }
  if (value.visibility === "SYSTEM_ONLY") {
    fail(ERROR.SCOPE_VIOLATION, `${path}.visibility`, "SYSTEM_ONLY");
  }
  if (value.visibility === "PUBLIC") {
    if (authorized.length !== 0) {
      fail(ERROR.SCOPE_VIOLATION, `${path}.authorizedSeatIds`, "PUBLIC_ACL_MUST_BE_EMPTY");
    }
    return;
  }
  if (authorized.length !== 1 || authorized[0] !== viewerSeatId) {
    fail(ERROR.SCOPE_VIOLATION, `${path}.authorizedSeatIds`, "VIEWER_SEAT_REQUIRED");
  }
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function storyFail(code: string, path: string, detail: string): never {
  return fail(code, path, detail);
}

export function deepFreezeStoryPack<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeStoryPack(child);
    }
  }
  return value;
}

function fail(code: string, path: string, detail: string): never {
  throw new PressureViewerStoryPackCompileErrorV1(code, path, detail);
}
