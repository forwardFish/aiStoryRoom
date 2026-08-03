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
  supportedStoryFacts?: Array<{
    supportId: string;
    statement: string;
  }>;
  mechanismOnlyEvidence?: Array<{
    evidenceId: string;
    statement: string;
  }>;
  specificityBoundary?: string;
};

export type TruthAssertion = {
  predicate: DurablePredicate;
  exactQuote: string;
  quoteStart: number;
  quoteEnd: number;
  explicitness: "EXPLICIT" | "AMBIGUOUS";
  confidence: number;
};

export type TruthReviewUnit = {
  unitId: string;
  quoteStart: number;
  quoteEnd: number;
  text: string;
};

export type OriginActionAssessment = {
  unitId: string;
  classification:
    | "NO_DURABLE_ACTION"
    | "AUTHORIZED"
    | "UNAUTHORIZED"
    | "AMBIGUOUS";
  exactQuotes: string[];
  confidence: number;
};

export type TruthReview = {
  reviewId: string;
  draftId: string;
  reviewerModel: string;
  assertions: TruthAssertion[];
  originActionAssessments: OriginActionAssessment[];
  missingRequiredPredicateIds: string[];
  unknownEntityMentions: Array<{
    exactQuote: string;
    durableImpact: boolean;
    confidence: number;
  }>;
  factClaims: Array<{
    exactQuote: string;
    supportId: string | null;
    durability: "DURABLE" | "TEXTURE_OR_TRANSIENT";
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
    | "UNKNOWN_DURABLE_ENTITY"
    | "UNSUPPORTED_DURABLE_FACT";
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
    supportedStoryFacts: input.context.supportedStoryFacts || [],
    mechanismOnlyEvidence: input.context.mechanismOnlyEvidence || [],
    specificityBoundary: input.context.specificityBoundary || "",
    reviewUnits: buildTruthReviewUnits(input.draft),
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
        "Separately extract explicit factual claims that would persist beyond sentence texture: exact quantities, named places, current shortages or price changes, document/evidence existence, institutional policy, completed acts, identities or relationships.",
        "For each such claim return one factClaims row. Bind supportId only when a supplied supportedStoryFact directly authorizes that current-world claim. Original mechanisms are inspiration only and can never be used as current-fact support.",
        "If a factual claim is unsupported, use supportId=null. Mark ordinary weather, gestures, furniture, light and other non-persistent texture as TEXTURE_OR_TRANSIENT or omit it.",
        "Do not judge prose quality, rewrite text, settle state or decide publication.",
        "Every supplied reviewUnit must receive exactly one originActionAssessment. Never omit a unit, even when it contains no durable action.",
        "Classify each unit as NO_DURABLE_ACTION, AUTHORIZED, UNAUTHORIZED, or AMBIGUOUS. For every non-NO_DURABLE_ACTION assessment, include the exact action quote from that unit.",
        "Return strict JSON with exactly: assertions, originActionAssessments, missingRequiredPredicateIds, unknownEntityMentions, factClaims.",
        "Each assertion has predicate, exactQuote, quoteStart, quoteEnd, explicitness and confidence.",
        "Each unknownEntityMention has exactQuote, durableImpact and confidence.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "# Review Contract",
        JSON.stringify(reviewContract),
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
      [
        "assertions",
        "originActionAssessments",
        "missingRequiredPredicateIds",
        "unknownEntityMentions",
        "factClaims",
      ],
      "TRUTH_REVIEW",
    );
    if (!Array.isArray(value.assertions)) throw new Error("ASSERTIONS_NOT_ARRAY");
    if (!Array.isArray(value.originActionAssessments)) {
      throw new Error("ORIGIN_ACTION_ASSESSMENTS_NOT_ARRAY");
    }
    if (!Array.isArray(value.missingRequiredPredicateIds)) {
      throw new Error("MISSING_REQUIRED_NOT_ARRAY");
    }
    if (!Array.isArray(value.unknownEntityMentions)) {
      throw new Error("UNKNOWN_MENTIONS_NOT_ARRAY");
    }
    if (!Array.isArray(value.factClaims)) {
      throw new Error("FACT_CLAIMS_NOT_ARRAY");
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

    const reviewUnits = buildTruthReviewUnits(input.draft);
    const unitById = new Map(reviewUnits.map((unit) => [unit.unitId, unit]));
    const seenUnitIds = new Set<string>();
    const originActionAssessments = value.originActionAssessments.map((raw, index) => {
      let normalizedRaw = raw;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const record = raw as Record<string, unknown>;
        if (String(record.classification || "").toUpperCase() === "NO_DURABLE_ACTION") {
          const additions: Record<string, unknown> = {};
          if (!("exactQuotes" in record)) additions.exactQuotes = [];
          if (!("confidence" in record)) additions.confidence = 1;
          if (Object.keys(additions).length) {
            normalizedRaw = { ...record, ...additions };
            parseStatus = "REPAIRED";
          }
        }
      }
      const item = exactObject(
        normalizedRaw,
        ["unitId", "classification", "exactQuotes", "confidence"],
        `ORIGIN_ACTION_ASSESSMENT_${index}`,
      );
      const unitId = requiredString(item.unitId, "ORIGIN_ACTION_UNIT_ID");
      const unit = unitById.get(unitId);
      if (!unit || seenUnitIds.has(unitId)) {
        throw new Error(`ORIGIN_ACTION_UNIT_INVALID:${unitId}`);
      }
      seenUnitIds.add(unitId);
      const classification = String(item.classification || "").toUpperCase();
      if (![
        "NO_DURABLE_ACTION",
        "AUTHORIZED",
        "UNAUTHORIZED",
        "AMBIGUOUS",
      ].includes(classification)) {
        throw new Error(`ORIGIN_ACTION_CLASSIFICATION_INVALID:${unitId}`);
      }
      if (classification !== item.classification) parseStatus = "REPAIRED";
      if (!Array.isArray(item.exactQuotes)) {
        throw new Error(`ORIGIN_ACTION_QUOTES_INVALID:${unitId}`);
      }
      const exactQuotes = item.exactQuotes.map((quote) => (
        requiredString(quote, `ORIGIN_ACTION_QUOTE:${unitId}`)
      ));
      if (classification === "NO_DURABLE_ACTION" && exactQuotes.length) {
        throw new Error(`ORIGIN_ACTION_NONE_HAS_QUOTES:${unitId}`);
      }
      if (classification !== "NO_DURABLE_ACTION" && !exactQuotes.length) {
        throw new Error(`ORIGIN_ACTION_QUOTE_REQUIRED:${unitId}`);
      }
      for (const quote of exactQuotes) {
        if (!unit.text.includes(quote)) {
          throw new Error(`ORIGIN_ACTION_QUOTE_OUTSIDE_UNIT:${unitId}`);
        }
      }
      return {
        unitId,
        classification: classification as OriginActionAssessment["classification"],
        exactQuotes: [...new Set(exactQuotes)],
        confidence: requiredConfidence(
          item.confidence,
          `ORIGIN_ACTION_CONFIDENCE:${unitId}`,
        ),
      } satisfies OriginActionAssessment;
    });
    if (seenUnitIds.size !== reviewUnits.length) {
      const missing = reviewUnits.find((unit) => !seenUnitIds.has(unit.unitId));
      throw new Error(`ORIGIN_ACTION_UNIT_MISSING:${missing?.unitId || "UNKNOWN"}`);
    }

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

    const supportedFactIds = new Set(
      (input.context.supportedStoryFacts || []).map((item) => item.supportId),
    );
    const factClaims = value.factClaims.map((raw, index) => {
      const item = exactObject(
        raw,
        ["exactQuote", "supportId", "durability", "confidence"],
        `FACT_CLAIM_${index}`,
      );
      const exactQuote = requiredString(item.exactQuote, `FACT_CLAIM_QUOTE_${index}`);
      if (!input.draft.includes(exactQuote)) {
        throw new Error(`FACT_CLAIM_QUOTE_NOT_FOUND:${index}`);
      }
      const supportId = item.supportId === null
        ? null
        : requiredString(item.supportId, `FACT_CLAIM_SUPPORT_${index}`);
      if (supportId && !supportedFactIds.has(supportId)) {
        throw new Error(`FACT_CLAIM_SUPPORT_UNKNOWN:${supportId}`);
      }
      const durability = String(item.durability || "").toUpperCase();
      if (durability !== "DURABLE" && durability !== "TEXTURE_OR_TRANSIENT") {
        throw new Error(`FACT_CLAIM_DURABILITY_INVALID:${index}`);
      }
      return {
        exactQuote,
        supportId,
        durability: durability as "DURABLE" | "TEXTURE_OR_TRANSIENT",
        confidence: requiredConfidence(item.confidence, `FACT_CLAIM_CONFIDENCE_${index}`),
      };
    });

    return {
      reviewId: input.reviewId,
      draftId: input.draftId,
      reviewerModel: input.reviewerModel,
      assertions,
      originActionAssessments,
      missingRequiredPredicateIds: [...new Set(missingRequiredPredicateIds)],
      unknownEntityMentions,
      factClaims,
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

  for (const assessment of input.review.originActionAssessments) {
    if (assessment.classification === "NO_DURABLE_ACTION") continue;
    if (
      assessment.classification === "AMBIGUOUS"
      || assessment.confidence < threshold
    ) {
      shadow.push({
        reason: assessment.classification === "AMBIGUOUS"
          ? "ORIGIN_ACTION_AMBIGUOUS"
          : "ORIGIN_ACTION_LOW_CONFIDENCE",
        exactQuote: assessment.exactQuotes.join(" | "),
      });
      continue;
    }
    if (
      input.context.originActionsInDraft === "FORBIDDEN"
      || assessment.classification === "UNAUTHORIZED"
    ) {
      for (const exactQuote of assessment.exactQuotes) {
        conflicts.push({
          code: "UNAUTHORIZED_PLAYER_ACTION",
          exactQuote,
        });
      }
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
  for (const claim of input.review.factClaims) {
    if (
      claim.durability === "DURABLE"
      && !claim.supportId
      && claim.confidence >= threshold
    ) {
      conflicts.push({
        code: "UNSUPPORTED_DURABLE_FACT",
        exactQuote: claim.exactQuote,
      });
    } else if (claim.durability === "DURABLE" && !claim.supportId) {
      shadow.push({
        reason: "UNSUPPORTED_FACT_LOW_CONFIDENCE",
        exactQuote: claim.exactQuote,
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
    originActionAssessments: [],
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
    factClaims: [],
    parseStatus: "INVALID",
    invalidReason: invalidReason.slice(0, 500),
  };
}

export function buildTruthReviewUnits(draft: string): TruthReviewUnit[] {
  const units: TruthReviewUnit[] = [];
  const text = String(draft || "");
  const pattern = /\S(?:[\s\S]*?\S)?(?=\r?\n[ \t]*\r?\n|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const quoteStart = match.index;
    const value = match[0];
    units.push({
      unitId: `U${String(units.length + 1).padStart(3, "0")}`,
      quoteStart,
      quoteEnd: quoteStart + value.length,
      text: value,
    });
  }
  if (!units.length && text.trim()) {
    const quoteStart = text.indexOf(text.trim());
    units.push({
      unitId: "U001",
      quoteStart,
      quoteEnd: quoteStart + text.trim().length,
      text: text.trim(),
    });
  }
  return units;
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
      requiredPredicateId: conflict.requiredPredicateId,
    }),
    conflict,
  ])).values()];
}
