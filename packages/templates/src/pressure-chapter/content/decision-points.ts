import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  validateDecisionPointDefinitionV1,
  validateDeterministicPredicateV1,
  type ChapterIdV1,
  type DecisionPointDefinitionV1,
  type DeterministicDefaultPolicyV1,
  type DeterministicPredicateV1,
  type ScalarFactValueV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  SANGTIAN_CONTENT_ERROR_CODES_V1 as ERROR,
  failSangtianContentV1,
} from "./errors";
import type {
  CompiledSangtianChapterContentV1,
  SangtianContentDecisionPointV1,
  SangtianPressureChapterContentV1,
} from "./types";

type Raw = Record<string, unknown>;

const POINT_KEYS = [
  "decisionPointKey",
  "ordinal",
  "mode",
  "purpose",
  "requiredSeatIds",
  "allowedActionTypes",
  "perSeatActionBudget",
  "closeFactRef",
  "deadlineMs",
  "absenceDefaultRef",
  "aiFailureDefaultRef",
  "beatResolutionPolicy",
  "allowedWorkingDeltaTypes",
  "feedbackVisibilityPolicy",
  "availability",
  "reaction",
  "sourceRefs",
] as const;

export function compileSangtianDecisionPointDefinitionV1(
  value: unknown,
  chapterId: ChapterIdV1,
  defaults: SangtianPressureChapterContentV1["defaultPolicies"],
): {
  definition: DecisionPointDefinitionV1;
  availability: DeterministicPredicateV1 | null;
  sourceRefs: string[];
} {
  const point = object(value, `chapters.${chapterId}.decisionPoint`);
  exact(point, POINT_KEYS, `chapters.${chapterId}.decisionPoint`);
  const typed = point as unknown as SangtianContentDecisionPointV1;
  nonEmpty(typed.decisionPointKey, "decisionPoint.decisionPointKey");
  integer(typed.ordinal, "decisionPoint.ordinal", 1);
  if (!["SOLO_BEAT", "TARGETED_INTERACTION", "SYNC_CONTEST"].includes(typed.mode)) {
    invalid("decisionPoint.mode", "MODE");
  }
  nonEmpty(typed.purpose, "decisionPoint.purpose");
  const requiredSeatIds = seatArray(typed.requiredSeatIds, "decisionPoint.requiredSeatIds", true);
  if (typed.mode === "SOLO_BEAT" && requiredSeatIds.length !== 1) {
    invalid("decisionPoint.requiredSeatIds", "SOLO_EXACTLY_ONE");
  }
  const allowedActionTypes = sortedStrings(
    typed.allowedActionTypes,
    "decisionPoint.allowedActionTypes",
    true,
  );
  integer(typed.perSeatActionBudget, "decisionPoint.perSeatActionBudget", 1);
  nonEmpty(typed.closeFactRef, "decisionPoint.closeFactRef");
  if (typed.deadlineMs !== null) integer(typed.deadlineMs, "decisionPoint.deadlineMs", 1);
  nonEmpty(typed.absenceDefaultRef, "decisionPoint.absenceDefaultRef");
  nonEmpty(typed.aiFailureDefaultRef, "decisionPoint.aiFailureDefaultRef");
  if (typed.absenceDefaultRef !== defaults.absence.policyRef) {
    invalid("decisionPoint.absenceDefaultRef", `EXPECTED_${defaults.absence.policyRef}`);
  }
  if (typed.aiFailureDefaultRef !== defaults.aiFailure.policyRef) {
    invalid("decisionPoint.aiFailureDefaultRef", `EXPECTED_${defaults.aiFailure.policyRef}`);
  }
  nonEmpty(typed.beatResolutionPolicy, "decisionPoint.beatResolutionPolicy");
  const allowedWorkingDeltaTypes = sortedStrings(
    typed.allowedWorkingDeltaTypes,
    "decisionPoint.allowedWorkingDeltaTypes",
    true,
  );
  nonEmpty(typed.feedbackVisibilityPolicy, "decisionPoint.feedbackVisibilityPolicy");
  const sourceRefs = sortedStrings(typed.sourceRefs, "decisionPoint.sourceRefs", true);
  const availability = typed.availability === null
    ? null
    : validateDeterministicPredicateV1(typed.availability, "decisionPoint.availability");
  const reaction = object(typed.reaction, "decisionPoint.reaction");
  exact(
    reaction,
    ["enabled", "eligibleSeatIds", "triggerFactRef"],
    "decisionPoint.reaction",
  );
  if (typeof typed.reaction.enabled !== "boolean") invalid("decisionPoint.reaction.enabled");
  const eligibleSeatIds = seatArray(
    typed.reaction.eligibleSeatIds,
    "decisionPoint.reaction.eligibleSeatIds",
    typed.reaction.enabled,
  );
  if (eligibleSeatIds.some((seatId) => !requiredSeatIds.includes(seatId))) {
    invalid("decisionPoint.reaction.eligibleSeatIds", "NOT_REQUIRED");
  }
  if (typed.reaction.enabled) {
    nonEmpty(typed.reaction.triggerFactRef, "decisionPoint.reaction.triggerFactRef");
  } else if (typed.reaction.triggerFactRef !== null || eligibleSeatIds.length !== 0) {
    invalid("decisionPoint.reaction", "DISABLED_REQUIRES_EMPTY");
  }

  const absence = compileDefault(defaults.absence, allowedActionTypes, "absence");
  const aiFailure = compileDefault(defaults.aiFailure, allowedActionTypes, "aiFailure");
  const closeCondition: DeterministicPredicateV1 = {
    op: "COMPARE",
    factRef: typed.closeFactRef,
    comparator: "EQ",
    value: true,
  };
  const definition = validateDecisionPointDefinitionV1({
    decisionPointKey: typed.decisionPointKey,
    chapterId,
    ordinal: typed.ordinal,
    mode: typed.mode,
    purpose: typed.purpose,
    requiredSeatIds,
    allowedActionTypes,
    perSeatActionBudget: Object.fromEntries(
      requiredSeatIds.map((seatId) => [seatId, typed.perSeatActionBudget]),
    ),
    closeCondition,
    deadlinePolicy: typed.deadlineMs === null
      ? null
      : {
          durationMs: typed.deadlineMs,
          clock: "SERVER_MONOTONIC",
          expiryAction: "APPLY_DEFAULT",
        },
    absenceDefaultPolicy: absence,
    aiFailureDefaultPolicy: aiFailure,
    beatResolutionPolicy: typed.beatResolutionPolicy,
    allowedWorkingDeltaTypes,
    feedbackVisibilityPolicy: typed.feedbackVisibilityPolicy,
    reactionPolicy: typed.reaction.enabled
      ? {
          enabled: true,
          eligibleSeatIds,
          trigger: {
            op: "COMPARE",
            factRef: typed.reaction.triggerFactRef,
            comparator: "EQ",
            value: true,
          },
          maxDepth: 1,
        }
      : { enabled: false, eligibleSeatIds: [], trigger: null, maxDepth: 0 },
  });
  return { definition, availability, sourceRefs };
}

/** Runtime selection for content-driven points; it never assumes a fixed count. */
export function selectAvailableSangtianDecisionPointsV1(
  chapter: CompiledSangtianChapterContentV1,
  workingFacts: Readonly<Record<string, ScalarFactValueV1>>,
): CompiledSangtianChapterContentV1["decisionPoints"] {
  return chapter.decisionPoints.filter((point) =>
    point.availability === null || availabilityMatches(point.availability, workingFacts),
  );
}

function availabilityMatches(
  predicate: DeterministicPredicateV1,
  facts: Readonly<Record<string, ScalarFactValueV1>>,
): boolean {
  if (predicate.op === "ALL") {
    return predicate.clauses.every((clause) => availabilityMatches(clause, facts));
  }
  if (predicate.op === "ANY") {
    return predicate.clauses.some((clause) => availabilityMatches(clause, facts));
  }
  if (predicate.op === "NOT") return !availabilityMatches(predicate.clause, facts);
  if (!("factRef" in predicate)) return false;
  const actual = facts[predicate.factRef];
  if (predicate.comparator === "IN") {
    return (predicate.value as ScalarFactValueV1[]).some((candidate) => candidate === actual);
  }
  if (predicate.comparator === "EQ") return actual === predicate.value;
  if (predicate.comparator === "NE") return actual !== predicate.value;
  if (typeof actual !== "number" || typeof predicate.value !== "number") return false;
  if (predicate.comparator === "GT") return actual > predicate.value;
  if (predicate.comparator === "GTE") return actual >= predicate.value;
  if (predicate.comparator === "LT") return actual < predicate.value;
  return actual <= predicate.value;
}

function compileDefault(
  value: { policyRef: string; actionType: string; payload: Record<string, ScalarFactValueV1> },
  allowedActionTypes: string[],
  path: string,
): DeterministicDefaultPolicyV1 {
  if (!allowedActionTypes.includes(value.actionType)) {
    invalid(`decisionPoint.${path}Default.actionType`, "NOT_ALLOWED");
  }
  const withoutHash = {
    policyRef: value.policyRef,
    actionType: value.actionType,
    payload: structuredClone(value.payload),
  };
  return { ...withoutHash, policyHash: sha256Canonical(withoutHash) };
}

function object(value: unknown, path: string): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "OBJECT");
  return value as Raw;
}

function exact(value: Raw, fields: readonly string[], path: string): void {
  const extra = Object.keys(value).find((field) => !fields.includes(field));
  if (extra) invalid(`${path}.${extra}`, "UNKNOWN_FIELD");
  const missing = fields.find((field) => !(field in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
}

function integer(value: unknown, path: string, minimum: number): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < minimum) invalid(path, `INTEGER_GTE_${minimum}`);
}

function sortedStrings(value: unknown, path: string, nonEmptyArray = false): string[] {
  if (!Array.isArray(value) || (nonEmptyArray && value.length === 0)) invalid(path, "STRING_ARRAY");
  const result = value.map((item, index) => {
    nonEmpty(item, `${path}[${index}]`);
    return item;
  });
  if (new Set(result).size !== result.length) invalid(path, "DUPLICATE");
  if (result.some((item, index) => index > 0 && compareCanonicalText(result[index - 1]!, item) >= 0)) {
    invalid(path, "SORTED_UNIQUE");
  }
  return result;
}

function seatArray(value: unknown, path: string, nonEmptyArray = false): SeatIdV1[] {
  const seats = sortedStrings(value, path, nonEmptyArray) as SeatIdV1[];
  if (seats.some((seatId) => !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId))) {
    invalid(path, "UNKNOWN_SEAT");
  }
  const ranks = seats.map((seatId) => PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(seatId));
  if (ranks.some((rank, index) => index > 0 && ranks[index - 1]! >= rank)) {
    invalid(path, "CANONICAL_SEAT_ORDER");
  }
  return seats;
}

function invalid(path: string, detail?: string): never {
  failSangtianContentV1(ERROR.DECISION_POINT_INVALID, path, detail);
}
