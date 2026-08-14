export const PRESSURE_METRIC_SCOPES_V1 = Object.freeze([
  "WORLD",
  "SEAT",
  "RELATIONSHIP",
  "OBJECT",
] as const);

export const PRESSURE_METRIC_VISIBILITIES_V1 = Object.freeze([
  "PUBLIC",
  "SEAT_PRIVATE",
  "SYSTEM_ONLY",
] as const);

export const PRESSURE_METRIC_VALUE_TYPES_V1 = Object.freeze([
  "NUMBER",
  "INTEGER",
  "PERCENT",
  "ENUM_LEVEL",
] as const);

export type PressureMetricScopeV1 =
  (typeof PRESSURE_METRIC_SCOPES_V1)[number];
export type PressureMetricVisibilityV1 =
  (typeof PRESSURE_METRIC_VISIBILITIES_V1)[number];
export type PressureMetricValueTypeV1 =
  (typeof PRESSURE_METRIC_VALUE_TYPES_V1)[number];

export interface PressureMetricDefinitionV1 {
  metricId: string;
  scope: PressureMetricScopeV1;
  scopeRef: string;
  visibility: PressureMetricVisibilityV1;
  visibleToSeatIds: string[];
  valueType: PressureMetricValueTypeV1;
  initialValue: number | string;
  bounds: {
    min: number;
    max: number;
  } | null;
  updateRuleRef: string;
  finaleRuleRefs: string[];
}

export interface PressureMetricChangeAuditV1 {
  schemaVersion: "pressure_metric_change_audit_v1";
  settlementBranchRef: string;
  applicationKey: string;
  changes: Array<{
    metricId: string;
    scope: PressureMetricScopeV1;
    visibility: PressureMetricVisibilityV1;
    before: number;
    delta: number;
    after: number;
    updateRuleRef: string;
    finaleRuleRefs: string[];
  }>;
}

export interface PressureFinaleScaleAuditV1 {
  schemaVersion: "pressure_finale_scale_audit_v1";
  status: "COMPATIBLE" | "MISMATCH" | "UNPROVEN";
  inputScale: "DELTA_FROM_GENESIS" | "ABSOLUTE" | "UNPROVEN";
  ruleScale: "DELTA_FROM_GENESIS";
  matchedSettlementBranchRefs: string[];
  evidenceRefs: string[];
}

export const PRESSURE_METRIC_AUTHORITY_ERROR_CODES_V1 = Object.freeze({
  CONTRACT_INVALID: "PRESSURE_METRIC_AUTHORITY_CONTRACT_INVALID",
  CHANGE_ARITHMETIC_MISMATCH: "PRESSURE_METRIC_CHANGE_ARITHMETIC_MISMATCH",
  CHANGE_OUT_OF_BOUNDS: "PRESSURE_METRIC_CHANGE_OUT_OF_BOUNDS",
  APPLICATION_REPLAY_MISMATCH: "PRESSURE_METRIC_APPLICATION_REPLAY_MISMATCH",
  FINALE_SCALE_MISMATCH: "PRESSURE_FINALE_SCALE_MISMATCH",
  FINALE_SCALE_UNPROVEN: "PRESSURE_FINALE_SCALE_UNPROVEN",
} as const);

export type PressureMetricAuthorityErrorCodeV1 =
  (typeof PRESSURE_METRIC_AUTHORITY_ERROR_CODES_V1)[keyof typeof PRESSURE_METRIC_AUTHORITY_ERROR_CODES_V1];

export class PressureMetricAuthorityErrorV1 extends Error {
  readonly code: PressureMetricAuthorityErrorCodeV1;
  readonly path: string;
  readonly detail: string | undefined;

  constructor(
    code: PressureMetricAuthorityErrorCodeV1,
    path: string,
    detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "PressureMetricAuthorityErrorV1";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

const ERROR = PRESSURE_METRIC_AUTHORITY_ERROR_CODES_V1;
const EPSILON = 1e-9;

export function compilePublicTrackMetricDefinitionsV1(
  tracks: readonly Readonly<{
    trackId: string;
    initialValue: number;
  }>[],
  finaleRuleRefs: readonly string[],
): ReadonlyArray<PressureMetricDefinitionV1> {
  return validatePressureMetricDefinitionsV1(tracks.map((track) => ({
    metricId: track.trackId,
    scope: "WORLD",
    scopeRef: "world",
    visibility: "PUBLIC",
    visibleToSeatIds: [],
    valueType: "NUMBER",
    initialValue: track.initialValue,
    bounds: { min: 0, max: 100 },
    updateRuleRef: "chapter_settlement.track_delta_v1",
    finaleRuleRefs: [...finaleRuleRefs],
  })));
}

/**
 * Validates the unified metric extension contract without assuming a fixed
 * metric count. Current Sangtian tracks are PUBLIC/WORLD metrics; future
 * SEAT_PRIVATE and SYSTEM_ONLY metrics must use this same authority surface.
 */
export function validatePressureMetricDefinitionsV1(
  value: unknown,
): ReadonlyArray<PressureMetricDefinitionV1> {
  if (!Array.isArray(value) || value.length === 0) {
    invalid("metricDefinitions", "NON_EMPTY_ARRAY");
  }
  const seen = new Set<string>();
  const definitions = value.map((item, index) => {
    const path = `metricDefinitions[${index}]`;
    const record = exactRecord(item, [
      "metricId",
      "scope",
      "scopeRef",
      "visibility",
      "visibleToSeatIds",
      "valueType",
      "initialValue",
      "bounds",
      "updateRuleRef",
      "finaleRuleRefs",
    ], path);
    const metricId = nonEmpty(record.metricId, `${path}.metricId`);
    if (seen.has(metricId)) invalid(`${path}.metricId`, "DUPLICATE");
    seen.add(metricId);
    const scope = enumValue(
      record.scope,
      PRESSURE_METRIC_SCOPES_V1,
      `${path}.scope`,
    );
    const visibility = enumValue(
      record.visibility,
      PRESSURE_METRIC_VISIBILITIES_V1,
      `${path}.visibility`,
    );
    const valueType = enumValue(
      record.valueType,
      PRESSURE_METRIC_VALUE_TYPES_V1,
      `${path}.valueType`,
    );
    const visibleToSeatIds = stringArray(
      record.visibleToSeatIds,
      `${path}.visibleToSeatIds`,
    );
    if (visibility === "PUBLIC" && visibleToSeatIds.length !== 0) {
      invalid(`${path}.visibleToSeatIds`, "PUBLIC_MUST_BE_EMPTY");
    }
    if (visibility === "SEAT_PRIVATE" && visibleToSeatIds.length === 0) {
      invalid(`${path}.visibleToSeatIds`, "PRIVATE_REQUIRES_SEAT");
    }
    if (visibility === "SYSTEM_ONLY" && visibleToSeatIds.length !== 0) {
      invalid(`${path}.visibleToSeatIds`, "SYSTEM_MUST_BE_EMPTY");
    }
    const bounds = validateBounds(record.bounds, `${path}.bounds`, valueType);
    const initialValue = validateInitialValue(
      record.initialValue,
      `${path}.initialValue`,
      valueType,
      bounds,
    );
    return {
      metricId,
      scope,
      scopeRef: nonEmpty(record.scopeRef, `${path}.scopeRef`),
      visibility,
      visibleToSeatIds,
      valueType,
      initialValue,
      bounds,
      updateRuleRef: nonEmpty(record.updateRuleRef, `${path}.updateRuleRef`),
      finaleRuleRefs: stringArray(record.finaleRuleRefs, `${path}.finaleRuleRefs`),
    } satisfies PressureMetricDefinitionV1;
  });
  return deepFreeze(definitions.sort((left, right) =>
    compareText(left.metricId, right.metricId),
  ));
}

export function projectPressureMetricDefinitionsForViewerV1(
  definitionsValue: unknown,
  viewerSeatId: string,
): ReadonlyArray<PressureMetricDefinitionV1> {
  const definitions = validatePressureMetricDefinitionsV1(definitionsValue);
  const seatId = nonEmpty(viewerSeatId, "viewerSeatId");
  return deepFreeze(definitions.filter((definition) => (
    definition.visibility === "PUBLIC"
    || (
      definition.visibility === "SEAT_PRIVATE"
      && definition.visibleToSeatIds.includes(seatId)
    )
  )));
}

/**
 * Settlement is the only caller allowed to produce this audit. Arithmetic is
 * checked before any Narrative/Provider stage and the branch/application keys
 * bind retries to one deterministic application.
 */
export function compilePressureMetricChangeAuditV1(inputValue: Readonly<{
  definitions: unknown;
  before: Readonly<Record<string, number>>;
  delta: Readonly<Record<string, number>>;
  after: Readonly<Record<string, number>>;
  settlementBranchRef: string;
  applicationKey: string;
}>): Readonly<PressureMetricChangeAuditV1> {
  const input = exactRecord(inputValue, [
    "definitions",
    "before",
    "delta",
    "after",
    "settlementBranchRef",
    "applicationKey",
  ], "metricChangeInput");
  const definitions = validatePressureMetricDefinitionsV1(input.definitions);
  const before = numberRecord(input.before, "metricChangeInput.before");
  const delta = numberRecord(input.delta, "metricChangeInput.delta");
  const after = numberRecord(input.after, "metricChangeInput.after");
  const numericDefinitions = definitions.filter((definition) =>
    definition.valueType !== "ENUM_LEVEL",
  );
  assertExactMetricKeys(before, numericDefinitions, "metricChangeInput.before");
  assertExactMetricKeys(delta, numericDefinitions, "metricChangeInput.delta");
  assertExactMetricKeys(after, numericDefinitions, "metricChangeInput.after");
  const changes = numericDefinitions.map((definition) => {
    const beforeValue = before[definition.metricId]!;
    const deltaValue = delta[definition.metricId]!;
    const afterValue = after[definition.metricId]!;
    if (!nearlyEqual(beforeValue + deltaValue, afterValue)) {
      throw new PressureMetricAuthorityErrorV1(
        ERROR.CHANGE_ARITHMETIC_MISMATCH,
        `metricChangeInput.after.${definition.metricId}`,
        `EXPECTED_${beforeValue + deltaValue}`,
      );
    }
    if (definition.valueType === "INTEGER" && !Number.isInteger(afterValue)) {
      invalid(`metricChangeInput.after.${definition.metricId}`, "INTEGER");
    }
    if (
      definition.bounds
      && (
        afterValue < definition.bounds.min - EPSILON
        || afterValue > definition.bounds.max + EPSILON
      )
    ) {
      throw new PressureMetricAuthorityErrorV1(
        ERROR.CHANGE_OUT_OF_BOUNDS,
        `metricChangeInput.after.${definition.metricId}`,
        `${definition.bounds.min}_${definition.bounds.max}`,
      );
    }
    return {
      metricId: definition.metricId,
      scope: definition.scope,
      visibility: definition.visibility,
      before: beforeValue,
      delta: deltaValue,
      after: afterValue,
      updateRuleRef: definition.updateRuleRef,
      finaleRuleRefs: [...definition.finaleRuleRefs],
    };
  });
  return deepFreeze({
    schemaVersion: "pressure_metric_change_audit_v1",
    settlementBranchRef: nonEmpty(
      input.settlementBranchRef,
      "metricChangeInput.settlementBranchRef",
    ),
    applicationKey: nonEmpty(
      input.applicationKey,
      "metricChangeInput.applicationKey",
    ),
    changes,
  } satisfies PressureMetricChangeAuditV1);
}

export function assertPressureMetricReplayCompatibleV1(
  committedValue: PressureMetricChangeAuditV1,
  candidateValue: PressureMetricChangeAuditV1,
): void {
  const committed = compilePressureMetricChangeAuditV1(toAuditInput(committedValue));
  const candidate = compilePressureMetricChangeAuditV1(toAuditInput(candidateValue));
  if (
    committed.applicationKey !== candidate.applicationKey
    || JSON.stringify(committed) !== JSON.stringify(candidate)
  ) {
    throw new PressureMetricAuthorityErrorV1(
      ERROR.APPLICATION_REPLAY_MISMATCH,
      "metricChangeReplay",
    );
  }
}

/**
 * Determines whether frozen chapter track snapshots are absolute 0–100 values
 * or cumulative deltas from Genesis. Every step must match exactly one
 * content-owned Settlement branch; ambiguous or incomplete chains are denied.
 */
export function auditPressureFinaleScaleV1(inputValue: Readonly<{
  definitions: unknown;
  chapters: readonly Readonly<{
    chapterId: string;
    snapshotValues: Readonly<Record<string, number>>;
    snapshotEvidenceRef: string;
    settlementBranches: readonly Readonly<{
      branchRef: string;
      delta: Readonly<Record<string, number>>;
    }>[];
  }>[];
}>): Readonly<PressureFinaleScaleAuditV1> {
  const definitions = validatePressureMetricDefinitionsV1(inputValue.definitions);
  const numericDefinitions = definitions.filter((definition) =>
    definition.valueType !== "ENUM_LEVEL",
  );
  if (!Array.isArray(inputValue.chapters) || inputValue.chapters.length === 0) {
    invalid("finaleScale.chapters", "NON_EMPTY_ARRAY");
  }
  const chapters = inputValue.chapters.map((chapter, index) => {
    const path = `finaleScale.chapters[${index}]`;
    const record = exactRecord(chapter, [
      "chapterId",
      "snapshotValues",
      "snapshotEvidenceRef",
      "settlementBranches",
    ], path);
    const snapshotValues = numberRecord(record.snapshotValues, `${path}.snapshotValues`);
    assertExactMetricKeys(snapshotValues, numericDefinitions, `${path}.snapshotValues`);
    if (!Array.isArray(record.settlementBranches) || record.settlementBranches.length === 0) {
      invalid(`${path}.settlementBranches`, "NON_EMPTY_ARRAY");
    }
    const settlementBranches = record.settlementBranches.map((branch, branchIndex) => {
      const branchPath = `${path}.settlementBranches[${branchIndex}]`;
      const branchRecord = exactRecord(branch, ["branchRef", "delta"], branchPath);
      const delta = numberRecord(branchRecord.delta, `${branchPath}.delta`);
      for (const metricId of Object.keys(delta)) {
        if (!numericDefinitions.some((definition) => definition.metricId === metricId)) {
          invalid(`${branchPath}.delta.${metricId}`, "UNKNOWN_METRIC");
        }
      }
      return {
        branchRef: nonEmpty(branchRecord.branchRef, `${branchPath}.branchRef`),
        delta,
      };
    });
    return {
      chapterId: nonEmpty(record.chapterId, `${path}.chapterId`),
      snapshotValues,
      snapshotEvidenceRef: nonEmpty(
        record.snapshotEvidenceRef,
        `${path}.snapshotEvidenceRef`,
      ),
      settlementBranches,
    };
  });
  const initialAbsolute = Object.fromEntries(numericDefinitions.map((definition) => {
    if (typeof definition.initialValue !== "number") {
      invalid(`metricDefinitions.${definition.metricId}.initialValue`, "NUMBER_REQUIRED");
    }
    return [definition.metricId, definition.initialValue];
  }));
  const initialNormalized = Object.fromEntries(numericDefinitions.map((definition) => [
    definition.metricId,
    0,
  ]));
  const absolute = matchScaleChain(initialAbsolute, chapters, numericDefinitions);
  const normalized = matchScaleChain(initialNormalized, chapters, numericDefinitions);
  const evidenceRefs = chapters.map((chapter) => chapter.snapshotEvidenceRef);
  if (normalized !== null && absolute === null) {
    return deepFreeze({
      schemaVersion: "pressure_finale_scale_audit_v1",
      status: "COMPATIBLE",
      inputScale: "DELTA_FROM_GENESIS",
      ruleScale: "DELTA_FROM_GENESIS",
      matchedSettlementBranchRefs: normalized,
      evidenceRefs,
    });
  }
  if (absolute !== null && normalized === null) {
    return deepFreeze({
      schemaVersion: "pressure_finale_scale_audit_v1",
      status: "MISMATCH",
      inputScale: "ABSOLUTE",
      ruleScale: "DELTA_FROM_GENESIS",
      matchedSettlementBranchRefs: absolute,
      evidenceRefs,
    });
  }
  return deepFreeze({
    schemaVersion: "pressure_finale_scale_audit_v1",
    status: "UNPROVEN",
    inputScale: "UNPROVEN",
    ruleScale: "DELTA_FROM_GENESIS",
    matchedSettlementBranchRefs: [],
    evidenceRefs,
  });
}

export function assertPressureFinaleScaleCompatibleV1(
  input: Parameters<typeof auditPressureFinaleScaleV1>[0],
): Readonly<PressureFinaleScaleAuditV1> {
  const audit = auditPressureFinaleScaleV1(input);
  if (audit.status === "MISMATCH") {
    throw new PressureMetricAuthorityErrorV1(
      ERROR.FINALE_SCALE_MISMATCH,
      "finaleScale",
      `${audit.inputScale}_TO_${audit.ruleScale}`,
    );
  }
  if (audit.status !== "COMPATIBLE") {
    throw new PressureMetricAuthorityErrorV1(
      ERROR.FINALE_SCALE_UNPROVEN,
      "finaleScale",
    );
  }
  return audit;
}

function matchScaleChain(
  baseValues: Readonly<Record<string, number>>,
  chapters: readonly Readonly<{
    snapshotValues: Readonly<Record<string, number>>;
    settlementBranches: readonly Readonly<{
      branchRef: string;
      delta: Readonly<Record<string, number>>;
    }>[];
  }>[],
  definitions: readonly PressureMetricDefinitionV1[],
): string[] | null {
  let previous = { ...baseValues };
  const matched: string[] = [];
  for (const chapter of chapters) {
    const actualDelta = Object.fromEntries(definitions.map((definition) => [
      definition.metricId,
      chapter.snapshotValues[definition.metricId]! - previous[definition.metricId]!,
    ]));
    const matches = chapter.settlementBranches.filter((branch) =>
      definitions.every((definition) => nearlyEqual(
        actualDelta[definition.metricId]!,
        branch.delta[definition.metricId] ?? 0,
      )),
    );
    if (matches.length !== 1) return null;
    matched.push(matches[0]!.branchRef);
    previous = { ...chapter.snapshotValues };
  }
  return matched;
}

function toAuditInput(value: PressureMetricChangeAuditV1) {
  const definitions: PressureMetricDefinitionV1[] = value.changes.map((change) => ({
    metricId: change.metricId,
    scope: change.scope,
    scopeRef: change.scope === "WORLD" ? "world" : change.metricId,
    visibility: change.visibility,
    visibleToSeatIds: change.visibility === "SEAT_PRIVATE" ? [change.metricId] : [],
    valueType: "NUMBER",
    initialValue: change.before,
    bounds: {
      min: Math.min(change.before, change.after),
      max: Math.max(change.before, change.after),
    },
    updateRuleRef: change.updateRuleRef,
    finaleRuleRefs: [...change.finaleRuleRefs],
  }));
  return {
    definitions,
    before: Object.fromEntries(value.changes.map((change) => [change.metricId, change.before])),
    delta: Object.fromEntries(value.changes.map((change) => [change.metricId, change.delta])),
    after: Object.fromEntries(value.changes.map((change) => [change.metricId, change.after])),
    settlementBranchRef: value.settlementBranchRef,
    applicationKey: value.applicationKey,
  };
}

function validateBounds(
  value: unknown,
  path: string,
  valueType: PressureMetricValueTypeV1,
): PressureMetricDefinitionV1["bounds"] {
  if (value === null) {
    if (valueType !== "ENUM_LEVEL") invalid(path, "NUMERIC_BOUNDS_REQUIRED");
    return null;
  }
  if (valueType === "ENUM_LEVEL") invalid(path, "ENUM_BOUNDS_MUST_BE_NULL");
  const record = exactRecord(value, ["min", "max"], path);
  const min = finite(record.min, `${path}.min`);
  const max = finite(record.max, `${path}.max`);
  if (min > max) invalid(path, "MIN_GT_MAX");
  if (valueType === "PERCENT" && (min < 0 || max > 100)) {
    invalid(path, "PERCENT_0_100");
  }
  return { min, max };
}

function validateInitialValue(
  value: unknown,
  path: string,
  valueType: PressureMetricValueTypeV1,
  bounds: PressureMetricDefinitionV1["bounds"],
): number | string {
  if (valueType === "ENUM_LEVEL") return nonEmpty(value, path);
  const number = finite(value, path);
  if (valueType === "INTEGER" && !Number.isInteger(number)) invalid(path, "INTEGER");
  if (bounds && (number < bounds.min || number > bounds.max)) {
    invalid(path, "OUT_OF_BOUNDS");
  }
  return number;
}

function assertExactMetricKeys(
  values: Readonly<Record<string, number>>,
  definitions: readonly PressureMetricDefinitionV1[],
  path: string,
): void {
  const expected = definitions.map((definition) => definition.metricId).sort();
  const actual = Object.keys(values).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    invalid(path, `EXPECTED_${expected.join(",")}`);
  }
}

function numberRecord(value: unknown, path: string): Record<string, number> {
  const record = plainRecord(value, path);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    nonEmpty(key, `${path}.key`),
    finite(item, `${path}.${key}`),
  ]));
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path, "ARRAY");
  const result = value.map((item, index) => nonEmpty(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) invalid(path, "DUPLICATE");
  return [...result].sort(compareText);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = plainRecord(value, path);
  const actual = Object.keys(record);
  const unknown = actual.find((key) => !keys.includes(key));
  const missing = keys.find((key) => !(key in record));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
  return record;
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "OBJECT");
  }
  return value as Record<string, unknown>;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    invalid(path, `ENUM_${values.join("_")}`);
  }
  return value as T;
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "FINITE_NUMBER");
  return value;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(path: string, detail: string): never {
  throw new PressureMetricAuthorityErrorV1(ERROR.CONTRACT_INVALID, path, detail);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
