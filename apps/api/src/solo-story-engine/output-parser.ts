import type {
  StoryDecisionCopyOutput,
  StoryNarratorDraft,
  StoryTurnModelOutput
} from "./types";

export function parseNarratorDraft(rawText: string): StoryNarratorDraft {
  const canonical = String(rawText || "").replace(/\r\n/g, "\n").trim();
  if (!canonical) throw new SyntaxError("NARRATOR_PROSE_EMPTY");
  if (/^```|```$/.test(canonical)) throw new SyntaxError("NARRATOR_PROSE_MARKDOWN_WRAPPER");
  if (/^\s*[\[{]/.test(canonical)) throw new SyntaxError("NARRATOR_PROSE_NOT_PLAIN_TEXT");

  const paragraphs = canonical
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  // Dialogue-heavy historical scenes often use short question/answer
  // paragraphs. Preserve that rhythm instead of forcing the Narrator to merge
  // speakers into report-like blocks.
  if (paragraphs.length < 3 || paragraphs.length > 12) {
    throw new SyntaxError("NARRATOR_PARAGRAPH_COUNT_INVALID");
  }
  const nextSituationNarrative = paragraphs.at(-1)!;
  const resultNarrative = paragraphs.slice(0, -1).join("\n\n");
  const recomposed = `${resultNarrative}\n\n${nextSituationNarrative}`;
  if (recomposed !== canonical) throw new SyntaxError("NARRATOR_PROSE_IMMUTABILITY_BROKEN");
  return {
    rawProse: canonical,
    resultNarrative,
    nextSituationNarrative
  };
}

export function parseDecisionCopyOutput(rawText: string): StoryDecisionCopyOutput {
  const parsed = JSON.parse(stripJsonFence(rawText)) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("DECISION_OUTPUT_NOT_OBJECT");
  }
  const decisions = parsed.decisions;
  if (!Array.isArray(decisions) || decisions.length !== 2) {
    throw new SyntaxError("DECISION_OUTPUT_COUNT_INVALID");
  }
  const allowedKeys = new Set(["routeKey", "description"]);
  const normalized = decisions.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SyntaxError(`DECISION_${index + 1}_NOT_OBJECT`);
    }
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !allowedKeys.has(key))) {
      throw new SyntaxError(`DECISION_${index + 1}_HAS_UNKNOWN_FIELD`);
    }
    const routeKey = typeof row.routeKey === "string" ? row.routeKey.trim() : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    if (!routeKey || !description) throw new SyntaxError(`DECISION_${index + 1}_FIELD_MISSING`);
    if ([...description.replace(/\s/g, "")].length < 8 || [...description].length > 100) {
      throw new SyntaxError(`DECISION_${index + 1}_DESCRIPTION_LENGTH_INVALID`);
    }
    return { routeKey, description };
  });
  return { decisions: normalized };
}

/**
 * Legacy parser retained for old diagnostic artifacts only. Production Solo
 * turns use parseNarratorDraft and parseDecisionCopyOutput.
 */
export function parseStoryTurnOutput(rawText: string): StoryTurnModelOutput {
  let parsed = JSON.parse(stripJsonFence(rawText)) as Record<string, unknown>;
  if (
    !isRecord(parsed.story)
    && Array.isArray(parsed.oneOf)
    && parsed.oneOf.length === 1
    && isRecord(parsed.oneOf[0])
  ) {
    parsed = parsed.oneOf[0];
  }
  if (
    parsed.schemaVersion === undefined
    && parsed.resultType === undefined
    && isRecord(parsed.story)
    && isRecord(parsed.resolution)
    && isRecord(parsed.endingState)
    && Array.isArray(parsed.decisions)
  ) {
    return {
      ...parsed,
      schemaVersion: "solo-story-turn-v1",
      resultType: "PUBLISHED_TURN"
    } as StoryTurnModelOutput;
  }
  if (
    parsed.schemaVersion === undefined
    && parsed.resultType === undefined
    && isRecord(parsed.clarification)
  ) {
    return {
      ...parsed,
      schemaVersion: "solo-story-turn-v1",
      resultType: "ACTION_NEEDS_CLARIFICATION"
    } as StoryTurnModelOutput;
  }
  return parsed as StoryTurnModelOutput;
}

function stripJsonFence(rawText: string) {
  return String(rawText || "")
    .trim()
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
