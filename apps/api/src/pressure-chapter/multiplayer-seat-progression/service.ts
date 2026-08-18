import {
  sha256Canonical,
  validateRunRouteSnapshotV1,
  type ChapterIdV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterBeatAuthoringV1 } from "@ai-story/templates";
import type {
  AuthoredChapterContentPort,
  SubmitOrchestratedActionCommandV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type { FormalPressureInteractionService } from "../interaction/formal-interaction.service";
import type {
  PressureFormalDecisionActivityPortV1,
  PressureInteractionAccessV1,
  SubmitFormalInteractionCommandV1,
} from "../interaction/contracts";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import {
  LEGACY_MULTIPLAYER_ONLY_BEAT_SUBMIT_POLICY_V1,
  type PressureBeatSubmitPolicyPortV1,
  usesIndependentSeatBeatFlowV1,
} from "../beat-submit-policy/policy";
import { planMultiplayerSeatBeatCursorV1 } from "../multiplayer-seat-beat/plan";
import {
  MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1,
  failMultiplayerSeatProgressionV1,
  readAcceptedMultiplayerSeatActionsV1,
} from "./accepted-actions";
import type {
  MultiplayerSeatProgressionPortV1,
  MultiplayerSeatProgressionResultV1,
} from "./contracts";

/**
 * Per-seat application service for registered multi-Beat chapters. Accepted actions remain in the
 * existing Working Ledger; the cursor is rebuilt on every read and is never a
 * second mutable authority.
 */
export class MultiplayerSeatProgressionServiceV1
implements MultiplayerSeatProgressionPortV1 {
  constructor(
    private readonly working: WorkingProjectionReaderPort,
    private readonly formalActions: Pick<FormalPressureInteractionService, "submit">,
  ) {}

  async read(input: Readonly<{
    routeSnapshot: SubmitOrchestratedActionCommandV1["routeSnapshot"];
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
    seatId: SeatIdV1;
  }>): Promise<MultiplayerSeatProgressionResultV1> {
    const route = validateRunRouteSnapshotV1(input.routeSnapshot);
    if (!usesIndependentSeatBeatFlowV1({
      participantMode: route.participantMode,
      chapterId: input.chapterId,
    })) {
      failMultiplayerSeatProgressionV1(
        MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.MODE_INVALID,
        "chapter.beatSubmitPolicy",
        "INDEPENDENT_SEAT_BEATS_REQUIRED",
      );
    }
    const projection = await this.working.load({
      runId: route.runId,
      chapterRuntimeId: input.chapterRuntimeId,
    });
    return projectMultiplayerSeatProgressionV1(
      route, input.chapterRuntimeId, input.chapterId, input.seatId, projection, "NOT_SUBMITTED",
    );
  }

  async submit(
    raw: Readonly<SubmitOrchestratedActionCommandV1>,
  ): Promise<MultiplayerSeatProgressionResultV1> {
    const command = structuredClone(raw);
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    if (!usesIndependentSeatBeatFlowV1({
      participantMode: route.participantMode,
      chapterId: command.action.chapterId,
    })) {
      failMultiplayerSeatProgressionV1(
        MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.MODE_INVALID,
        "chapter.beatSubmitPolicy",
        "INDEPENDENT_SEAT_BEATS_REQUIRED",
      );
    }
    const before = await this.working.load({
      runId: route.runId,
      chapterRuntimeId: command.action.chapterRuntimeId,
    });
    const prior = before.actionsByIdempotencyKey.get(command.action.idempotencyKey);
    if (prior) {
      if (
        prior.action.sealedHash !== command.action.sealedHash
        || prior.inputFingerprint !== command.inputFingerprint
        || sha256Canonical(prior.intent) !== sha256Canonical(command.intent)
      ) {
        failMultiplayerSeatProgressionV1(
          MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.SUBMISSION_INVALID,
          "command.action.idempotencyKey",
          "REUSED_WITH_DIFFERENT_COMMAND",
        );
      }
      return projectMultiplayerSeatProgressionV1(
        route,
        command.action.chapterRuntimeId,
        command.action.chapterId,
        command.action.seatId,
        before,
        "REPLAYED",
      );
    }
    const current = projectMultiplayerSeatProgressionV1(
      route,
      command.action.chapterRuntimeId,
      command.action.chapterId,
      command.action.seatId,
      before,
      "NOT_SUBMITTED",
    );
    if (
      current.cursor.status !== "AWAITING_DECISION"
      || current.cursor.decisionPointId !== command.action.decisionPointId
      || command.action.expectedWorkingRevision !== before.state.revision
    ) {
      failMultiplayerSeatProgressionV1(
        MULTIPLAYER_SEAT_PROGRESSION_ERROR_CODES_V1.SUBMISSION_INVALID,
        "command.action",
        "SEAT_CURSOR_MISMATCH",
      );
    }
    const submitted = await this.formalActions.submit({
      routeSnapshot: route,
      subjectId: command.subjectId,
      action: command.action,
      intent: command.intent,
      inputFingerprint: command.inputFingerprint,
    });
    const after = await this.working.load({
      runId: route.runId,
      chapterRuntimeId: command.action.chapterRuntimeId,
    });
    return projectMultiplayerSeatProgressionV1(
      route,
      command.action.chapterRuntimeId,
      command.action.chapterId,
      command.action.seatId,
      after,
      submitted.status,
    );
  }

}

export class MultiplayerFormalDecisionActivityServiceV1
implements PressureFormalDecisionActivityPortV1 {
  constructor(
    private readonly content: Pick<AuthoredChapterContentPort, "load">,
    private readonly beatSubmitPolicy: PressureBeatSubmitPolicyPortV1 =
      LEGACY_MULTIPLAYER_ONLY_BEAT_SUBMIT_POLICY_V1,
  ) {}

  async resolve(input: Readonly<{
    command: SubmitFormalInteractionCommandV1;
    projection: WorkingLedgerProjectionV1;
    access: PressureInteractionAccessV1;
  }>): Promise<"DELEGATE" | "ACTIVE" | "INACTIVE"> {
    const route = validateRunRouteSnapshotV1(input.command.routeSnapshot);
    if (!this.beatSubmitPolicy.usesIndependentSeatBeats({
      participantMode: route.participantMode,
      chapterId: input.command.action.chapterId,
    })) return "DELEGATE";
    if (
      input.access.routeHash !== route.routeHash
      || !input.access.controlledSeatIds.includes(input.command.action.seatId)
      || input.access.controlEpochBySeat[input.command.action.seatId]
        !== input.command.action.controlEpoch
    ) return "INACTIVE";
    const result = projectMultiplayerSeatProgressionV1(
      route,
      input.command.action.chapterRuntimeId,
      input.command.action.chapterId,
      input.command.action.seatId,
      input.projection,
      "NOT_SUBMITTED",
    );
    if (
      result.cursor.status !== "AWAITING_DECISION"
      || result.cursor.decisionPointId !== input.command.action.decisionPointId
    ) return "INACTIVE";
    const descriptor = await this.content.load({
      routeSnapshot: route,
      chapterId: input.command.action.chapterId,
    });
    const decision = descriptor.decisions.find(
      (candidate) => candidate.decisionPointId === input.command.action.decisionPointId,
    );
    return decision
      && decision.seatRequirements[input.command.action.seatId] === "REQUIRED"
      && decision.execution.allowedActionTypes.includes(input.command.action.actionType)
      ? "ACTIVE"
      : "INACTIVE";
  }
}

export function projectMultiplayerSeatProgressionV1(
  route: ReturnType<typeof validateRunRouteSnapshotV1>,
  chapterRuntimeId: string,
  chapterId: ChapterIdV1,
  seatId: SeatIdV1,
  projection: WorkingLedgerProjectionV1,
  submissionStatus: MultiplayerSeatProgressionResultV1["submissionStatus"],
): MultiplayerSeatProgressionResultV1 {
  const authoring = loadSangtianPressureChapterBeatAuthoringV1(chapterId);
  const accepted = readAcceptedMultiplayerSeatActionsV1({
    routeSnapshot: route,
    chapterRuntimeId,
    chapterId,
    seatId,
    package: authoring,
    projection,
  });
  const cursor = planMultiplayerSeatBeatCursorV1({
    participantMode: route.participantMode,
    chapterRuntimeId,
    seatId,
    package: authoring,
    acceptedActions: accepted.actions,
  });
  return Object.freeze({
    schemaVersion: "pressure_multiplayer_seat_progression_result_v1",
    submissionStatus,
    cursor,
    accepted,
  });
}
