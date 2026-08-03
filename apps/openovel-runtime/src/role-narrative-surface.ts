import { containsInternalLeak } from "./surface-guard.js";

export type RoleNarrativeSurfaceReview =
  | { ok: true; text: string }
  | { ok: false; text: string; reason: string };

/**
 * Checks only whether provider output is safe story prose. Shared-world truth
 * is settled by the API before narration and must not be inferred from word
 * overlap here. This follows Story V2 P03's surface-integrity boundary.
 */
export function reviewRoleNarrativeSurface(value: string): RoleNarrativeSurfaceReview {
  const text = normalizeRoleNarrativeSurface(value);
  if (!text) return rejected(text, "NARRATION_EMPTY");
  if (looksLikeProviderFailure(text)) return rejected(text, "NARRATION_PROVIDER_FAILURE");
  if (looksLikeStructuredOutput(text)) return rejected(text, "NARRATION_STRUCTURED_OUTPUT");
  if (containsInternalLeak(text) || containsInternalProtocol(text)) {
    return rejected(text, "NARRATION_INTERNAL_LEAK");
  }
  if (hasBrokenFence(text)) return rejected(text, "NARRATION_TRUNCATED");
  if (looksLikeMenuInsteadOfStory(text)) return rejected(text, "NARRATION_NOT_STORY_PROSE");
  return { ok: true, text };
}

export function normalizeRoleNarrativeSurface(value: string) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeProviderFailure(text: string) {
  return /(?:internal server error|bad gateway|service unavailable|upstream error|rate limit|context length exceeded|request (?:failed|timed out))/iu
    .test(text.slice(0, 500).toLocaleLowerCase());
}

function looksLikeStructuredOutput(text: string) {
  const trimmed = text.trim();
  if (/^```(?:json|xml|yaml|yml)?\s/iu.test(trimmed)) return true;
  if (/^<\/?(?:response|result|output|tool_call|function_call)(?:\s|>)/iu.test(trimmed)) return true;
  if (!/^[{[]/u.test(trimmed)) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Boolean(parsed && typeof parsed === "object");
  } catch {
    return false;
  }
}

function containsInternalProtocol(text: string) {
  return /(?:turnEnvelopeId|sourcePredicateIds|stateRevision|allowedPredicates|requiredVisiblePredicates|forbiddenPredicatePatterns|role working set|confirmed resolution|reader action|visible events|visible interactions|system prompt)/iu
    .test(text);
}

function hasBrokenFence(text: string) {
  return (text.match(/```/gu)?.length || 0) % 2 !== 0;
}

function looksLikeMenuInsteadOfStory(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const menuLines = lines.filter((line) => /^(?:[-*+]\s+|\d+[.)]\s+|[A-Z][.)]\s+)/u.test(line));
  return menuLines.length >= 3 && menuLines.length / lines.length >= 0.6;
}

function rejected(text: string, reason: string): RoleNarrativeSurfaceReview {
  return { ok: false, text, reason };
}
