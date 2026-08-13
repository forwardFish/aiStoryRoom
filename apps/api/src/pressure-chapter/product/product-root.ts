import {
  loadPublishedSangtianAEmotionLifecycleBindingsV1,
  loadPublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import type { PrismaService } from "../../prisma.service";
import {
  createPrismaAEmotionPersistenceV1,
  type AEmotionPersistencePrismaClient,
} from "../a-emotion-persistence";
import { PressureWorkingLedgerFormalCommitmentServiceV1 } from "../a-emotion-promise";
import {
  createAEmotionPostCommitProductionV1,
  createPrismaAEmotionAuthorityBundleV1,
  type AEmotionAuthorityPrismaClientV1,
} from "../a-emotion-production";
import { ChapterSettlementOrchestrator } from "../chapter-settlement";
import {
  createPressureDecisionAutomationProductionV1,
} from "../decision-automation";
import { createPressureDeadlineDefaultProductionV1 } from "../deadline-default-production";
import {
  N7FrozenFinaleInputAssemblerV1,
  PressureFinaleApplicationServiceV1,
} from "../finale";
import {
  PressureChapterGameProjectionService,
  PressureDecisionPresentationServiceV1,
  type PressureDecisionPresentationProviderPortV1,
} from "../game-projection";
import { PressureChapterGenesisService } from "../genesis";
import {
  PressureChapterHttpControllerMethods,
  PressureChapterHttpFacade,
  type PressureChapterHttpAccessPort,
  type PressureChapterHttpActionPort,
  type PressureChapterHttpChatPort,
  type PressureChapterHttpClockPort,
  type PressureChapterHttpDecisionCompilerPort,
  type PressureChapterHttpGamePort,
  type PressureChapterHttpReplayPort,
  type PressureChapterHttpResultPort,
  type PressureChapterHttpRoutePort,
} from "../http";
import {
  createPressureChapterHttpProductionAdaptersV1,
  type PressureChapterHttpProductionPrismaPortV1,
} from "../http-production";
import {
  ExistingN7FinaleOutboxConfirmationAdapterV1,
  PressureDecisionCommandCompilerV1,
  RequiredSeatsDecisionCloseAdapterV1,
  SangtianAuthoredChapterContentAdapterV1,
  SangtianAuthoritativeBeatCompilerV1,
  SangtianChapterWorkingSeedAdapterV1,
  SangtianContentOwnedChapterPolicyAdapterV1,
  SangtianDeterministicDefaultActionAdapterV1,
  SangtianGenesisContentAdapterV1,
  SangtianPressureGameContentMapperV1,
  SangtianReleaseActionPresentationCatalogAdapterV1,
  SangtianServerDecisionWorkingIntentCompilerV1,
  SynchronizedDecisionBeatResolutionAdapterV1,
  W4ToW6ChapterSettlementAdapterV1,
  W5FormalActionSubmissionAdapterV1,
  W5WorkingLedgerOpeningAdapterV1,
  W5WorkingProjectionReaderAdapterV1,
  SelectiveWorkingProjectionReaderV1,
  createPublishedSangtianRouteRegistryPortV1,
} from "../integration";
import {
  FormalPressureInteractionService,
} from "../interaction/formal-interaction.service";
import { PressureChapterChatService } from "../interaction/chat.service";
import {
  createPressureGameFeedReaderV1,
  createPrismaPressureGameWorldReaderV1,
  createViewerScopedPressureGameChapterReaderV1,
  PrismaPressureGameNarrativeReaderV1,
} from "../live-adapters";
import {
  PrismaAtomicChapterCommitter,
  PrismaAuthorityFirstTerminalCommitter,
  type FinaleShadowAppendPrismaClient,
  PrismaChapterOrchestratorStateRepository,
  PrismaDurableChapterSettlementSourceRepository,
  PrismaGenesisAtomicCommitRepository,
  PrismaN7FrozenFinaleSourceReader,
  PrismaPressureChatRepository,
  PrismaPressureInteractionAccessRepository,
  PrismaPressureResultReadModelInputReader,
  PrismaPressureResultViewerAuthorizer,
  PrismaReplayCreationTransaction,
  PrismaReplayExecutionReader,
  PrismaRunRouteRepository,
  PrismaWorkingLedgerRepository,
  type AuthorityFirstTerminalPrismaClient,
  type ChapterSettlementPrismaClient,
  type ChapterSettlementSourcePrismaClient,
  type GenesisPrismaClient,
  type InteractionAccessPrismaClient,
  type N7FrozenFinaleSourcePrismaClient,
  type OrchestratorStatePrismaClient,
  type ReplayPrismaClient,
  type ReplayReceiptTransactionV1,
  type ResultReadModelPrismaClient,
  type ResultViewerPrismaClient,
  type RunRoutePrismaClient,
  type WorkingLedgerPrismaClient,
  WorkingProjectionFastReaderV1,
  type WorkingProjectionFastReaderPrismaClientV1,
} from "../persistence";
import {
  composePressureProductionCoreV1,
} from "../production";
import {
  createPrismaPressureProductionAdaptersV1,
} from "../production-prisma";
import {
  createPressureChapterInternalProductionPortsV1,
  SangtianFrozenSeatPresentationCatalogV1,
} from "../product-adapters";
import type { PressureNarrativeProviderReadinessV1 } from "../production-config";
import {
  createPrismaPressureProgressOutboxWorkerV1,
} from "../progress-outbox/factory";
import {
  PrismaProgressChapterHandoffAuthorityV1,
  type ProgressChapterHandoffAuthorityPrismaClientV1,
} from "../progress-outbox/prisma-authority";
import {
  RuntimeProgressFinaleAdapterV1,
  RuntimeProgressOpenChapterAdapterV1,
} from "../progress-outbox/runtime-adapters";
import {
  PressureReplayCommandHandlerV1,
  PressureReplayPolicyEvaluatorV1,
} from "../replay";
import {
  PressureResultQueryServiceV1,
  PressureResultReadModelComposerV1,
} from "../result";
import { PressureChapterRunRouterService } from "../run-router";
import { composePressureChapterRuntimeV1 } from "../runtime/composition";
import { SeatControlAudienceProjector, SeatControlService } from "../seat-control";
import { PressureSeatTransportFacadeV1 } from "../seat-transport";
import {
  createPressureSeatControlPersistenceAdaptersV1,
  PrismaPressureGameViewerReaderV1,
  type PressureSeatControlPersistenceDependenciesV1,
} from "../seat-control-persistence";
import { WorkingLedgerService } from "../working-ledger/working-ledger.service";
import {
  createPrismaDecisionToNextProjectionSnapshotReaderV1,
  planPressureSql7PreparedAutomationActionBatchV1,
  PressureSql7CommandCompilerAdapterV1,
  PressureSql7FirstSubmitServiceV1,
  PressureSql7PreparedInputsAdapterV1,
  PressureSql7ReceiptProjectionAdapterV1,
  PressureSql7SettlementN2PlanBuilderV1,
  PrismaPressureSql7CommitRepositoryV1,
  type PressureSql7PrismaClientV1,
} from "../sql7-fast-path";
import {
  DefaultPressureWorkerSchedulerV1,
  PressureWorkerRuntimeServiceV1,
  type PressureWorkerLanePortV1,
} from "../worker-runtime";
import {
  DEFAULT_PRESSURE_CHAPTER_PRODUCT_OPTIONS_V1,
  resolvePressureChapterWorkerOwnershipV1,
  type PressureChapterProductOptionsV1,
} from "./contracts";
import {
  PRESSURE_CHAPTER_PRODUCT_ERROR_CODES as ERROR,
  failPressureChapterProduct,
} from "./errors";
import {
  PressureAuthoritativeResultReaderAdapterV1,
  pressureHttpRouteReadPortV1,
  pressureHttpRuntimeFacetsV1,
} from "./read-only-adapters";
import { PressureChapterRoomsGatewayV1 } from "./rooms-gateway";
import { PressureSingleN1StarterBinderV1 } from "./single-n1-starter";
import { PressureChapterWorkerLifecycleV1 } from "./worker-lifecycle";
import { PersistedPressureGenericFinaleShadowV1 } from "./generic-shadow-persistence.adapter";
import { PressureChapterOperationalReadinessV1 } from "./operational-readiness";
import {
  PressurePromiseProductAccessAdapterV1,
  PressurePromiseProductFacadeV1,
} from "./promise-facade";

export interface PressureChapterProductRootV1 {
  routeRelease: ReturnType<typeof loadPublishedSangtianActionReleaseV1>;
  routes: PressureChapterRunRouterService;
  runtime: ReturnType<typeof composePressureChapterRuntimeV1>;
  productionBridge: ReturnType<typeof composePressureProductionCoreV1>["bridge"];
  roomsGateway: PressureChapterRoomsGatewayV1;
  httpFacade: PressureChapterHttpFacade;
  httpControllerMethods: PressureChapterHttpControllerMethods;
  httpPorts: Readonly<{
    access: PressureChapterHttpAccessPort;
    routes: PressureChapterHttpRoutePort;
    game: PressureChapterHttpGamePort;
    decisionCompiler: PressureChapterHttpDecisionCompilerPort;
    actions: PressureChapterHttpActionPort;
    chat: PressureChapterHttpChatPort;
    result: PressureChapterHttpResultPort;
    replay: PressureChapterHttpReplayPort;
    clock: PressureChapterHttpClockPort;
  }>;
  gameProjection: PressureChapterGameProjectionService;
  seatTransport: PressureSeatTransportFacadeV1;
  promises: PressurePromiseProductFacadeV1;
  aEmotion: ReturnType<typeof createPrismaAEmotionPersistenceV1>;
  narrativeProjectionState: Awaited<
    ReturnType<typeof createPressureChapterInternalProductionPortsV1>
  >["narrativeExecution"]["projectionState"];
  progress: ReturnType<typeof createPrismaPressureProgressOutboxWorkerV1>;
  decisionAutomation: ReturnType<
    typeof createPressureDecisionAutomationProductionV1
  >;
  workerSupervisor: PressureWorkerRuntimeServiceV1;
  workerLifecycle: PressureChapterWorkerLifecycleV1;
  operationalReadiness: PressureChapterOperationalReadinessV1;
  diagnostics: Readonly<{
    n1Handoff: ReturnType<typeof createPrismaPressureProductionAdaptersV1>["genesisN1Handoff"];
    n1StarterBoundExactlyOnce: true;
    narrativeWorkerAutoStarted: false;
    narrativeProviderMode: "EXTERNAL_PROVIDER" | "DETERMINISTIC_FALLBACK_ONLY";
  }>;
}

/**
 * The sole production object graph for a Pressure Run. All Prisma-backed
 * adapters share `input.prisma`; application services never allocate another
 * client, and no legacy runtime is present in this graph.
 */
export async function createPressureChapterProductRootV1(input: {
  prisma: PrismaService;
  options?: Partial<PressureChapterProductOptionsV1>;
  narrativeProviderReadiness?: PressureNarrativeProviderReadinessV1;
  decisionPresentationProvider?: PressureDecisionPresentationProviderPortV1 | null;
}): Promise<PressureChapterProductRootV1> {
  const options = normalizeOptions(input.options);
  const httpProduction = createPressureChapterHttpProductionAdaptersV1(
    input.prisma as unknown as PressureChapterHttpProductionPrismaPortV1,
  );
  const internal = await createPressureChapterInternalProductionPortsV1(
    input.prisma,
    options.internalAdapters,
  );
  const release = loadPublishedSangtianActionReleaseV1();
  const aEmotionLifecycle = loadPublishedSangtianAEmotionLifecycleBindingsV1();

  const routes = new PressureChapterRunRouterService(
    new PrismaRunRouteRepository(asPrisma<RunRoutePrismaClient>(input.prisma)),
    createPublishedSangtianRouteRegistryPortV1(release.routeConfiguration),
  );
  const genesisRepository = new PrismaGenesisAtomicCommitRepository(
    asPrisma<GenesisPrismaClient>(input.prisma),
  );
  const genesis = new PressureChapterGenesisService(
    routes,
    new SangtianGenesisContentAdapterV1(),
    genesisRepository,
  );

  const seatPersistence = createPressureSeatControlPersistenceAdaptersV1({
    prisma: input.prisma as PressureSeatControlPersistenceDependenciesV1["prisma"],
    genesis: genesisRepository,
    presentationCatalog: internal.seatPresentationCatalog,
  });
  const seatViewer = new PrismaPressureGameViewerReaderV1(
    seatPersistence.memberships,
    seatPersistence.authority,
    seatPersistence.presence,
    internal.seatPrivateProjection,
    internal.seatPresentationCatalog,
  );
  const seatControl = new SeatControlService(
    seatPersistence.genesis,
    seatPersistence.policies,
    seatPersistence.authority,
    seatPersistence.presence,
    seatPersistence.defaults,
    seatPersistence.decisionAuthority,
  );

  const content = new SangtianAuthoredChapterContentAdapterV1();
  const ledgerRepository = new PrismaWorkingLedgerRepository(
    asPrisma<WorkingLedgerPrismaClient>(input.prisma),
  );
  const interactionAccess = new PrismaPressureInteractionAccessRepository(
    asPrisma<InteractionAccessPrismaClient>(input.prisma),
  );
  const formalInteraction = new FormalPressureInteractionService(
    interactionAccess,
    ledgerRepository,
  );
  const formalActions = new W5FormalActionSubmissionAdapterV1(formalInteraction);
  const projections = new W5WorkingProjectionReaderAdapterV1(ledgerRepository);
  const onlineProjections = new SelectiveWorkingProjectionReaderV1(
    new WorkingProjectionFastReaderV1(
      asPrisma<WorkingProjectionFastReaderPrismaClientV1>(input.prisma),
    ),
    projections,
    workingProjectionReadMode(process.env.PRESSURE_WORKING_PROJECTION_READ_MODE),
  );
  const workingOpening = new W5WorkingLedgerOpeningAdapterV1(
    new WorkingLedgerService(ledgerRepository),
  );
  const beatResolution = new SynchronizedDecisionBeatResolutionAdapterV1(
    ledgerRepository,
    new SangtianAuthoritativeBeatCompilerV1(),
  );
  const settlementSource = new PrismaDurableChapterSettlementSourceRepository(
    asPrisma<ChapterSettlementSourcePrismaClient>(input.prisma),
  );
  const settlementPolicy = new SangtianContentOwnedChapterPolicyAdapterV1(release);
  const settlementOrchestrator = new ChapterSettlementOrchestrator(
    settlementSource,
    settlementPolicy,
    new PrismaAtomicChapterCommitter(
      asPrisma<ChapterSettlementPrismaClient>(input.prisma),
    ),
  );
  const settlement = new W4ToW6ChapterSettlementAdapterV1(
    settlementSource,
    settlementOrchestrator,
  );

  const finaleReader = new PrismaN7FrozenFinaleSourceReader(
    asPrisma<N7FrozenFinaleSourcePrismaClient>(input.prisma),
    internal.finaleConfiguration,
  );
  const finaleAssembler = new N7FrozenFinaleInputAssemblerV1(finaleReader);
  const terminalCommitter = new PrismaAuthorityFirstTerminalCommitter(
    asPrisma<AuthorityFirstTerminalPrismaClient>(input.prisma),
    internal.finaleConfiguration,
    internal.narrativeProjectorVersion,
  );
  const genericShadow = new PersistedPressureGenericFinaleShadowV1(
    internal.genericFinaleShadow,
    asPrisma<FinaleShadowAppendPrismaClient>(input.prisma),
  );
  const finale = new PressureFinaleApplicationServiceV1(
    finaleAssembler,
    terminalCommitter,
    internal.narrativeOutboxSignal,
    genericShadow,
  );
  const narrative = internal.narrativeConsumer;
  const narrativeProjectionState = internal.narrativeExecution.projectionState;

  const resultInputs = new PrismaPressureResultReadModelInputReader(
    asPrisma<ResultReadModelPrismaClient>(input.prisma),
    internal.narrativeProjectorVersion,
  );
  const resultViewer = new PrismaPressureResultViewerAuthorizer(
    asPrisma<ResultViewerPrismaClient>(input.prisma),
  );
  const replayPolicy = new PressureReplayPolicyEvaluatorV1(internal.replayPolicy);
  const result = new PressureResultQueryServiceV1(
    new PressureResultReadModelComposerV1(resultInputs),
    resultViewer,
    replayPolicy,
  );
  const replayPrisma = asPrisma<ReplayPrismaClient<ReplayReceiptTransactionV1>>(
    input.prisma,
  );
  const replay = new PressureReplayCommandHandlerV1(
    new PressureAuthoritativeResultReaderAdapterV1(resultInputs),
    resultViewer,
    replayPolicy,
    new PrismaReplayExecutionReader(replayPrisma),
    internal.replayTargetRouteResolver,
    new PrismaReplayCreationTransaction(
      replayPrisma,
      internal.replayTargetFactory,
    ),
  );

  const n1Binder = new PressureSingleN1StarterBinderV1();
  const orchestratorStates = new PrismaChapterOrchestratorStateRepository(
    asPrisma<OrchestratorStatePrismaClient>(input.prisma),
  );
  const promises = new PressurePromiseProductFacadeV1(
    new PressurePromiseProductAccessAdapterV1({
      routes,
      orchestrators: orchestratorStates,
      interactions: interactionAccess,
      working: projections,
      bindings: aEmotionLifecycle.bindings,
    }),
    new PressureWorkingLedgerFormalCommitmentServiceV1(ledgerRepository),
  );
  let productionAdapters: ReturnType<
    typeof createPrismaPressureProductionAdaptersV1
  > | null = null;
  const workingSeeds = new SangtianChapterWorkingSeedAdapterV1(
    internal.authoritativeChapterWorld,
  );
  const runtime = composePressureChapterRuntimeV1({
    genesis,
    n1Handoff(starter) {
      return n1Binder.bind(starter, (soleStarter) => {
        productionAdapters = createPrismaPressureProductionAdaptersV1(
          input.prisma,
          soleStarter,
        );
        return productionAdapters.genesisN1Handoff;
      });
    },
    chapter: {
      states: orchestratorStates,
      content,
      seeds: workingSeeds,
      ledgerOpening: workingOpening,
      projections,
      formalActions,
      beatResolution,
      decisionClose: new RequiredSeatsDecisionCloseAdapterV1(),
      defaults: new SangtianDeterministicDefaultActionAdapterV1(
        content,
        projections,
        internal.deterministicDefaultAuthority,
        formalActions,
      ),
      settlement,
      finaleRequest: new ExistingN7FinaleOutboxConfirmationAdapterV1(
        internal.n7FinaleHandoff,
      ),
    },
    finale,
    narrative,
    result,
    replay,
  });
  const durableProductionAdapters = requireProductionAdapters(productionAdapters);
  if (n1Binder.requireBound() !== durableProductionAdapters.genesisN1Handoff) {
    failPressureChapterProduct(
      ERROR.N1_STARTER_CONFLICT,
      "production.genesisN1Handoff",
    );
  }
  const production = composePressureProductionCoreV1({
    runShellWriter: durableProductionAdapters.runShellWriter,
    lobbyPersistence: durableProductionAdapters.lobbyPersistence,
    startBoundary: durableProductionAdapters.startBoundary,
    routeRouter: routes,
    genesis,
    seatControl,
    n1Handoff: durableProductionAdapters.genesisN1Handoff,
    // New Runs accept canonical seat ids only. Legacy aliases fail closed.
    legacyRoleRegistry: null,
  });

  const aEmotion = createPrismaAEmotionPersistenceV1({
    prisma: asPrisma<AEmotionPersistencePrismaClient>(input.prisma),
    bindings: internal.aEmotionSeatBindings,
    storyDay: internal.aEmotionStoryDay,
    observerResolver: internal.aEmotionObserverResolver,
    presentation: internal.aEmotionPresentation,
  });
  const aEmotionAuthority = createPrismaAEmotionAuthorityBundleV1(
    asPrisma<AEmotionAuthorityPrismaClientV1>(input.prisma),
  );
  const aEmotionProduction = createAEmotionPostCommitProductionV1({
    outbox: aEmotionAuthority.outbox,
    authority: aEmotionAuthority.authority,
    viewers: aEmotionAuthority.viewers,
    pipeline: aEmotion.pipeline,
    clock: httpProduction.clock,
    config: options.aEmotionWorker,
  });
  const seatTransport = new PressureSeatTransportFacadeV1(
    routes,
    seatPersistence.memberships,
    new SeatControlAudienceProjector(
      seatPersistence.authority,
      seatPersistence.presence,
      internal.seatPrivateProjection,
    ),
    seatControl,
    aEmotion.feed,
  );
  const actionPresentations = new SangtianReleaseActionPresentationCatalogAdapterV1(
    release,
  );
  const gameContentMapper = new SangtianPressureGameContentMapperV1(actionPresentations);
  const gameChapterReader = createViewerScopedPressureGameChapterReaderV1({
    routes,
    states: orchestratorStates,
    working: onlineProjections,
    content,
    mapper: gameContentMapper,
  });
  const gameProjection = new PressureChapterGameProjectionService(
    routes,
    gameChapterReader,
    seatViewer,
    createPrismaPressureGameWorldReaderV1(input.prisma),
    new PrismaPressureGameNarrativeReaderV1(input.prisma),
    createPressureGameFeedReaderV1(aEmotion.feed),
    internal.gameCapabilities,
    new PressureDecisionPresentationServiceV1(
      input.decisionPresentationProvider ?? null,
    ),
  );
  const runtimeFacets = pressureHttpRuntimeFacetsV1(runtime);
  const httpRoutes = pressureHttpRouteReadPortV1(routes);
  const chat = new PressureChapterChatService(
    interactionAccess,
    new PrismaPressureChatRepository(
      asPrisma<WorkingLedgerPrismaClient>(input.prisma),
    ),
  );
  const progressAuthority = new PrismaProgressChapterHandoffAuthorityV1(
    asPrisma<ProgressChapterHandoffAuthorityPrismaClientV1>(input.prisma),
  );
  const progress = createPrismaPressureProgressOutboxWorkerV1(
    input.prisma,
    {
      clock: httpProduction.clock,
      openNextChapter: new RuntimeProgressOpenChapterAdapterV1(
        routes,
        progressAuthority,
        runtime,
      ),
      finale: new RuntimeProgressFinaleAdapterV1(
        routes,
        progressAuthority,
        finaleAssembler,
        runtime,
      ),
    },
    options.progressWorker,
  );
  const deadlineDefaults = createPressureDeadlineDefaultProductionV1({
    prisma: input.prisma,
    orchestrators: orchestratorStates,
    working: projections,
    content,
    seats: seatPersistence.authority,
    seatControl,
    runtime,
  });
  const decisionAutomation = createPressureDecisionAutomationProductionV1({
    prisma: input.prisma,
    content,
    runtime,
    clock: httpProduction.clock,
    deadlineDefaults,
    config: options.decisionAutomation,
  });
  const decisionCompiler = new PressureDecisionCommandCompilerV1(
    gameProjection,
    onlineProjections,
    content,
    new SangtianServerDecisionWorkingIntentCompilerV1(release),
    {
      chapter: gameChapterReader,
      viewer: seatViewer,
      capabilities: internal.gameCapabilities,
    },
    decisionAutomation.snapshots,
    decisionAutomation.policy.artifactSha256,
  );
  const sql7PreparedInputs = new PressureSql7PreparedInputsAdapterV1(
    settlementPolicy,
    content,
    workingSeeds,
    gameContentMapper,
    new SangtianFrozenSeatPresentationCatalogV1(input.prisma),
  );
  const sql7FirstSubmit = new PressureSql7FirstSubmitServiceV1(
    createPrismaDecisionToNextProjectionSnapshotReaderV1(input.prisma),
    new PressureSql7CommandCompilerAdapterV1(
      decisionCompiler,
      decisionAutomation.policy.artifactSha256,
    ),
    {
      plan: (sql7Input) => planPressureSql7PreparedAutomationActionBatchV1(
        sql7Input,
        {
          content,
          policy: decisionAutomation.policy,
          compiler: decisionAutomation.compiler,
        },
      ),
    },
    new PressureSql7SettlementN2PlanBuilderV1(sql7PreparedInputs),
    new PrismaPressureSql7CommitRepositoryV1(
      input.prisma as unknown as PressureSql7PrismaClientV1,
    ),
    new PressureSql7ReceiptProjectionAdapterV1(gameProjection),
  );
  const narrativeLane: PressureWorkerLanePortV1 = Object.freeze({
    tick: (workerId: string) => narrative.consumeNext(workerId),
  });
  const aEmotionLane: PressureWorkerLanePortV1 = Object.freeze({
    tick: (workerId: string) => aEmotionProduction.worker.consumeNext(workerId),
  });
  const workerOwnership = resolvePressureChapterWorkerOwnershipV1(process.env);
  const ownsWorkerLanes = workerOwnership.ready && workerOwnership.ownsWorkerLanes;
  const workerSupervisor = new PressureWorkerRuntimeServiceV1({
    clock: httpProduction.clock,
    scheduler: new DefaultPressureWorkerSchedulerV1(),
    progress: progress.worker,
    narrative: narrativeLane,
    aEmotion: aEmotionLane,
    decision: decisionAutomation.workerLane,
  }, {
    enabled: ownsWorkerLanes,
    topology: workerOwnership.topology,
    autoStart: false,
    pollMs: options.workerRuntime.pollMs,
    perLaneLimit: options.workerRuntime.perLaneLimit,
    unrefTimers: options.workerRuntime.unrefTimers,
    lanes: {
      progress: ownsWorkerLanes,
      narrative: ownsWorkerLanes,
      aEmotion: ownsWorkerLanes,
      decision: ownsWorkerLanes,
    },
  });
  const workerLifecycle = new PressureChapterWorkerLifecycleV1(
    workerSupervisor,
    workerOwnership,
  );
  const narrativeReadiness = input.narrativeProviderReadiness ?? {
    ready: true as const,
    mode: internal.narrativeProviderMode,
    externalProviderConfigured: internal.narrativeProviderMode === "EXTERNAL_PROVIDER",
    degraded: internal.narrativeProviderMode !== "EXTERNAL_PROVIDER",
    provider: internal.narrativeProviderMode === "EXTERNAL_PROVIDER"
      ? "deepseek" as const
      : "deterministic-fallback" as const,
    model: null,
  };
  if (narrativeReadiness.mode !== internal.narrativeProviderMode) {
    failPressureChapterProduct(
      ERROR.PRODUCTION_PORT_INVALID,
      "narrativeProviderReadiness.mode",
    );
  }
  const operationalReadiness = new PressureChapterOperationalReadinessV1(
    workerLifecycle,
    narrativeReadiness,
  );
  const httpPorts = Object.freeze({
    access: httpProduction.access,
    routes: httpRoutes,
    game: gameProjection,
    decisionCompiler,
    actions: runtimeFacets.actions,
    chat,
    result: runtimeFacets.result,
    replay: runtimeFacets.replay,
    clock: httpProduction.clock,
  });
  const httpFacade = new PressureChapterHttpFacade(
    httpPorts.access,
    httpPorts.routes,
    httpPorts.game,
    httpPorts.decisionCompiler,
    httpPorts.actions,
    httpPorts.chat,
    httpPorts.result,
    httpPorts.replay,
    httpPorts.clock,
    decisionAutomation.service,
    sql7FirstSubmit,
  );
  const roomsGateway = new PressureChapterRoomsGatewayV1(production.bridge);
  return Object.freeze({
    routeRelease: release,
    routes,
    runtime,
    productionBridge: production.bridge,
    roomsGateway,
    httpFacade,
    httpControllerMethods: new PressureChapterHttpControllerMethods(httpFacade),
    httpPorts,
    gameProjection,
    seatTransport,
    promises,
    aEmotion,
    narrativeProjectionState,
    progress,
    decisionAutomation,
    workerSupervisor,
    workerLifecycle,
    operationalReadiness,
    diagnostics: Object.freeze({
      n1Handoff: durableProductionAdapters.genesisN1Handoff,
      n1StarterBoundExactlyOnce: true as const,
      narrativeWorkerAutoStarted: false as const,
      narrativeProviderMode: internal.narrativeProviderMode,
    }),
  });
}

function asPrisma<T>(prisma: PrismaService): T {
  return prisma as unknown as T;
}

function workingProjectionReadMode(
  value: string | undefined,
): "FAST" | "SHADOW" | "REPLAY" {
  if (value === "SHADOW" || value === "REPLAY") return value;
  return value === "FAST" ? "FAST" : "REPLAY";
}

function normalizeOptions(
  options: Partial<PressureChapterProductOptionsV1> | undefined,
): PressureChapterProductOptionsV1 {
  const workerRuntime = {
    ...DEFAULT_PRESSURE_CHAPTER_PRODUCT_OPTIONS_V1.workerRuntime,
    ...(options?.workerRuntime ?? {}),
  };
  const decisionAutomation = {
    ...DEFAULT_PRESSURE_CHAPTER_PRODUCT_OPTIONS_V1.decisionAutomation,
    ...(options?.decisionAutomation ?? {}),
  };
  const aEmotionWorker = {
    ...DEFAULT_PRESSURE_CHAPTER_PRODUCT_OPTIONS_V1.aEmotionWorker,
    ...(options?.aEmotionWorker ?? {}),
  };
  if (
    !Number.isSafeInteger(workerRuntime.pollMs)
    || workerRuntime.pollMs <= 0
    || !Number.isSafeInteger(workerRuntime.perLaneLimit)
    || workerRuntime.perLaneLimit <= 0
    || typeof workerRuntime.unrefTimers !== "boolean"
  ) {
    failPressureChapterProduct(
      ERROR.PRODUCTION_PORT_INVALID,
      "options.workerRuntime",
    );
  }
  if (
    !Number.isSafeInteger(decisionAutomation.retryMs)
    || decisionAutomation.retryMs <= 0
  ) {
    failPressureChapterProduct(
      ERROR.PRODUCTION_PORT_INVALID,
      "options.decisionAutomation",
    );
  }
  if (
    !Number.isSafeInteger(aEmotionWorker.leaseMs)
    || aEmotionWorker.leaseMs <= 0
    || !Number.isSafeInteger(aEmotionWorker.infrastructureRetryMs)
    || aEmotionWorker.infrastructureRetryMs < 0
  ) {
    failPressureChapterProduct(
      ERROR.PRODUCTION_PORT_INVALID,
      "options.aEmotionWorker",
    );
  }
  return {
    internalAdapters: options?.internalAdapters ?? {},
    progressWorker: options?.progressWorker ?? {},
    workerRuntime,
    decisionAutomation,
    aEmotionWorker,
  };
}

function requireProductionAdapters(
  value: ReturnType<typeof createPrismaPressureProductionAdaptersV1> | null,
): ReturnType<typeof createPrismaPressureProductionAdaptersV1> {
  if (!value) {
    return failPressureChapterProduct(
      ERROR.COMPOSITION_INCOMPLETE,
      "productionPrismaAdapters",
    );
  }
  return value;
}
