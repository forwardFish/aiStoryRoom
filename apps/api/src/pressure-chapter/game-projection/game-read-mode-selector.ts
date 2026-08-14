import { canonicalJson } from "@ai-story/shared";
import { isDeepStrictEqual } from "node:util";
import type {
  PressureChapterGameProjectionV1,
  ReadPressureChapterGameProjectionQueryV1,
} from "./contracts";
import {
  PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
  type GameReadSnapshotRequestV1,
  type GameReadSnapshotResolvedSourcesV1,
  type GameReadSnapshotV1,
} from "./game-read-snapshot";

export const PRESSURE_GAME_READ_MODES_V1 = Object.freeze([
  "REPLAY",
  "SHADOW",
  "FAST",
] as const);

export type PressureGameReadModeV1 =
  (typeof PRESSURE_GAME_READ_MODES_V1)[number];

export const PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1 =
  "pressure_game_read_shadow_diagnostic_v1" as const;

export type PressureGameReadShadowDiagnosticStageV1 =
  | "REQUEST"
  | "SNAPSHOT"
  | "PROJECTOR"
  | "COMPARE";

export type PressureGameReadShadowDiagnosticV1 =
  | Readonly<{
      schemaVersion: typeof PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1;
      mode: "SHADOW";
      outcome: "MATCH" | "MISMATCH";
      stage: "COMPARE";
      deepEqual: boolean;
      canonicalEqual: boolean;
    }>
  | Readonly<{
      schemaVersion: typeof PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1;
      mode: "SHADOW";
      outcome: "ERROR";
      stage: PressureGameReadShadowDiagnosticStageV1;
    }>;

export const PRESSURE_GAME_READ_MODE_ERROR_CODES_V1 = Object.freeze({
  MODE_INVALID: "PRESSURE_GAME_READ_MODE_INVALID",
  CLOCK_INVALID: "PRESSURE_GAME_READ_CLOCK_INVALID",
} as const);

export type PressureGameReadModeErrorCodeV1 =
  (typeof PRESSURE_GAME_READ_MODE_ERROR_CODES_V1)[keyof typeof PRESSURE_GAME_READ_MODE_ERROR_CODES_V1];

export class PressureGameReadModeErrorV1 extends Error {
  readonly code: PressureGameReadModeErrorCodeV1;

  constructor(code: PressureGameReadModeErrorCodeV1) {
    super(code);
    this.name = "PressureGameReadModeErrorV1";
    this.code = code;
  }
}

export interface PressureGameReadSnapshotCaptureRequestV1
  extends GameReadSnapshotRequestV1 {
  capturedAtMs: number;
}

export interface PressureGameReadLegacyReaderPortV1 {
  read(
    query: Readonly<ReadPressureChapterGameProjectionQueryV1>,
  ): Promise<PressureChapterGameProjectionV1>;
}

export interface PressureGameReadSnapshotReaderPortV1 {
  readSnapshot(
    request: Readonly<PressureGameReadSnapshotCaptureRequestV1>,
  ): Promise<GameReadSnapshotV1>;
}

export interface PressureGameReadProjectorPortV1 {
  projectFromResolvedSources(
    sources: GameReadSnapshotResolvedSourcesV1,
  ): Promise<PressureChapterGameProjectionV1>;
}

export interface PressureGameReadClockPortV1 {
  nowMs(): number;
}

export interface PressureGameReadShadowDiagnosticPortV1 {
  report(
    diagnostic: PressureGameReadShadowDiagnosticV1,
  ): void | Promise<void>;
}

export interface PressureGameReadModeSelectorDependenciesV1 {
  legacy: PressureGameReadLegacyReaderPortV1;
  snapshots: PressureGameReadSnapshotReaderPortV1;
  projector: PressureGameReadProjectorPortV1;
  clock: PressureGameReadClockPortV1;
  diagnostics: PressureGameReadShadowDiagnosticPortV1;
}

export function parsePressureGameReadModeV1(
  value: unknown,
): PressureGameReadModeV1 {
  if (value === undefined || value === "") return "REPLAY";
  if (value === "REPLAY" || value === "SHADOW" || value === "FAST") {
    return value;
  }
  throw new PressureGameReadModeErrorV1(
    PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.MODE_INVALID,
  );
}

export class PressureGameReadModeSelectorV1 {
  constructor(
    private readonly dependencies: Readonly<PressureGameReadModeSelectorDependenciesV1>,
  ) {}

  async read(
    mode: PressureGameReadModeV1,
    query: Readonly<ReadPressureChapterGameProjectionQueryV1>,
  ): Promise<PressureChapterGameProjectionV1> {
    if (mode === "REPLAY") return this.dependencies.legacy.read(query);
    if (mode === "SHADOW") return this.readShadow(query);
    if (mode === "FAST") return this.readFast(query);
    throw new PressureGameReadModeErrorV1(
      PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.MODE_INVALID,
    );
  }

  private async readShadow(
    query: Readonly<ReadPressureChapterGameProjectionQueryV1>,
  ): Promise<PressureChapterGameProjectionV1> {
    const legacy = await this.dependencies.legacy.read(query);
    let stage: PressureGameReadShadowDiagnosticStageV1 = "REQUEST";

    try {
      const request = snapshotRequest(query, this.dependencies.clock.nowMs());
      stage = "SNAPSHOT";
      const snapshot = await this.dependencies.snapshots.readSnapshot(request);
      stage = "PROJECTOR";
      const candidate = await this.dependencies.projector
        .projectFromResolvedSources(snapshot.sources);
      stage = "COMPARE";
      const deepEqual = isDeepStrictEqual(legacy, candidate);
      const canonicalEqual = canonicalJson(legacy) === canonicalJson(candidate);
      await this.report({
        schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
        mode: "SHADOW",
        outcome: deepEqual && canonicalEqual ? "MATCH" : "MISMATCH",
        stage: "COMPARE",
        deepEqual,
        canonicalEqual,
      });
    } catch {
      await this.report({
        schemaVersion: PRESSURE_GAME_READ_SHADOW_DIAGNOSTIC_SCHEMA_V1,
        mode: "SHADOW",
        outcome: "ERROR",
        stage,
      });
    }

    return legacy;
  }

  private async readFast(
    query: Readonly<ReadPressureChapterGameProjectionQueryV1>,
  ): Promise<PressureChapterGameProjectionV1> {
    const request = snapshotRequest(query, this.dependencies.clock.nowMs());
    const snapshot = await this.dependencies.snapshots.readSnapshot(request);
    return this.dependencies.projector.projectFromResolvedSources(
      snapshot.sources,
    );
  }

  private async report(
    diagnostic: PressureGameReadShadowDiagnosticV1,
  ): Promise<void> {
    try {
      await this.dependencies.diagnostics.report(Object.freeze(diagnostic));
    } catch {
      return;
    }
  }
}

function snapshotRequest(
  query: Readonly<ReadPressureChapterGameProjectionQueryV1>,
  capturedAtMs: number,
): PressureGameReadSnapshotCaptureRequestV1 {
  if (!Number.isSafeInteger(capturedAtMs) || capturedAtMs < 0) {
    throw new PressureGameReadModeErrorV1(
      PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.CLOCK_INVALID,
    );
  }
  return {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
    roomId: query.runId,
    runId: query.runId,
    subjectId: query.subjectId,
    feedCursor: query.feedCursor ?? null,
    feedLimit: query.feedLimit ?? 10,
    capturedAtMs,
  };
}
