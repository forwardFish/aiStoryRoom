import { createHash } from "node:crypto";
import {
  narrativeSlotIds,
  phaseForSlot,
  type BeatManifest,
  type NarrativeSlotId,
  type SceneDraft,
} from "./scene-expression.js";
import {
  buildObservationReviewUnits,
  compareTruthObservations,
  materializeShadowClaims,
  parseTruthObservationReview,
  reviewCatalogHash,
  truthTextHash,
  type StructuredShadowClaim,
} from "./truth-observation.js";
import type { NarrativeTruthContext } from "./truth-review.js";
import type { DurablePredicate } from "@ai-story/templates";
import type { ProviderRequest } from "./types.js";

export const SCENE_COVERAGE_REVIEW_SCHEMA = "omw.scene-coverage-review.v1" as const;
export const SCENE_P0_REVIEW_SCHEMA = "omw.scene-p0-review.v1" as const;
export const MAX_REVIEW_SLOT_CHARS = 1_800;
export const MAX_REVIEW_TOTAL_CHARS = 6_000;
export const MAX_REVIEW_CATALOG_ENTITIES = 12;
export const MAX_REVIEW_PREDICATES = 24;
const MAX_ID_CHARS = 64;

const coverageStatuses = [
  "NOT_REQUIRED", "COVERED_ONCE", "MISSING", "WRONG_SLOT", "DUPLICATED", "UNCERTAIN",
] as const;
const candidatePresence = ["NONE", "FOUND", "UNCERTAIN"] as const;
const claimModes = [
  "ASSERTED", "NEGATED", "PROPOSED", "CONDITIONAL", "QUESTIONED", "UNCERTAIN",
] as const;
const p0Categories = [
  "causalIntroduction", "keyEntityState", "secretLeak", "playerAction",
] as const;

type CoverageStatus = (typeof coverageStatuses)[number];
type P0Category = (typeof p0Categories)[number];
type CandidatePresence = (typeof candidatePresence)[number];
type ClaimMode = (typeof claimModes)[number];

export type SurfaceObligation = {
  obligationId: string;
  ownerSlot: NarrativeSlotId;
  sourceTicketIds: string[];
  reviewerMeaning: string;
  mustAppear: boolean;
  forbiddenInOtherSlots: true;
};

type EvidenceSpan = {
  slot: NarrativeSlotId;
  start: number;
  end: number;
};

type CoverageFinding = {
  obligationId: string | null;
  status: CoverageStatus;
  primarySpan: EvidenceSpan | null;
  duplicateSpan: EvidenceSpan | null;
};

export type SceneCoverageReview = {
  schemaVersion: typeof SCENE_COVERAGE_REVIEW_SCHEMA;
  draftHash: string;
  manifestHash: string;
  findings: Record<NarrativeSlotId, CoverageFinding>;
};

type P0Candidate = {
  presence: CandidatePresence;
  slot: NarrativeSlotId | null;
  start: number | null;
  end: number | null;
  claimMode: ClaimMode | null;
  explicitness: "EXPLICIT" | "AMBIGUOUS" | null;
  predicate: DurablePredicate | null;
  unknownEntity: {
    surfaceName: string;
    entityKind: "ACTOR" | "DOCUMENT" | "EVIDENCE" | "FORMAL_ORDER";
    durableImpact: boolean;
  } | null;
  confidence: number | null;
};

export type SceneP0Review = {
  schemaVersion: typeof SCENE_P0_REVIEW_SCHEMA;
  draftHash: string;
  catalogHash: string;
  candidates: Record<P0Category, P0Candidate>;
};

export type BoundedSceneReview = {
  coveredTicketIdsBySlot: Partial<Record<NarrativeSlotId, string[]>>;
  factText: string;
  shadowClaims: StructuredShadowClaim[];
  conflictCodes: string[];
  coverageWarnings: string[];
};

export const MAX_COVERAGE_RESPONSE_BYTES = Buffer.byteLength(
  JSON.stringify(maximalCoverageFixture()),
  "utf8",
);
export const MAX_P0_RESPONSE_BYTES = Buffer.byteLength(
  JSON.stringify(maximalP0Fixture()),
  "utf8",
);

export function preflightSceneReview(input: {
  draft: SceneDraft;
  manifest: BeatManifest;
  truthContexts: { actionPhase: NarrativeTruthContext; afterPhase: NarrativeTruthContext };
}) {
  const slotTexts = narrativeSlotIds
    .filter((slot) => input.draft.slots[slot])
    .map((slot) => input.draft.slots[slot]!);
  if (slotTexts.some((text) => text.length > MAX_REVIEW_SLOT_CHARS)
    || slotTexts.reduce((sum, text) => sum + text.length, 0) > MAX_REVIEW_TOTAL_CHARS) {
    throw new Error("REVIEW_SCOPE_TEXT_OVERFLOW");
  }
  for (const context of Object.values(input.truthContexts)) validateTruthScope(context);
  return compileSurfaceObligations(input.manifest);
}

export function buildCoverageReviewRequest(input: {
  draft: SceneDraft;
  manifest: BeatManifest;
  obligations: SurfaceObligation[];
}): ProviderRequest {
  const contract = {
    schemaVersion: SCENE_COVERAGE_REVIEW_SCHEMA,
    draftHash: draftHash(input.draft),
    manifestHash: manifestHash(input.manifest),
    slots: Object.fromEntries(narrativeSlotIds.map((slot) => [slot, input.draft.slots[slot] || null])),
    obligations: Object.fromEntries(input.obligations.map((item) => [item.ownerSlot, item])),
  };
  return {
    profile: "reviewer",
    messages: [
      {
        role: "system",
        content: [
          "You are a bounded coverage extractor. The server decides acceptance.",
          "Return exactly five findings, one for each supplied slot ID.",
          "Use character offsets into the supplied slot text. Do not return quotes or explanations.",
          "COVERED_ONCE means the obligation meaning appears once in its owner slot and nowhere else.",
          "NOT_REQUIRED is allowed only when the obligation is absent or mustAppear is false.",
          "Return strict raw JSON with exactly schemaVersion, draftHash, manifestHash and findings.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(contract) },
    ],
    temperature: 0,
    maxTokens: MAX_COVERAGE_RESPONSE_BYTES,
    json: false,
    stream: false,
  };
}

export function buildP0ReviewRequest(input: {
  draft: SceneDraft;
  truthContexts: { actionPhase: NarrativeTruthContext; afterPhase: NarrativeTruthContext };
}): ProviderRequest {
  const contract = {
    schemaVersion: SCENE_P0_REVIEW_SCHEMA,
    draftHash: draftHash(input.draft),
    catalogHash: combinedCatalogHash(input.truthContexts),
    slots: Object.fromEntries(narrativeSlotIds.map((slot) => [slot, {
      phase: phaseForSlot(slot),
      text: input.draft.slots[slot] || null,
      boundary: compactTruthBoundary(contextForSlot(slot, input.truthContexts)),
    }])),
  };
  return {
    profile: "reviewer",
    messages: [
      {
        role: "system",
        content: [
          "You are a bounded P0 risk candidate extractor. You never decide pass or conflict.",
          "Return exactly four candidates: causalIntroduction, keyEntityState, secretLeak and playerAction.",
          "Each category contains at most one strongest candidate. Return NONE when absent.",
          "Posture, gaze, footsteps, furniture, weather and incidental objects are ordinary narrative texture.",
          "Questions, proposals and conditions are not completed orders or commitments.",
          "Use only IDs and predicate shapes supplied in the boundary. Never invent IDs.",
          "Use character offsets into one slot. Do not return quotes, explanations, arrays or extra keys.",
          "The server reconstructs the quote and compares the candidate with Settlement.",
          "Return strict raw JSON with exactly schemaVersion, draftHash, catalogHash and candidates.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(contract) },
    ],
    temperature: 0,
    maxTokens: MAX_P0_RESPONSE_BYTES,
    json: false,
    stream: false,
  };
}

export function parseAndCompareBoundedReviews(input: {
  coverageRaw?: string;
  p0Raw: string;
  reviewerModel: string;
  runId: string;
  worldRevision: number;
  draft: SceneDraft;
  manifest: BeatManifest;
  obligations: SurfaceObligation[];
  truthContexts: { actionPhase: NarrativeTruthContext; afterPhase: NarrativeTruthContext };
}): BoundedSceneReview {
  let coverage: SceneCoverageReview | null = null;
  const coverageWarnings: string[] = [];
  if (input.coverageRaw) {
    try {
      coverage = parseCoverage(input.coverageRaw, input.draft, input.manifest, input.obligations);
    } catch (error) {
      coverageWarnings.push(`COVERAGE_REVIEW_INVALID:${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    coverageWarnings.push("COVERAGE_REVIEW_UNAVAILABLE");
  }
  const p0 = parseP0(input.p0Raw, input.draft, input.truthContexts);
  const coveredTicketIdsBySlot: BoundedSceneReview["coveredTicketIdsBySlot"] = {};
  const factLines: string[] = [];
  for (const obligation of input.obligations) {
    if (input.draft.slots[obligation.ownerSlot]) {
      coveredTicketIdsBySlot[obligation.ownerSlot] = [...obligation.sourceTicketIds];
    }
    if (obligation.mustAppear) factLines.push(obligation.reviewerMeaning);
    const finding = coverage?.findings[obligation.ownerSlot];
    if (!finding) continue;
    const acceptable = finding.status === "COVERED_ONCE"
      || (!obligation.mustAppear && finding.status === "NOT_REQUIRED");
    if (!acceptable) {
      coverageWarnings.push(`SCENE_COVERAGE_${finding.status}:${obligation.ownerSlot}`);
    }
  }
  const shadowClaims: StructuredShadowClaim[] = [];
  const conflictCodes: string[] = [];
  for (const category of p0Categories) {
    const candidate = p0.candidates[category];
    if (candidate.presence === "NONE") continue;
    if (candidate.presence === "UNCERTAIN") {
      throw new Error(`SCENE_P0_REVIEW_UNCERTAIN:${category}`);
    }
    const slot = candidate.slot!;
    const text = input.draft.slots[slot]!;
    const quote = text.slice(candidate.start!, candidate.end!);
    const context = contextForSlot(slot, input.truthContexts);
    const units = buildObservationReviewUnits(text);
    const unit = units.find((item) => (
      item.quoteStart <= candidate.start! && item.quoteEnd >= candidate.end!
    ));
    if (!unit) throw new Error(`SCENE_P0_SPAN_CROSSES_UNIT:${category}`);
    const binding = {
      runId: input.runId,
      worldRevision: input.worldRevision,
      draftId: `${input.draft.draftId}.${slot}.${category}`,
      reviewId: `${input.draft.draftId}.${slot}.${category}.review`,
    };
    const rawReview = {
      schemaVersion: "omw.truth-assertions.v2",
      ...binding,
      textHash: truthTextHash(text),
      catalogHash: reviewCatalogHash(context),
      assertions: candidate.predicate ? [{
        unitId: unit.unitId,
        exactQuote: quote,
        predicate: candidate.predicate,
        claimMode: candidate.claimMode,
        explicitness: candidate.explicitness,
        confidence: candidate.confidence,
      }] : [],
      unknownEntityMentions: candidate.unknownEntity ? [{
        unitId: unit.unitId,
        exactQuote: quote,
        ...candidate.unknownEntity,
        explicitness: candidate.explicitness,
        confidence: candidate.confidence,
      }] : [],
    };
    const review = parseTruthObservationReview({
      raw: JSON.stringify(rawReview),
      draft: text,
      binding,
      reviewerModel: input.reviewerModel,
      context,
    });
    if (review.parseStatus === "INVALID") {
      throw new Error(`SCENE_P0_CANDIDATE_INVALID:${category}:${review.invalidReason || "INVALID"}`);
    }
    const comparison = compareTruthObservations({ review, context });
    conflictCodes.push(...comparison.conflicts.map((item) => item.code));
    shadowClaims.push(...materializeShadowClaims({
      artifactId: binding.draftId,
      runId: input.runId,
      worldRevision: input.worldRevision,
      shadow: comparison.shadow,
    }));
  }
  return {
    coveredTicketIdsBySlot,
    factText: factLines.join("\n"),
    shadowClaims,
    conflictCodes: [...new Set(conflictCodes)],
    coverageWarnings,
  };
}

export function compileSurfaceObligations(manifest: BeatManifest): SurfaceObligation[] {
  return narrativeSlotIds.map((slot) => {
    const tickets = manifest.tickets.filter((ticket) => ticket.slot === slot);
    return {
      obligationId: `${manifest.beatId}.${slot}`,
      ownerSlot: slot,
      sourceTicketIds: tickets.map((ticket) => ticket.ticketId),
      reviewerMeaning: tickets.map((ticket) => ticket.requiredMeaning).join("\n"),
      mustAppear: tickets.some((ticket) => ticket.required),
      forbiddenInOtherSlots: true as const,
    };
  });
}

function parseCoverage(
  raw: string,
  draft: SceneDraft,
  manifest: BeatManifest,
  obligations: SurfaceObligation[],
): SceneCoverageReview {
  if (Buffer.byteLength(raw, "utf8") > MAX_COVERAGE_RESPONSE_BYTES) {
    throw new Error("SCENE_COVERAGE_REVIEW_OVERSIZED");
  }
  const value = exactObject(JSON.parse(stripFence(raw)), [
    "schemaVersion", "draftHash", "manifestHash", "findings",
  ], "COVERAGE");
  if (value.schemaVersion !== SCENE_COVERAGE_REVIEW_SCHEMA
    || value.draftHash !== draftHash(draft)
    || value.manifestHash !== manifestHash(manifest)) {
    throw new Error("SCENE_COVERAGE_BINDING_INVALID");
  }
  const findingsValue = exactObject(value.findings, [...narrativeSlotIds], "COVERAGE_FINDINGS");
  const findings = Object.fromEntries(narrativeSlotIds.map((slot) => {
    const finding = exactObject(findingsValue[slot], [
      "obligationId", "status", "primarySpan", "duplicateSpan",
    ], `COVERAGE_${slot}`);
    const obligation = obligations.find((item) => item.ownerSlot === slot)!;
    if (finding.obligationId !== obligation.obligationId) {
      throw new Error(`SCENE_COVERAGE_OBLIGATION_INVALID:${slot}`);
    }
    const status = enumValue(finding.status, coverageStatuses, `COVERAGE_STATUS_${slot}`);
    const primarySpan = parseSpan(finding.primarySpan, draft, `COVERAGE_PRIMARY_${slot}`);
    const duplicateSpan = parseSpan(finding.duplicateSpan, draft, `COVERAGE_DUPLICATE_${slot}`);
    if (status === "COVERED_ONCE"
      && (!primarySpan || primarySpan.slot !== slot || duplicateSpan)) {
      throw new Error(`SCENE_COVERAGE_SPAN_INVALID:${slot}`);
    }
    return [slot, { obligationId: obligation.obligationId, status, primarySpan, duplicateSpan }];
  })) as Record<NarrativeSlotId, CoverageFinding>;
  return {
    schemaVersion: SCENE_COVERAGE_REVIEW_SCHEMA,
    draftHash: String(value.draftHash),
    manifestHash: String(value.manifestHash),
    findings,
  };
}

function parseP0(
  raw: string,
  draft: SceneDraft,
  contexts: { actionPhase: NarrativeTruthContext; afterPhase: NarrativeTruthContext },
): SceneP0Review {
  if (Buffer.byteLength(raw, "utf8") > MAX_P0_RESPONSE_BYTES) {
    throw new Error("SCENE_P0_REVIEW_OVERSIZED");
  }
  const value = exactObject(JSON.parse(stripFence(raw)), [
    "schemaVersion", "draftHash", "catalogHash", "candidates",
  ], "P0");
  if (value.schemaVersion !== SCENE_P0_REVIEW_SCHEMA
    || value.draftHash !== draftHash(draft)
    || value.catalogHash !== combinedCatalogHash(contexts)) {
    throw new Error("SCENE_P0_BINDING_INVALID");
  }
  const candidatesValue = exactObject(value.candidates, [...p0Categories], "P0_CANDIDATES");
  const candidates = Object.fromEntries(p0Categories.map((category) => {
    const item = exactObject(candidatesValue[category], [
      "presence", "slot", "start", "end", "claimMode", "explicitness",
      "predicate", "unknownEntity", "confidence",
    ], `P0_${category}`);
    const presence = enumValue(item.presence, candidatePresence, `P0_PRESENCE_${category}`);
    if (presence === "NONE") {
      if ([item.slot, item.start, item.end, item.claimMode, item.explicitness,
        item.predicate, item.unknownEntity, item.confidence].some((candidate) => candidate !== null)) {
        throw new Error(`SCENE_P0_NONE_NOT_EMPTY:${category}`);
      }
      return [category, { presence, slot: null, start: null, end: null, claimMode: null,
        explicitness: null, predicate: null, unknownEntity: null, confidence: null }];
    }
    const slot = enumValue(item.slot, narrativeSlotIds, `P0_SLOT_${category}`);
    const span = parseSpan({ slot, start: item.start, end: item.end }, draft, `P0_SPAN_${category}`);
    if (!span) throw new Error(`SCENE_P0_SPAN_MISSING:${category}`);
    const claimMode = enumValue(item.claimMode, claimModes, `P0_MODE_${category}`);
    const explicitness = enumValue(item.explicitness, ["EXPLICIT", "AMBIGUOUS"] as const, `P0_EXPLICIT_${category}`);
    const confidence = numberValue(item.confidence, `P0_CONFIDENCE_${category}`);
    const predicate = item.predicate === null ? null : item.predicate as DurablePredicate;
    const unknownEntity = item.unknownEntity === null ? null : parseUnknownEntity(item.unknownEntity, category);
    if ((predicate === null) === (unknownEntity === null)) {
      throw new Error(`SCENE_P0_PAYLOAD_CARDINALITY:${category}`);
    }
    return [category, {
      presence, slot, start: span.start, end: span.end, claimMode, explicitness,
      predicate, unknownEntity, confidence,
    }];
  })) as Record<P0Category, P0Candidate>;
  return {
    schemaVersion: SCENE_P0_REVIEW_SCHEMA,
    draftHash: String(value.draftHash),
    catalogHash: String(value.catalogHash),
    candidates,
  };
}

function compactTruthBoundary(context: NarrativeTruthContext) {
  return {
    originActorId: context.originActorId,
    projectionActorId: context.projectionActorId,
    originActionsInDraft: context.originActionsInDraft,
    catalog: relevantCatalog(context),
    capabilityIds: context.capabilityIds,
    secretIds: context.secretIds,
    establishedPredicates: context.establishedPredicates || [],
    allowedPredicates: context.allowedPredicates,
    forbiddenPredicates: context.forbiddenPredicates,
  };
}

function validateTruthScope(context: NarrativeTruthContext) {
  if (relevantCatalog(context).length > MAX_REVIEW_CATALOG_ENTITIES) {
    throw new Error("REVIEW_SCOPE_CATALOG_OVERFLOW");
  }
  const predicateCount = (context.establishedPredicates || []).length
    + context.allowedPredicates.length + context.forbiddenPredicates.length;
  if (predicateCount > MAX_REVIEW_PREDICATES) throw new Error("REVIEW_SCOPE_PREDICATE_OVERFLOW");
  for (const id of [context.originActorId, context.projectionActorId,
    ...context.capabilityIds, ...context.secretIds]) assertBoundedId(id);
}

function relevantCatalog(context: NarrativeTruthContext) {
  const active = new Set([
    context.originActorId,
    context.projectionActorId,
    ...(context.activeSceneEntityIds || []),
    ...predicateIds(context.establishedPredicates || []),
    ...context.allowedPredicates.flatMap((item) => Object.values(item.constraints).filter(isString)),
    ...context.forbiddenPredicates.flatMap((item) => Object.values(item.constraints).filter(isString)),
  ]);
  const catalog = context.catalog.filter((item) => active.has(item.id));
  for (const item of catalog) assertBoundedId(item.id);
  return catalog;
}

function predicateIds(predicates: DurablePredicate[]) {
  return predicates.flatMap((predicate) => Object.entries(predicate)
    .filter(([key, value]) => key !== "type" && typeof value === "string")
    .map(([, value]) => value as string));
}

function parseSpan(value: unknown, draft: SceneDraft, label: string): EvidenceSpan | null {
  if (value === null) return null;
  const item = exactObject(value, ["slot", "start", "end"], label);
  const slot = enumValue(item.slot, narrativeSlotIds, `${label}_SLOT`);
  const text = draft.slots[slot];
  if (!text || !Number.isInteger(item.start) || !Number.isInteger(item.end)
    || Number(item.start) < 0 || Number(item.end) <= Number(item.start)
    || Number(item.end) > text.length) throw new Error(`${label}_RANGE_INVALID`);
  return { slot, start: Number(item.start), end: Number(item.end) };
}

function parseUnknownEntity(value: unknown, category: string) {
  const item = exactObject(value, ["surfaceName", "entityKind", "durableImpact"], `P0_UNKNOWN_${category}`);
  const surfaceName = stringValue(item.surfaceName, `P0_UNKNOWN_SURFACE_${category}`);
  const entityKind = enumValue(item.entityKind, [
    "ACTOR", "DOCUMENT", "EVIDENCE", "FORMAL_ORDER",
  ] as const, `P0_UNKNOWN_KIND_${category}`);
  if (typeof item.durableImpact !== "boolean") throw new Error(`P0_UNKNOWN_DURABLE_${category}`);
  return { surfaceName, entityKind, durableImpact: item.durableImpact };
}

function contextForSlot(
  slot: NarrativeSlotId,
  contexts: { actionPhase: NarrativeTruthContext; afterPhase: NarrativeTruthContext },
) {
  return phaseForSlot(slot) === "ACTION_PHASE" ? contexts.actionPhase : contexts.afterPhase;
}

function draftHash(draft: SceneDraft) {
  return hash(JSON.stringify({ draftId: draft.draftId, slots: draft.slots }));
}
function manifestHash(manifest: BeatManifest) {
  return hash(JSON.stringify(manifest));
}
function combinedCatalogHash(contexts: {
  actionPhase: NarrativeTruthContext;
  afterPhase: NarrativeTruthContext;
}) {
  return hash(reviewCatalogHash(contexts.actionPhase) + reviewCatalogHash(contexts.afterPhase));
}
function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function maximalCoverageFixture(): SceneCoverageReview {
  const span = { slot: "DECISION_STOP" as const, start: 9_999, end: 9_999 };
  const finding: CoverageFinding = {
    obligationId: "x".repeat(MAX_ID_CHARS),
    status: "DUPLICATED",
    primarySpan: span,
    duplicateSpan: span,
  };
  return {
    schemaVersion: SCENE_COVERAGE_REVIEW_SCHEMA,
    draftHash: "x".repeat(64),
    manifestHash: "x".repeat(64),
    findings: Object.fromEntries(narrativeSlotIds.map((slot) => [slot, finding])) as Record<NarrativeSlotId, CoverageFinding>,
  };
}

function maximalP0Fixture(): SceneP0Review {
  const predicate = {
    type: "DOCUMENT.TRANSFERRED",
    documentId: "x".repeat(MAX_ID_CHARS),
    fromActorId: "x".repeat(MAX_ID_CHARS),
    toActorId: "x".repeat(MAX_ID_CHARS),
  } as DurablePredicate;
  const candidate: P0Candidate = {
    presence: "FOUND",
    slot: "DECISION_STOP",
    start: 9_999,
    end: 9_999,
    claimMode: "CONDITIONAL",
    explicitness: "AMBIGUOUS",
    predicate,
    unknownEntity: null,
    confidence: 0.999,
  };
  return {
    schemaVersion: SCENE_P0_REVIEW_SCHEMA,
    draftHash: "x".repeat(64),
    catalogHash: "x".repeat(64),
    candidates: Object.fromEntries(p0Categories.map((category) => [category, candidate])) as Record<P0Category, P0Candidate>,
  };
}

function exactObject(value: unknown, keys: string[], label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_NOT_OBJECT`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}_FIELDS_INVALID`);
  }
  return record;
}
function enumValue<T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${label}_INVALID`);
  assertBoundedId(value);
  return value as T[number];
}
function stringValue(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_ID_CHARS) {
    throw new Error(`${label}_INVALID`);
  }
  return value;
}
function numberValue(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}_INVALID`);
  }
  return value;
}
function assertBoundedId(value: string) {
  if (!value || value.length > MAX_ID_CHARS) throw new Error("REVIEW_ID_LENGTH_INVALID");
}
function stripFence(value: string) {
  return String(value || "").trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu, "$1");
}
function isString(value: unknown): value is string {
  return typeof value === "string";
}
