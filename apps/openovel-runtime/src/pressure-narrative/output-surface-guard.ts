import {
  PRESSURE_NARRATIVE_ERROR_CODES as ERROR,
  failPressureNarrative,
} from "./errors.js";

export const PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES = Object.freeze({
  PROVIDER_FAILURE: "SURFACE_PROVIDER_FAILURE",
  STRUCTURED_CONTROL: "SURFACE_STRUCTURED_CONTROL",
  PROMPT_LEAK: "SURFACE_PROMPT_LEAK",
  SECRET_LEAK: "SURFACE_SECRET_LEAK",
  INTERNAL_PROTOCOL: "SURFACE_INTERNAL_PROTOCOL",
  MENU_OUTPUT: "SURFACE_MENU_OUTPUT",
  BROKEN_FENCE: "SURFACE_BROKEN_FENCE",
} as const);

export type PressureNarrativeSurfaceIssueCode =
  (typeof PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES)[keyof typeof PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES];

export interface PressureNarrativeSurfaceReviewV1 {
  accepted: boolean;
  issueCodes: PressureNarrativeSurfaceIssueCode[];
}

/**
 * Reviews only the player-visible output surface. Truth, audience scope and
 * authority remain the responsibility of NarrativeTruthGuardV1 and the
 * upstream deterministic Pressure pipeline.
 */
export function reviewPressureNarrativeOutputSurfaceV1(
  value: string,
): PressureNarrativeSurfaceReviewV1 {
  const text = String(value ?? "");
  const issues = new Set<PressureNarrativeSurfaceIssueCode>();

  if (looksLikeProviderFailure(text)) {
    issues.add(PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES.PROVIDER_FAILURE);
  }
  if (looksLikeStructuredControl(text)) {
    issues.add(PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES.STRUCTURED_CONTROL);
  }
  if (containsPromptLeak(text)) {
    issues.add(PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES.PROMPT_LEAK);
  }
  if (containsSecretLeak(text)) {
    issues.add(PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES.SECRET_LEAK);
  }
  if (containsInternalProtocol(text)) {
    issues.add(PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES.INTERNAL_PROTOCOL);
  }
  if (looksLikeMenuInsteadOfNarrative(text)) {
    issues.add(PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES.MENU_OUTPUT);
  }
  if (hasUnclosedCodeFence(text)) {
    issues.add(PRESSURE_NARRATIVE_SURFACE_ISSUE_CODES.BROKEN_FENCE);
  }

  const issueCodes = [...issues].sort();
  return { accepted: issueCodes.length === 0, issueCodes };
}

/** Defense-in-depth boundary for artifacts, including pending publish retry. */
export function assertPressureNarrativeOutputSurfaceV1(
  value: string,
  path = "artifact.text",
): void {
  const review = reviewPressureNarrativeOutputSurfaceV1(value);
  if (!review.accepted) {
    failPressureNarrative(ERROR.OUTPUT_SURFACE_REJECTED, path, review.issueCodes.join("|"));
  }
}

function looksLikeProviderFailure(text: string): boolean {
  return /(?:internal server error|bad gateway|service unavailable|upstream error|rate limit(?:ed| exceeded)?|context length exceeded|request (?:failed|timed out)|gateway timeout)/iu
    .test(text.slice(0, 600));
}

function looksLikeStructuredControl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^```(?:json|xml|ya?ml|toml|javascript|typescript|tsx?|jsx?)?(?:\s|$)/iu.test(trimmed)) {
    return true;
  }
  if (/^<\/?(?:response|result|output|tool_call|function_call|system|developer|assistant)(?:\s|>)/iu.test(trimmed)) {
    return true;
  }
  if (/^[{[]/u.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === "object") return true;
    } catch {
      if (/^[{[]\s*["']?(?:text|narration|result|output|schemaVersion|projectionKind|tool_call|function_call)["']?\s*:/iu.test(trimmed)) {
        return true;
      }
    }
  }
  const controlLines = trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^(?:schemaVersion|projectionKind|sourceAuthority|sourceCommitHash|sourceContentHash|allowedClaims|usedFactRefs|claims|stateRevision|idempotencyKey|tool_call|function_call)\s*:/u.test(line));
  return controlLines.length >= 2;
}

function containsPromptLeak(text: string): boolean {
  return /(?:\bsystem prompt\b|\bdeveloper (?:message|prompt)\b|\bchain[ -]of[ -]thought\b|\bbegin (?:system|developer|prompt|internal)\b|\bend (?:system|developer|prompt|internal)\b|<\/?\s*(?:system|developer|assistant|prompt|rationale)\s*>|\[(?:SYSTEM|DEVELOPER|PROMPT|INTERNAL)\]|(?:系统|开发者)(?:提示词|消息|指令)|隐藏提示词|内部提示词|你是\s*(?:ChatGPT|OpenAI))/iu.test(text);
}

function containsSecretLeak(text: string): boolean {
  const normalized = text.replace(/([a-z0-9])([A-Z])/gu, "$1 $2");
  return /(?:\bDATABASE_URL\b|\b(?:OPENAI|OPENOVEL|DEEPSEEK|SUPABASE|ANTHROPIC|AWS)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|URL)\b|\b(?:api|secret|private)[_-]?(?:key|token)\s*[:=]|\bauthorization\s*:\s*bearer\s+|\bpostgres(?:ql)?:\/\/[^\s]+|\bsk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?\b)/imu.test(normalized);
}

function containsInternalProtocol(text: string): boolean {
  return /(?:\bturnEnvelopeId\b|\bsourcePredicateIds\b|\bstateRevision\b|\ballowedPredicates\b|\brequiredVisiblePredicates\b|\bforbiddenPredicatePatterns\b|\bsourceRuntimeProfile\b|\bnarrativeProfileVersion\b|\bcontextCompilerVersion\b|\btruthGuardVersion\b|\bprojectorVersion\b|\bsourceCommitHash\b|\bsourceContentHash\b|\ballowedFactIds\b|\ballowedObjectVersionIds\b|\ballowedKnowledgeIds\b|\ballowedClaims\b|\busedFactRefs\b|\bidempotencyKey\b|\braw provider payload\b|\brole working set\b|\binternal working set\b|\bconfirmed resolution\b|\breader action\b|\bvisible events\b|\bvisible interactions\b|\bstate patch\b|\bsettlement json\b|\bruntime mode\b|\bdatabase url\b|\bsupabase\b|<\/?\s*(?:tool_call|function_call|state_patch)\b)/iu.test(text);
}

function looksLikeMenuInsteadOfNarrative(text: string): boolean {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const menuLines = lines.filter((line) => /^(?:[-*+]\s+|\d+[.)、]\s*|[A-Z][.)、]\s*)/u.test(line));
  return menuLines.length >= 2 && menuLines.length / lines.length >= 0.6;
}

function hasUnclosedCodeFence(text: string): boolean {
  return countFence(text, /```/gu) % 2 !== 0 || countFence(text, /~~~/gu) % 2 !== 0;
}

function countFence(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}
