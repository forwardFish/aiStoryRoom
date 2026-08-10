import { evaluateBooleanExpression } from "./endgame-package-v1.contract.mjs";

export const SCORE_FEATURES = Object.freeze([
  "causalStrength",
  "metricImpact",
  "relationshipImpact",
  "terminalRelevance",
  "recency",
  "uniqueness"
]);
export const PLAYER_SAFE_VISIBILITIES = new Set(["PLAYER", "PUBLIC"]);
export const TERMINAL_CATEGORIES = new Set([
  "ACHIEVEMENT",
  "COST",
  "PUBLIC_AFTERMATH",
  "POLITICAL_AFTERMATH",
  "POLICY_AFTERMATH",
  "SCENE_ANCHOR",
  "UNRESOLVED_HOOK"
]);

export class ConfigDrivenEndingDetailError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ConfigDrivenEndingDetailError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

export function evaluateRule(expression, context, code, details) {
  try {
    return evaluateBooleanExpression(expression, context);
  } catch (error) {
    throw new ConfigDrivenEndingDetailError(code, "Configured detail rule failed closed.", {
      ...details,
      cause: errorMessage(error)
    });
  }
}

export function selectorMatches(fact, selector) {
  return (!selector.sourceTypes || selector.sourceTypes.includes(fact.sourceType))
    && (!selector.categories || selector.categories.includes(fact.category))
    && (!selector.statuses || selector.statuses.includes(fact.status))
    && (!selector.polarities || selector.polarities.includes(fact.polarity))
    && (!selector.visibility || selector.visibility.includes(fact.visibility))
    && (!selector.includeTagsAny || selector.includeTagsAny.some((tag) => fact.tags.includes(tag)))
    && (!selector.includeTagsAll || selector.includeTagsAll.every((tag) => fact.tags.includes(tag)))
    && (!selector.excludeTags || selector.excludeTags.every((tag) => !fact.tags.includes(tag)))
    && (selector.minMagnitude === undefined || fact.magnitude >= selector.minMagnitude);
}

export function assertExactObject(value, allowedKeys, label) {
  if (!isRecord(value)) {
    throw new ConfigDrivenEndingDetailError("ENDGAME_DETAIL_CLOSED_OBJECT_REQUIRED", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  const missing = allowedKeys.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_CLOSED_OBJECT_VIOLATION",
      `${label} has unknown or missing fields.`,
      { unknown, missing }
    );
  }
}

export function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareText(left, right)));
}

export function compareNullableText(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareText(left, right);
}

export function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
