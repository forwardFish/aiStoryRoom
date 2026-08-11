export type PressureSeatVerdict = "WIN" | "COSTLY_WIN" | "LOSS";

export type FinaleSeatVerdictV1 = {
  seatId: string;
  verdict: PressureSeatVerdict;
  [key: string]: unknown;
};

export type FinaleResultV1 = {
  schemaVersion: string;
  worldOutcomeId: string;
  trackBands: Array<Record<string, unknown>>;
  seatVerdicts: FinaleSeatVerdictV1[];
  causes: unknown[];
  replayHook: unknown;
  inputFrozenResultIds: string[];
  contentHash: string;
};

export type FinaleExpressionV1 = {
  schemaVersion: "finale_expression_v1";
  sourceContentHash: string;
  worldOutcomeId: string;
  trackBands: Array<Record<string, unknown>>;
  seatVerdicts: FinaleSeatVerdictV1[];
  causes: unknown[];
  replayHook: unknown;
  inputFrozenResultIds: string[];
};

export class PressureFinaleContractError extends Error {
  readonly code: string;

  constructor(code: string, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "PressureFinaleContractError";
    this.code = code;
  }
}

/**
 * Converts an existing deterministic FinaleResult into expression input. It
 * deliberately exposes no scoring, ranking, classification or override hook.
 */
export function adaptFinaleForExpression(result: FinaleResultV1): FinaleExpressionV1 {
  assertText("schemaVersion", result.schemaVersion);
  assertText("worldOutcomeId", result.worldOutcomeId);
  assertText("contentHash", result.contentHash);
  if (!Array.isArray(result.trackBands) || result.trackBands.length !== 5) {
    throw new PressureFinaleContractError("FINALE_TRACK_BAND_COUNT_INVALID", String(result.trackBands?.length ?? "missing"));
  }
  if (!Array.isArray(result.seatVerdicts) || result.seatVerdicts.length !== 6) {
    throw new PressureFinaleContractError("FINALE_SEAT_VERDICT_COUNT_INVALID", String(result.seatVerdicts?.length ?? "missing"));
  }
  const seatIds = new Set<string>();
  for (const item of result.seatVerdicts) {
    assertText("seatVerdict.seatId", item.seatId);
    if (seatIds.has(item.seatId)) {
      throw new PressureFinaleContractError("FINALE_SEAT_DUPLICATE", item.seatId);
    }
    seatIds.add(item.seatId);
    if (!(["WIN", "COSTLY_WIN", "LOSS"] as const).includes(item.verdict)) {
      throw new PressureFinaleContractError("FINALE_VERDICT_INVALID", String(item.verdict));
    }
  }
  const inputFrozenResultIds = uniqueStrings(
    result.inputFrozenResultIds,
    "inputFrozenResultIds",
  );
  if (inputFrozenResultIds.length === 0) {
    throw new PressureFinaleContractError("FINALE_FROZEN_INPUT_REQUIRED");
  }

  return deepFreeze({
    schemaVersion: "finale_expression_v1",
    sourceContentHash: result.contentHash,
    worldOutcomeId: result.worldOutcomeId,
    trackBands: cloneJson(result.trackBands),
    seatVerdicts: cloneJson(result.seatVerdicts),
    causes: cloneJson(result.causes),
    replayHook: cloneJson(result.replayHook),
    inputFrozenResultIds,
  });
}

function assertText(field: string, value: string) {
  if (!String(value || "").trim()) {
    throw new PressureFinaleContractError("FINALE_REQUIRED_FIELD_EMPTY", field);
  }
}

function uniqueStrings(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values)) {
    throw new PressureFinaleContractError("FINALE_ARRAY_REQUIRED", field);
  }
  const normalized = values.map((value) => String(value || "").trim());
  if (normalized.some((value) => !value)) {
    throw new PressureFinaleContractError("FINALE_REFERENCE_EMPTY", field);
  }
  return [...new Set(normalized)];
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
