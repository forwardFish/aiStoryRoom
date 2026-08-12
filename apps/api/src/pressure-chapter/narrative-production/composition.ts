import type { PrismaService } from "../../prisma.service";
import {
  NarrativeOutboxConsumerV1,
  type AuthoritativeNarrativeSourceReaderPortV1,
  type NarrativeOutboxConsumerConfigV1,
  type NarrativeOutboxPortV1,
  type OpenNovelNarrativeProjectorPortV1,
} from "../narrative";
import {
  PrismaAuthoritativeNarrativeSourceReader,
  PrismaNarrativeOutboxRepository,
  PrismaNarrativeProjectionStateRepository,
  type AuthoritativeNarrativeSnapshotCompilerPortV1,
  type NarrativeAuthorityReadPrismaClient,
  type NarrativeOutboxPrismaClient,
  type NarrativeProjectionPrismaClient,
} from "../persistence";
import type {
  NarrativeArtifactPublisherPortV1,
  NarrativeClockPortV1,
  NarrativeProfileResolverPortV1,
  NarrativeProjectionStatePortV1,
  NarrativeProviderPortV1,
} from "@apps/openovel-runtime/pressure-narrative/ports";
import { SangtianAuthoritativeNarrativeSnapshotCompilerV1 } from "../narrative-authority/compiler";
import { InProcessOpenNovelNarrativeProjectorAdapterV1 } from "./in-process-adapter";
import {
  InProcessPressureNarrativeOutboxSignalV1,
  PressureNarrativeInProcessWorkerV1,
  type PressureNarrativeInProcessWorkerOptionsV1,
} from "./outbox-signal";
import {
  PublishedPressureNarrativeProfileResolverV1,
  type PressureNarrativeOperationalProfileOptionsV1,
} from "./published-profile-resolver";
import { PressureNarrativeProviderBoundaryV1 } from "./provider-boundary";
import {
  deployedOpenNovelPressureNarrativeRuntimeLoaderV1,
  type DeployedOpenNovelPressureNarrativeRuntimeLoaderOptionsV1,
  type OpenNovelPressureNarrativeRuntimeLoaderPortV1,
  validateOpenNovelPressureNarrativeRuntimeModuleV1,
} from "./runtime-module";
import type { NarrativeOutboxSignalPort } from "../terminal-commit";
import {
  PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureNarrativeProduction,
} from "./errors";

export interface PressureNarrativeProductionExecutionV1 {
  consumer: NarrativeOutboxConsumerV1;
  projector: OpenNovelNarrativeProjectorPortV1;
  profiles: NarrativeProfileResolverPortV1;
  providerBoundary: PressureNarrativeProviderBoundaryV1;
  projectionState: NarrativeProjectionStatePortV1;
  artifactPublisher: NarrativeArtifactPublisherPortV1;
  profileVersion: string;
  projectorVersion: string;
  providerMode: "EXTERNAL_PROVIDER" | "DETERMINISTIC_FALLBACK_ONLY";
}

export interface PressureNarrativeProductionCompositionInputV1 {
  outbox: NarrativeOutboxPortV1;
  authority: AuthoritativeNarrativeSourceReaderPortV1;
  projectionPersistence:
    NarrativeProjectionStatePortV1 & NarrativeArtifactPublisherPortV1;
  runtimeLoader: OpenNovelPressureNarrativeRuntimeLoaderPortV1;
  provider?: NarrativeProviderPortV1 | null;
  clock?: NarrativeClockPortV1;
  consumerConfig?: Partial<NarrativeOutboxConsumerConfigV1>;
  profileOptions?: Partial<PressureNarrativeOperationalProfileOptionsV1>;
}

export interface PrismaPressureNarrativeProductionInputV1
extends Omit<
  PressureNarrativeProductionCompositionInputV1,
  "outbox" | "authority" | "projectionPersistence"
> {
  prisma: PrismaService;
  authoritativeSnapshotCompiler?: AuthoritativeNarrativeSnapshotCompilerPortV1;
}

export interface PrismaPressureNarrativeProductBundleInputV1 {
  prisma: PrismaService;
  provider?: NarrativeProviderPortV1 | null;
  runtimeLoader?: OpenNovelPressureNarrativeRuntimeLoaderPortV1;
  runtimeLoaderOptions?: DeployedOpenNovelPressureNarrativeRuntimeLoaderOptionsV1;
  clock?: NarrativeClockPortV1;
  consumerConfig?: Partial<NarrativeOutboxConsumerConfigV1>;
  profileOptions?: Partial<PressureNarrativeOperationalProfileOptionsV1>;
  workerOptions?: PressureNarrativeInProcessWorkerOptionsV1;
  startWorker?: boolean;
}

/** Exact aliases consumed by PressureChapterTrueExternalProductionPortsV1. */
export interface PressureNarrativeProductBundleV1 {
  narrativeProjectorVersion: string;
  narrativeOutboxSignal: NarrativeOutboxSignalPort;
  narrativeSnapshotCompiler: AuthoritativeNarrativeSnapshotCompilerPortV1;
  openNovelNarrativeProjector: OpenNovelNarrativeProjectorPortV1;
  consumer: NarrativeOutboxConsumerV1;
  worker: PressureNarrativeInProcessWorkerV1;
  execution: PressureNarrativeProductionExecutionV1;
  providerMode: "EXTERNAL_PROVIDER" | "DETERMINISTIC_FALLBACK_ONLY";
}

const SYSTEM_CLOCK: NarrativeClockPortV1 = Object.freeze({
  nowMs: () => Date.now(),
});

const DEFAULT_CONSUMER_CONFIG: NarrativeOutboxConsumerConfigV1 = Object.freeze({
  leaseMs: 30_000,
  infrastructureRetryMs: 5_000,
});

/**
 * Complete committed-outbox -> audience projection -> OpenNovel -> artifact
 * execution graph. It receives no authority writer capability.
 */
export async function createPressureNarrativeProductionExecutionV1(
  input: PressureNarrativeProductionCompositionInputV1,
): Promise<PressureNarrativeProductionExecutionV1> {
  validateCompositionInput(input);
  const runtime = validateOpenNovelPressureNarrativeRuntimeModuleV1(
    await input.runtimeLoader.load(),
  );
  const clock = input.clock ?? SYSTEM_CLOCK;
  const providerBoundary = new PressureNarrativeProviderBoundaryV1(
    input.provider ?? null,
  );
  const profiles = new PublishedPressureNarrativeProfileResolverV1({
    providerConfigured: providerBoundary.configured,
    options: input.profileOptions,
  });
  const renderer = new runtime.NarrativeRendererV1(providerBoundary);
  const publisher = new runtime.NarrativePublisherV1(
    input.projectionPersistence,
  );
  const openNovelProjector = new runtime.OpenNovelNarrativeProjectorV1(
    profiles,
    input.projectionPersistence,
    renderer,
    publisher,
    clock,
  );
  const projector = new InProcessOpenNovelNarrativeProjectorAdapterV1(
    openNovelProjector,
    runtime,
  );
  const consumer = new NarrativeOutboxConsumerV1(
    input.outbox,
    input.authority,
    projector,
    clock,
    {
      ...DEFAULT_CONSUMER_CONFIG,
      ...(input.consumerConfig ?? {}),
    },
  );
  return Object.freeze({
    consumer,
    projector,
    profiles,
    providerBoundary,
    projectionState: input.projectionPersistence,
    artifactPublisher: input.projectionPersistence,
    profileVersion: profiles.profileVersion,
    projectorVersion: profiles.projectorVersion,
    providerMode: providerBoundary.configured
      ? "EXTERNAL_PROVIDER" as const
      : "DETERMINISTIC_FALLBACK_ONLY" as const,
  });
}

/** Same-Prisma production convenience factory; no in-memory adapter exists. */
export async function createPrismaPressureNarrativeProductionExecutionV1(
  input: PrismaPressureNarrativeProductionInputV1,
): Promise<PressureNarrativeProductionExecutionV1> {
  const outbox = new PrismaNarrativeOutboxRepository(
    input.prisma as unknown as NarrativeOutboxPrismaClient,
  );
  const authority = new PrismaAuthoritativeNarrativeSourceReader(
    input.prisma as unknown as NarrativeAuthorityReadPrismaClient,
    input.authoritativeSnapshotCompiler
      ?? new SangtianAuthoritativeNarrativeSnapshotCompilerV1(),
  );
  const projectionPersistence = new PrismaNarrativeProjectionStateRepository(
    input.prisma as unknown as NarrativeProjectionPrismaClient,
  );
  return createPressureNarrativeProductionExecutionV1({
    outbox,
    authority,
    projectionPersistence,
    runtimeLoader: input.runtimeLoader,
    provider: input.provider,
    clock: input.clock,
    consumerConfig: input.consumerConfig,
    profileOptions: input.profileOptions,
  });
}

/**
 * One production bundle for ProductRoot. It internalizes the four narrative
 * ports previously wired by hand. The only optional business environment
 * capability is the external Provider; when absent the published profile
 * deterministically selects authored fallback.
 */
export async function createPrismaPressureNarrativeProductBundleV1(
  input: PrismaPressureNarrativeProductBundleInputV1,
): Promise<PressureNarrativeProductBundleV1> {
  requireMethod(input, "prisma", "$transaction");
  const compiler = new SangtianAuthoritativeNarrativeSnapshotCompilerV1();
  const runtimeLoader = input.runtimeLoader
    ?? deployedOpenNovelPressureNarrativeRuntimeLoaderV1({
      allowTypeScriptSource: process.env.NODE_ENV !== "production",
      ...(input.runtimeLoaderOptions ?? {}),
    });
  const clock = input.clock ?? SYSTEM_CLOCK;
  const execution = await createPrismaPressureNarrativeProductionExecutionV1({
    prisma: input.prisma,
    authoritativeSnapshotCompiler: compiler,
    runtimeLoader,
    provider: input.provider,
    clock,
    consumerConfig: input.consumerConfig,
    profileOptions: input.profileOptions,
  });
  const worker = new PressureNarrativeInProcessWorkerV1(
    execution.consumer,
    clock,
    input.workerOptions,
  );
  const signal = new InProcessPressureNarrativeOutboxSignalV1(worker);
  if (input.startWorker !== false) worker.start();
  return Object.freeze({
    narrativeProjectorVersion: execution.projectorVersion,
    narrativeOutboxSignal: signal,
    narrativeSnapshotCompiler: compiler,
    openNovelNarrativeProjector: execution.projector,
    consumer: execution.consumer,
    worker,
    execution,
    providerMode: execution.providerMode,
  });
}

export const PRESSURE_NARRATIVE_PRODUCTION_CAPABILITY_MANIFEST_V1 = Object.freeze({
  compiledAuthorities: Object.freeze([
    "GENESIS_FROZEN",
    "CHAPTER_WORKING",
    "CHAPTER_FROZEN",
    "FINALE_FROZEN",
  ]),
  failClosedAuthorities: Object.freeze([
    "LEGACY_TERMINAL_COMMITTED",
  ]),
  reads: Object.freeze([
    "NarrativeOutbox",
    "CommittedNarrativeAuthority",
    "NarrativeProjectionState",
  ]),
  writes: Object.freeze([
    "NarrativeOutboxLease",
    "NarrativeProjectionState",
    "NarrativeArtifact",
  ]),
  forbidden: Object.freeze([
    "GenesisWriter",
    "WorkingLedgerWriter",
    "ChapterSettlementWriter",
    "FinaleCommitter",
    "ResultAuthorityWriter",
    "RunCompletionWriter",
  ]),
});

function validateCompositionInput(
  input: PressureNarrativeProductionCompositionInputV1,
): void {
  requireMethod(input, "runtimeLoader", "load");
  requireMethod(input, "outbox", "claimNext");
  requireMethod(input, "outbox", "acknowledge");
  requireMethod(input, "outbox", "retry");
  requireMethod(input, "outbox", "deadLetter");
  requireMethod(input, "authority", "readCommitted");
  requireMethod(input, "projectionPersistence", "claim");
  requireMethod(input, "projectionPersistence", "transition");
  requireMethod(input, "projectionPersistence", "publish");
  requireMethod(input, "projectionPersistence", "markPublished");
  requireMethod(input, "projectionPersistence", "deadLetter");
  if (input.provider != null) requireMethod(input, "provider", "render");
  if (input.clock !== undefined) requireMethod(input, "clock", "nowMs");
}

function requireMethod(
  input: unknown,
  field: string,
  method: string,
): void {
  const root = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const value = root[field];
  if (
    !value
    || (typeof value !== "object" && typeof value !== "function")
    || typeof (value as Record<string, unknown>)[method] !== "function"
  ) {
    failPressureNarrativeProduction(
      ERROR.PRODUCTION_CONFIG_INVALID,
      `input.${field}.${method}`,
      "FUNCTION",
    );
  }
}
