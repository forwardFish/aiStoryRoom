import { jsonrepair } from "jsonrepair";
import templatesPackage from "@ai-story/templates";
import type {
  DurablePredicate,
  DurablePredicatePattern,
} from "@ai-story/templates";
import type { ModelMessage } from "./types.js";

const { predicateFields, predicateMatchesPattern } = templatesPackage;

export type TruthEntityCatalogItem = {
  id: string;
  kind: string;
  displayName: string;
  aliases?: string[];
};

export type RequiredTruthPredicate = {
  id: string;
  pattern: DurablePredicatePattern;
};

export type NarrativeTruthContext = {
  originActorId: string;
  projectionActorId: string;
  catalog: TruthEntityCatalogItem[];
  capabilityIds: string[];
  secretIds: string[];
  allowedPredicates: DurablePredicatePattern[];
  requiredVisiblePredicates: RequiredTruthPredicate[];
  forbiddenPredicates: DurablePredicatePattern[];
  originActionsInDraft: "FORBIDDEN" | "ALLOWED_BY_ENVELOPE";
};

export type TruthAssertion = {
  predicate: DurablePredicate;
  exactQuote: string;
  quoteStart: number;
  quoteEnd: number;
  explicitness: "EXPLICIT" | "AMBIGUOUS";
  confidence: number;
};

export type TruthReview = {
  reviewId: string;
  draftId: string;
  reviewerModel: string;
  assertions: TruthAssertion[];
  missingRequiredPredicateIds: string[];
  unknownEntityMentions: Array<{
    exactQuote: string;
    durableImpact: boolean;
    confidence: number;
  }>;
  parseStatus: "VALID" | "REPAIRED" | "INVALID";
  invalidReason?: string;
};

export type TruthConflict = {
  code:
    | "UNAUTHORIZED_DURABLE_ASSERTION"
    | "UNAUTHORIZED_PLAYER_ACTION"
    | "FORBIDDEN_PREDICATE"
    | "MISSING_REQUIRED_PREDICATE"
    | "UNKNOWN_DURABLE_ENTITY";
  exactQuote: string;
  predicate?: DurablePredicate;
  requiredPredicateId?: string;
};

export type TruthComparison = {
  conflicts: TruthConflict[];
  shadow: Array<{
    reason: string;
    exactQuote: string;
    predicate?: DurablePredicate;
  }>;
};

type ReviewParseInput = {
  raw: string;
  draft: string;
  draftId: string;
  reviewId: string;
  reviewerModel: string;
  context: NarrativeTruthContext;
};

export function buildTruthReviewerMessages(input: {
  draft: string;
  draftId: string;
  reviewId: string;
  context: NarrativeTruthContext;
}): ModelMessage[] {
  const reviewContract = {
    draftId: input.draftId,
    reviewId: input.reviewId,
    originActorId: input.context.originActorId,
    projectionActorId: input.context.projectionActorId,
    catalog: input.context.catalog,
    capabilityIds: input.context.capabilityIds,
    secretIds: input.context.secretIds,
    allowedPredicates: input.context.allowedPredicates,
    requiredVisiblePredicates: input.context.requiredVisiblePredicates,
    forbiddenPredicates: input.context.forbiddenPredicates,
    originActionsInDraft: input.context.originActionsInDraft,
  };
  return [
    {
      role: "system",
      content: [
        "You are a Truth Reviewer, not a narrator and not a release gate.",
        "Extract only explicit durable assertions from the supplied draft.",
        "Ordinary scene texture, unnamed incidental people, gestures, furniture, light, footsteps, sleeves, ink and ordinary paper are not durable assertions.",
        "Use only IDs from the supplied catalog and capability list. Never invent an ID.",
        "If an explicit major order by the origin actor has no matching catalog capability, report its exact quote under unknownEntityMentions with durableImpact=true instead of inventing a capability ID.",
        "Do not judge prose quality, rewrite text, settle state or decide publication.",
        "Return strict JSON with exactly: assertions, missingRequiredPredicateIds, unknownEntityMentions.",
        "Each assertion has predicate, exactQuote, quoteStart, quoteEnd, explicitness and confidence.",
        "Each unknownEntityMention has exactQuote, durableImpact and confidence.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "# Review Contract",
        JSON.stringify(reviewContract),
        "# Draft",
        input.draft,
      ].join("\n\n"),
    },
  ];
}

export function parseTruthReview(input: ReviewParseInput): TruthReview {
  let parsed: unknown;
  const candidate = unwrapJsonCandidate(String(input.raw || ""));
  let parseStatus: TruthReview["parseStatus"] = candidate.repaired
    ? "REPAIRED"
    : "VALID";
  try {
    parsed = JSON.parse(candidate.text);
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(candidate.text));
      parseStatus = "REPAIRED";
    } catch (error) {
      return invalidReview(input, String((error as Error).message || error));
    }
  }

  try {
    const value = exactObject(
      parsed,
      ["assertions", "missingRequiredPredicateIds", "unknownEntityMentions"],
      "TRUTH_REVIEW",
    );
    if (!Array.isArray(value.assertions)) throw new Error("ASSERTIONS_NOT_ARRAY");
    if (!Array.isArray(value.missingRequiredPredicateIds)) {
      throw new Error("MISSING_REQUIRED_NOT_ARRAY");
    }
    if (!Array.isArray(value.unknownEntityMentions)) {
      throw new Error("UNKNOWN_MENTIONS_NOT_ARRAY");
    }

    const requiredIds = new Set(
      input.context.requiredVisiblePredicates.map((item) => item.id),
    );
    const missingRequiredPredicateIds = value.missingRequiredPredicateIds.map(
      (item) => requiredString(item, "MISSING_REQUIRED_ID"),
    );
    for (const id of missingRequiredPredicateIds) {
      if (!requiredIds.has(id)) throw new Error(`UNKNOWN_REQUIRED_ID:${id}`);
    }

    const assertions = value.assertions.map((raw, index) => {
      const item = exactObject(
        raw,
        [
          "predicate",
          "exactQuote",
          "quoteStart",
          "quoteEnd",
          "explicitness",
          "confidence",
        ],
        `ASSERTION_${index}`,
      );
      const exactQuote = requiredString(item.exactQuote, "EXACT_QUOTE");
      let quoteStart = requiredInteger(item.quoteStart, "QUOTE_START");
      let quoteEnd = requiredInteger(item.quoteEnd, "QUOTE_END");
      if (quoteEnd <= quoteStart || input.draft.slice(quoteStart, quoteEnd) !== exactQuote) {
        const repairedSpan = uniqueQuoteSpan(input.draft, exactQuote);
        if (!repairedSpan) throw new Error(`QUOTE_SPAN_INVALID:${index}`);
        quoteStart = repairedSpan.quoteStart;
        quoteEnd = repairedSpan.quoteEnd;
        parseStatus = "REPAIRED";
      }
      const explicitness = String(item.explicitness || "").toUpperCase();
      if (explicitness !== "EXPLICIT" && explicitness !== "AMBIGUOUS") {
        throw new Error(`EXPLICITNESS_INVALID:${index}`);
      }
      if (explicitness !== item.explicitness) parseStatus = "REPAIRED";
      const confidence = requiredConfidence(item.confidence, `CONFIDENCE_${index}`);
      return {
        predicate: validateReviewPredicate(item.predicate, input.context),
        exactQuote,
        quoteStart,
        quoteEnd,
        explicitness,
        confidence,
      } satisfies TruthAssertion;
    });

    const unknownEntityMentions = value.unknownEntityMentions.map((raw, index) => {
      const item = exactObject(
        raw,
        ["exactQuote", "durableImpact", "confidence"],
        `UNKNOWN_MENTION_${index}`,
      );
      const exactQuote = requiredString(item.exactQuote, "UNKNOWN_EXACT_QUOTE");
      if (!input.draft.includes(exactQuote)) {
        throw new Error(`UNKNOWN_QUOTE_NOT_FOUND:${index}`);
      }
      if (typeof item.durableImpact !== "boolean") {
        throw new Error(`DURABLE_IMPACT_INVALID:${index}`);
      }
      return {
        exactQuote,
        durableImpact: item.durableImpact,
        confidence: requiredConfidence(item.confidence, `UNKNOWN_CONFIDENCE_${index}`),
      };
    });

    return {
      reviewId: input.reviewId,
      draftId: input.draftId,
      reviewerModel: input.reviewerModel,
      assertions,
      missingRequiredPredicateIds: [...new Set(missingRequiredPredicateIds)],
      unknownEntityMentions,
      parseStatus,
    };
  } catch (error) {
    return invalidReview(input, String((error as Error).message || error));
  }
}

function unwrapJsonCandidate(raw: string) {
  const text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced
    ? { text: fenced[1]!.trim(), repaired: true }
    : { text, repaired: false };
}

function uniqueQuoteSpan(draft: string, exactQuote: string) {
  const first = draft.indexOf(exactQuote);
  if (first < 0 || draft.indexOf(exactQuote, first + exactQuote.length) >= 0) {
    return null;
  }
  return {
    quoteStart: first,
    quoteEnd: first + exactQuote.length,
  };
}

export function compareTruthReview(input: {
  review: TruthReview;
  context: NarrativeTruthContext;
  confidenceThreshold?: number;
}): TruthComparison {
  const threshold = Number.isFinite(input.confidenceThreshold)
    ? Math.max(0.5, Math.min(1, Number(input.confidenceThreshold)))
    : 0.9;
  const conflicts: TruthConflict[] = [];
  const shadow: TruthComparison["shadow"] = [];
  if (input.review.parseStatus === "INVALID") {
    shadow.push({
      reason: `REVIEW_INVALID:${input.review.invalidReason || "UNKNOWN"}`,
      exactQuote: "",
    });
    return { conflicts, shadow };
  }

  for (const assertion of input.review.assertions) {
    if (assertion.explicitness !== "EXPLICIT" || assertion.confidence < threshold) {
      shadow.push({
        reason: assertion.explicitness !== "EXPLICIT"
          ? "ASSERTION_AMBIGUOUS"
          : "ASSERTION_LOW_CONFIDENCE",
        exactQuote: assertion.exactQuote,
        predicate: assertion.predicate,
      });
      continue;
    }
    const allowed = input.context.allowedPredicates.some((pattern) =>
      predicateMatchesPattern(assertion.predicate, pattern)
    );
    const forbidden = input.context.forbiddenPredicates.some((pattern) =>
      predicateMatchesPattern(assertion.predicate, pattern)
    );
    if (forbidden) {
      conflicts.push({
        code: "FORBIDDEN_PREDICATE",
        exactQuote: assertion.exactQuote,
        predicate: assertion.predicate,
      });
      continue;
    }
    if (
      input.context.originActionsInDraft === "FORBIDDEN"
      && isOriginActorAction(assertion.predicate, input.context.originActorId)
    ) {
      conflicts.push({
        code: "UNAUTHORIZED_PLAYER_ACTION",
        exactQuote: assertion.exactQuote,
        predicate: assertion.predicate,
      });
      continue;
    }
    if (!allowed && isP0DurablePredicate(assertion.predicate)) {
      conflicts.push({
        code: "UNAUTHORIZED_DURABLE_ASSERTION",
        exactQuote: assertion.exactQuote,
        predicate: assertion.predicate,
      });
      continue;
    }
    if (!allowed) {
      shadow.push({
        reason: "ASSERTION_NOT_AUTHORIZED_BUT_NOT_P0",
        exactQuote: assertion.exactQuote,
        predicate: assertion.predicate,
      });
    }
  }

  const explicitlyMissingRequired = new Set(
    input.review.missingRequiredPredicateIds,
  );
  for (const required of input.context.requiredVisiblePredicates) {
    const visiblyAsserted = input.review.assertions.some((assertion) => (
      assertion.explicitness === "EXPLICIT"
      && assertion.confidence >= threshold
      && predicateMatchesPattern(assertion.predicate, required.pattern)
    ));
    if (!visiblyAsserted) explicitlyMissingRequired.add(required.id);
  }
  for (const requiredPredicateId of explicitlyMissingRequired) {
    conflicts.push({
      code: "MISSING_REQUIRED_PREDICATE",
      exactQuote: "",
      requiredPredicateId,
    });
  }
  for (const mention of input.review.unknownEntityMentions) {
    if (mention.durableImpact && mention.confidence >= threshold) {
      conflicts.push({
        code: "UNKNOWN_DURABLE_ENTITY",
        exactQuote: mention.exactQuote,
      });
    } else {
      shadow.push({
        reason: mention.durableImpact
          ? "UNKNOWN_MENTION_LOW_CONFIDENCE"
          : "UNKNOWN_MENTION_TEXTURE",
        exactQuote: mention.exactQuote,
      });
    }
  }
  return { conflicts: deduplicateConflicts(conflicts), shadow };
}

function validateReviewPredicate(
  input: unknown,
  context: NarrativeTruthContext,
): DurablePredicate {
  const value = exactObject(input, undefined, "PREDICATE");
  if (typeof value.type !== "string" || !(value.type in predicateFields)) {
    throw new Error(`PREDICATE_TYPE_INVALID:${String(value.type)}`);
  }
  const fields = predicateFields[value.type as DurablePredicate["type"]];
  const exact = exactObject(value, ["type", ...fields], "PREDICATE");
  const knownIds = new Set(context.catalog.map((item) => item.id));
  const actorIds = new Set(
    context.catalog.filter((item) => item.kind === "ACTOR").map((item) => item.id),
  );
  for (const field of fields) {
    const fieldValue = exact[field];
    if (field === "delta") {
      if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
        throw new Error(`PREDICATE_DELTA_INVALID:${String(value.type)}`);
      }
      continue;
    }
    const id = requiredString(fieldValue, `PREDICATE_${field}`);
    if (/^(?:actorId|fromActorId|toActorId)$/u.test(field) && !actorIds.has(id)) {
      throw new Error(`PREDICATE_ACTOR_UNKNOWN:${id}`);
    }
    if (field === "capabilityId" && !context.capabilityIds.includes(id)) {
      throw new Error(`PREDICATE_CAPABILITY_UNKNOWN:${id}`);
    }
    if (field === "secretId" && !context.secretIds.includes(id)) {
      throw new Error(`PREDICATE_SECRET_UNKNOWN:${id}`);
    }
    if (
      /^(?:entityId|locationId|documentId|evidenceId|resourceId|audienceId)$/u.test(field)
      && !knownIds.has(id)
    ) {
      throw new Error(`PREDICATE_ENTITY_UNKNOWN:${id}`);
    }
  }
  return exact as unknown as DurablePredicate;
}

function isOriginActorAction(predicate: DurablePredicate, originActorId: string) {
  return (
    (predicate.type === "ACTOR.ORDERED" || predicate.type === "ACTOR.COMMITTED")
    && predicate.actorId === originActorId
  );
}

function isP0DurablePredicate(predicate: DurablePredicate) {
  return [
    "ENTITY.INTRODUCED",
    "ENTITY.LOCATED_AT",
    "ENTITY.HELD_BY",
    "DOCUMENT.CREATED",
    "DOCUMENT.AUTHENTICATED",
    "DOCUMENT.TRANSFERRED",
    "DOCUMENT.PUBLISHED",
    "EVIDENCE.DESTROYED",
    "KNOWLEDGE.REVEALED_TO",
    "ACTOR.COMMITTED",
    "ACTOR.ORDERED",
  ].includes(predicate.type);
}

function invalidReview(input: ReviewParseInput, invalidReason: string): TruthReview {
  return {
    reviewId: input.reviewId,
    draftId: input.draftId,
    reviewerModel: input.reviewerModel,
    assertions: [],
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
    parseStatus: "INVALID",
    invalidReason: invalidReason.slice(0, 500),
  };
}

function exactObject(
  input: unknown,
  fields: readonly string[] | undefined,
  label: string,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label}_NOT_OBJECT`);
  }
  const value = input as Record<string, unknown>;
  if (fields) {
    const unknown = Object.keys(value).find((key) => !fields.includes(key));
    const missing = fields.find((key) => !(key in value));
    if (unknown) throw new Error(`${label}_UNKNOWN_FIELD:${unknown}`);
    if (missing) throw new Error(`${label}_MISSING_FIELD:${missing}`);
  }
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}_INVALID`);
  return value;
}

function requiredInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label}_INVALID`);
  return Number(value);
}

function requiredConfidence(value: unknown, label: string) {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 1
  ) {
    throw new Error(`${label}_INVALID`);
  }
  return value;
}

function deduplicateConflicts(conflicts: TruthConflict[]) {
  return [...new Map(conflicts.map((conflict) => [
    JSON.stringify({
      code: conflict.code,
      exactQuote: conflict.exactQuote,
      predicate: conflict.predicate,
      requiredPredicateId: conflict.requiredPredicateId,
    }),
    conflict,
  ])).values()];
}
