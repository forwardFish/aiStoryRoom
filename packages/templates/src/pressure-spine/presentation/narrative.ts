export const NARRATIVE_BEAT_TYPES = [
  "PLAYER_ACTION",
  "VISIBLE_REACTION",
  "CONSEQUENCE_OR_NEW_INFO",
  "NEXT_PRESSURE",
] as const;

export type NarrativeBeatType = typeof NARRATIVE_BEAT_TYPES[number];
export type NarrativeActionOutcome = "SUCCESS" | "PARTIAL" | "FAILURE" | "DEFAULT";

export type NarrativeBeatEvidenceV1 = {
  sourceActionIds: readonly string[];
  settledEventIds: readonly string[];
  factIds: readonly string[];
  objectVersionIds: readonly string[];
  contentSourceRefs: readonly string[];
};

export type NarrativeSceneBeatV1 = NarrativeBeatEvidenceV1 & {
  beatId: string;
  beatType: NarrativeBeatType;
};

export type NarrativeSceneBriefV1 = {
  schemaVersion: "narrative_scene_brief_v1";
  briefId: string;
  runId: string;
  nodeId: string;
  viewerSeatId: string;
  sourceActionIds: string[];
  safeSourceQuote: string;
  actionOutcome: NarrativeActionOutcome;
  requiredBeats: NarrativeSceneBeatV1[];
  mustNotRevealFactIds: string[];
  mustNotRevealKnowledgeIds: string[];
  allowedFactIds: string[];
  allowedObjectVersionIds: string[];
  allowedSettledEventIds: string[];
  allowedContentSourceRefs: string[];
  snapshotHash: string;
};

export type NarrativeSceneBriefInputV1 = Omit<
  NarrativeSceneBriefV1,
  "schemaVersion" | "requiredBeats"
> & {
  beatEvidence: Record<NarrativeBeatType, NarrativeBeatEvidenceV1>;
};

export type NarrativeRequestV1 = {
  runId: string;
  nodeId: string;
  sceneId: string;
  viewerSeatId: string;
  currentActorId: string;
  publicFactIds: string[];
  privateFactIds: string[];
  visibleObjectVersions: string[];
  settledEventIds: string[];
  pressure: unknown;
  worldTime: unknown;
  styleRules: string[];
  forbiddenFactIds: string[];
  allowedContentSourceRefs: string[];
  sceneBrief: NarrativeSceneBriefV1;
  snapshotHash: string;
};

export type NarrativeResponseV1 = {
  sceneText: string;
  usedFactIds: string[];
  usedObjectVersionIds: string[];
  usedActionIds: string[];
  usedSettledEventIds: string[];
  usedContentSourceRefs: string[];
  coveredBeatIds: string[];
  endingState: unknown;
};

export type NarrativeBindingExpectationV1 = {
  viewerSeatId: string;
  snapshotHash: string;
  viewerKnownFactIds: readonly string[];
  visibleObjectVersionIds: readonly string[];
  settledEventIds: readonly string[];
  allowedContentSourceRefs: readonly string[];
  forbiddenFactIds: readonly string[];
  mustNotRevealKnowledgeIds: readonly string[];
};

export class PressureNarrativeContractError extends Error {
  readonly code: string;

  constructor(code: string, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "PressureNarrativeContractError";
    this.code = code;
  }
}

/**
 * Builds one derived brief from an already-settled, viewer-safe batch. This
 * function never decides an outcome and never mutates an authoritative input.
 */
export function buildNarrativeSceneBrief(
  input: NarrativeSceneBriefInputV1,
): NarrativeSceneBriefV1 {
  assertNonEmpty("briefId", input.briefId);
  assertNonEmpty("runId", input.runId);
  assertNonEmpty("nodeId", input.nodeId);
  assertNonEmpty("viewerSeatId", input.viewerSeatId);
  assertNonEmpty("safeSourceQuote", input.safeSourceQuote);
  assertNonEmpty("snapshotHash", input.snapshotHash);
  if (!("SUCCESS PARTIAL FAILURE DEFAULT".split(" ") as string[]).includes(input.actionOutcome)) {
    throw new PressureNarrativeContractError(
      "BRIEF_ACTION_OUTCOME_INVALID",
      String(input.actionOutcome),
    );
  }
  const suppliedBeatTypes = Object.keys(input.beatEvidence || {});
  assertSetEqual(
    NARRATIVE_BEAT_TYPES,
    suppliedBeatTypes,
    "BRIEF_BEAT_TYPES_INVALID",
  );

  const sourceActionIds = uniqueStrings(input.sourceActionIds, "sourceActionIds");
  if (sourceActionIds.length === 0) {
    throw new PressureNarrativeContractError("BRIEF_SOURCE_ACTION_REQUIRED");
  }

  const allowedFactIds = uniqueStrings(input.allowedFactIds, "allowedFactIds");
  const allowedObjectVersionIds = uniqueStrings(
    input.allowedObjectVersionIds,
    "allowedObjectVersionIds",
  );
  const allowedSettledEventIds = uniqueStrings(
    input.allowedSettledEventIds,
    "allowedSettledEventIds",
  );
  const allowedContentSourceRefs = uniqueStrings(
    input.allowedContentSourceRefs,
    "allowedContentSourceRefs",
  );
  const mustNotRevealFactIds = uniqueStrings(
    input.mustNotRevealFactIds,
    "mustNotRevealFactIds",
  );
  const mustNotRevealKnowledgeIds = uniqueStrings(
    input.mustNotRevealKnowledgeIds,
    "mustNotRevealKnowledgeIds",
  );

  assertDisjoint(
    allowedFactIds,
    mustNotRevealFactIds,
    "BRIEF_ALLOWED_FACT_IS_FORBIDDEN",
  );
  assertTextOmitsStableIds(
    input.safeSourceQuote,
    [...mustNotRevealFactIds, ...mustNotRevealKnowledgeIds],
    "BRIEF_SAFE_QUOTE_REVEALS_FORBIDDEN_ID",
  );

  const requiredBeats = NARRATIVE_BEAT_TYPES.map((beatType) => {
    const evidence = input.beatEvidence[beatType];
    if (!evidence) {
      throw new PressureNarrativeContractError("BRIEF_BEAT_MISSING", beatType);
    }
    const beat: NarrativeSceneBeatV1 = {
      beatId: `${input.briefId}:${beatType}`,
      beatType,
      sourceActionIds: uniqueStrings(evidence.sourceActionIds, `${beatType}.sourceActionIds`),
      settledEventIds: uniqueStrings(evidence.settledEventIds, `${beatType}.settledEventIds`),
      factIds: uniqueStrings(evidence.factIds, `${beatType}.factIds`),
      objectVersionIds: uniqueStrings(
        evidence.objectVersionIds,
        `${beatType}.objectVersionIds`,
      ),
      contentSourceRefs: uniqueStrings(
        evidence.contentSourceRefs,
        `${beatType}.contentSourceRefs`,
      ),
    };
    assertBeatReferences(beat, {
      sourceActionIds,
      allowedSettledEventIds,
      allowedFactIds,
      allowedObjectVersionIds,
      allowedContentSourceRefs,
    });
    return beat;
  });

  if (requiredBeats[0]?.sourceActionIds.length === 0) {
    throw new PressureNarrativeContractError("PLAYER_ACTION_REFERENCE_REQUIRED");
  }

  return deepFreeze({
    schemaVersion: "narrative_scene_brief_v1",
    briefId: input.briefId,
    runId: input.runId,
    nodeId: input.nodeId,
    viewerSeatId: input.viewerSeatId,
    sourceActionIds,
    safeSourceQuote: input.safeSourceQuote.trim(),
    actionOutcome: input.actionOutcome,
    requiredBeats,
    mustNotRevealFactIds,
    mustNotRevealKnowledgeIds,
    allowedFactIds,
    allowedObjectVersionIds,
    allowedSettledEventIds,
    allowedContentSourceRefs,
    snapshotHash: input.snapshotHash,
  });
}

/** Validates request/brief binding before any Writer call is made. */
export function assertNarrativeRequestBinding(
  request: NarrativeRequestV1,
  expected: NarrativeBindingExpectationV1,
): void {
  const brief = request.sceneBrief;
  assertNarrativeSceneBrief(brief);
  if (
    request.viewerSeatId !== expected.viewerSeatId
    || brief.viewerSeatId !== expected.viewerSeatId
  ) {
    throw new PressureNarrativeContractError("NARRATIVE_VIEWER_MISMATCH");
  }
  if (
    request.snapshotHash !== expected.snapshotHash
    || brief.snapshotHash !== expected.snapshotHash
  ) {
    throw new PressureNarrativeContractError("NARRATIVE_SNAPSHOT_MISMATCH");
  }
  if (brief.runId !== request.runId || brief.nodeId !== request.nodeId) {
    throw new PressureNarrativeContractError("NARRATIVE_BRIEF_SCOPE_MISMATCH");
  }

  assertSetEqual(
    [...request.publicFactIds, ...request.privateFactIds],
    expected.viewerKnownFactIds,
    "NARRATIVE_VIEWER_KNOWLEDGE_MISMATCH",
  );
  assertSetEqual(
    request.visibleObjectVersions,
    expected.visibleObjectVersionIds,
    "NARRATIVE_VIEWER_OBJECT_MISMATCH",
  );
  assertSetEqual(
    request.settledEventIds,
    expected.settledEventIds,
    "NARRATIVE_VIEWER_EVENT_MISMATCH",
  );
  assertSetEqual(
    request.allowedContentSourceRefs,
    expected.allowedContentSourceRefs,
    "NARRATIVE_VIEWER_CONTENT_MISMATCH",
  );
  assertSetEqual(
    request.forbiddenFactIds,
    expected.forbiddenFactIds,
    "NARRATIVE_FORBIDDEN_FACT_MISMATCH",
  );
  assertSetEqual(
    brief.mustNotRevealKnowledgeIds,
    expected.mustNotRevealKnowledgeIds,
    "NARRATIVE_FORBIDDEN_KNOWLEDGE_MISMATCH",
  );

  assertSetEqual(
    brief.allowedSettledEventIds,
    request.settledEventIds,
    "NARRATIVE_EVENT_ALLOWLIST_MISMATCH",
  );
  assertSetEqual(
    brief.allowedObjectVersionIds,
    request.visibleObjectVersions,
    "NARRATIVE_OBJECT_ALLOWLIST_MISMATCH",
  );
  assertSetEqual(
    brief.allowedContentSourceRefs,
    request.allowedContentSourceRefs,
    "NARRATIVE_CONTENT_ALLOWLIST_MISMATCH",
  );
  assertSetEqual(
    brief.allowedFactIds,
    [...request.publicFactIds, ...request.privateFactIds],
    "NARRATIVE_FACT_ALLOWLIST_MISMATCH",
  );
  assertSetEqual(
    brief.mustNotRevealFactIds,
    request.forbiddenFactIds,
    "NARRATIVE_FORBIDDEN_FACT_MISMATCH",
  );
}

/** Revalidates a deserialized brief before it enters a model request. */
export function assertNarrativeSceneBrief(brief: NarrativeSceneBriefV1): void {
  if (brief.schemaVersion !== "narrative_scene_brief_v1") {
    throw new PressureNarrativeContractError("BRIEF_SCHEMA_INVALID");
  }
  assertNonEmpty("briefId", brief.briefId);
  assertNonEmpty("runId", brief.runId);
  assertNonEmpty("nodeId", brief.nodeId);
  assertNonEmpty("viewerSeatId", brief.viewerSeatId);
  assertNonEmpty("safeSourceQuote", brief.safeSourceQuote);
  assertNonEmpty("snapshotHash", brief.snapshotHash);
  if (!("SUCCESS PARTIAL FAILURE DEFAULT".split(" ") as string[]).includes(brief.actionOutcome)) {
    throw new PressureNarrativeContractError(
      "BRIEF_ACTION_OUTCOME_INVALID",
      String(brief.actionOutcome),
    );
  }
  if (brief.sourceActionIds.length === 0) {
    throw new PressureNarrativeContractError("BRIEF_SOURCE_ACTION_REQUIRED");
  }
  assertUnique(brief.sourceActionIds, "BRIEF_SOURCE_ACTION_DUPLICATE");
  if (brief.requiredBeats.length !== NARRATIVE_BEAT_TYPES.length) {
    throw new PressureNarrativeContractError("BRIEF_BEAT_COUNT_INVALID");
  }
  const beatIds = brief.requiredBeats.map((beat) => beat.beatId);
  if (new Set(beatIds).size !== beatIds.length) {
    throw new PressureNarrativeContractError("BRIEF_BEAT_ID_DUPLICATE");
  }
  assertSetEqual(
    NARRATIVE_BEAT_TYPES,
    brief.requiredBeats.map((beat) => beat.beatType),
    "BRIEF_BEAT_TYPES_INVALID",
  );
  assertDisjoint(
    brief.allowedFactIds,
    brief.mustNotRevealFactIds,
    "BRIEF_ALLOWED_FACT_IS_FORBIDDEN",
  );
  assertTextOmitsStableIds(
    brief.safeSourceQuote,
    [...brief.mustNotRevealFactIds, ...brief.mustNotRevealKnowledgeIds],
    "BRIEF_SAFE_QUOTE_REVEALS_FORBIDDEN_ID",
  );
  for (const beat of brief.requiredBeats) {
    assertNonEmpty("beatId", beat.beatId);
    assertBeatReferences(beat, {
      sourceActionIds: brief.sourceActionIds,
      allowedSettledEventIds: brief.allowedSettledEventIds,
      allowedFactIds: brief.allowedFactIds,
      allowedObjectVersionIds: brief.allowedObjectVersionIds,
      allowedContentSourceRefs: brief.allowedContentSourceRefs,
    });
  }
  const playerActionBeat = brief.requiredBeats.find(
    (beat) => beat.beatType === "PLAYER_ACTION",
  );
  if (!playerActionBeat?.sourceActionIds.length) {
    throw new PressureNarrativeContractError("PLAYER_ACTION_REFERENCE_REQUIRED");
  }
}

/**
 * Enforces exact beat coverage and machine-reference subsets. Semantic truth
 * remains server-owned; this guard does not attempt to adjudicate prose.
 */
export function assertNarrativeResponse(
  request: NarrativeRequestV1,
  response: NarrativeResponseV1,
): void {
  assertNonEmpty("sceneText", response.sceneText);
  const expectedBeatIds = request.sceneBrief.requiredBeats.map((beat) => beat.beatId);
  assertExactCoverage(expectedBeatIds, response.coveredBeatIds);
  assertSubset(
    response.usedActionIds,
    request.sceneBrief.sourceActionIds,
    "NARRATIVE_ACTION_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    response.usedSettledEventIds,
    request.settledEventIds,
    "NARRATIVE_EVENT_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    response.usedFactIds,
    [...request.publicFactIds, ...request.privateFactIds],
    "NARRATIVE_FACT_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    response.usedObjectVersionIds,
    request.visibleObjectVersions,
    "NARRATIVE_OBJECT_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    response.usedContentSourceRefs,
    request.allowedContentSourceRefs,
    "NARRATIVE_CONTENT_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertTextOmitsStableIds(
    response.sceneText,
    [
      ...request.forbiddenFactIds,
      ...request.sceneBrief.mustNotRevealKnowledgeIds,
    ],
    "NARRATIVE_TEXT_REVEALS_FORBIDDEN_ID",
  );
}

export type GuardedNarrativeResultV1 = {
  source: "MODEL" | "AUTHORED_FALLBACK";
  response: NarrativeResponseV1;
  rejectedCandidateReason?: string;
};

/**
 * Applies the exact same request and response guard to model and authored
 * fallback text. A rejected model result is returned only as a reason string;
 * this pure module creates neither NarrativeEntry nor StoryEvent.
 */
export function resolveNarrativeWithAuthoredFallback(input: {
  request: NarrativeRequestV1;
  expected: NarrativeBindingExpectationV1;
  candidate: NarrativeResponseV1;
  authoredFallback: NarrativeResponseV1;
}): GuardedNarrativeResultV1 {
  assertNarrativeRequestBinding(input.request, input.expected);
  try {
    assertNarrativeResponse(input.request, input.candidate);
    return deepFreeze({ source: "MODEL", response: cloneResponse(input.candidate) });
  } catch (error) {
    const rejectedCandidateReason = errorMessage(error);
    assertNarrativeResponse(input.request, input.authoredFallback);
    return deepFreeze({
      source: "AUTHORED_FALLBACK",
      response: cloneResponse(input.authoredFallback),
      rejectedCandidateReason,
    });
  }
}

function assertBeatReferences(
  beat: NarrativeSceneBeatV1,
  allowlists: {
    sourceActionIds: readonly string[];
    allowedSettledEventIds: readonly string[];
    allowedFactIds: readonly string[];
    allowedObjectVersionIds: readonly string[];
    allowedContentSourceRefs: readonly string[];
  },
) {
  const referenceCount = beat.sourceActionIds.length
    + beat.settledEventIds.length
    + beat.factIds.length
    + beat.objectVersionIds.length
    + beat.contentSourceRefs.length;
  if (referenceCount === 0) {
    throw new PressureNarrativeContractError("BRIEF_BEAT_REFERENCE_REQUIRED", beat.beatType);
  }
  assertSubset(
    beat.sourceActionIds,
    allowlists.sourceActionIds,
    "BRIEF_ACTION_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    beat.settledEventIds,
    allowlists.allowedSettledEventIds,
    "BRIEF_EVENT_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    beat.factIds,
    allowlists.allowedFactIds,
    "BRIEF_FACT_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    beat.objectVersionIds,
    allowlists.allowedObjectVersionIds,
    "BRIEF_OBJECT_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    beat.contentSourceRefs,
    allowlists.allowedContentSourceRefs,
    "BRIEF_CONTENT_REFERENCE_OUTSIDE_ALLOWLIST",
  );
}

function assertExactCoverage(expected: readonly string[], actual: readonly string[]) {
  const uniqueActual = uniqueStrings(actual, "coveredBeatIds");
  if (uniqueActual.length !== actual.length) {
    throw new PressureNarrativeContractError("NARRATIVE_BEAT_DUPLICATE");
  }
  assertSetEqual(expected, uniqueActual, "NARRATIVE_BEAT_COVERAGE_INVALID");
}

function assertSetEqual(
  left: readonly string[],
  right: readonly string[],
  code: string,
) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (
    leftSet.size !== rightSet.size
    || [...leftSet].some((value) => !rightSet.has(value))
  ) {
    throw new PressureNarrativeContractError(code);
  }
}

function assertSubset(values: readonly string[], allowed: readonly string[], code: string) {
  const allowedSet = new Set(allowed);
  const invalid = values.find((value) => !allowedSet.has(value));
  if (invalid) throw new PressureNarrativeContractError(code, invalid);
}

function assertDisjoint(
  left: readonly string[],
  right: readonly string[],
  code: string,
) {
  const rightSet = new Set(right);
  const overlap = left.find((value) => rightSet.has(value));
  if (overlap) throw new PressureNarrativeContractError(code, overlap);
}

function assertUnique(values: readonly string[], code: string) {
  if (new Set(values).size !== values.length) {
    throw new PressureNarrativeContractError(code);
  }
}

function assertTextOmitsStableIds(
  text: string,
  forbiddenIds: readonly string[],
  code: string,
) {
  const revealed = forbiddenIds.find((value) => value && text.includes(value));
  if (revealed) throw new PressureNarrativeContractError(code, revealed);
}

function assertNonEmpty(field: string, value: string) {
  if (!String(value || "").trim()) {
    throw new PressureNarrativeContractError("NARRATIVE_REQUIRED_FIELD_EMPTY", field);
  }
}

function uniqueStrings(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values)) {
    throw new PressureNarrativeContractError("NARRATIVE_ARRAY_REQUIRED", field);
  }
  const normalized = values.map((value) => String(value || "").trim());
  if (normalized.some((value) => !value)) {
    throw new PressureNarrativeContractError("NARRATIVE_REFERENCE_EMPTY", field);
  }
  return [...new Set(normalized)];
}

function cloneResponse(response: NarrativeResponseV1): NarrativeResponseV1 {
  return {
    ...response,
    usedFactIds: [...response.usedFactIds],
    usedObjectVersionIds: [...response.usedObjectVersionIds],
    usedActionIds: [...response.usedActionIds],
    usedSettledEventIds: [...response.usedSettledEventIds],
    usedContentSourceRefs: [...response.usedContentSourceRefs],
    coveredBeatIds: [...response.coveredBeatIds],
    endingState: cloneJson(response.endingState),
  };
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function errorMessage(error: unknown) {
  return String((error as Error)?.message || error || "NARRATIVE_GUARD_REJECTED").slice(0, 500);
}
