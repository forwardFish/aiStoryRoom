import type { StoryTurnModelOutput } from "./types";

export function parseStoryTurnOutput(rawText: string): StoryTurnModelOutput {
  const cleaned = rawText
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  if (
    parsed.schemaVersion === undefined &&
    parsed.resultType === undefined &&
    isRecord(parsed.story) &&
    isRecord(parsed.resolution) &&
    isRecord(parsed.endingState) &&
    Array.isArray(parsed.decisions) &&
    isRecord(parsed.grounding)
  ) {
    return { ...parsed, schemaVersion: "solo-story-turn-v1", resultType: "PUBLISHED_TURN" } as StoryTurnModelOutput;
  }
  return parsed as StoryTurnModelOutput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
