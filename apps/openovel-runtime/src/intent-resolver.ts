import type { OpenNovelOption } from "./types.js";

export const INTENT_RESOLUTION_SCHEMA = "omw.intent-resolution.v1" as const;

export type IntentResolutionInput = {
  action: string;
  affordances: readonly OpenNovelOption[];
};

export type IntentAlternative = {
  affordanceId: string;
  label: string;
  confidence: number;
};

export type ResolvedIntent = {
  schemaVersion: typeof INTENT_RESOLUTION_SCHEMA;
  status: "BOUND_AFFORDANCE" | "CLARIFICATION_REQUIRED" | "OUT_OF_SCOPE";
  intentType: "AFFORDANCE_EQUIVALENT" | "CAPABILITY_VARIANT" | "UNRESOLVED";
  capabilityRef: string | null;
  targetRefs: string[];
  constraints: string[];
  matchedAffordanceId: string | null;
  canonicalAction: string | null;
  confidence: number;
  alternatives: IntentAlternative[];
  reason: string;
};

export interface IntentResolverModule {
  readonly moduleId: string;
  resolve(input: IntentResolutionInput): Promise<ResolvedIntent> | ResolvedIntent;
}

type ScoredAffordance = {
  option: OpenNovelOption;
  exact: boolean;
  score: number;
  sharedScore: number;
  longestUniqueGram: number;
  matchedActionIndexes: Set<number>;
};

/**
 * World-agnostic resolver for the bounded Affordances currently published by
 * the server. It never contains story words or synonym tables. Instead it uses
 * exact normalized equality and distinctive Unicode n-grams that are unique
 * among the current options. A match therefore remains scoped to what the
 * player can actually do at this decision point.
 */
export class DeterministicAffordanceIntentResolver implements IntentResolverModule {
  readonly moduleId = "openovel.intent-resolver.affordance-ngrams.v1";

  resolve(input: IntentResolutionInput): ResolvedIntent {
    const action = normalize(input.action);
    const affordances = validateAffordances(input.affordances);
    if (!action || !affordances.length) {
      return unresolved("OUT_OF_SCOPE", [], "NO_CURRENT_AFFORDANCE");
    }

    const surfaces = affordances.map((option) => ({
      option,
      values: optionSurfaces(option).map(normalize).filter(Boolean),
    }));
    const exact = surfaces.find(({ values }) => values.includes(action));
    if (exact) return bound(exact.option, 1, "AFFORDANCE_EQUIVALENT", "EXACT_NORMALIZED_MATCH");

    const scored = surfaces
      .map(({ option, values }) => scoreAffordance(action, option, values, surfaces))
      .sort((left, right) => (
        right.score - left.score
        || right.longestUniqueGram - left.longestUniqueGram
        || left.option.id.localeCompare(right.option.id)
      ));
    const alternatives = scored.slice(0, 3).map((item) => ({
      affordanceId: item.option.id,
      label: item.option.label,
      confidence: confidenceFor(item, action.length),
    }));
    const best = scored[0];
    if (!best || best.score <= 0) {
      return unresolved("OUT_OF_SCOPE", alternatives, "NO_AFFORDANCE_SIGNAL");
    }
    const next = scored[1];
    const margin = best.score - (next?.score || 0);
    const relativeMargin = margin / Math.max(1, best.score);
    const coverage = best.matchedActionIndexes.size / Math.max(1, [...action].length);
    const confidence = confidenceFor(best, action.length);

    if (best.longestUniqueGram >= 4 && relativeMargin >= 0.2) {
      return bound(
        best.option,
        confidence,
        "AFFORDANCE_EQUIVALENT",
        "DISTINCTIVE_AFFORDANCE_PHRASE",
      );
    }
    if (best.longestUniqueGram >= 3 && coverage >= 0.3 && relativeMargin >= 0.3) {
      return bound(
        best.option,
        Math.min(confidence, 0.89),
        "CAPABILITY_VARIANT",
        "BOUNDED_CAPABILITY_VARIANT",
      );
    }
    return unresolved(
      "CLARIFICATION_REQUIRED",
      alternatives,
      next && relativeMargin < 0.2 ? "AMBIGUOUS_AFFORDANCE" : "INSUFFICIENT_AFFORDANCE_EVIDENCE",
    );
  }
}

function scoreAffordance(
  action: string,
  option: OpenNovelOption,
  values: string[],
  all: Array<{ option: OpenNovelOption; values: string[] }>,
): ScoredAffordance {
  const actionPoints = [...action];
  let score = 0;
  let sharedScore = 0;
  let longestUniqueGram = 0;
  const matchedActionIndexes = new Set<number>();

  for (let length = Math.min(10, actionPoints.length); length >= 3; length -= 1) {
    for (let index = 0; index + length <= actionPoints.length; index += 1) {
      const gram = actionPoints.slice(index, index + length).join("");
      const owners = all.filter(({ values: candidateValues }) => (
        candidateValues.some((value) => value.includes(gram))
      ));
      if (!owners.some((owner) => owner.option.id === option.id)) continue;
      if (owners.length === 1) {
        score += length * length;
        longestUniqueGram = Math.max(longestUniqueGram, length);
        for (let cursor = index; cursor < index + length; cursor += 1) {
          matchedActionIndexes.add(cursor);
        }
      } else {
        sharedScore += length;
      }
    }
  }

  score += sharedScore * 0.05;
  return {
    option,
    exact: false,
    score,
    sharedScore,
    longestUniqueGram,
    matchedActionIndexes,
  };
}

function optionSurfaces(option: OpenNovelOption) {
  return [
    option.label,
    option.effect?.intent,
    option.effect?.beatContract?.objective,
    option.effect?.beatContract?.settledNarrative,
  ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

function confidenceFor(item: ScoredAffordance, actionLength: number) {
  if (item.exact) return 1;
  const coverage = item.matchedActionIndexes.size / Math.max(1, [...String(actionLength)].length);
  const value = 0.55 + item.longestUniqueGram * 0.055 + Math.min(0.18, coverage * 0.18);
  return round(Math.max(0, Math.min(0.99, value)));
}

function bound(
  option: OpenNovelOption,
  confidence: number,
  intentType: ResolvedIntent["intentType"],
  reason: string,
): ResolvedIntent {
  const decisionPointId = String(option.effect?.decisionPointId || "").trim();
  return {
    schemaVersion: INTENT_RESOLUTION_SCHEMA,
    status: "BOUND_AFFORDANCE",
    intentType,
    capabilityRef: decisionPointId
      ? `decision-point:${decisionPointId}`
      : `affordance:${option.id}`,
    targetRefs: decisionPointId ? [decisionPointId] : [],
    constraints: [...(option.effect?.beatContract?.constraints || [])],
    matchedAffordanceId: option.id,
    canonicalAction: option.label,
    confidence: round(confidence),
    alternatives: [{
      affordanceId: option.id,
      label: option.label,
      confidence: round(confidence),
    }],
    reason,
  };
}

function unresolved(
  status: "CLARIFICATION_REQUIRED" | "OUT_OF_SCOPE",
  alternatives: IntentAlternative[],
  reason: string,
): ResolvedIntent {
  return {
    schemaVersion: INTENT_RESOLUTION_SCHEMA,
    status,
    intentType: "UNRESOLVED",
    capabilityRef: null,
    targetRefs: [],
    constraints: [],
    matchedAffordanceId: null,
    canonicalAction: null,
    confidence: alternatives[0]?.confidence || 0,
    alternatives,
    reason,
  };
}

function validateAffordances(input: readonly OpenNovelOption[]) {
  const seen = new Set<string>();
  return input.map((option) => {
    const id = String(option.id || "").trim();
    const label = String(option.label || "").trim();
    if (!id || !label) throw new Error("INTENT_AFFORDANCE_INVALID");
    if (seen.has(id)) throw new Error(`INTENT_AFFORDANCE_DUPLICATE:${id}`);
    seen.add(id);
    return { ...option, id, label };
  });
}

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
