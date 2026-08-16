import { sha256Canonical } from "@ai-story/shared";
import type {
  AcceptedMultiplayerSeatBeatActionV1,
  MultiplayerSeatBeatCursorPlanV1,
  PlanMultiplayerSeatBeatCursorInputV1,
} from "./contracts";

export const MULTIPLAYER_SEAT_BEAT_ERROR_CODES_V1 = Object.freeze({
  MODE_INVALID: "PRESSURE_MULTIPLAYER_SEAT_BEAT_MODE_INVALID",
  INPUT_INVALID: "PRESSURE_MULTIPLAYER_SEAT_BEAT_INPUT_INVALID",
  ACTION_SEQUENCE_INVALID: "PRESSURE_MULTIPLAYER_SEAT_BEAT_ACTION_SEQUENCE_INVALID",
} as const);

export class MultiplayerSeatBeatPlanErrorV1 extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    public readonly detail: string,
  ) {
    super(`${code}:${path}:${detail}`);
    this.name = "MultiplayerSeatBeatPlanErrorV1";
  }
}

/**
 * Derives one human seat's private Beat cursor from its durable action prefix.
 * It does not mutate the shared chapter runtime, Working Ledger or Settlement.
 */
export function planMultiplayerSeatBeatCursorV1(
  input: Readonly<PlanMultiplayerSeatBeatCursorInputV1>,
): MultiplayerSeatBeatCursorPlanV1 {
  if (input.participantMode !== "MULTIPLAYER") {
    fail(MULTIPLAYER_SEAT_BEAT_ERROR_CODES_V1.MODE_INVALID, "participantMode", "MULTIPLAYER_REQUIRED");
  }
  const chapterRuntimeId = text(input.chapterRuntimeId, "chapterRuntimeId");
  const chapterId = text(input.package.chapterId, "package.chapterId");
  if (
    input.package.schemaVersion !== "pressure_chapter_beat_authoring_package_v1"
    || input.package.beats.length === 0
  ) {
    fail(MULTIPLAYER_SEAT_BEAT_ERROR_CODES_V1.INPUT_INVALID, "package", "AUTHORING_PACKAGE_REQUIRED");
  }

  const actions = validateActionPrefix(input.acceptedActions, input.package.beats);
  const completedDecisionPointIds = actions.map((item) => item.decisionPointId);
  const completedActionIds = actions.map((item) => item.actionId);
  const next = input.package.beats[actions.length] ?? null;
  const body = next
    ? {
        schemaVersion: "pressure_multiplayer_seat_beat_cursor_plan_v1" as const,
        chapterRuntimeId,
        chapterId,
        seatId: input.seatId,
        completedDecisionPointIds,
        completedActionIds,
        status: "AWAITING_DECISION" as const,
        beatId: next.beatId,
        decisionPointId: next.catalogDecisionPointRef,
        closesChapter: next.closesChapter,
      }
    : {
        schemaVersion: "pressure_multiplayer_seat_beat_cursor_plan_v1" as const,
        chapterRuntimeId,
        chapterId,
        seatId: input.seatId,
        completedDecisionPointIds,
        completedActionIds,
        status: "CHAPTER_READY_FOR_CONVERGENCE" as const,
        beatId: null,
        decisionPointId: null,
        closesChapter: true,
      };
  return Object.freeze({ ...body, planHash: sha256Canonical(body) });
}

function validateActionPrefix(
  values: readonly AcceptedMultiplayerSeatBeatActionV1[],
  beats: PlanMultiplayerSeatBeatCursorInputV1["package"]["beats"],
): AcceptedMultiplayerSeatBeatActionV1[] {
  if (!Array.isArray(values) || values.length > beats.length) {
    fail(MULTIPLAYER_SEAT_BEAT_ERROR_CODES_V1.ACTION_SEQUENCE_INVALID, "acceptedActions", "PREFIX_LENGTH");
  }
  const actionIds = new Set<string>();
  return values.map((value, index) => {
    const decisionPointId = text(value?.decisionPointId, `acceptedActions.${index}.decisionPointId`);
    const actionId = text(value?.actionId, `acceptedActions.${index}.actionId`);
    if (actionIds.has(actionId)) {
      fail(MULTIPLAYER_SEAT_BEAT_ERROR_CODES_V1.ACTION_SEQUENCE_INVALID, `acceptedActions.${index}.actionId`, "DUPLICATE");
    }
    actionIds.add(actionId);
    if (beats[index]?.catalogDecisionPointRef !== decisionPointId) {
      fail(
        MULTIPLAYER_SEAT_BEAT_ERROR_CODES_V1.ACTION_SEQUENCE_INVALID,
        `acceptedActions.${index}.decisionPointId`,
        `EXPECTED_${beats[index]?.catalogDecisionPointRef ?? "NONE"}`,
      );
    }
    return { decisionPointId, actionId };
  });
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(MULTIPLAYER_SEAT_BEAT_ERROR_CODES_V1.INPUT_INVALID, path, "NON_EMPTY_STRING");
  }
  return value.trim();
}

function fail(code: string, path: string, detail: string): never {
  throw new MultiplayerSeatBeatPlanErrorV1(code, path, detail);
}
