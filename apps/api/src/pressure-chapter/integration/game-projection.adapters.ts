import {
  chapterSequence,
  sha256Canonical,
  validateWorldStateV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterPackageV1 } from "@ai-story/templates";
import type {
  PressureGameChapterReaderPort,
  PressureGameChapterSourceV1,
  PressureGameWorldReaderPort,
  PressureGameWorldSourceV1,
} from "../game-projection/contracts";
import type {
  AuthoredChapterContentPort,
  ChapterOrchestratorStatePort,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import {
  assertStoredRunRouteRecord,
  type StoredRunRouteReaderPort,
} from "../run-router";
import { SangtianPressureGameContentMapperV1 } from "./content.adapters";
import { failPressureChapterIntegration } from "./errors";

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
    if (
      projection.key.runId !== input.runId
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
      metrics: this.loaded.content.genesis.tracks.map((track) => {
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
