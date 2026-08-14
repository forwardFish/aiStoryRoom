import {
  PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1,
  PressureViewerStoryPackCompileErrorV1,
  type PressureViewerStoryPackErrorKindV1,
} from "./viewer-story-pack-errors";

export function storyText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) storyFail("INVALID", path, "NON_EMPTY_STRING");
  return value.trim();
}

export function storyInteger(value: unknown, path: string, min = 0): number {
  if (!Number.isInteger(value) || Number(value) < min) {
    storyFail("INVALID", path, `INTEGER_MIN_${min}`);
  }
  return Number(value);
}

export function storySha(value: unknown, path: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/iu.test(value)) {
    storyFail("INVALID", path, "SHA256");
  }
}

export function storyUnique(values: readonly string[], path: string): string[] {
  const result = values.map((value, index) => storyText(value, `${path}[${index}]`));
  if (new Set(result).size !== result.length) storyFail("INVALID", path, "DUPLICATE");
  return result;
}

export function storyFail(kind: PressureViewerStoryPackErrorKindV1, path: string, detail: string): never {
  throw new PressureViewerStoryPackCompileErrorV1(
    PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1[kind],
    path,
    detail,
  );
}
