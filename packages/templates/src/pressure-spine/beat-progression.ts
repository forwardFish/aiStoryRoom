import { sha256Bytes, canonicalJson } from "./canonical";
import type { PressureChapterBeatAuthoringPackageV1 } from "./beat-authoring-contracts";

export const PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1 = Object.freeze({
  INVALID: "PRESSURE_BEAT_PROGRESSION_INVALID",
  CONFLICT: "PRESSURE_BEAT_PROGRESSION_CONFLICT",
  BINDING_MISMATCH: "PRESSURE_BEAT_PROGRESSION_BINDING_MISMATCH",
  ILLEGAL_REPEAT: "PRESSURE_BEAT_PROGRESSION_ILLEGAL_REPEAT",
  PREMATURE_CLOSE: "PRESSURE_BEAT_PROGRESSION_PREMATURE_CLOSE",
} as const);

export type PressureBeatProgressionPlanV1 = Readonly<{
  schemaVersion: "pressure_beat_progression_plan_v1";
  kind: "NEXT_BEAT" | "CHAPTER_SUMMARY_READY";
  chapterId: string;
  chapterRuntimeId: string;
  currentBeatId: string;
  currentDecisionPointId: string;
  nextBeatId: string | null;
  nextDecisionPointId: string | null;
  authorityRevisionBefore: number;
  authorityRevisionAfter: number;
  planHash: string;
}>;

export class PressureBeatProgressionErrorV1 extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    public readonly detail: string,
  ) {
    super(`${code}:${path}:${detail}`);
    this.name = "PressureBeatProgressionErrorV1";
  }
}

/**
 * Content-driven progression proof. It consumes the already authoritative
 * nextDecisionPin produced by Working Ledger/Action Guard and never creates a
 * decision, settlement result or chapter transition by itself.
 */
export function planPressureBeatProgressionV1(input: Readonly<{
  package: PressureChapterBeatAuthoringPackageV1;
  chapterRuntimeId: string;
  currentBeatId: string;
  currentDecisionPointId: string;
  nextDecisionPin: { decisionPointId: string } | null;
  expectedAuthorityRevision: number;
  actualAuthorityRevision: number;
  expectedFenceToken: string;
  actualFenceToken: string;
}>): PressureBeatProgressionPlanV1 {
  const chapterRuntimeId = text(input.chapterRuntimeId, "input.chapterRuntimeId");
  const currentBeatId = text(input.currentBeatId, "input.currentBeatId");
  const currentDecisionPointId = text(
    input.currentDecisionPointId,
    "input.currentDecisionPointId",
  );
  const expectedRevision = revision(
    input.expectedAuthorityRevision,
    "input.expectedAuthorityRevision",
  );
  const actualRevision = revision(
    input.actualAuthorityRevision,
    "input.actualAuthorityRevision",
  );
  if (expectedRevision !== actualRevision) {
    fail(
      PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.CONFLICT,
      "input.actualAuthorityRevision",
      `EXPECTED_${expectedRevision}`,
    );
  }
  const expectedFence = text(input.expectedFenceToken, "input.expectedFenceToken");
  const actualFence = text(input.actualFenceToken, "input.actualFenceToken");
  if (expectedFence !== actualFence) {
    fail(
      PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.CONFLICT,
      "input.actualFenceToken",
      "FENCE_MISMATCH",
    );
  }
  if (
    input.package.schemaVersion !== "pressure_chapter_beat_authoring_package_v1"
    || !input.package.chapterId?.trim()
    || !Array.isArray(input.package.beats)
  ) {
    fail(PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.INVALID, "input.package", "PACKAGE");
  }
  const current = input.package.beats.find((beat) => beat.beatId === currentBeatId);
  if (!current || current.catalogDecisionPointRef !== currentDecisionPointId) {
    fail(
      PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.BINDING_MISMATCH,
      "input.currentBeatId",
      "BEAT_DECISION_BINDING",
    );
  }

  const base = {
    schemaVersion: "pressure_beat_progression_plan_v1" as const,
    chapterId: input.package.chapterId,
    chapterRuntimeId,
    currentBeatId,
    currentDecisionPointId,
    authorityRevisionBefore: actualRevision,
    authorityRevisionAfter: actualRevision + 1,
  };
  if (input.nextDecisionPin) {
    const nextDecisionPointId = text(
      input.nextDecisionPin.decisionPointId,
      "input.nextDecisionPin.decisionPointId",
    );
    if (nextDecisionPointId === currentDecisionPointId) {
      fail(
        PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.ILLEGAL_REPEAT,
        "input.nextDecisionPin.decisionPointId",
        "CURRENT_DECISION_REPEATED",
      );
    }
    if (current.closesChapter || current.advanceCondition.kind !== "AUTHORITY_NEXT_DECISION_PIN") {
      fail(
        PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.BINDING_MISMATCH,
        "input.nextDecisionPin",
        "TERMINAL_BEAT_HAS_NEXT_PIN",
      );
    }
    const successors = current.successorBeatIds
      .map((beatId) => input.package.beats.find((candidate) => candidate.beatId === beatId))
      .filter((beat): beat is NonNullable<typeof beat> => Boolean(beat));
    const next = successors.find(
      (beat) => beat.catalogDecisionPointRef === nextDecisionPointId,
    );
    if (!next) {
      fail(
        PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.BINDING_MISMATCH,
        "input.nextDecisionPin.decisionPointId",
        "NOT_A_DECLARED_SUCCESSOR",
      );
    }
    return seal({
      ...base,
      kind: "NEXT_BEAT" as const,
      nextBeatId: next.beatId,
      nextDecisionPointId,
    });
  }

  if (!current.closesChapter || current.advanceCondition.kind !== "CHAPTER_SUMMARY_READY") {
    fail(
      PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.PREMATURE_CLOSE,
      "input.nextDecisionPin",
      "NON_TERMINAL_BEAT_CANNOT_CLOSE",
    );
  }
  return seal({
    ...base,
    kind: "CHAPTER_SUMMARY_READY" as const,
    nextBeatId: null,
    nextDecisionPointId: null,
  });
}

function seal(
  body: Omit<PressureBeatProgressionPlanV1, "planHash">,
): PressureBeatProgressionPlanV1 {
  return Object.freeze({
    ...body,
    planHash: sha256Bytes(canonicalJson(body)),
  });
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.INVALID, path, "NON_EMPTY_STRING");
  }
  return value.trim();
}

function revision(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(PRESSURE_BEAT_PROGRESSION_ERROR_CODES_V1.INVALID, path, "NON_NEGATIVE_REVISION");
  }
  return Number(value);
}

function fail(code: string, path: string, detail: string): never {
  throw new PressureBeatProgressionErrorV1(code, path, detail);
}
