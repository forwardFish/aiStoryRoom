import type { RuntimeWarning } from "./types.js";

export type SurfaceIntegrityResult = {
  ok: boolean;
  reason?: string;
  warnings: RuntimeWarning[];
};

export function normalizeNarrativeSurface(value: string) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateSurfaceIntegrity(
  value: string,
  previousOpening = "",
): SurfaceIntegrityResult {
  const text = normalizeNarrativeSurface(value);
  if (!text) return failed("NARRATION_EMPTY");
  if (looksLikeProviderFailure(text)) return failed("NARRATION_PROVIDER_FAILURE");
  if (looksLikeStructuredOutput(text)) return failed("NARRATION_STRUCTURED_OUTPUT");
  if (containsInternalProtocol(text)) return failed("NARRATION_INTERNAL_LEAK");
  if (hasBrokenFence(text)) return failed("NARRATION_TRUNCATED");
  if (isCompleteOpeningRepeat(text, previousOpening)) {
    return failed("NARRATION_REPEATS_PREVIOUS_OPENING");
  }
  if (looksLikeMenuInsteadOfStory(text)) return failed("NARRATION_NOT_STORY_PROSE");
  return { ok: true, warnings: [] };
}

// Compatibility name for callers migrating from the old semantic surface gate.
export const validateForegroundSurface = validateSurfaceIntegrity;

function looksLikeProviderFailure(text: string) {
  const first = text.slice(0, 500).toLocaleLowerCase();
  return /(?:internal server error|bad gateway|service unavailable|upstream error|rate limit|context length exceeded|request (?:failed|timed out))/u
    .test(first);
}

function looksLikeStructuredOutput(text: string) {
  const trimmed = text.trim();
  if (/^```(?:json|xml|yaml|yml)?\s/iu.test(trimmed)) return true;
  if (/^<\/?(?:response|result|output|tool_call|function_call)(?:\s|>)/iu.test(trimmed)) {
    return true;
  }
  if (!/^[{[]/u.test(trimmed)) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Boolean(parsed && typeof parsed === "object");
  } catch {
    return false;
  }
}

function containsInternalProtocol(text: string) {
  return /(?:turnEnvelopeId|sourcePredicateIds|stateRevision|allowedPredicates|requiredVisiblePredicates|forbiddenPredicatePatterns|foreground guidance|reader action|durable memory|recent canon|system prompt)/iu
    .test(text);
}

function hasBrokenFence(text: string) {
  return (text.match(/```/gu)?.length || 0) % 2 !== 0;
}

function isCompleteOpeningRepeat(text: string, previousOpening: string) {
  const previous = normalizeForComparison(previousOpening);
  const current = normalizeForComparison(text);
  if (previous.length < 80 || current.length < 80) return false;
  return current === previous || current.startsWith(previous.slice(0, 240));
}

function looksLikeMenuInsteadOfStory(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const menuLines = lines.filter((line) => /^(?:[-*+]\s+|\d+[.)]\s+|[A-Z][.)]\s+)/u.test(line));
  return menuLines.length >= 3 && menuLines.length / lines.length >= 0.6;
}

function normalizeForComparison(value: string) {
  return normalizeNarrativeSurface(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function failed(reason: string): SurfaceIntegrityResult {
  return { ok: false, reason, warnings: [] };
}
