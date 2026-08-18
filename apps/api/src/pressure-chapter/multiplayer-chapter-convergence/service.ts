import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  validateRunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterBeatAuthoringV1 } from "@ai-story/templates";
import type {
  PressureDecisionConvergencePortV1,
} from "../decision-automation/contracts";
import type { RuntimeChapterOrchestratorPortV1 } from "../runtime/contracts";
import type {
  ChapterOrchestratorStatePort,
  ChapterOrchestratorStateV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import type { SeatControlAuthorityPort } from "../seat-control/types";
import { planMultiplayerSeatBeatCursorV1 } from "../multiplayer-seat-beat/plan";
import { readAcceptedMultiplayerSeatActionsV1 } from "../multiplayer-seat-progression/accepted-actions";
import { usesIndependentSeatBeatFlowV1 } from "../beat-submit-policy/policy";
import type {
  MultiplayerChapterConvergenceCommandV1,
  MultiplayerChapterConvergencePortV1,
  MultiplayerChapterConvergenceResultV1,
} from "./contracts";

export const MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1 = Object.freeze({
  MODE_INVALID: "PRESSURE_MULTIPLAYER_CHAPTER_CONVERGENCE_MODE_INVALID",
  AUTHORITY_MISMATCH: "PRESSURE_MULTIPLAYER_CHAPTER_CONVERGENCE_AUTHORITY_MISMATCH",
  ACTION_PREFIX_INVALID: "PRESSURE_MULTIPLAYER_CHAPTER_CONVERGENCE_ACTION_PREFIX_INVALID",
  CONVERGENCE_STALLED: "PRESSURE_MULTIPLAYER_CHAPTER_CONVERGENCE_STALLED",
} as const);

export class MultiplayerChapterConvergenceErrorV1 extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    public readonly detail: string,
  ) {
    super(`${code}:${path}:${detail}`);
    this.name = "MultiplayerChapterConvergenceErrorV1";
  }
}

/**
 * Chapter-end-only reconciliation for registered multi-Beat chapters. Human actions have already been persisted;
 * this service replays them through the shared orchestrator, then delegates AI
 * filling and the single authoritative Beat/Settlement path to the existing
 * convergence service.
 */
export class MultiplayerChapterConvergenceServiceV1
implements MultiplayerChapterConvergencePortV1 {
  constructor(
    private readonly states: Pick<ChapterOrchestratorStatePort, "read">,
    private readonly working: WorkingProjectionReaderPort,
    private readonly seats: Pick<SeatControlAuthorityPort, "readSnapshot">,
    private readonly runtime: Required<Pick<
      RuntimeChapterOrchestratorPortV1,
      "reconcileAcceptedMultiplayerAction" | "resume"
    >>,
    private readonly convergence: PressureDecisionConvergencePortV1,
  ) {}

  async convergeIfReady(
    raw: Readonly<MultiplayerChapterConvergenceCommandV1>,
  ): Promise<MultiplayerChapterConvergenceResultV1> {
    const route = validateRunRouteSnapshotV1(raw.routeSnapshot);
    if (!usesIndependentSeatBeatFlowV1({
      participantMode: route.participantMode,
      chapterId: raw.chapterId,
    })) {
      return fail(
        MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.MODE_INVALID,
        "chapter.beatSubmitPolicy",
        "INDEPENDENT_SEAT_BEATS_REQUIRED",
      );
    }
    if (!Number.isSafeInteger(raw.nowMs) || raw.nowMs < 0) {
      return fail(MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.AUTHORITY_MISMATCH, "nowMs", "NON_NEGATIVE_SAFE_INTEGER");
    }
    const initialRaw = await this.states.read(route.runId);
    if (!initialRaw) {
      return result("ALREADY_PROGRESSED", [], null);
    }
    const initial = validateOrchestratorStateV1(initialRaw);
    if (
      initial.chapterRuntimeId !== raw.chapterRuntimeId
      || initial.currentChapterId !== raw.chapterId
    ) return result("ALREADY_PROGRESSED", [], initial);

    const authoring = loadSangtianPressureChapterBeatAuthoringV1(raw.chapterId);
    const initialProjection = await this.working.load({
      runId: route.runId,
      chapterRuntimeId: raw.chapterRuntimeId,
    });
    const humanAudienceSeatIds = canonicalHumanSeats(route.humanSeatIdsAtStart);
    const authority = await this.seats.readSnapshot(route.runId);
    if (!authority || authority.routeHash !== route.routeHash) {
      return fail(MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.AUTHORITY_MISMATCH, "seatAuthority", "MISSING_OR_STALE");
    }
    const activeHumanSeatIds = humanAudienceSeatIds.filter((seatId) => (
      authority.seatControls.find((seat) => seat.seatId === seatId)?.mode === "HUMAN_ACTIVE"
    ));
    const waitingSeatIds = activeHumanSeatIds.filter((seatId) => {
      const accepted = readAcceptedMultiplayerSeatActionsV1({
        routeSnapshot: route,
        chapterRuntimeId: raw.chapterRuntimeId,
        chapterId: raw.chapterId,
        seatId,
        package: authoring,
        projection: initialProjection,
      });
      return planMultiplayerSeatBeatCursorV1({
        participantMode: route.participantMode,
        chapterRuntimeId: raw.chapterRuntimeId,
        seatId,
        package: authoring,
        acceptedActions: accepted.actions,
      }).status !== "CHAPTER_READY_FOR_CONVERGENCE";
    });
    if (waitingSeatIds.length) return result("WAITING_FOR_HUMANS", waitingSeatIds, initial);

    let chapter = initial;
    const limit = (authoring.beats.length * 2) + 2;
    for (let pass = 0; pass < limit; pass += 1) {
      if (
        chapter.chapterRuntimeId !== raw.chapterRuntimeId
        || chapter.currentChapterId !== raw.chapterId
        || !chapter.activeDecision
      ) return result("CONVERGED", [], chapter);

      const activeDecision = chapter.activeDecision;
      const decisionPointId = activeDecision.decisionPointId;
      if (chapter.phase === "RESOLVING_BEAT" || chapter.phase === "SETTLING") {
        chapter = validateOrchestratorStateV1(await this.runtime.resume(route, raw.nowMs));
        continue;
      }
      if (chapter.phase !== "ACTIVE") return result("CONVERGED", [], chapter);
      const projection = await this.working.load({
        runId: route.runId,
        chapterRuntimeId: raw.chapterRuntimeId,
      });
      for (const seatId of humanAudienceSeatIds) {
        const activeSeat = activeDecision.seats.find((seat) => seat.seatId === seatId);
        if (!activeSeat || activeSeat.requirement !== "REQUIRED" || activeSeat.completion !== "PENDING") {
          continue;
        }
        const accepted = [...projection.acceptedActions.values()].filter((item) => (
          item.action.seatId === seatId
          && item.action.decisionPointId === decisionPointId
          && item.action.chapterRuntimeId === raw.chapterRuntimeId
        ));
        const controller = authority.seatControls.find((seat) => seat.seatId === seatId);
        if (!controller) {
          return fail(
            MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.AUTHORITY_MISMATCH,
            `seatAuthority.${seatId}`,
            "CONTROLLER_MISSING",
          );
        }
        if (accepted.length > 1 || (controller.mode === "HUMAN_ACTIVE" && accepted.length !== 1)) {
          return fail(
            MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.ACTION_PREFIX_INVALID,
            `actions.${decisionPointId}.${seatId}`,
            `EXPECTED_ONE_GOT_${accepted.length}`,
          );
        }
        if (!accepted.length) continue;
        if (controller.mode === "HUMAN_ACTIVE"
          && controller.controlEpoch !== accepted[0]!.action.controlEpoch) {
          return fail(MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.AUTHORITY_MISMATCH, `seatAuthority.${seatId}`, "HUMAN_CONTROLLER_MISMATCH");
        }
        chapter = validateOrchestratorStateV1(await this.runtime.reconcileAcceptedMultiplayerAction({
          routeSnapshot: route,
          actionId: accepted[0]!.action.actionId,
          nowMs: raw.nowMs,
        }));
      }

      const convergence = await this.convergence.converge({
        trigger: "RECOVERY",
        runId: route.runId,
        expectedRouteHash: route.routeHash,
        source: {
          chapterRuntimeId: raw.chapterRuntimeId,
          chapterId: raw.chapterId,
          decisionPointId,
        },
        nowMs: raw.nowMs,
        humanSubmitMs: 0,
        humanAction: null,
        authoritySnapshot: null,
      });
      if (!convergence.chapter) {
        return fail(MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.CONVERGENCE_STALLED, "convergence.chapter", convergence.outcome);
      }
      chapter = validateOrchestratorStateV1(convergence.chapter);
      if (convergence.outcome === "WAITING_FOR_HUMANS") {
        return fail(MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.CONVERGENCE_STALLED, "convergence.outcome", "HUMANS_ALREADY_READY");
      }
    }
    return fail(MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.CONVERGENCE_STALLED, "convergence.loop", "PASS_LIMIT");
  }
}

function canonicalHumanSeats(values: readonly string[]): SeatIdV1[] {
  const result = [...new Set(values)].map((seatId) => {
    if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId as SeatIdV1)) {
      return fail(
        MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.AUTHORITY_MISMATCH,
        "route.humanSeatIdsAtStart",
        `INVALID_SEAT_${seatId}`,
      );
    }
    return seatId as SeatIdV1;
  }).sort(compareCanonicalText);
  if (!result.length) {
    return fail(MULTIPLAYER_CHAPTER_CONVERGENCE_ERROR_CODES_V1.AUTHORITY_MISMATCH, "route.humanSeatIdsAtStart", "NON_EMPTY");
  }
  return result;
}

function result(
  status: MultiplayerChapterConvergenceResultV1["status"],
  waitingSeatIds: SeatIdV1[],
  chapter: ChapterOrchestratorStateV1 | null,
): MultiplayerChapterConvergenceResultV1 {
  return Object.freeze({
    schemaVersion: "pressure_multiplayer_chapter_convergence_result_v1",
    status,
    waitingSeatIds: [...waitingSeatIds],
    chapter: chapter ? structuredClone(chapter) : null,
  });
}

function fail(code: string, path: string, detail: string): never {
  throw new MultiplayerChapterConvergenceErrorV1(code, path, detail);
}
