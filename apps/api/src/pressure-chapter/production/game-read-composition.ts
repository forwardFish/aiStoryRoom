import type {
  PressureChapterGameProjectionV1,
  ReadPressureChapterGameProjectionQueryV1,
} from "../game-projection/contracts";
import type { GameReadSnapshotV1 } from "../game-projection/game-read-snapshot";
import {
  PressureGameReadModeSelectorV1,
  type PressureGameReadClockPortV1,
  type PressureGameReadLegacyReaderPortV1,
  type PressureGameReadModeV1,
  type PressureGameReadProjectorPortV1,
  type PressureGameReadShadowDiagnosticPortV1,
  type PressureGameReadShadowDiagnosticV1,
  type PressureGameReadSnapshotCaptureRequestV1,
  type PressureGameReadSnapshotReaderPortV1,
} from "../game-projection/game-read-mode-selector";
import type {
  CaptureGameReadSnapshotV1,
  GameReadSnapshotLocalAuthoritiesV1,
} from "../persistence/game-read-snapshot.prisma-adapter";

export interface PressureGameReadSnapshotCapturePortV1 {
  capture(
    input: Readonly<CaptureGameReadSnapshotV1>,
  ): Promise<GameReadSnapshotV1>;
}

export interface PressureGameReadBoundReaderPortV1 {
  read(
    query: Readonly<ReadPressureChapterGameProjectionQueryV1>,
  ): Promise<PressureChapterGameProjectionV1>;
}

export class NoopPressureGameReadShadowDiagnosticAdapterV1
implements PressureGameReadShadowDiagnosticPortV1 {
  report(_diagnostic: PressureGameReadShadowDiagnosticV1): void {}
}

/** Maps M4A's capture request to M2 without forwarding selector-only fields. */
export class PressureGameReadSnapshotCaptureBridgeV1
implements PressureGameReadSnapshotReaderPortV1 {
  constructor(
    private readonly snapshots: PressureGameReadSnapshotCapturePortV1,
  ) {}

  readSnapshot(
    request: Readonly<PressureGameReadSnapshotCaptureRequestV1>,
  ): Promise<GameReadSnapshotV1> {
    return this.snapshots.capture({
      roomId: request.roomId,
      runId: request.runId,
      subjectId: request.subjectId,
      feedCursor: request.feedCursor,
      feedLimit: request.feedLimit,
      capturedAtMs: request.capturedAtMs,
    });
  }
}

export interface ComposePressureGameReadV1Input {
  mode: PressureGameReadModeV1;
  legacy: PressureGameReadLegacyReaderPortV1;
  snapshots: PressureGameReadSnapshotCapturePortV1;
  projector: PressureGameReadProjectorPortV1;
  clock: PressureGameReadClockPortV1;
  diagnostics?: PressureGameReadShadowDiagnosticPortV1;
}

export interface PressureGameReadCompositionV1 {
  mode: PressureGameReadModeV1;
  reader: PressureGameReadBoundReaderPortV1;
}

/**
 * Binds one startup-selected mode to the frozen M4A selector. HTTP callers do
 * not receive or supply the mode, and M2 remains behind its one capture port.
 */
export function composePressureGameReadV1(
  input: Readonly<ComposePressureGameReadV1Input>,
): PressureGameReadCompositionV1 {
  const selector = new PressureGameReadModeSelectorV1({
    legacy: input.legacy,
    snapshots: new PressureGameReadSnapshotCaptureBridgeV1(input.snapshots),
    projector: input.projector,
    clock: input.clock,
    diagnostics: input.diagnostics
      ?? new NoopPressureGameReadShadowDiagnosticAdapterV1(),
  });
  const reader: PressureGameReadBoundReaderPortV1 = Object.freeze({
    read: (query: Readonly<ReadPressureChapterGameProjectionQueryV1>) => (
      selector.read(input.mode, query)
    ),
  });
  return Object.freeze({ mode: input.mode, reader });
}

export interface ComposeGameReadSnapshotLocalAuthoritiesV1Input {
  chapters: GameReadSnapshotLocalAuthoritiesV1["chapters"];
  presentation: GameReadSnapshotLocalAuthoritiesV1["presentation"];
  seatCatalog: GameReadSnapshotLocalAuthoritiesV1["seatCatalog"];
  compilePrivateProjection: GameReadSnapshotLocalAuthoritiesV1[
    "privateProjection"
  ]["compile"];
}

/**
 * Narrows M2 local authorities to package-owned, captured-input operations.
 * In particular, the returned seat/private ports expose no Prisma reader.
 */
export function composeGameReadSnapshotLocalAuthoritiesV1(
  input: Readonly<ComposeGameReadSnapshotLocalAuthoritiesV1Input>,
): GameReadSnapshotLocalAuthoritiesV1 {
  return Object.freeze({
    chapters: Object.freeze({
      load: (request: Parameters<GameReadSnapshotLocalAuthoritiesV1["chapters"]["load"]>[0]) => (
        input.chapters.load(request)
      ),
    }),
    presentation: Object.freeze({
      chapterTitle: (chapterId: Parameters<GameReadSnapshotLocalAuthoritiesV1["presentation"]["chapterTitle"]>[0]) => (
        input.presentation.chapterTitle(chapterId)
      ),
      metrics: (world: Parameters<GameReadSnapshotLocalAuthoritiesV1["presentation"]["metrics"]>[0]) => (
        input.presentation.metrics(world)
      ),
    }),
    seatCatalog: Object.freeze({
      readCatalogFromRoute: (request: Parameters<GameReadSnapshotLocalAuthoritiesV1["seatCatalog"]["readCatalogFromRoute"]>[0]) => (
        input.seatCatalog.readCatalogFromRoute(request)
      ),
    }),
    privateProjection: Object.freeze({
      compile: (request: Parameters<GameReadSnapshotLocalAuthoritiesV1["privateProjection"]["compile"]>[0]) => (
        input.compilePrivateProjection(request)
      ),
    }),
  });
}
