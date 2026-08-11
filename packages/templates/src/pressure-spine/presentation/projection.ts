import { createHash } from "node:crypto";

export type LatestActionFeedbackV1 = {
  actionEcho: string;
  visibleReactions: string[];
  changes: {
    consequence: string[];
    resource: string[];
    time: string[];
    pressure: string[];
    object: string[];
  };
  nextPressure: string;
  sourceActionIds: string[];
  settledEventIds: string[];
  projectionHash: string;
};

export type LatestActionFeedbackInputV1 = {
  actionEcho: string;
  visibleReactions: readonly string[];
  changes: {
    consequence: readonly string[];
    resource: readonly string[];
    time: readonly string[];
    pressure: readonly string[];
    object: readonly string[];
  };
  nextPressure: string;
  sourceActionIds: readonly string[];
  settledEventIds: readonly string[];
  snapshotHash: string;
  allowedActionIds: readonly string[];
  allowedSettledEventIds: readonly string[];
  forbiddenStableIds: readonly string[];
};

export type SuggestedInputSource =
  | "DEFAULT_PREPARE"
  | "DEFAULT_COMMIT"
  | "KEY_LEVERAGE"
  | "DIALOGUE_SEED"
  | "DETERMINISTIC_DERIVATION";

export type SuggestedInputCandidateV1 = {
  id: string;
  displayText: string;
  sourceRefs: readonly string[];
  sourceKind: SuggestedInputSource;
};

export type SuggestedInputV1 = {
  id: string;
  displayText: string;
  sourceRefs: string[];
  sourceKind: SuggestedInputSource;
  requiresPreview: true;
};

export class PressureProjectionContractError extends Error {
  readonly code: string;

  constructor(code: string, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "PressureProjectionContractError";
    this.code = code;
  }
}

/**
 * Projects an explicit viewer-safe feedback card from settled state. Each
 * change category remains an array, including when no change is visible, so a
 * client never has to infer state from narrative prose.
 */
export function projectLatestActionFeedback(
  input: LatestActionFeedbackInputV1,
): LatestActionFeedbackV1 {
  assertText("actionEcho", input.actionEcho);
  assertText("nextPressure", input.nextPressure);
  assertText("snapshotHash", input.snapshotHash);

  const sourceActionIds = uniqueStrings(input.sourceActionIds, "sourceActionIds");
  const settledEventIds = uniqueStrings(input.settledEventIds, "settledEventIds");
  assertSubset(
    sourceActionIds,
    input.allowedActionIds,
    "FEEDBACK_ACTION_REFERENCE_OUTSIDE_ALLOWLIST",
  );
  assertSubset(
    settledEventIds,
    input.allowedSettledEventIds,
    "FEEDBACK_EVENT_REFERENCE_OUTSIDE_ALLOWLIST",
  );

  const payload = {
    actionEcho: input.actionEcho.trim(),
    visibleReactions: normalizedTextList(input.visibleReactions, "visibleReactions"),
    changes: {
      consequence: normalizedTextList(input.changes.consequence, "changes.consequence"),
      resource: normalizedTextList(input.changes.resource, "changes.resource"),
      time: normalizedTextList(input.changes.time, "changes.time"),
      pressure: normalizedTextList(input.changes.pressure, "changes.pressure"),
      object: normalizedTextList(input.changes.object, "changes.object"),
    },
    nextPressure: input.nextPressure.trim(),
    sourceActionIds,
    settledEventIds,
  };

  assertViewerSafeStrings(payload, input.forbiddenStableIds);
  const projectionHash = sha256(canonicalJson({
    snapshotHash: input.snapshotHash,
    ...payload,
  }));
  return deepFreeze({ ...payload, projectionHash });
}

/**
 * Produces a deterministic 2-3 item action surface. Suggestions only fill the
 * ordinary Preview input; this module has no Confirm or world-write ability.
 */
export function buildViewerSafeSuggestedInputs(input: {
  actionPhaseOpen: boolean;
  candidates: readonly SuggestedInputCandidateV1[];
  allowedSourceRefs: readonly string[];
  forbiddenStableIds: readonly string[];
}): SuggestedInputV1[] {
  if (!input.actionPhaseOpen) return deepFreeze([] as SuggestedInputV1[]);
  if (input.candidates.length < 2 || input.candidates.length > 3) {
    throw new PressureProjectionContractError("SUGGESTED_INPUT_COUNT_INVALID");
  }

  const ids = new Set<string>();
  const suggestions = input.candidates.map((candidate) => {
    assertText("suggestedInput.id", candidate.id);
    assertText("suggestedInput.displayText", candidate.displayText);
    if (ids.has(candidate.id)) {
      throw new PressureProjectionContractError("SUGGESTED_INPUT_ID_DUPLICATE", candidate.id);
    }
    ids.add(candidate.id);
    const sourceRefs = uniqueStrings(candidate.sourceRefs, `${candidate.id}.sourceRefs`);
    if (sourceRefs.length === 0) {
      throw new PressureProjectionContractError("SUGGESTED_INPUT_SOURCE_REQUIRED", candidate.id);
    }
    assertSubset(
      sourceRefs,
      input.allowedSourceRefs,
      "SUGGESTED_INPUT_SOURCE_OUTSIDE_ALLOWLIST",
    );
    assertNoForbiddenId(
      [candidate.displayText, ...sourceRefs],
      input.forbiddenStableIds,
      "SUGGESTED_INPUT_REVEALS_FORBIDDEN_ID",
    );
    return {
      id: candidate.id,
      displayText: candidate.displayText.trim(),
      sourceRefs,
      sourceKind: candidate.sourceKind,
      requiresPreview: true as const,
    };
  });
  return deepFreeze(suggestions);
}

function assertViewerSafeStrings(
  value: Omit<LatestActionFeedbackV1, "projectionHash">,
  forbiddenIds: readonly string[],
) {
  assertNoForbiddenId(
    [
      value.actionEcho,
      ...value.visibleReactions,
      ...value.changes.consequence,
      ...value.changes.resource,
      ...value.changes.time,
      ...value.changes.pressure,
      ...value.changes.object,
      value.nextPressure,
      ...value.sourceActionIds,
      ...value.settledEventIds,
    ],
    forbiddenIds,
    "FEEDBACK_REVEALS_FORBIDDEN_ID",
  );
}

function assertNoForbiddenId(
  values: readonly string[],
  forbiddenIds: readonly string[],
  code: string,
) {
  const found = forbiddenIds.find(
    (forbidden) => forbidden && values.some((value) => value.includes(forbidden)),
  );
  if (found) throw new PressureProjectionContractError(code, found);
}

function normalizedTextList(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values)) {
    throw new PressureProjectionContractError("FEEDBACK_ARRAY_REQUIRED", field);
  }
  const normalized = values.map((value) => String(value || "").trim());
  if (normalized.some((value) => !value)) {
    throw new PressureProjectionContractError("FEEDBACK_TEXT_EMPTY", field);
  }
  return [...new Set(normalized)];
}

function uniqueStrings(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values)) {
    throw new PressureProjectionContractError("PROJECTION_ARRAY_REQUIRED", field);
  }
  const normalized = values.map((value) => String(value || "").trim());
  if (normalized.some((value) => !value)) {
    throw new PressureProjectionContractError("PROJECTION_REFERENCE_EMPTY", field);
  }
  return [...new Set(normalized)];
}

function assertSubset(values: readonly string[], allowed: readonly string[], code: string) {
  const allowedSet = new Set(allowed);
  const invalid = values.find((value) => !allowedSet.has(value));
  if (invalid) throw new PressureProjectionContractError(code, invalid);
}

function assertText(field: string, value: string) {
  if (!String(value || "").trim()) {
    throw new PressureProjectionContractError("PROJECTION_REQUIRED_FIELD_EMPTY", field);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
