import { jsonrepair } from "jsonrepair";
import templatesPackage from "@ai-story/templates";
import type {
  CausalEvent,
  DurablePredicate,
  DurablePredicatePattern,
  DurableTurnEnvelope,
  PlayerTurnProjection,
  WorldRuntimeContract,
} from "@ai-story/templates";
import type { ModelMessage } from "./types.js";

const {
  predicateFields,
  predicateMatchesPattern,
  validateDurableTurnEnvelope,
  validateWorldRuntimeContract,
} = templatesPackage;

export type TruthEntityCatalogItem = {
  id: string;
  kind: string;
  displayName: string;
  aliases?: string[];
};

export type RequiredTruthPredicate = {
  id: string;
  pattern: DurablePredicatePattern;
  /**
   * Server-owned natural-language meaning of the predicate. The Reviewer uses
   * this to extract semantic coverage without guessing what an opaque predicate
   * ID means. Wording may vary in prose; meaning may not.
   */
  requiredMeaning: string;
  /** Current-world events that authorize this required meaning. */
  supportIds: string[];
};

export type NarrativeTruthContext = {
  originActorId: string;
  projectionActorId: string;
  /** Server-selected entities that are active in the settled scene. */
  activeSceneEntityIds?: string[];
  catalog: TruthEntityCatalogItem[];
  capabilityIds: string[];
  secretIds: string[];
  /** Predicates already visible and true at the start of Narrator continuation. */
  establishedPredicates?: DurablePredicate[];
  allowedPredicates: DurablePredicatePattern[];
  requiredVisiblePredicates: RequiredTruthPredicate[];
  forbiddenPredicates: DurablePredicatePattern[];
  originActionsInDraft: "FORBIDDEN" | "ALLOWED_BY_ENVELOPE";
  supportedStoryFacts?: Array<{
    supportId: string;
    statement: string;
    /**
     * False means this support exists only to require a server-owned beat. It
     * cannot authorize unrelated durable fact claims in free prose.
     */
    claimSupport?: boolean;
  }>;
  forbiddenStoryClaims?: Array<{
    boundaryId: string;
    statement: string;
  }>;
  mechanismOnlyEvidence?: Array<{
    evidenceId: string;
    statement: string;
  }>;
  specificityBoundary?: string;
  /** The unresolved question/pressure at which this continuation must stop. */
  stopCondition?: string;
  /**
   * Server-owned scene end-state after settlement. Narration may texture this
   * scene, but cannot advance time or move elsewhere unless a later settlement
   * explicitly changes the scene first.
   */
  sceneContinuity?: {
    sceneId: string;
    timeLabel: string;
    locationLabel: string;
  };
};

/**
 * Convert the shared v4 settlement contract into the only semantic contract
 * accepted by the Reviewer/Comparator pipeline. This keeps world adapters
 * from inventing a second, story-specific meaning for the same envelope.
 */
export function buildNarrativeTruthContextFromEnvelope(input: {
  contract: WorldRuntimeContract;
  envelope: DurableTurnEnvelope;
  events: CausalEvent[];
  projection: PlayerTurnProjection;
  originActionsInDraft: NarrativeTruthContext["originActionsInDraft"];
  supportedStoryFacts?: NarrativeTruthContext["supportedStoryFacts"];
  mechanismOnlyEvidence?: NarrativeTruthContext["mechanismOnlyEvidence"];
  forbiddenStoryClaims?: NarrativeTruthContext["forbiddenStoryClaims"];
  specificityBoundary?: string;
}): NarrativeTruthContext {
  const contract = validateWorldRuntimeContract(input.contract);
  const envelope = validateDurableTurnEnvelope(
    input.envelope,
    contract,
    input.events,
  );
  if (
    input.projection.runId !== envelope.runId
    || input.projection.worldTurnId !== envelope.worldTurnId
    || input.projection.actorId !== envelope.projectionActorId
  ) {
    throw new Error("TRUTH_CONTEXT_PROJECTION_MISMATCH");
  }
  const events = new Map(input.events.map((event) => [event.eventId, event]));
  const eventFacts = envelope.requiredVisiblePredicates.flatMap((required) =>
    required.supportEventIds.map((supportId) => {
      const event = events.get(supportId);
      if (!event || event.status !== "APPLIED") {
        throw new Error(`TRUTH_CONTEXT_SUPPORT_EVENT_MISSING:${supportId}`);
      }
      const statement = event.affectedPlayerSummaries[envelope.projectionActorId]
        || event.publicSummary;
      if (!statement) {
        throw new Error(`TRUTH_CONTEXT_SUPPORT_NOT_VISIBLE:${supportId}`);
      }
      return { supportId, statement, claimSupport: true };
    })
  );
  const supportedStoryFacts = deduplicateSupportedFacts([
    ...eventFacts,
    ...(input.supportedStoryFacts || []),
  ]);
  const establishedPredicates = deduplicatePredicates([
    ...input.projection.privateFacts.map((fact) => fact.predicate),
    ...input.projection.publicFacts.map((fact) => fact.predicate),
    ...input.projection.personalEchoes.flatMap((effect) => effect.predicate ? [effect.predicate] : []),
    ...input.projection.crossPlayerEchoes.flatMap((effect) => effect.predicate ? [effect.predicate] : []),
    ...input.projection.worldEchoes.flatMap((effect) => effect.predicate ? [effect.predicate] : []),
  ]);
  return {
    originActorId: envelope.originActorId,
    projectionActorId: envelope.projectionActorId,
    activeSceneEntityIds: [...envelope.activeSceneEntityIds],
    catalog: contract.entities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      displayName: entity.displayName,
      aliases: [...entity.aliases],
    })),
    capabilityIds: contract.capabilities.map((capability) => capability.id),
    secretIds: contract.entities
      .filter((entity) => entity.kind === "SECRET")
      .map((entity) => entity.id),
    establishedPredicates,
    allowedPredicates: envelope.allowedPredicates,
    requiredVisiblePredicates: envelope.requiredVisiblePredicates.map((required) => ({
      id: required.id,
      pattern: required.pattern,
      requiredMeaning: required.requiredMeaning,
      supportIds: [...required.supportEventIds],
    })),
    forbiddenPredicates: envelope.forbiddenPredicatePatterns,
    originActionsInDraft: input.originActionsInDraft,
    supportedStoryFacts,
    forbiddenStoryClaims: input.forbiddenStoryClaims || [],
    mechanismOnlyEvidence: input.mechanismOnlyEvidence || [],
    specificityBoundary: input.specificityBoundary || "",
    stopCondition: envelope.narrativeSeed.stopCondition,
  };
}

function deduplicatePredicates(predicates: DurablePredicate[]) {
  return [...new Map(predicates.map((predicate) => [JSON.stringify(predicate), predicate])).values()];
}

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

export type StoryFactAssessment = {
  unitId: string;
  exactQuote: string;
  quoteStart: number;
  quoteEnd: number;
  classification:
    | "TEXTURE_OR_TRANSIENT"
    | "SUPPORTED_DURABLE"
    | "UNSUPPORTED_DURABLE_SHADOW"
    | "AMBIGUOUS_DURABILITY";
  supportIds: string[];
  confidence: number;
};

export type TruthReview = {
  reviewId: string;
  draftId: string;
  reviewerModel: string;
  assertions: TruthAssertion[];
  originActionAssessments: OriginActionAssessment[];
  storyFactAssessments: StoryFactAssessment[];
  missingRequiredPredicateIds: string[];
  unknownEntityMentions: Array<{
    unitId: string;
    exactQuote: string;
    surfaceName: string;
    entityKind: "ACTOR" | "DOCUMENT" | "EVIDENCE";
    introductionMode:
      | "EXPLICIT_NEW"
      | "EXPLICIT_UNKNOWN_EXISTING"
      | "AMBIGUOUS";
    durableImpact: boolean;
    confidence: number;
  }>;
  entityCandidateIssues: Array<{
    reason: string;
    exactQuote: string;
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
  validateNarrativeTruthContext(input.context);
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
    forbiddenStoryClaims: input.context.forbiddenStoryClaims || [],
    mechanismOnlyEvidence: input.context.mechanismOnlyEvidence || [],
    specificityBoundary: input.context.specificityBoundary || "",
    stopCondition: input.context.stopCondition || "",
    reviewUnits: buildTruthReviewUnits(input.draft),
    factUnits: buildStoryFactReviewUnits(input.draft),
  };
  return [
    {
      role: "system",
      content: [
        "You are a Truth Reviewer, not a narrator and not a release gate.",
        "Extract only explicit durable assertions from the supplied draft.",
        "Ordinary scene texture, unnamed incidental people, gestures, furniture, light, footsteps, sleeves, ink and ordinary paper are not durable assertions.",
        "Use only IDs from the supplied catalog and capability list. Never invent an ID.",
        "Unknown-entity review is limited to concrete ACTOR, DOCUMENT, or EVIDENCE candidates. Orders and commitments belong in typed assertions/originActionAssessments, never unknownEntityMentions.",
        "For an unknown entity candidate, select one supplied factUnit, quote an exact span inside that unit, and provide the exact surfaceName appearing inside the quote.",
        "Use EXPLICIT_NEW only when the prose explicitly introduces the entity as new; EXPLICIT_UNKNOWN_EXISTING only when it explicitly establishes a durable entity that already exists but is absent from the catalog; otherwise use AMBIGUOUS.",
        "A title, reported speech, generic role, unnamed incidental person, ordinary paper, or passing reference is not by itself a durable unknown entity.",
        "The server has split the complete draft into factUnits. Every factUnit must receive exactly one storyFactAssessment; never omit, merge or invent a unit.",
        "Classify each factUnit as TEXTURE_OR_TRANSIENT, SUPPORTED_DURABLE, UNSUPPORTED_DURABLE_SHADOW, or AMBIGUOUS_DURABILITY.",
        "For SUPPORTED_DURABLE, supportIds must contain only supplied supportedStoryFacts whose claimSupport=true and whose statement directly entails the complete factUnit at the same specificity. A support about an action, pressure, anomaly or general topic does not authorize new quantities, places, document wording, institutions, causes or completed states.",
        "Use UNSUPPORTED_DURABLE_SHADOW for every unsupported factual claim. Shadow does not become world truth but does not reject otherwise playable prose.",
        "The five P0 domains are handled separately through typed assertions, originActionAssessments, missingRequiredPredicateIds, unknownEntityMentions, and server ACLs. Never create a sixth generic fact-claim P0 category.",
        "For every classification except SUPPORTED_DURABLE supportIds must be empty. Original mechanisms are inspiration only and can never support a current-world fact.",
        "Ordinary weather, gestures, furniture, light and non-persistent texture are TEXTURE_OR_TRANSIENT. Use AMBIGUOUS_DURABILITY only when the unit itself does not make a clear persistent claim.",
        "Do not judge prose quality, rewrite text, settle state or decide publication.",
        "originActionAssessments evaluates only actions performed by originActorId (the player protagonist). NPC speech, questions, proposals and actions are not origin actions.",
        "Every supplied reviewUnit must receive exactly one originActionAssessment. Never omit a unit, even when it contains no durable action.",
        "Classify each unit as NO_DURABLE_ACTION, AUTHORIZED, UNAUTHORIZED, or AMBIGUOUS. For every non-NO_DURABLE_ACTION assessment, include the exact action quote from that unit.",
        "Each requiredVisiblePredicate includes a server-owned requiredMeaning and supportIds. If the draft explicitly expresses that meaning, emit an assertion whose predicate realizes that pattern; copy pattern constraints into flat predicate fields. The prose need not quote requiredMeaning verbatim.",
        "List a required predicate ID under missingRequiredPredicateIds only when its requiredMeaning is not explicitly dramatized in the draft.",
        "The stopCondition is an unresolved dramatic stopping point, not permission to invent its answer or outcome.",
        "Return strict JSON with exactly: assertions, originActionAssessments, storyFactAssessments, missingRequiredPredicateIds, unknownEntityMentions.",
        "Each assertion has predicate, exactQuote, quoteStart, quoteEnd, explicitness and confidence.",
        "Each unknownEntityMention has exactly unitId, exactQuote, surfaceName, entityKind, introductionMode, durableImpact and confidence.",
        "Each originActionAssessment has exactly unitId, classification, exactQuotes (an array), and confidence.",
        "Each storyFactAssessment has exactly unitId, classification, supportIds (an array), and confidence.",
        "Predicate fields are flat. Example: {\"type\":\"ACTOR.ORDERED\",\"actorId\":\"actor.id\",\"capabilityId\":\"capability.id\"}; never nest fields under constraints.",
        "Return raw JSON only, without a Markdown fence.",
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

export function validateNarrativeTruthContext(context: NarrativeTruthContext) {
  const catalogIds = new Set(context.catalog.map((item) => item.id));
  if (!catalogIds.has(context.originActorId)) {
    throw new Error(`TRUTH_CONTEXT_ORIGIN_UNKNOWN:${context.originActorId}`);
  }
  if (!catalogIds.has(context.projectionActorId)) {
    throw new Error(`TRUTH_CONTEXT_PROJECTION_UNKNOWN:${context.projectionActorId}`);
  }
  const supported = deduplicateSupportedFacts(context.supportedStoryFacts || []);
  const supportedIds = new Set(supported.map((item) => item.supportId));
  const requiredIds = new Set<string>();
  const forbiddenBoundaryIds = new Set<string>();
  for (const boundary of context.forbiddenStoryClaims || []) {
    const boundaryId = String(boundary.boundaryId || "").trim();
    const statement = String(boundary.statement || "").trim();
    if (!boundaryId || !statement || forbiddenBoundaryIds.has(boundaryId)) {
      throw new Error(`TRUTH_CONTEXT_FORBIDDEN_BOUNDARY_INVALID:${boundaryId}`);
    }
    forbiddenBoundaryIds.add(boundaryId);
  }
  for (const required of context.requiredVisiblePredicates) {
    if (!required.id.trim() || requiredIds.has(required.id)) {
      throw new Error(`TRUTH_CONTEXT_REQUIRED_ID_INVALID:${required.id}`);
    }
    requiredIds.add(required.id);
    if (!required.requiredMeaning.trim()) {
      throw new Error(`TRUTH_CONTEXT_REQUIRED_MEANING_MISSING:${required.id}`);
    }
    if (
      !required.supportIds.length
      || new Set(required.supportIds).size !== required.supportIds.length
    ) {
      throw new Error(`TRUTH_CONTEXT_REQUIRED_SUPPORT_INVALID:${required.id}`);
    }
    for (const supportId of required.supportIds) {
      if (!supportedIds.has(supportId)) {
        throw new Error(`TRUTH_CONTEXT_REQUIRED_SUPPORT_UNKNOWN:${supportId}`);
      }
    }
  }
  return context;
}

export function parseTruthReview(input: ReviewParseInput): TruthReview {
  try {
    validateNarrativeTruthContext(input.context);
  } catch (error) {
    return invalidReview(input, String((error as Error).message || error));
  }
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
        "storyFactAssessments",
        "missingRequiredPredicateIds",
        "unknownEntityMentions",
      ],
      "TRUTH_REVIEW",
    );
    if (!Array.isArray(value.assertions)) throw new Error("ASSERTIONS_NOT_ARRAY");
    if (!Array.isArray(value.originActionAssessments)) {
      throw new Error("ORIGIN_ACTION_ASSESSMENTS_NOT_ARRAY");
    }
    if (!Array.isArray(value.storyFactAssessments)) {
      throw new Error("STORY_FACT_ASSESSMENTS_NOT_ARRAY");
    }
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
      let exactQuote = requiredString(item.exactQuote, "EXACT_QUOTE");
      let quoteStart = requiredInteger(item.quoteStart, "QUOTE_START");
      let quoteEnd = requiredInteger(item.quoteEnd, "QUOTE_END");
      if (quoteEnd <= quoteStart || input.draft.slice(quoteStart, quoteEnd) !== exactQuote) {
        const repairedSpan = resolveUniqueQuote(input.draft, exactQuote);
        if (!repairedSpan) throw new Error(`QUOTE_SPAN_INVALID:${index}`);
        exactQuote = repairedSpan.exactQuote;
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
        predicate: validateReviewPredicate(normalizeReviewPredicate(item.predicate), input.context),
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
        const classification = record.classification ?? record.assessment;
        const exactQuotes = record.exactQuotes
          ?? (record.exactActionQuote ? [record.exactActionQuote] : []);
        normalizedRaw = {
          unitId: record.unitId,
          classification,
          exactQuotes,
          confidence: record.confidence ?? 1,
        };
        if (
          !("classification" in record)
          || !("exactQuotes" in record)
          || !("confidence" in record)
          || Object.keys(record).some((key) => ![
            "unitId", "classification", "exactQuotes", "confidence",
          ].includes(key))
        ) {
          parseStatus = "REPAIRED";
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
      const exactQuotes = item.exactQuotes.map((quote) => {
        const reportedQuote = requiredString(quote, `ORIGIN_ACTION_QUOTE:${unitId}`);
        const resolved = resolveUniqueQuote(unit.text, reportedQuote);
        if (!resolved) {
          throw new Error(`ORIGIN_ACTION_QUOTE_OUTSIDE_UNIT:${unitId}`);
        }
        if (resolved.exactQuote !== reportedQuote) parseStatus = "REPAIRED";
        return resolved.exactQuote;
      });
      if (classification === "NO_DURABLE_ACTION" && exactQuotes.length) {
        throw new Error(`ORIGIN_ACTION_NONE_HAS_QUOTES:${unitId}`);
      }
      if (classification !== "NO_DURABLE_ACTION" && !exactQuotes.length) {
        throw new Error(`ORIGIN_ACTION_QUOTE_REQUIRED:${unitId}`);
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

    const factUnits = buildStoryFactReviewUnits(input.draft);
    const factUnitById = new Map(factUnits.map((unit) => [unit.unitId, unit]));
    const entityCandidateIssues: TruthReview["entityCandidateIssues"] = [];
    const unknownEntityMentions = value.unknownEntityMentions.flatMap((raw, index) => {
      try {
        const item = exactObject(
          raw,
          [
            "unitId",
            "exactQuote",
            "surfaceName",
            "entityKind",
            "introductionMode",
            "durableImpact",
            "confidence",
          ],
          `UNKNOWN_MENTION_${index}`,
        );
        const unitId = requiredString(item.unitId, `UNKNOWN_UNIT_ID:${index}`);
        const unit = factUnitById.get(unitId);
        if (!unit) throw new Error(`UNKNOWN_UNIT_INVALID:${unitId}`);
        const reportedQuote = requiredString(item.exactQuote, "UNKNOWN_EXACT_QUOTE");
        const resolvedQuote = resolveUniqueQuote(input.draft, reportedQuote);
        if (!resolvedQuote) throw new Error(`UNKNOWN_QUOTE_NOT_FOUND:${index}`);
        if (
          resolvedQuote.quoteStart < unit.quoteStart
          || resolvedQuote.quoteEnd > unit.quoteEnd
        ) {
          throw new Error(`UNKNOWN_QUOTE_OUTSIDE_UNIT:${index}`);
        }
        const exactQuote = resolvedQuote.exactQuote;
        if (exactQuote !== reportedQuote) parseStatus = "REPAIRED";
        const surfaceName = requiredString(
          item.surfaceName,
          `UNKNOWN_SURFACE_NAME:${index}`,
        );
        if (!exactQuote.includes(surfaceName)) {
          throw new Error(`UNKNOWN_SURFACE_OUTSIDE_QUOTE:${index}`);
        }
        const entityKind = String(item.entityKind || "").toUpperCase();
        if (!["ACTOR", "DOCUMENT", "EVIDENCE"].includes(entityKind)) {
          throw new Error(`UNKNOWN_ENTITY_KIND_INVALID:${index}`);
        }
        const introductionMode = String(item.introductionMode || "").toUpperCase();
        if (![
          "EXPLICIT_NEW",
          "EXPLICIT_UNKNOWN_EXISTING",
          "AMBIGUOUS",
        ].includes(introductionMode)) {
          throw new Error(`UNKNOWN_INTRODUCTION_MODE_INVALID:${index}`);
        }
        if (typeof item.durableImpact !== "boolean") {
          throw new Error(`DURABLE_IMPACT_INVALID:${index}`);
        }
        return [{
          unitId,
          exactQuote,
          surfaceName,
          entityKind: entityKind as "ACTOR" | "DOCUMENT" | "EVIDENCE",
          introductionMode: introductionMode as
            | "EXPLICIT_NEW"
            | "EXPLICIT_UNKNOWN_EXISTING"
            | "AMBIGUOUS",
          durableImpact: item.durableImpact,
          confidence: requiredConfidence(
            item.confidence,
            `UNKNOWN_CONFIDENCE_${index}`,
          ),
        }];
      } catch (error) {
        entityCandidateIssues.push({
          reason: String((error as Error).message || error).slice(0, 300),
          exactQuote: extractCandidateQuote(raw),
        });
        parseStatus = "REPAIRED";
        return [];
      }
    });

    const allSupportedFactIds = new Set(
      (input.context.supportedStoryFacts || []).map((item) => item.supportId),
    );
    const supportedFactIds = new Set(
      (input.context.supportedStoryFacts || [])
        .filter((item) => item.claimSupport !== false)
        .map((item) => item.supportId),
    );
    const seenFactUnitIds = new Set<string>();
    const storyFactAssessments = value.storyFactAssessments.map((raw, index) => {
      const item = exactObject(
        raw,
        ["unitId", "classification", "supportIds", "confidence"],
        `STORY_FACT_ASSESSMENT_${index}`,
      );
      const unitId = requiredString(item.unitId, `STORY_FACT_UNIT_ID_${index}`);
      if (!factUnitById.has(unitId) || seenFactUnitIds.has(unitId)) {
        throw new Error(`STORY_FACT_UNIT_INVALID:${unitId}`);
      }
      seenFactUnitIds.add(unitId);
      let classification = String(item.classification || "").toUpperCase();
      if (![
        "TEXTURE_OR_TRANSIENT",
        "SUPPORTED_DURABLE",
        "UNSUPPORTED_DURABLE_SHADOW",
        "AMBIGUOUS_DURABILITY",
      ].includes(classification)) {
        throw new Error(`STORY_FACT_CLASSIFICATION_INVALID:${unitId}`);
      }
      if (classification !== item.classification) parseStatus = "REPAIRED";
      if (!Array.isArray(item.supportIds)) {
        throw new Error(`STORY_FACT_SUPPORTS_INVALID:${unitId}`);
      }
      let supportIds = item.supportIds.map((supportId) => (
        requiredString(supportId, `STORY_FACT_SUPPORT_ID:${unitId}`)
      ));
      if (new Set(supportIds).size !== supportIds.length) {
        throw new Error(`STORY_FACT_SUPPORTS_DUPLICATE:${unitId}`);
      }
      if (classification === "SUPPORTED_DURABLE") {
        if (!supportIds.length || supportIds.some((id) => !allSupportedFactIds.has(id))) {
          throw new Error(`STORY_FACT_SUPPORT_UNKNOWN:${unitId}`);
        }
        const claimSupportIds = supportIds.filter((id) => supportedFactIds.has(id));
        if (!claimSupportIds.length) {
          classification = "UNSUPPORTED_DURABLE_SHADOW";
          supportIds = [];
          parseStatus = "REPAIRED";
        } else if (claimSupportIds.length !== supportIds.length) {
          supportIds = claimSupportIds;
          parseStatus = "REPAIRED";
        }
      } else if (supportIds.length) {
        throw new Error(`STORY_FACT_SUPPORTS_FORBIDDEN:${unitId}`);
      }
      const unit = factUnitById.get(unitId)!;
      return {
        unitId,
        exactQuote: unit.text,
        quoteStart: unit.quoteStart,
        quoteEnd: unit.quoteEnd,
        classification: classification as StoryFactAssessment["classification"],
        supportIds,
        confidence: requiredConfidence(item.confidence, `STORY_FACT_CONFIDENCE:${unitId}`),
      } satisfies StoryFactAssessment;
    });
    if (seenFactUnitIds.size !== factUnits.length) {
      const missing = factUnits.find((unit) => !seenFactUnitIds.has(unit.unitId));
      throw new Error(`STORY_FACT_UNIT_MISSING:${missing?.unitId || "UNKNOWN"}`);
    }
    const factClaims = storyFactAssessments.flatMap((assessment) => {
      const unit = factUnitById.get(assessment.unitId)!;
      if (assessment.classification === "TEXTURE_OR_TRANSIENT") return [];
      return [{
        exactQuote: unit.text,
        supportId: assessment.classification === "SUPPORTED_DURABLE"
          ? assessment.supportIds[0]!
          : null,
        durability: assessment.classification === "AMBIGUOUS_DURABILITY"
          ? "TEXTURE_OR_TRANSIENT" as const
          : "DURABLE" as const,
        confidence: assessment.confidence,
      }];
    });

    return {
      reviewId: input.reviewId,
      draftId: input.draftId,
      reviewerModel: input.reviewerModel,
      assertions,
      originActionAssessments,
      storyFactAssessments,
      missingRequiredPredicateIds: [...new Set(missingRequiredPredicateIds)],
      unknownEntityMentions,
      entityCandidateIssues,
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

function resolveUniqueQuote(draft: string, reportedQuote: string) {
  const exactStart = uniqueIndexOf(draft, reportedQuote);
  if (exactStart !== null) {
    return {
      exactQuote: reportedQuote,
      quoteStart: exactStart,
      quoteEnd: exactStart + reportedQuote.length,
    };
  }

  const normalizedDraft = withoutWhitespaceWithOffsets(draft);
  const normalizedQuote = withoutWhitespaceWithOffsets(reportedQuote).text;
  if (!normalizedQuote) return null;
  const normalizedStart = uniqueIndexOf(normalizedDraft.text, normalizedQuote);
  if (normalizedStart === null) return null;
  const normalizedEnd = normalizedStart + normalizedQuote.length - 1;
  const quoteStart = normalizedDraft.offsets[normalizedStart];
  const finalOffset = normalizedDraft.offsets[normalizedEnd];
  if (quoteStart === undefined || finalOffset === undefined) return null;
  const quoteEnd = finalOffset + 1;
  return {
    exactQuote: draft.slice(quoteStart, quoteEnd),
    quoteStart,
    quoteEnd,
  };
}

function uniqueIndexOf(text: string, candidate: string) {
  const first = text.indexOf(candidate);
  if (first < 0 || text.indexOf(candidate, first + candidate.length) >= 0) {
    return null;
  }
  return first;
}

function withoutWhitespaceWithOffsets(text: string) {
  let normalized = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text[index]!;
    if (/\s/u.test(codeUnit)) continue;
    normalized += codeUnit;
    offsets.push(index);
  }
  return { text: normalized, offsets };
}

function deduplicateSupportedFacts(
  facts: NonNullable<NarrativeTruthContext["supportedStoryFacts"]>,
) {
  const byId = new Map<string, { statement: string; claimSupport: boolean }>();
  for (const fact of facts) {
    const supportId = String(fact.supportId || "").trim();
    const statement = String(fact.statement || "").trim();
    const claimSupport = fact.claimSupport !== false;
    if (!supportId || !statement) throw new Error("TRUTH_CONTEXT_SUPPORT_INVALID");
    const prior = byId.get(supportId);
    if (prior && (prior.statement !== statement || prior.claimSupport !== claimSupport)) {
      throw new Error(`TRUTH_CONTEXT_SUPPORT_CONFLICT:${supportId}`);
    }
    byId.set(supportId, { statement, claimSupport });
  }
  return [...byId].map(([supportId, fact]) => ({ supportId, ...fact }));
}

export function compareTruthReview(input: {
  review: TruthReview;
  context: NarrativeTruthContext;
}): TruthComparison {
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
    if (assertion.explicitness !== "EXPLICIT") {
      shadow.push({
        reason: "ASSERTION_AMBIGUOUS",
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
    if (assessment.classification === "AMBIGUOUS") {
      shadow.push({
        reason: "ORIGIN_ACTION_AMBIGUOUS",
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
    const catalogMatch = findCatalogSurfaceMatch(
      input.context.catalog,
      mention.surfaceName,
    );
    if (catalogMatch) {
      shadow.push({
        reason: "ENTITY_CANDIDATE_ALREADY_CATALOGED",
        exactQuote: mention.exactQuote,
      });
    } else if (
      mention.durableImpact
      && mention.introductionMode !== "AMBIGUOUS"
    ) {
      conflicts.push({
        code: "UNKNOWN_DURABLE_ENTITY",
        exactQuote: mention.exactQuote,
      });
    } else {
      shadow.push({
        reason: !mention.durableImpact
          ? "UNKNOWN_MENTION_TEXTURE"
          : "UNKNOWN_ENTITY_AMBIGUOUS",
        exactQuote: mention.exactQuote,
      });
    }
  }
  for (const issue of input.review.entityCandidateIssues) {
    shadow.push({
      reason: `ENTITY_CANDIDATE_INVALID:${issue.reason}`,
      exactQuote: issue.exactQuote,
    });
  }
  for (const assessment of input.review.storyFactAssessments) {
    if (assessment.classification === "UNSUPPORTED_DURABLE_SHADOW") {
      shadow.push({
        reason: "UNSUPPORTED_DURABLE_SHADOW",
        exactQuote: assessment.exactQuote,
      });
    }
  }
  for (const assessment of input.review.storyFactAssessments) {
    if (assessment.classification !== "AMBIGUOUS_DURABILITY") continue;
    shadow.push({
      reason: "STORY_FACT_DURABILITY_AMBIGUOUS",
      exactQuote: assessment.exactQuote,
    });
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
    storyFactAssessments: [],
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
    entityCandidateIssues: [],
    factClaims: [],
    parseStatus: "INVALID",
    invalidReason: invalidReason.slice(0, 500),
  };
}

function extractCandidateQuote(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const quote = (input as Record<string, unknown>).exactQuote;
  return typeof quote === "string" ? quote.slice(0, 500) : "";
}

function findCatalogSurfaceMatch(
  catalog: TruthEntityCatalogItem[],
  surfaceName: string,
) {
  const target = normalizeEntitySurface(surfaceName);
  if (!target) return undefined;
  return catalog.find((item) => (
    [item.displayName, ...(item.aliases || [])]
      .some((name) => normalizeEntitySurface(name) === target)
  ));
}

function normalizeEntitySurface(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s"'“”‘’《》〈〉「」『』【】()\[\]{}.,，。:：;；!?！？—–-]+/gu, "");
}

export function buildTruthReviewUnits(draft: string): TruthReviewUnit[] {
  const paragraphs: Array<{ quoteStart: number; quoteEnd: number; text: string }> = [];
  const text = String(draft || "");
  const pattern = /\S(?:[\s\S]*?\S)?(?=\r?\n[ \t]*\r?\n|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const quoteStart = match.index;
    const value = match[0];
    paragraphs.push({
      quoteStart,
      quoteEnd: quoteStart + value.length,
      text: value,
    });
  }
  if (!paragraphs.length && text.trim()) {
    const quoteStart = text.indexOf(text.trim());
    paragraphs.push({
      quoteStart,
      quoteEnd: quoteStart + text.trim().length,
      text: text.trim(),
    });
  }
  const units: TruthReviewUnit[] = [];
  for (const paragraph of paragraphs) {
    const current = units.at(-1);
    const combinedLength = current
      ? paragraph.quoteEnd - current.quoteStart
      : paragraph.text.length;
    if (current && combinedLength <= 700) {
      current.quoteEnd = paragraph.quoteEnd;
      current.text = text.slice(current.quoteStart, current.quoteEnd);
      continue;
    }
    units.push({
      unitId: `U${String(units.length + 1).padStart(3, "0")}`,
      ...paragraph,
    });
  }
  return units;
}

/**
 * Produce complete, stable semantic coverage units without interpreting story
 * vocabulary. Sentence punctuation and explicit semicolons are durable
 * boundaries. Ordinary commas stay inside the sentence: splitting every comma
 * in literary Chinese turns a short scene into dozens of JSON assessments and
 * can truncate the Reviewer before it reaches the release decision.
 *
 * Latin-script coordinating clauses keep one structural exception because a
 * comma followed by and/but/or/yet/while/whereas/so commonly joins two complete
 * factual assertions. This remains language-structural, not story-specific.
 */
export function buildStoryFactReviewUnits(draft: string): TruthReviewUnit[] {
  const text = String(draft || "");
  const units: TruthReviewUnit[] = [];
  const boundary = /[；;。！？!?\r\n]+|,\s+(?=(?:and|but|or|yet|while|whereas|so)\b)/giu;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const end = (match.index || 0) + match[0].length;
    appendStoryFactUnit(text, start, end, units);
    start = end;
  }
  appendStoryFactUnit(text, start, text.length, units);
  return units;
}

function appendStoryFactUnit(
  draft: string,
  rawStart: number,
  rawEnd: number,
  units: TruthReviewUnit[],
) {
  const raw = draft.slice(rawStart, rawEnd);
  const leading = raw.match(/^[\s"'“”‘’]+/u)?.[0].length || 0;
  const trailing = raw.match(/[\s"'“”‘’]+$/u)?.[0].length || 0;
  const quoteStart = rawStart + leading;
  const quoteEnd = Math.max(quoteStart, rawEnd - trailing);
  const text = draft.slice(quoteStart, quoteEnd);
  if (!text.trim()) return;
  units.push({
    unitId: `F${String(units.length + 1).padStart(3, "0")}`,
    quoteStart,
    quoteEnd,
    text,
  });
}


function normalizeReviewPredicate(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  if (!record.constraints || typeof record.constraints !== "object" || Array.isArray(record.constraints)) {
    return input;
  }
  return { type: record.type, ...(record.constraints as Record<string, unknown>) };
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
