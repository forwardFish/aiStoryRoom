import {
  compareCanonicalText,
  sha256Canonical,
  validateRunRouteSnapshotV1,
} from "@ai-story/shared";
import type {
  DurableAcceptedMultiplayerSeatActionsV1,
  ReadAcceptedMultiplayerSeatActionsInputV1,
} from "./contracts";

export const MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1 = Object.freeze({
  MODE_INVALID: "PRESSURE_MULTIPLAYER_SEAT_PROGRESSION_MODE_INVALID",
  AUTHORITY_MISMATCH: "PRESSURE_MULTIPLAYER_SEAT_PROGRESSION_AUTHORITY_MISMATCH",
  ACTION_PREFIX_INVALID: "PRESSURE_MULTIPLAYER_SEAT_PROGRESSION_ACTION_PREFIX_INVALID",
  SUBMISSION_INVALID: "PRESSURE_MULTIPLAYER_SEAT_PROGRESSION_SUBMISSION_INVALID",
} as const);

export class MultiplayerSeatProgressionErrorV1 extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    public readonly detail: string,
  ) {
    super(`${code}:${path}:${detail}`);
    this.name = "MultiplayerSeatProgressionErrorV1";
  }
}

/**
 * Extracts one seat's contiguous authored action prefix from the durable
 * Working Ledger projection. It never reads another seat's private payload.
 */
export function readAcceptedMultiplayerSeatActionsV1(
  input: Readonly<ReadAcceptedMultiplayerSeatActionsInputV1>,
): DurableAcceptedMultiplayerSeatActionsV1 {
  const route = validateRunRouteSnapshotV1(input.routeSnapshot);
  if (route.participantMode !== "MULTIPLAYER") {
    fail(MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.MODE_INVALID, "route.participantMode", "MULTIPLAYER_REQUIRED");
  }
  const runtimeId = nonEmpty(input.chapterRuntimeId, "chapterRuntimeId");
  const chapterId = input.chapterId;
  const projection = input.projection;
  if (
    input.package.schemaVersion !== "pressure_chapter_beat_authoring_package_v1"
    || input.package.chapterId !== chapterId
    || projection.key.runId !== route.runId
    || projection.key.chapterRuntimeId !== runtimeId
    || projection.routeHash !== route.routeHash
    || projection.chapterId !== chapterId
  ) {
    fail(MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.AUTHORITY_MISMATCH, "projection", "RUN_CHAPTER_PACKAGE_BINDING");
  }

  const byDecision = new Map<string, Array<{ decisionPointId: string; actionId: string }>>();
  for (const accepted of projection.acceptedActions.values()) {
    const action = accepted.action;
    if (action.seatId !== input.seatId) continue;
    if (
      action.runId !== route.runId
      || action.chapterRuntimeId !== runtimeId
      || action.chapterId !== chapterId
      || action.status !== "SEALED"
    ) {
      fail(MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.AUTHORITY_MISMATCH, `actions.${action.actionId}`, "ACTION_BINDING");
    }
    const list = byDecision.get(action.decisionPointId) ?? [];
    list.push({ decisionPointId: action.decisionPointId, actionId: action.actionId });
    byDecision.set(action.decisionPointId, list);
  }

  const authoredIds = new Set(input.package.beats.map((beat) => beat.catalogDecisionPointRef));
  for (const decisionPointId of byDecision.keys()) {
    if (!authoredIds.has(decisionPointId)) {
      fail(MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.ACTION_PREFIX_INVALID, `actions.${decisionPointId}`, "NOT_AUTHORED");
    }
  }

  const actions: Array<{ decisionPointId: string; actionId: string }> = [];
  let gap = false;
  for (const beat of input.package.beats) {
    const values = (byDecision.get(beat.catalogDecisionPointRef) ?? [])
      .sort((left, right) => compareCanonicalText(left.actionId, right.actionId));
    if (values.length > 1) {
      fail(MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.ACTION_PREFIX_INVALID, `actions.${beat.catalogDecisionPointRef}`, "MULTIPLE_ACTIONS_FOR_BEAT");
    }
    if (!values.length) {
      gap = true;
      continue;
    }
    if (gap) {
      fail(MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.ACTION_PREFIX_INVALID, `actions.${beat.catalogDecisionPointRef}`, "NON_CONTIGUOUS_PREFIX");
    }
    actions.push(values[0]!);
  }

  const body = {
    schemaVersion: "pressure_durable_accepted_multiplayer_seat_actions_v1" as const,
    runId: route.runId,
    routeHash: route.routeHash,
    chapterRuntimeId: runtimeId,
    chapterId,
    seatId: input.seatId,
    actions,
    ledgerHeadHash: projection.headHash,
    workingRevision: projection.state.revision,
  };
  return Object.freeze({ ...body, prefixHash: sha256Canonical(body) });
}

function nonEmpty(value: string, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.AUTHORITY_MISMATCH, path, "NON_EMPTY_STRING");
  }
  return value.trim();
}

export function failMultiplayerSeatProgressionV1(
  code: string,
  path: string,
  detail: string,
): never {
  return fail(code, path, detail);
}

function fail(code: string, path: string, detail: string): never {
  throw new MultiplayerSeatProgressionErrorV1(code, path, detail);
}
