import type { OpenNovelOption } from "./types.js";

export const INTENT_RESOLUTION_SCHEMA = "omw.intent-resolution.v1" as const;
const MATCH_BOUNDARY = "\u0001";

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
  status:
    | "BOUND_AFFORDANCE"
    | "BOUND_CAPABILITY"
    | "CLARIFICATION_REQUIRED"
    | "OUT_OF_SCOPE";
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

type AffordanceSurfaces = {
  option: OpenNovelOption;
  exactValues: string[];
  matchValues: string[];
};

type ScoredAffordance = {
  option: OpenNovelOption;
  exact: boolean;
  score: number;
  sharedScore: number;
  longestUniqueGram: number;
  longestSharedGram: number;
  matchedActionIndexes: Set<number>;
  sharedActionIndexes: Set<number>;
};

/**
 * World-agnostic resolver for the bounded Affordances currently published by
 * the server. It never contains story words or synonym tables. Instead it uses
 * exact normalized equality and distinctive Unicode n-grams that are unique
 * among the current options. A match therefore remains scoped to what the
 * player can actually do at this decision point.
 *
 * Shared phrases are never sufficient to bind one existing option. They may,
 * however, prove that a free action remains inside the capability surface of a
 * single published Decision Point. Such an action is returned as
 * BOUND_CAPABILITY and must be settled by a capability-aware Fact Settlement;
 * it must never be silently converted into one of the existing options.
 */
export class DeterministicAffordanceIntentResolver implements IntentResolverModule {
  readonly moduleId = "openovel.intent-resolver.affordance-ngrams.v2";

  resolve(input: IntentResolutionInput): ResolvedIntent {
    const originalAction = String(input.action || "").trim();
    const actionExact = normalizeExact(originalAction);
    const actionMatch = normalizeForMatch(originalAction);
    const affordances = validateAffordances(input.affordances);
    if (!actionExact || !actionMatch || !affordances.length) {
      return unresolved("OUT_OF_SCOPE", [], "NO_CURRENT_AFFORDANCE");
    }

    const surfaces: AffordanceSurfaces[] = affordances.map((option) => {
      const values = optionSurfaces(option);
      return {
        option,
        exactValues: values.map(normalizeExact).filter(Boolean),
        matchValues: values.map(normalizeForMatch).filter(Boolean),
      };
    });
    const exact = surfaces.find(({ exactValues }) => exactValues.includes(actionExact));
    if (exact) {
      return bound(
        exact.option,
        1,
        "AFFORDANCE_EQUIVALENT",
        "EXACT_NORMALIZED_MATCH",
      );
    }

    const scored = surfaces
      .map(({ option }) => scoreAffordance(actionMatch, option, surfaces))
      .sort((left, right) => (
        right.score - left.score
        || right.longestUniqueGram - left.longestUniqueGram
        || right.sharedScore - left.sharedScore
        || left.option.id.localeCompare(right.option.id)
      ));
    const actionLength = [...actionMatch].filter((point) => point !== MATCH_BOUNDARY).length;
    const alternatives = scored.slice(0, 3).map((item) => ({
      affordanceId: item.option.id,
      label: item.option.label,
      confidence: confidenceFor(item, actionLength),
    }));
    const best = scored[0];
    const next = scored[1];

    if (best && best.score > 0) {
      const margin = best.score - (next?.score || 0);
      const relativeMargin = margin / Math.max(1, best.score);
      const coverage = best.matchedActionIndexes.size / Math.max(1, actionLength);
      const confidence = confidenceFor(best, actionLength);

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
          "BOUNDED_AFFORDANCE_VARIANT",
        );
      }
    }

    const capability = capabilityVariant(
      originalAction,
      actionMatch,
      surfaces,
      alternatives,
    );
    if (capability) return capability;

    if (!best || best.score <= 0) {
      const sharedCandidates = scored.filter((item) => (
        item.longestSharedGram >= 5
        && item.sharedActionIndexes.size / Math.max(1, actionLength) >= 0.4
      ));
      return sharedCandidates.length >= 2
        ? unresolved("CLARIFICATION_REQUIRED", alternatives, "AMBIGUOUS_AFFORDANCE")
        : unresolved("OUT_OF_SCOPE", alternatives, "NO_AFFORDANCE_SIGNAL");
    }

    const margin = best.score - (next?.score || 0);
    const relativeMargin = margin / Math.max(1, best.score);
    return unresolved(
      "CLARIFICATION_REQUIRED",
      alternatives,
      next && relativeMargin < 0.2
        ? "AMBIGUOUS_AFFORDANCE"
        : "INSUFFICIENT_AFFORDANCE_EVIDENCE",
    );
  }
}

function capabilityVariant(
  originalAction: string,
  actionMatch: string,
  surfaces: AffordanceSurfaces[],
  alternatives: IntentAlternative[],
): ResolvedIntent | null {
  const decisionPointIds = unique(
    surfaces
      .map(({ option }) => String(option.effect?.decisionPointId || "").trim())
      .filter(Boolean),
  );
  if (decisionPointIds.length !== 1) return null;

  const actionUnits = lexicalUnits(actionMatch);
  const affordanceUnits = new Set(
    surfaces.flatMap(({ matchValues }) => matchValues.flatMap(lexicalUnits)),
  );
  const overlaps = [...actionUnits].filter((unit) => affordanceUnits.has(unit));
  const novelUnits = [...actionUnits].filter((unit) => !affordanceUnits.has(unit));
  const strongOverlap = overlaps.some((unit) => [...unit].length >= 4)
    || overlaps.filter((unit) => [...unit].length >= 2).length >= 2;
  const hasARealVariant = novelUnits.some((unit) => [...unit].length >= 2);
  if (!strongOverlap || !hasARealVariant) return null;

  const constraints = unique(
    surfaces.flatMap(({ option }) => option.effect?.beatContract?.constraints || []),
  );
  const overlapWeight = overlaps.reduce((total, unit) => total + [...unit].length, 0);
  const confidence = round(Math.min(0.86, 0.61 + overlapWeight * 0.012));
  return {
    schemaVersion: INTENT_RESOLUTION_SCHEMA,
    status: "BOUND_CAPABILITY",
    intentType: "CAPABILITY_VARIANT",
    capabilityRef: `decision-point:${decisionPointIds[0]}`,
    targetRefs: [decisionPointIds[0]!],
    constraints,
    matchedAffordanceId: null,
    canonicalAction: originalAction,
    confidence,
    alternatives,
    reason: "BOUNDED_CAPABILITY_VARIANT",
  };
}

function lexicalUnits(value: string) {
  const units = new Set<string>();
  for (const segment of value.split(MATCH_BOUNDARY).filter(Boolean)) {
    const points = [...segment];
    const containsCjk = /[\p{Script=Han}]/u.test(segment);
    if (containsCjk) {
      for (const length of [2, 3]) {
        for (let index = 0; index + length <= points.length; index += 1) {
          units.add(points.slice(index, index + length).join(""));
        }
      }
    } else if (points.length >= 4) {
      units.add(segment);
    }
  }
  return units;
}

function scoreAffordance(
  action: string,
  option: OpenNovelOption,
  all: AffordanceSurfaces[],
): ScoredAffordance {
  const actionPoints = [...action];
  let score = 0;
  let sharedScore = 0;
  let longestUniqueGram = 0;
  let longestSharedGram = 0;
  const matchedActionIndexes = new Set<number>();
  const sharedActionIndexes = new Set<number>();

  for (let length = Math.min(10, actionPoints.length); length >= 3; length -= 1) {
    for (let index = 0; index + length <= actionPoints.length; index += 1) {
      const points = actionPoints.slice(index, index + length);
      if (points.includes(MATCH_BOUNDARY)) continue;
      const gram = points.join("");
      const owners = all.filter(({ matchValues }) => (
        matchValues.some((value) => value.includes(gram))
      ));
      if (!owners.some((owner) => owner.option.id === option.id)) continue;
      if (owners.length === 1) {
        score += length * length;
        longestUniqueGram = Math.max(longestUniqueGram, length);
        for (let cursor = index; cursor < index + length; cursor += 1) {
          if (actionPoints[cursor] !== MATCH_BOUNDARY) matchedActionIndexes.add(cursor);
        }
      } else {
        sharedScore += length;
        longestSharedGram = Math.max(longestSharedGram, length);
        for (let cursor = index; cursor < index + length; cursor += 1) {
          if (actionPoints[cursor] !== MATCH_BOUNDARY) sharedActionIndexes.add(cursor);
        }
      }
    }
  }

  return {
    option,
    exact: false,
    score,
    sharedScore,
    longestUniqueGram,
    longestSharedGram,
    matchedActionIndexes,
    sharedActionIndexes,
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
  if (!item.longestUniqueGram) {
    const sharedCoverage = item.sharedActionIndexes.size / Math.max(1, actionLength);
    return item.longestSharedGram >= 5
      ? round(Math.min(0.69, 0.35 + sharedCoverage * 0.3))
      : 0;
  }
  const coverage = item.matchedActionIndexes.size / Math.max(1, actionLength);
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

function normalized(value: unknown) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("und");
}

function normalizeExact(value: unknown) {
  return normalized(value).replace(/[\p{P}\p{S}\s]+/gu, "").trim();
}

function normalizeForMatch(value: unknown) {
  return normalized(value)
    .replace(/[\p{P}\p{S}\s]+/gu, MATCH_BOUNDARY)
    .split(MATCH_BOUNDARY)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(MATCH_BOUNDARY);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
