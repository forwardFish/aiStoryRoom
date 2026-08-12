import type { InjectionToken } from "@nestjs/common";
import type { PressureChapterInternalProductionAdapterOptionsV1 } from "../product-adapters";
import type { ProgressOutboxWorkerConfigV1 } from "../progress-outbox/ports";

export const PRESSURE_CHAPTER_PRODUCT_TOKENS = Object.freeze({
  ROOT: Symbol.for("PressureChapterProduct.Root"),
  PRODUCTION_BRIDGE: Symbol.for("PressureChapterProduct.ProductionBridge"),
  ROOMS_GATEWAY: Symbol.for("PressureChapterProduct.RoomsGateway"),
  IS_PRESSURE: Symbol.for("PressureChapterProduct.IsPressure"),
  HTTP_CONTROLLER_METHODS: Symbol.for("PressureChapterProduct.HttpControllerMethods"),
  SEAT_TRANSPORT: Symbol.for("PressureChapterProduct.SeatTransport"),
  PROMISES: Symbol.for("PressureChapterProduct.Promises"),
  RUNTIME: Symbol.for("PressureChapterProduct.Runtime"),
  A_EMOTION_PIPELINE: Symbol.for("PressureChapterProduct.AEmotionPipeline"),
  PROGRESS_WORKER: Symbol.for("PressureChapterProduct.ProgressWorker"),
  WORKER_LIFECYCLE: Symbol.for("PressureChapterProduct.WorkerLifecycle"),
  OPERATIONAL_READINESS: Symbol.for("PressureChapterProduct.OperationalReadiness"),
} satisfies Record<string, InjectionToken>);

export const PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1 =
  "PRESSURE_CHAPTER_WORKER_OWNER" as const;

export type PressureChapterWorkerOwnerV1 =
  | "embedded_api"
  | "independent_worker";

export type PressureChapterWorkerProcessRoleV1 =
  | "api"
  | "independent_worker";

export interface PressureChapterWorkerOwnershipSnapshotV1 {
  schemaVersion: "pressure_chapter_worker_ownership_v1";
  processRole: PressureChapterWorkerProcessRoleV1;
  configuredOwner: PressureChapterWorkerOwnerV1;
  configuredOwnerExplicit: boolean;
  topology: "embedded" | "independent";
  ownsWorkerLanes: boolean;
  ready: boolean;
  code?: "PRESSURE_WORKER_OWNERSHIP_INVALID";
  detail?: string;
}

export function resolvePressureChapterWorkerOwnershipV1(
  env: NodeJS.ProcessEnv,
): PressureChapterWorkerOwnershipSnapshotV1 {
  const processRole: PressureChapterWorkerProcessRoleV1 =
    env.STORY_WORKER_PROCESS === "true"
      ? "independent_worker"
      : "api";
  const configured = parsePressureChapterWorkerOwnerV1(
    env[PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1],
  );
  if (!configured.ok) {
    return {
      schemaVersion: "pressure_chapter_worker_ownership_v1",
      processRole,
      configuredOwner: "embedded_api",
      configuredOwnerExplicit: true,
      topology: "embedded",
      ownsWorkerLanes: false,
      ready: false,
      code: "PRESSURE_WORKER_OWNERSHIP_INVALID",
      detail: configured.detail,
    };
  }
  const configuredOwner = configured.owner;
  return {
    schemaVersion: "pressure_chapter_worker_ownership_v1",
    processRole,
    configuredOwner,
    configuredOwnerExplicit: configured.explicit,
    topology: configuredOwner === "embedded_api" ? "embedded" : "independent",
    ownsWorkerLanes:
      configuredOwner === "embedded_api"
        ? processRole === "api"
        : processRole === "independent_worker",
    ready: true,
  };
}

export interface PressureChapterProductOptionsV1 {
  internalAdapters: PressureChapterInternalProductionAdapterOptionsV1;
  progressWorker: Partial<ProgressOutboxWorkerConfigV1>;
  workerRuntime: {
    pollMs: number;
    perLaneLimit: number;
    unrefTimers: boolean;
  };
  decisionAutomation: {
    retryMs: number;
  };
  aEmotionWorker: {
    leaseMs: number;
    infrastructureRetryMs: number;
  };
}

export const DEFAULT_PRESSURE_CHAPTER_PRODUCT_OPTIONS_V1 = Object.freeze({
  internalAdapters: Object.freeze({}),
  progressWorker: Object.freeze({}),
  workerRuntime: Object.freeze({
    pollMs: 250,
    perLaneLimit: 8,
    unrefTimers: true,
  }),
  decisionAutomation: Object.freeze({
    retryMs: 1_000,
  }),
  aEmotionWorker: Object.freeze({
    leaseMs: 30_000,
    infrastructureRetryMs: 5_000,
  }),
} satisfies PressureChapterProductOptionsV1);

/** Machine-checkable trust zones used by the composition contract tests. */
export const PRESSURE_CHAPTER_PRODUCT_DEPENDENCY_GRAPH_V1 = Object.freeze({
  authority: Object.freeze([
    "RunRouter",
    "Genesis",
    "SeatControl",
    "ChapterOrchestrator",
    "WorkingLedger",
    "BeatResolution",
    "ChapterSettlement",
    "FinaleCommitter",
  ]),
  postCommit: Object.freeze([
    "NarrativeOutboxSignal",
    "GenericFinaleShadow",
    "OpenNovelNarrativeProjector",
    "AEmotionProjection",
  ]),
  readOnly: Object.freeze([
    "GameProjection",
    "ResultQuery",
    "AudienceProjection",
    "ReplayPolicyRead",
  ]),
  forbiddenAuthorityDependencies: Object.freeze([
    "Provider",
    "OpenNovelNarrativeProjector",
    "ResultQuery",
    "WebRenderer",
    "LegacyRuntime",
  ]),
});

export const PRESSURE_CHAPTER_GET_CAPABILITY_SURFACE_V1 = Object.freeze({
  game: Object.freeze([
    "authorize",
    "readStoredRoute",
    "readViewer",
    "readCurrentChapter",
    "readWorld",
    "readNarrative",
    "listAEmotionFeed",
    "readCapabilities",
  ]),
  result: Object.freeze([
    "authorize",
    "readStoredRoute",
    "readFinalizedResult",
    "readViewerContext",
    "listReplayActions",
  ]),
  forbidden: Object.freeze([
    "create",
    "update",
    "delete",
    "commit",
    "settle",
    "finalize",
    "publish",
    "notify",
  ]),
});

function parsePressureChapterWorkerOwnerV1(
  raw: string | undefined,
): {
  ok: true;
  owner: PressureChapterWorkerOwnerV1;
  explicit: boolean;
} | {
  ok: false;
  detail: string;
} {
  if (raw === undefined || !raw.trim()) {
    return {
      ok: true,
      owner: "embedded_api",
      explicit: false,
    };
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "embedded_api"
    || normalized === "embedded"
    || normalized === "api"
  ) {
    return {
      ok: true,
      owner: "embedded_api",
      explicit: true,
    };
  }
  if (
    normalized === "independent_worker"
    || normalized === "independent"
    || normalized === "worker"
  ) {
    return {
      ok: true,
      owner: "independent_worker",
      explicit: true,
    };
  }
  return {
    ok: false,
    detail: `${PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1} must be embedded_api or independent_worker`,
  };
}
