import { createHash } from "node:crypto";
import templatesPackage from "@ai-story/templates";
import type { DurablePredicate } from "@ai-story/templates";
import type { ModelMessage } from "./types.js";
import type { NarrativeTruthContext } from "./truth-review.js";

const { predicateFields, predicateMatchesPattern } = templatesPackage;

export const TRUTH_OBSERVATION_SCHEMA = "omw.truth-assertions.v2" as const;
export const TRUTH_OBSERVATION_MAX_TOKENS = 1_600 as const;
export const SHADOW_CLAIM_SCHEMA = "omw.shadow-claim.v2" as const;

const CLAIM_MODES = [
  "ASSERTED", "NEGATED", "PROPOSED", "CONDITIONAL", "QUESTIONED", "UNCERTAIN",
] as const;
const EXPLICITNESS = ["EXPLICIT", "AMBIGUOUS"] as const;
const UNKNOWN_ENTITY_KINDS = [
  "ACTOR", "DOCUMENT", "EVIDENCE", "FORMAL_ORDER",
] as const;
const MAX_REVIEW_UNITS = 8;
const HIGH_CONFIDENCE = 0.85;

export type ObservationReviewUnit = {
  unitId: string;
  quoteStart: number;
  quoteEnd: number;
  text: string;
};

export type P0ReviewCategory =
  | "causalIntroduction"
  | "keyEntityState"
  | "secretLeak"
  | "playerAction";

export type TruthAssertionObservation = {
  unitId: string;
  quoteStart: number;
  quoteEnd: number;
  exactQuote: string;
  predicate: DurablePredicate;
  claimMode: typeof CLAIM_MODES[number];
  explicitness: typeof EXPLICITNESS[number];
  confidence: number;
};

export type UnknownEntityObservation = {
  unitId: string;
  quoteStart: number;
  quoteEnd: number;
  exactQuote: string;
  surfaceName: string;
  entityKind: typeof UNKNOWN_ENTITY_KINDS[number];
  durableImpact: boolean;
  explicitness: typeof EXPLICITNESS[number];
  confidence: number;
};

export type TruthObservationReview = {
  schemaVersion: typeof TRUTH_OBSERVATION_SCHEMA;
  reviewId: string;
  draftId: string;
  runId: string;
  worldRevision: number;
  textHash: string;
  catalogHash: string;
  reviewerModel: string;
  reviewUnits: ObservationReviewUnit[];
  assertions: TruthAssertionObservation[];
  unknownEntityMentions: UnknownEntityObservation[];
  parseIssues: Array<{ reason: string; exactQuote: string }>;
  parseStatus: "VALID" | "REPAIRED" | "INVALID";
  invalidReason?: string;
};

export type ObservationConflict = {
  code:
    | "UNAUTHORIZED_CAUSAL_INTRODUCTION"
    | "UNAUTHORIZED_KEY_ENTITY_STATE"
    | "SECRET_LEAK"
    | "UNAUTHORIZED_PLAYER_ACTION";
  category: P0ReviewCategory;
  exactQuote: string;
  evidenceQuote: string;
  quoteStart: number;
  quoteEnd: number;
  unitId: string;
  predicate?: DurablePredicate;
  unknownSurface?: string;
};

export type ObservationShadow = {
  reason: string;
  exactQuote: string;
  quoteStart: number;
  quoteEnd: number;
  unitId: string;
  kind: P0ReviewCategory | "REVIEW_UNAVAILABLE";
};

export type ObservationComparison = {
  conflicts: ObservationConflict[];
  shadow: ObservationShadow[];
};

export type StructuredShadowClaim = {
  schemaVersion: typeof SHADOW_CLAIM_SCHEMA;
  shadowClaimId: string;
  artifactId: string;
  runId: string;
  worldRevision: number;
  unitId: string;
  quoteStart: number;
  quoteEnd: number;
  exactQuote: string;
  kind: ObservationShadow["kind"];
  reason: string;
  status: "UNVERIFIED";
  scope: "TURN_LOCAL" | "RECENT_SURFACE";
  stateWriteAllowed: false;
  durableMemoryWriteAllowed: false;
  optionsPremiseAllowed: false;
  storykeeperFactWriteAllowed: false;
  narratorContinuityPolicy: "NON_AUTHORITATIVE_ONLY";
  promotionPolicy: "SETTLEMENT_ONLY";
};

export type ObservationReviewBinding = {
  runId: string;
  worldRevision: number;
  draftId: string;
  reviewId: string;
};

export function truthTextHash(text: string) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

export function buildObservationReviewUnits(draft: string): ObservationReviewUnit[] {
  const text = String(draft || "");
  const segments: ObservationReviewUnit[] = [];
  const boundary = /[^\u3002\uFF01\uFF1F.!?;\uFF1B\r\n]+[\u3002\uFF01\uFF1F.!?;\uFF1B]?|[^\r\n]+/gu;
  for (const match of text.matchAll(boundary)) {
    appendUnit(text, match.index || 0, (match.index || 0) + match[0].length, segments);
  }
  if (!segments.length && text.trim()) appendUnit(text, 0, text.length, segments);
  if (segments.length <= MAX_REVIEW_UNITS) return renumberUnits(segments);
  const merged: ObservationReviewUnit[] = [];
  for (let index = 0; index < MAX_REVIEW_UNITS; index += 1) {
    const startIndex = Math.floor(index * segments.length / MAX_REVIEW_UNITS);
    const endIndex = Math.floor((index + 1) * segments.length / MAX_REVIEW_UNITS) - 1;
    const first = segments[startIndex];
    const last = segments[Math.max(startIndex, endIndex)];
    if (!first || !last) continue;
    merged.push({
      unitId: "",
      quoteStart: first.quoteStart,
      quoteEnd: last.quoteEnd,
      text: text.slice(first.quoteStart, last.quoteEnd),
    });
  }
  return renumberUnits(merged);
}

export function buildTruthObservationMessages(input: {
  draft: string;
  binding: ObservationReviewBinding;
  context: NarrativeTruthContext;
}): ModelMessage[] {
  const contract = {
    schemaVersion: TRUTH_OBSERVATION_SCHEMA,
    ...input.binding,
    textHash: truthTextHash(input.draft),
    catalogHash: reviewCatalogHash(input.context),
    reviewUnits: buildObservationReviewUnits(input.draft),
    originActorId: input.context.originActorId,
    projectionActorId: input.context.projectionActorId,
    catalog: reviewCatalog(input.context),
    capabilityIds: input.context.capabilityIds,
    secretIds: input.context.secretIds,
    predicateShapes: predicateFields,
    establishedPredicates: input.context.establishedPredicates || [],
    allowedPredicates: input.context.allowedPredicates,
    forbiddenPredicates: input.context.forbiddenPredicates,
    originActionsInDraft: input.context.originActionsInDraft,
    forbiddenStoryClaims: input.context.forbiddenStoryClaims || [],
  };
  return [
    {
      role: "system",
      content: [
        "You are a bounded semantic extractor. You never decide whether prose passes or conflicts.",
        "Extract only explicit durable assertions. The server compares them with Settlement.",
        "Durable assertions cover introduction, location, custody, entity state, document or evidence state, secret knowledge, formal commitments and issued orders.",
        "Posture, gaze, speech manner, footsteps, light, furniture, weather and incidental objects are narrative texture and produce no assertion.",
        "Use ENTITY.STATE for a known entity durable attribute. Reuse exact attribute names and values visible in established, allowed or forbidden predicates.",
        "Use ACTOR.ORDERED or ACTOR.COMMITTED only when that actor performs the consequential action in this continuation. Questions, proposals, expectations and recollections are not performed actions.",
        "Use only supplied entity, actor, secret and capability IDs. Never invent an ID.",
        "An explicit new critical actor, formal document, key evidence or formal order without an ID belongs in unknownEntityMentions.",
        "Copy one exact contiguous quote from one reviewUnit for every item.",
        "ASSERTED means completed or presently true. Preserve negation, proposal, condition, question and uncertainty in claimMode.",
        "EXPLICIT means the quote directly states the predicate. Otherwise use AMBIGUOUS or omit it.",
        "Return empty arrays when nothing durable is asserted.",
        "Return strict raw JSON with exactly schemaVersion, reviewId, draftId, runId, worldRevision, textHash, catalogHash, assertions and unknownEntityMentions.",
      ].join("\n"),
    },
    {
      role: "user",
      content: "# Truth Extraction Contract\n" + JSON.stringify(contract),
    },
  ];
}

export function buildTruthObservationOutputSchema(input: {
  binding: ObservationReviewBinding;
  textHash: string;
  context: NarrativeTruthContext;
}) {
  const assertion = {
    type: "object",
    additionalProperties: false,
    required: ["unitId", "exactQuote", "predicate", "claimMode", "explicitness", "confidence"],
    properties: {
      unitId: { type: "string" },
      exactQuote: { type: "string" },
      predicate: { type: "object", required: ["type"], additionalProperties: true },
      claimMode: { enum: CLAIM_MODES },
      explicitness: { enum: EXPLICITNESS },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  };
  const unknown = {
    type: "object",
    additionalProperties: false,
    required: [
      "unitId", "exactQuote", "surfaceName", "entityKind",
      "durableImpact", "explicitness", "confidence",
    ],
    properties: {
      unitId: { type: "string" },
      exactQuote: { type: "string" },
      surfaceName: { type: "string" },
      entityKind: { enum: UNKNOWN_ENTITY_KINDS },
      durableImpact: { type: "boolean" },
      explicitness: { enum: EXPLICITNESS },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "reviewId", "draftId", "runId", "worldRevision",
      "textHash", "catalogHash", "assertions", "unknownEntityMentions",
    ],
    properties: {
      schemaVersion: { const: TRUTH_OBSERVATION_SCHEMA },
      reviewId: { const: input.binding.reviewId },
      draftId: { const: input.binding.draftId },
      runId: { const: input.binding.runId },
      worldRevision: { const: input.binding.worldRevision },
      textHash: { const: input.textHash },
      catalogHash: { const: reviewCatalogHash(input.context) },
      assertions: { type: "array", maxItems: 16, items: assertion },
      unknownEntityMentions: { type: "array", maxItems: 8, items: unknown },
    },
  };
}

export function parseTruthObservationReview(input: {
  raw: string;
  draft: string;
  binding: ObservationReviewBinding;
  reviewerModel: string;
  context: NarrativeTruthContext;
}): TruthObservationReview {
  const units = buildObservationReviewUnits(input.draft);
  const invalid = (reason: string): TruthObservationReview => ({
    schemaVersion: TRUTH_OBSERVATION_SCHEMA,
    ...input.binding,
    textHash: truthTextHash(input.draft),
    catalogHash: reviewCatalogHash(input.context),
    reviewerModel: input.reviewerModel,
    reviewUnits: units,
    assertions: [],
    unknownEntityMentions: [],
    parseIssues: [],
    parseStatus: "INVALID",
    invalidReason: reason.slice(0, 500),
  });
  try {
    const value = exactObject(JSON.parse(strictJsonPayload(input.raw)), [
      "schemaVersion", "reviewId", "draftId", "runId", "worldRevision",
      "textHash", "catalogHash", "assertions", "unknownEntityMentions",
    ], "REVIEW");
    validateBinding(value, input);
    if (!Array.isArray(value.assertions)) throw new Error("ASSERTIONS_NOT_ARRAY");
    if (!Array.isArray(value.unknownEntityMentions)) {
      throw new Error("UNKNOWN_MENTIONS_NOT_ARRAY");
    }
    const unitById = new Map(units.map((unit) => [unit.unitId, unit]));
    const parseIssues: TruthObservationReview["parseIssues"] = [];
    const assertions = value.assertions.flatMap((raw, index) => {
      try {
        return [parseAssertion(raw, index, input, unitById)];
      } catch (error) {
        parseIssues.push({
          reason: String((error as Error).message || error).slice(0, 300),
          exactQuote: candidateQuote(raw),
        });
        return [];
      }
    });
    const unknownEntityMentions = value.unknownEntityMentions.flatMap((raw, index) => {
      try {
        return [parseUnknownMention(raw, index, input, unitById)];
      } catch (error) {
        parseIssues.push({
          reason: String((error as Error).message || error).slice(0, 300),
          exactQuote: candidateQuote(raw),
        });
        return [];
      }
    });
    return {
      schemaVersion: TRUTH_OBSERVATION_SCHEMA,
      ...input.binding,
      textHash: truthTextHash(input.draft),
      catalogHash: reviewCatalogHash(input.context),
      reviewerModel: input.reviewerModel,
      reviewUnits: units,
      assertions,
      unknownEntityMentions,
      parseIssues,
      parseStatus: parseIssues.length ? "REPAIRED" : "VALID",
    };
  } catch (error) {
    return invalid(String((error as Error).message || error));
  }
}

export function compareTruthObservations(input: {
  review: TruthObservationReview;
  context: NarrativeTruthContext;
}): ObservationComparison {
  if (input.review.parseStatus === "INVALID") return { conflicts: [], shadow: [] };
  const conflicts: ObservationConflict[] = [];
  const shadow: ObservationShadow[] = [];
  for (const issue of input.review.parseIssues) {
    const bound = bindIssue(input.review.reviewUnits, issue.exactQuote);
    if (!bound) continue;
    shadow.push({
      reason: "REVIEW_ITEM_INVALID:" + issue.reason,
      ...bound,
      kind: "causalIntroduction",
    });
  }
  for (const assertion of input.review.assertions) {
    const category = categoryFor(assertion.predicate, input.context);
    if (
      assertion.explicitness !== "EXPLICIT"
      || assertion.claimMode !== "ASSERTED"
      || assertion.confidence < HIGH_CONFIDENCE
    ) {
      shadow.push(shadowForAssertion(
        "ASSERTION_NOT_EXPLICIT_HIGH_CONFIDENCE",
        category,
        assertion,
      ));
      continue;
    }
    const forbidden = input.context.forbiddenPredicates.some((pattern) =>
      predicateMatchesPattern(assertion.predicate, pattern)
    );
    const established = (input.context.establishedPredicates || []).some((predicate) =>
      predicatesEqual(predicate, assertion.predicate)
    );
    const allowed = input.context.allowedPredicates.some((pattern) =>
      predicateMatchesPattern(assertion.predicate, pattern)
    );
    if (forbidden) {
      conflicts.push(conflictForAssertion(category, assertion));
      continue;
    }
    if (established || allowed) continue;
    if (category === "playerAction" && input.context.originActionsInDraft === "FORBIDDEN") {
      conflicts.push(conflictForAssertion(category, assertion));
      continue;
    }
    if (
      category === "secretLeak"
      || isInherentlyP0Predicate(assertion.predicate)
      || conflictsWithEstablishedAxis(
        assertion.predicate,
        input.context.establishedPredicates || [],
      )
    ) {
      conflicts.push(conflictForAssertion(category, assertion));
      continue;
    }
    shadow.push(shadowForAssertion("UNAUTHORIZED_NON_P0_ASSERTION", category, assertion));
  }
  for (const mention of input.review.unknownEntityMentions) {
    if (
      !mention.durableImpact
      || mention.explicitness !== "EXPLICIT"
      || mention.confidence < HIGH_CONFIDENCE
    ) {
      shadow.push({
        reason: "UNKNOWN_MENTION_NOT_EXPLICIT_DURABLE",
        exactQuote: mention.exactQuote,
        quoteStart: mention.quoteStart,
        quoteEnd: mention.quoteEnd,
        unitId: mention.unitId,
        kind: "causalIntroduction",
      });
      continue;
    }
    // A surface mention is not, by itself, a durable causal assertion. Generic
    // attendants, paper, furniture and local colour may appear in prose without
    // becoming world state. Since an unknown mention has no server-verifiable
    // predicate identity, it remains Shadow and cannot be promoted into Canon,
    // Options or Storykeeper memory. Durable actions involving a new entity must
    // also be extracted as a typed predicate before they can become a hard P0.
    shadow.push({
      reason: "UNKNOWN_MENTION_HAS_NO_VERIFIABLE_PREDICATE",
      exactQuote: mention.exactQuote,
      quoteStart: mention.quoteStart,
      quoteEnd: mention.quoteEnd,
      unitId: mention.unitId,
      kind: "causalIntroduction",
    });
  }
  return { conflicts: uniqueConflicts(conflicts), shadow: uniqueShadow(shadow) };
}

export function materializeShadowClaims(input: {
  artifactId: string;
  runId: string;
  worldRevision: number;
  shadow: ObservationShadow[];
}): StructuredShadowClaim[] {
  return input.shadow.map((item, index) => ({
    schemaVersion: SHADOW_CLAIM_SCHEMA,
    shadowClaimId: input.artifactId + ".shadow." + String(index + 1).padStart(3, "0"),
    artifactId: input.artifactId,
    runId: input.runId,
    worldRevision: input.worldRevision,
    unitId: item.unitId,
    quoteStart: item.quoteStart,
    quoteEnd: item.quoteEnd,
    exactQuote: item.exactQuote,
    kind: item.kind,
    reason: item.reason,
    status: "UNVERIFIED",
    scope: "RECENT_SURFACE",
    stateWriteAllowed: false,
    durableMemoryWriteAllowed: false,
    optionsPremiseAllowed: false,
    storykeeperFactWriteAllowed: false,
    narratorContinuityPolicy: "NON_AUTHORITATIVE_ONLY",
    promotionPolicy: "SETTLEMENT_ONLY",
  }));
}

export function quarantineWholeDraft(input: {
  artifactId: string;
  runId: string;
  worldRevision: number;
  draft: string;
  reason: string;
}): StructuredShadowClaim[] {
  if (!input.draft) return [];
  return materializeShadowClaims({
    artifactId: input.artifactId,
    runId: input.runId,
    worldRevision: input.worldRevision,
    shadow: [{
      reason: input.reason,
      exactQuote: input.draft,
      quoteStart: 0,
      quoteEnd: input.draft.length,
      unitId: "WHOLE_DRAFT",
      kind: "REVIEW_UNAVAILABLE",
    }],
  }).map((claim) => ({ ...claim, scope: "TURN_LOCAL" as const }));
}

export function projectShadowFreeText(draft: string, claims: StructuredShadowClaim[]) {
  return projectShadowRanges(
    draft,
    claims,
    () => "[Unverified narrative detail omitted from fact projection.]",
  );
}

export function projectShadowContinuityText(
  draft: string,
  claims: StructuredShadowClaim[],
) {
  return projectShadowRanges(
    draft,
    claims,
    (claim) => claim.exactQuote + "[Surface continuity only; not an authoritative fact.]",
  );
}

function projectShadowRanges(
  draft: string,
  claims: StructuredShadowClaim[],
  replacement: (claim: StructuredShadowClaim) => string,
) {
  const relevant = claims.filter((claim) => (
    claim.quoteStart >= 0
    && claim.quoteEnd <= draft.length
    && draft.slice(claim.quoteStart, claim.quoteEnd) === claim.exactQuote
  )).sort((left, right) => right.quoteStart - left.quoteStart);
  let projected = draft;
  let previousStart = draft.length + 1;
  for (const claim of relevant) {
    if (claim.quoteEnd > previousStart) continue;
    projected = projected.slice(0, claim.quoteStart)
      + replacement(claim)
      + projected.slice(claim.quoteEnd);
    previousStart = claim.quoteStart;
  }
  return projected;
}

function parseAssertion(
  raw: unknown,
  index: number,
  input: { draft: string; context: NarrativeTruthContext },
  unitById: Map<string, ObservationReviewUnit>,
): TruthAssertionObservation {
  const value = exactObject(raw, [
    "unitId", "exactQuote", "predicate", "claimMode", "explicitness", "confidence",
  ], "ASSERTION_" + index);
  const bound = bindQuote(
    input.draft,
    unitById,
    value.unitId,
    value.exactQuote,
    "ASSERTION_" + index,
  );
  return {
    ...bound,
    predicate: validateReviewPredicate(value.predicate, input.context),
    claimMode: enumValue(value.claimMode, CLAIM_MODES, "ASSERTION_CLAIM_MODE"),
    explicitness: enumValue(value.explicitness, EXPLICITNESS, "ASSERTION_EXPLICITNESS"),
    confidence: confidenceValue(value.confidence, "ASSERTION_CONFIDENCE"),
  };
}

function parseUnknownMention(
  raw: unknown,
  index: number,
  input: { draft: string },
  unitById: Map<string, ObservationReviewUnit>,
): UnknownEntityObservation {
  const value = exactObject(raw, [
    "unitId", "exactQuote", "surfaceName", "entityKind",
    "durableImpact", "explicitness", "confidence",
  ], "UNKNOWN_" + index);
  const bound = bindQuote(
    input.draft,
    unitById,
    value.unitId,
    value.exactQuote,
    "UNKNOWN_" + index,
  );
  const surfaceName = stringValue(value.surfaceName, "UNKNOWN_SURFACE");
  if (!bound.exactQuote.includes(surfaceName)) throw new Error("UNKNOWN_SURFACE_OUTSIDE_QUOTE");
  if (typeof value.durableImpact !== "boolean") throw new Error("UNKNOWN_DURABLE_INVALID");
  return {
    ...bound,
    surfaceName,
    entityKind: enumValue(value.entityKind, UNKNOWN_ENTITY_KINDS, "UNKNOWN_KIND"),
    durableImpact: value.durableImpact,
    explicitness: enumValue(value.explicitness, EXPLICITNESS, "UNKNOWN_EXPLICITNESS"),
    confidence: confidenceValue(value.confidence, "UNKNOWN_CONFIDENCE"),
  };
}

function validateReviewPredicate(input: unknown, context: NarrativeTruthContext): DurablePredicate {
  const value = exactObject(input, undefined, "PREDICATE");
  if (typeof value.type !== "string" || !(value.type in predicateFields)) {
    throw new Error("PREDICATE_TYPE_INVALID:" + String(value.type));
  }
  const fields = predicateFields[value.type as DurablePredicate["type"]];
  const exact = exactObject(value, ["type", ...fields], "PREDICATE");
  const catalog = new Set(context.catalog.map((item) => item.id));
  const actorIds = new Set(
    context.catalog.filter((item) => item.kind === "ACTOR").map((item) => item.id),
  );
  for (const field of fields) {
    const fieldValue = exact[field];
    if (field === "delta") {
      if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
        throw new Error("PREDICATE_DELTA_INVALID");
      }
      continue;
    }
    if (value.type === "ENTITY.STATE" && field === "attribute") {
      if (typeof fieldValue !== "string" || !/^[a-z][A-Za-z0-9_]*$/u.test(fieldValue)) {
        throw new Error("PREDICATE_ATTRIBUTE_INVALID");
      }
      continue;
    }
    if (value.type === "ENTITY.STATE" && field === "value") {
      if (!isStableScalar(fieldValue)) throw new Error("PREDICATE_STATE_VALUE_INVALID");
      continue;
    }
    const id = stringValue(fieldValue, "PREDICATE_" + field);
    if (/^(?:actorId|fromActorId|toActorId)$/u.test(field) && !actorIds.has(id)) {
      throw new Error("PREDICATE_ACTOR_UNKNOWN:" + id);
    }
    if (field === "capabilityId" && !context.capabilityIds.includes(id)) {
      throw new Error("PREDICATE_CAPABILITY_UNKNOWN:" + id);
    }
    if (field === "secretId" && !context.secretIds.includes(id)) {
      throw new Error("PREDICATE_SECRET_UNKNOWN:" + id);
    }
    if (
      /^(?:entityId|locationId|documentId|evidenceId|resourceId|audienceId)$/u.test(field)
      && !catalog.has(id)
    ) throw new Error("PREDICATE_ENTITY_UNKNOWN:" + id);
  }
  return exact as unknown as DurablePredicate;
}

function categoryFor(
  predicate: DurablePredicate,
  context: NarrativeTruthContext,
): P0ReviewCategory {
  if (
    (predicate.type === "ACTOR.ORDERED" || predicate.type === "ACTOR.COMMITTED")
    && predicate.actorId === context.originActorId
  ) return "playerAction";
  if (predicate.type === "KNOWLEDGE.REVEALED_TO") return "secretLeak";
  if ([
    "ENTITY.LOCATED_AT", "ENTITY.HELD_BY", "ENTITY.STATE",
    "DOCUMENT.AUTHENTICATED", "DOCUMENT.TRANSFERRED",
    "DOCUMENT.PUBLISHED", "EVIDENCE.DESTROYED",
  ].includes(predicate.type)) return "keyEntityState";
  return "causalIntroduction";
}

function conflictForAssertion(
  category: P0ReviewCategory,
  assertion: TruthAssertionObservation,
): ObservationConflict {
  const code = category === "playerAction"
    ? "UNAUTHORIZED_PLAYER_ACTION"
    : category === "secretLeak"
      ? "SECRET_LEAK"
      : category === "keyEntityState"
        ? "UNAUTHORIZED_KEY_ENTITY_STATE"
        : "UNAUTHORIZED_CAUSAL_INTRODUCTION";
  return {
    code,
    category,
    exactQuote: assertion.exactQuote,
    evidenceQuote: assertion.exactQuote,
    quoteStart: assertion.quoteStart,
    quoteEnd: assertion.quoteEnd,
    unitId: assertion.unitId,
    predicate: assertion.predicate,
  };
}

function shadowForAssertion(
  reason: string,
  category: P0ReviewCategory,
  assertion: TruthAssertionObservation,
): ObservationShadow {
  return {
    reason,
    exactQuote: assertion.exactQuote,
    quoteStart: assertion.quoteStart,
    quoteEnd: assertion.quoteEnd,
    unitId: assertion.unitId,
    kind: category,
  };
}

function isInherentlyP0Predicate(predicate: DurablePredicate) {
  return [
    "ENTITY.INTRODUCED",
    "DOCUMENT.CREATED", "DOCUMENT.AUTHENTICATED", "DOCUMENT.TRANSFERRED",
    "DOCUMENT.PUBLISHED", "EVIDENCE.DESTROYED", "KNOWLEDGE.REVEALED_TO",
  ].includes(predicate.type);
}

function conflictsWithEstablishedAxis(
  candidate: DurablePredicate,
  established: DurablePredicate[],
) {
  return established.some((known) => {
    if (candidate.type !== known.type || predicatesEqual(candidate, known)) return false;
    if (candidate.type === "ENTITY.STATE" && known.type === "ENTITY.STATE") {
      return candidate.entityId === known.entityId
        && candidate.attribute === known.attribute;
    }
    if (candidate.type === "ENTITY.LOCATED_AT" && known.type === "ENTITY.LOCATED_AT") {
      return candidate.entityId === known.entityId;
    }
    if (candidate.type === "ENTITY.HELD_BY" && known.type === "ENTITY.HELD_BY") {
      return candidate.entityId === known.entityId;
    }
    return false;
  });
}

function predicatesEqual(left: DurablePredicate, right: DurablePredicate) {
  return JSON.stringify(sortRecord(left as unknown as Record<string, unknown>))
    === JSON.stringify(sortRecord(right as unknown as Record<string, unknown>));
}

function sortRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function validateBinding(
  value: Record<string, unknown>,
  input: {
    draft: string;
    binding: ObservationReviewBinding;
    context: NarrativeTruthContext;
  },
) {
  if (value.schemaVersion !== TRUTH_OBSERVATION_SCHEMA) throw new Error("SCHEMA_VERSION_INVALID");
  if (value.reviewId !== input.binding.reviewId) throw new Error("REVIEW_ID_MISMATCH");
  if (value.draftId !== input.binding.draftId) throw new Error("DRAFT_ID_MISMATCH");
  if (value.runId !== input.binding.runId) throw new Error("RUN_ID_MISMATCH");
  if (value.worldRevision !== input.binding.worldRevision) throw new Error("WORLD_REVISION_MISMATCH");
  if (value.textHash !== truthTextHash(input.draft)) throw new Error("TEXT_HASH_MISMATCH");
  if (value.catalogHash !== reviewCatalogHash(input.context)) {
    throw new Error("CATALOG_HASH_MISMATCH");
  }
}

function bindQuote(
  draft: string,
  unitById: Map<string, ObservationReviewUnit>,
  rawUnitId: unknown,
  rawQuote: unknown,
  label: string,
) {
  const unitId = stringValue(rawUnitId, label + "_UNIT");
  const unit = unitById.get(unitId);
  if (!unit) throw new Error(label + "_UNIT_UNKNOWN:" + unitId);
  const exactQuote = stringValue(rawQuote, label + "_QUOTE");
  const relativeStart = unit.text.indexOf(exactQuote);
  if (
    relativeStart < 0
    || unit.text.indexOf(exactQuote, relativeStart + exactQuote.length) >= 0
  ) throw new Error(label + "_QUOTE_NOT_UNIQUE_IN_UNIT");
  const quoteStart = unit.quoteStart + relativeStart;
  const quoteEnd = quoteStart + exactQuote.length;
  if (draft.slice(quoteStart, quoteEnd) !== exactQuote) {
    throw new Error(label + "_QUOTE_BINDING_INVALID");
  }
  return { unitId, exactQuote, quoteStart, quoteEnd };
}

function bindIssue(units: ObservationReviewUnit[], quote: string) {
  if (!quote) return null;
  for (const unit of units) {
    const relativeStart = unit.text.indexOf(quote);
    if (
      relativeStart >= 0
      && unit.text.indexOf(quote, relativeStart + quote.length) < 0
    ) {
      const quoteStart = unit.quoteStart + relativeStart;
      return {
        exactQuote: quote,
        quoteStart,
        quoteEnd: quoteStart + quote.length,
        unitId: unit.unitId,
      };
    }
  }
  return null;
}

function reviewCatalog(context: NarrativeTruthContext) {
  return [...new Map(context.catalog.map((item) => [item.id, item])).values()];
}

export function reviewCatalogHash(context: NarrativeTruthContext) {
  return createHash("sha256")
    .update(JSON.stringify(reviewCatalog(context)), "utf8")
    .digest("hex");
}

function appendUnit(
  text: string,
  rawStart: number,
  rawEnd: number,
  target: ObservationReviewUnit[],
) {
  let quoteStart = rawStart;
  let quoteEnd = rawEnd;
  while (quoteStart < quoteEnd && /\s/u.test(text[quoteStart]!)) quoteStart += 1;
  while (quoteEnd > quoteStart && /\s/u.test(text[quoteEnd - 1]!)) quoteEnd -= 1;
  if (quoteEnd <= quoteStart) return;
  target.push({
    unitId: "",
    quoteStart,
    quoteEnd,
    text: text.slice(quoteStart, quoteEnd),
  });
}

function renumberUnits(units: ObservationReviewUnit[]) {
  return units.map((unit, index) => ({
    ...unit,
    unitId: "U" + String(index + 1).padStart(3, "0"),
  }));
}

function exactObject(
  input: unknown,
  fields: readonly string[] | undefined,
  label: string,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(label + "_NOT_OBJECT");
  }
  const value = input as Record<string, unknown>;
  if (fields) {
    const keys = Object.keys(value);
    const unknown = keys.find((key) => !fields.includes(key));
    const missing = fields.find((key) => !(key in value));
    if (unknown) throw new Error(label + "_UNKNOWN_FIELD:" + unknown);
    if (missing) throw new Error(label + "_MISSING_FIELD:" + missing);
  }
  return value;
}

function enumValue<T extends readonly string[]>(
  input: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof input !== "string" || !values.includes(input as T[number])) {
    throw new Error(label + "_INVALID");
  }
  return input as T[number];
}

function stringValue(input: unknown, label: string) {
  if (typeof input !== "string" || !input.trim()) throw new Error(label + "_INVALID");
  return input;
}

function confidenceValue(input: unknown, label: string) {
  if (
    typeof input !== "number"
    || !Number.isFinite(input)
    || input < 0
    || input > 1
  ) throw new Error(label + "_INVALID");
  return input;
}

function isStableScalar(value: unknown) {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function strictJsonPayload(raw: string) {
  return String(raw || "").trim().replace(
    /^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/iu,
    "$1",
  );
}

function candidateQuote(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const quote = (raw as Record<string, unknown>).exactQuote;
  return typeof quote === "string" ? quote.slice(0, 500) : "";
}

function uniqueConflicts(items: ObservationConflict[]) {
  return [...new Map(items.map((item) => [
    [
      item.code,
      item.quoteStart,
      item.quoteEnd,
      JSON.stringify(item.predicate || null),
    ].join(":"),
    item,
  ])).values()];
}

function uniqueShadow(items: ObservationShadow[]) {
  return [...new Map(items.map((item) => [
    [item.reason, item.quoteStart, item.quoteEnd].join(":"),
    item,
  ])).values()];
}
