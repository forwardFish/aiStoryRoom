import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  chapterSequence,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  validateWorldStateV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  loadSangtianPressureChapterBeatAuthoringV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import type {
  PressureGameChapterReaderPort,
  PressureGameChapterSourceV1,
  PressureGameWorldReaderPort,
  PressureGameWorldSourceV1,
} from "../game-projection/contracts";
import type {
  AuthoredChapterContentPort,
  AuthoredChapterRuntimeV1,
  ActiveDecisionStateV1,
  ChapterOrchestratorStatePort,
  ChapterOrchestratorStateV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import {
  assertStoredRunRouteRecord,
  type StoredRunRouteReaderPort,
} from "../run-router";
import { SangtianPressureGameContentMapperV1 } from "./content.adapters";
import { failPressureChapterIntegration } from "./errors";
import { planMultiplayerSeatBeatCursorV1 } from "../multiplayer-seat-beat/plan";
import { readAcceptedMultiplayerSeatActionsV1 } from "../multiplayer-seat-progression/accepted-actions";
import { compileMultiplayerSeatBeatStoryContextV1 } from "../multiplayer-seat-progression/story-context";
import { SANGTIAN_INITIAL_PLAYER_METRICS_V1 } from "../initial-player-state/sangtian-initial-player-state";

/**
 * Viewer-scoped chapter read composition. It joins only the frozen route,
 * durable orchestrator state, current Working projection and accepted content.
 * It deliberately has no cache: any future cache key must include both runId
 * and viewerSeatId because decision requirement/options are audience-scoped.
 */
export class SangtianPressureGameChapterReaderAdapterV1
implements PressureGameChapterReaderPort {
  constructor(
    private readonly routes: StoredRunRouteReaderPort,
    private readonly states: ChapterOrchestratorStatePort,
    private readonly working: WorkingProjectionReaderPort,
    private readonly content: AuthoredChapterContentPort,
    private readonly mapper: SangtianPressureGameContentMapperV1,
  ) {}

  async readCurrent(input: {
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
  }): Promise<PressureGameChapterSourceV1 | null> {
    return (await this.readCurrentWithProjection(input))?.chapter ?? null;
  }

  async readCurrentWithProjection(input: {
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
  }): Promise<Readonly<{
    chapter: PressureGameChapterSourceV1;
    projection: WorkingLedgerProjectionV1;
  }> | null> {
    if (!input.runId.trim() || !/^[a-f0-9]{64}$/.test(input.routeHash)) {
      invalid("gameChapter.query", "INVALID_BINDING");
    }
    const stored = assertStoredRunRouteRecord(
      await this.routes.readStoredRoute(input.runId),
    );
    if (
      stored.runId !== input.runId
      || stored.snapshot.routeHash !== input.routeHash
    ) {
      invalid("gameChapter.route", "SOURCE_BINDING_MISMATCH");
    }
    const rawState = await this.states.read(input.runId);
    if (!rawState) return null;
    const state = validateOrchestratorStateV1(rawState);
    if (state.runId !== input.runId || state.routeHash !== input.routeHash) {
      invalid("gameChapter.orchestrator", "SOURCE_BINDING_MISMATCH");
    }
    const [projection, chapter] = await Promise.all([
      this.working.load({
        runId: input.runId,
        chapterRuntimeId: state.chapterRuntimeId,
      }),
      this.content.load({
        routeSnapshot: stored.snapshot,
        chapterId: state.currentChapterId,
      }),
    ]);
    return {
      chapter: stored.snapshot.participantMode === "MULTIPLAYER"
        ? this.projectMultiplayerCurrent({
            runId: input.runId,
            routeHash: input.routeHash,
            viewerSeatId: input.viewerSeatId,
            routeSnapshot: stored.snapshot,
            state,
            projection,
            chapter,
          })
        : this.projectCurrent({
        runId: input.runId,
        routeHash: input.routeHash,
        viewerSeatId: input.viewerSeatId,
        state,
        projection,
        chapter,
          }),
      projection,
    };
  }

  projectMultiplayerCurrent(input: Readonly<{
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
    routeSnapshot: ReturnType<typeof validateRunRouteSnapshotV1>;
    state: ChapterOrchestratorStateV1;
    projection: WorkingLedgerProjectionV1;
    chapter: AuthoredChapterRuntimeV1;
  }>): PressureGameChapterSourceV1 {
    const state = validateOrchestratorStateV1(input.state);
    const projection = input.projection;
    const chapter = input.chapter;
    if (
      input.routeSnapshot.participantMode !== "MULTIPLAYER"
      || state.runId !== input.runId
      || state.routeHash !== input.routeHash
      || projection.key.runId !== input.runId
      || projection.key.chapterRuntimeId !== state.chapterRuntimeId
      || projection.routeHash !== input.routeHash
      || projection.chapterId !== state.currentChapterId
      || projection.chapterDefinitionHash !== sha256Canonical(chapter.definition)
      || state.descriptorHash !== chapter.descriptorHash
    ) {
      invalid("gameChapter.multiplayerAuthority", "CHAPTER_OR_WORKING_MISMATCH");
    }
    if (state.phase !== "ACTIVE") {
      return this.projectCurrent({
        runId: input.runId,
        routeHash: input.routeHash,
        viewerSeatId: input.viewerSeatId,
        state,
        projection,
        chapter,
      });
    }
    const authoring = loadSangtianPressureChapterBeatAuthoringV1(state.currentChapterId);
    const accepted = readAcceptedMultiplayerSeatActionsV1({
      routeSnapshot: input.routeSnapshot,
      chapterRuntimeId: state.chapterRuntimeId,
      chapterId: state.currentChapterId,
      seatId: input.viewerSeatId,
      package: authoring,
      projection,
    });
    const cursor = planMultiplayerSeatBeatCursorV1({
      participantMode: input.routeSnapshot.participantMode,
      chapterRuntimeId: state.chapterRuntimeId,
      seatId: input.viewerSeatId,
      package: authoring,
      acceptedActions: accepted.actions,
    });
    const activeDecision = cursor.status === "AWAITING_DECISION"
      ? projectionOnlyActiveDecisionV1(chapter, cursor.decisionPointId!)
      : null;
    const previousActionRef = accepted.actions.at(-1) ?? null;
    const previousAccepted = previousActionRef
      ? projection.acceptedActions.get(previousActionRef.actionId) ?? null
      : null;
    const previousDecision = previousAccepted
      ? this.mapper.decisionForSeat({
          chapter,
          activeDecision: projectionOnlyActiveDecisionV1(
            chapter,
            previousAccepted.action.decisionPointId,
          ),
          viewerSeatId: input.viewerSeatId,
          workingRevision: projection.state.revision,
        })
      : null;
    const previousOption = previousAccepted
      ? previousDecision?.options.find(
          (option) => option.actionType === previousAccepted.action.actionType,
        ) ?? null
      : null;
    const previousPresentation = previousAccepted
      ? this.mapper.actionPresentation({
          chapterId: state.currentChapterId,
          decisionPointId: previousAccepted.action.decisionPointId,
          actionType: previousAccepted.action.actionType,
        })
      : null;
    const customText = previousAccepted
      && typeof previousAccepted.action.payload.customText === "string"
      ? previousAccepted.action.payload.customText.trim()
      : "";
    const availableFactRefs = new Set([
      ...(projection.knowledgeBySeat.get(input.viewerSeatId) ?? []),
      ...(previousAccepted?.intent.evidenceRefs ?? []),
      ...(previousAccepted?.intent.knowledgeGrants
        .filter((grant) => grant.seatId === input.viewerSeatId)
        .flatMap((grant) => grant.factRefs) ?? []),
    ]);
    return {
      runId: input.runId,
      routeHash: input.routeHash,
      viewerSeatId: input.viewerSeatId,
      projectionVersion: pairVersion(state.revision, projection.headSequence),
      chapter: {
        chapterRuntimeId: state.chapterRuntimeId,
        chapterId: state.currentChapterId,
        chapterNumber: chapterSequence(state.currentChapterId),
        title: this.mapper.chapterTitle(state.currentChapterId),
        phase: state.phase,
        workingRevision: projection.state.revision,
      },
      decision: this.mapper.decisionForSeat({
        chapter,
        activeDecision,
        viewerSeatId: input.viewerSeatId,
        workingRevision: projection.state.revision,
      }),
      viewerBeatContext: {
        beatId: cursor.status === "AWAITING_DECISION" ? cursor.beatId : null,
        story: cursor.status === "AWAITING_DECISION"
          ? compileMultiplayerSeatBeatStoryContextV1({
              chapterId: state.currentChapterId,
              beatId: cursor.beatId!,
              viewerSeatId: input.viewerSeatId,
              availableFactRefs: [...availableFactRefs],
            })
          : null,
        previousPlayerAction: previousAccepted
          ? {
              decisionPointId: previousAccepted.action.decisionPointId,
              actionType: previousAccepted.action.actionType,
              displayText: customText
                || previousOption?.label
                || previousAccepted.action.actionType,
              effectText: previousPresentation!.description,
            }
          : null,
      },
    };
  }

  projectCurrent(input: Readonly<{
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
    state: ChapterOrchestratorStateV1;
    projection: WorkingLedgerProjectionV1;
    chapter: AuthoredChapterRuntimeV1;
  }>): PressureGameChapterSourceV1 {
    const state = validateOrchestratorStateV1(input.state);
    const projection = input.projection;
    const chapter = input.chapter;
    if (
      state.runId !== input.runId
      || state.routeHash !== input.routeHash
      || projection.key.runId !== input.runId
      || projection.key.chapterRuntimeId !== state.chapterRuntimeId
      || projection.routeHash !== input.routeHash
      || projection.chapterId !== state.currentChapterId
      || projection.chapterDefinitionHash !== sha256Canonical(chapter.definition)
      || state.descriptorHash !== chapter.descriptorHash
      || (
        state.activeDecision !== null
        && projection.nextDecisionPin?.decisionPointId
          !== state.activeDecision.decisionPointId
      )
    ) {
      invalid("gameChapter.authority", "CHAPTER_OR_WORKING_MISMATCH");
    }
    return {
      runId: input.runId,
      routeHash: input.routeHash,
      viewerSeatId: input.viewerSeatId,
      projectionVersion: pairVersion(state.revision, projection.headSequence),
      chapter: {
        chapterRuntimeId: state.chapterRuntimeId,
        chapterId: state.currentChapterId,
        chapterNumber: chapterSequence(state.currentChapterId),
        title: this.mapper.chapterTitle(state.currentChapterId),
        phase: state.phase,
        workingRevision: projection.state.revision,
      },
      decision: this.mapper.decisionForSeat({
        chapter,
        activeDecision: state.activeDecision,
        viewerSeatId: input.viewerSeatId,
        workingRevision: projection.state.revision,
      }),
    };
  }
}

function projectionOnlyActiveDecisionV1(
  chapter: AuthoredChapterRuntimeV1,
  decisionPointId: string,
): ActiveDecisionStateV1 {
  const decision = chapter.decisions.find(
    (candidate) => candidate.decisionPointId === decisionPointId,
  );
  if (!decision) invalid("gameChapter.multiplayerDecision", "NOT_AUTHORED");
  return {
    decisionPointId,
    policyHash: sha256Canonical(decision),
    openedAtMs: 0,
    deadlineAtMs: null,
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const requirement = decision.seatRequirements[seatId];
      return {
        seatId,
        requirement,
        completion: requirement === "REQUIRED" ? "PENDING" : "NOT_REQUIRED",
        actionIds: [],
        actionCount: 0,
        defaultCode: null,
      };
    }),
  };
}

/**
 * W1 read-model seam. It must read only Genesis/Frozen authority state and is
 * forbidden from deriving WorldState from WorkingLedger, Narrative or Result.
 */
export interface AuthoritativePressureGameWorldSourcePort {
  readCurrentWorld(runId: string): Promise<Readonly<{
    runId: string;
    routeHash: string;
    worldState: WorldStateV1;
  }> | null>;
}

export class SangtianPressureGameWorldReaderAdapterV1
implements PressureGameWorldReaderPort {
  private readonly loaded = loadSangtianPressureChapterPackageV1();

  constructor(private readonly source: AuthoritativePressureGameWorldSourcePort) {}

  async readWorld(runId: string): Promise<PressureGameWorldSourceV1 | null> {
    if (typeof runId !== "string" || !runId.trim()) {
      invalid("gameWorld.runId", "NON_EMPTY_STRING");
    }
    const raw = await this.source.readCurrentWorld(runId);
    if (!raw) return null;
    const world = validateWorldStateV1(raw.worldState);
    if (
      raw.runId !== runId
      || !/^[a-f0-9]{64}$/.test(raw.routeHash)
    ) {
      invalid("gameWorld.authority", "SOURCE_BINDING_MISMATCH");
    }
    return {
      runId,
      routeHash: raw.routeHash,
      worldSequence: world.worldSequence,
      worldStateHash: world.stateHash,
      metrics: world.worldSequence === 0
        ? SANGTIAN_INITIAL_PLAYER_METRICS_V1.map((metric) => ({
          trackId: metric.trackId,
          label: metric.label,
          value: metric.value,
          displayValue: String(metric.value),
          tone: "DEFAULT" as const,
        }))
        : this.loaded.content.genesis.tracks.map((track) => {
          const value = world.tracks.values[track.trackId];
          if (!Number.isFinite(value)) {
            invalid(`gameWorld.tracks.${track.trackId}`, "FINITE_NUMBER");
          }
          return {
            trackId: track.trackId,
            label: track.name,
            value,
            displayValue: String(value),
            tone: "DEFAULT" as const,
          };
        }),
    };
  }
}

function invalid(path: string, detail?: string): never {
  return failPressureChapterIntegration(
    "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
    path,
    detail,
  );
}

/** Collision-free pairing for two non-negative durable counters. */
function pairVersion(orchestratorRevision: number, ledgerHeadSequence: number): number {
  if (
    !Number.isSafeInteger(orchestratorRevision)
    || orchestratorRevision < 0
    || !Number.isSafeInteger(ledgerHeadSequence)
    || ledgerHeadSequence < 0
  ) {
    invalid("gameChapter.projectionVersion", "NON_NEGATIVE_SAFE_INTEGER");
  }
  const sum = orchestratorRevision + ledgerHeadSequence;
  const paired = ((sum * (sum + 1)) / 2) + ledgerHeadSequence + 1;
  if (!Number.isSafeInteger(paired)) {
    invalid("gameChapter.projectionVersion", "SAFE_INTEGER_OVERFLOW");
  }
  return paired;
}
