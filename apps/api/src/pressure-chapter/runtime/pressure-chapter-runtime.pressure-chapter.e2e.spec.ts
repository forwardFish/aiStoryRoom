import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeDecisionActionRequestFingerprint,
  computeNarrativeArtifactContentHash,
  sha256Canonical,
  validateReplayCreationReceiptV1,
  withRunRouteHash,
  type ChapterIdV1,
  type DecisionActionV1,
  type FrozenChapterBundleV1,
  type OpenNovelNarrativeArtifactV1,
  type OpenNovelNarrativeProjectionJobV1,
  type ReplayCreationReceiptV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
  type TrackIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  PressureChapterRouteRegistry,
  compileSangtianContentFinalePolicyV1,
  compileTerminalResultContextV1,
  computePressureChapterRouteRegistryHash,
  createChapterWorkingState,
  loadSangtianPressureChapterPackageV1,
  type PressureChapterDefinition,
  type PressureChapterRouteRegistryV1,
} from "@ai-story/templates";
import {
  PressureChapterRunRouterService,
  buildPressurePinnedRouteRegistrationV1,
  type RunRouteRepositoryPort,
  type StoredRunRouteRecordV1,
} from "../run-router";
import {
  PressureChapterGenesisService,
  buildGenesisCommitReceipt,
} from "../genesis/genesis.service";
import type {
  CommittedGenesisV1,
  GenesisAtomicCommitPort,
  GenesisAtomicRecordV1,
  GenesisContentPort,
} from "../genesis/types";
import {
  FormalPressureInteractionService,
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import type {
  PressureInteractionAccessPort,
  PressureInteractionAccessV1,
} from "../interaction/contracts";
import { WorkingBeatApplicationService } from "../working-ledger/beat-application.service";
import type {
  WorkingActionIntentV1,
  WorkingLedgerAppendResultV1,
  WorkingLedgerEventV1,
  WorkingLedgerKeyV1,
  WorkingLedgerPort,
} from "../working-ledger/contracts";
import { projectWorkingLedger } from "../working-ledger/working-ledger";
import { WorkingLedgerService } from "../working-ledger/working-ledger.service";
import type {
  AuthoredChapterContentPort,
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStatePort,
  ChapterOrchestratorStateV1,
  ChapterSettlementPort,
  ChapterWorkingSeedPort,
  DecisionBeatResolutionPort,
  DecisionCloseEvaluatorPort,
  DeterministicDefaultActionPort,
  FinaleRequestPort,
  FormalActionSubmissionPort,
  WorkingLedgerOpeningPort,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import {
  N7FrozenFinaleInputAssemblerV1,
  PressureFinaleApplicationServiceV1,
  withN7FrozenFinaleSourceFingerprintV1,
  type N7FrozenFinaleSourceReaderPort,
  type N7FrozenFinaleSourceV1,
} from "../finale";
import {
  type AuthorityFirstTerminalCommitterPort,
  type AuthorityFirstTerminalRecordV1,
  type GenericFinaleShadowReadOnlyPort,
  type NarrativeOutboxSignalPort,
} from "../terminal-commit";
import { NarrativeOutboxConsumerV1 } from "../narrative/narrative-outbox-consumer";
import type {
  NarrativeOutboxClaimV1,
  NarrativeOutboxPortV1,
  OpenNovelNarrativeProjectorPortV1,
} from "../narrative/ports";
import { PressureReplayPolicyEvaluatorV1 } from "../replay/replay-policy";
import { PressureReplayCommandHandlerV1 } from "../replay/replay-command.handler";
import type {
  ReplayCreationRequestV1,
  ReplayCreationTransactionPort,
  ReplayExecutionReaderPort,
  StoredReplayExecutionV1,
} from "../replay/ports";
import { validateReplayResolvedTargetV1 } from "../replay/ports";
import { PressureResultQueryServiceV1 } from "../result/result-query.service";
import type {
  PressureResultReadModelSourceV1,
  PressureReplayPolicyPort,
  ResultViewerAuthorizerPort,
} from "../result/ports";
import {
  pressureNarrativeReadSetFixture,
  replayActionsFixture,
  replayCommandFixture,
  viewerFixture,
} from "../result/result-test-fixtures";
import { RESULT_CONTRACT_REGISTRY_VERSION_V1 } from "../result/registry";
import { composePressureChapterRuntimeV1 } from "./composition";
import {
  buildGenesisOpenN1OutboxDedupeKeyV1,
  type OpenPressureN1FromGenesisHandoffCommandV1,
  type PersistedGenesisN1HandoffV1,
  type RuntimeChapterHandoffStartPortV1,
  type RuntimeGenesisN1HandoffPortV1,
} from "./contracts";

const RUN_ID = "run-pressure-1";
const ACTOR: SeatIdV1 = "cabinet_finance";
const DECIDED_AT = "2026-08-12T02:00:00.000Z";
const POINT_COUNTS: Record<ChapterIdV1, number> = {
  N1: 2,
  N2: 3,
  N3: 4,
  N4: 2,
  N5: 3,
  N6: 4,
  N7: 5,
};

test("P0 to N7, authority-first Finale, pending Result, narrative, privacy and replay form one chain", async () => {
  const routeRepository = new MemoryRouteRepository();
  const registry = routeRegistry();
  const router = new PressureChapterRunRouterService(routeRepository, registry);
  const routeRecord = (await router.create({
    runId: RUN_ID,
    participantMode: "SOLO",
    humanSeatIdsAtStart: [ACTOR],
    runSeed: `seed-${RUN_ID}`,
  })).route;
  const replayRegistration = registry.resolveStored(
    routeRecord.routeKey,
    routeRecord.snapshot.route,
  );
  const replayPin = buildPressurePinnedRouteRegistrationV1({
    registryVersion: registry.registryVersion,
    registryHash: registry.registryHash,
    registration: replayRegistration,
  });
  const replayTargetBase = {
    schemaVersion: "pressure_replay_route_target_v1" as const,
    sourceRunId: RUN_ID,
    targetExperience: "SAME_FROZEN_ROUTE" as const,
    participantMode: "SOLO" as const,
    pinnedRegistration: replayPin,
    sourceRouteHash: routeRecord.snapshot.routeHash,
  };
  const replayTarget = validateReplayResolvedTargetV1({
    ...replayTargetBase,
    targetDescriptorHash: sha256Canonical(replayTargetBase),
  });
  const genesisStore = new MemoryGenesisStore();
  const genesis = new PressureChapterGenesisService(
    router,
    new P0Content(),
    genesisStore,
  );

  const content = new DynamicAuthoredContent();
  const working = new W5MemoryHarness(content);
  const states = new MemoryOrchestratorStates();
  const settlements = new MemoryChapterSettlement();
  const finaleRequests = new MemoryFinaleRequests();
  const terminal = new MemoryTerminalCommitter();
  const finaleSource = new MemoryN7FinaleSource(
    routeRecord.snapshot,
    genesisStore,
    settlements,
  );
  const narrativeOutbox = new MemoryNarrativeOutbox();
  const narrativeSignal: NarrativeOutboxSignalPort = {
    async notifyCommitted() {
      const record = terminal.record;
      assert.ok(record, "terminal authority must exist before narrative signal");
      narrativeOutbox.seed(record.narrativeOutbox.jobs);
    },
  };
  const shadow: GenericFinaleShadowReadOnlyPort = {
    async evaluateShadow() { return null; },
  };
  const finale = new PressureFinaleApplicationServiceV1(
    new N7FrozenFinaleInputAssemblerV1(finaleSource),
    terminal,
    narrativeSignal,
    shadow,
  );

  let resultSource: PressureResultReadModelSourceV1 | null = null;
  const resultReader = {
    async readFinalized(runId: string) {
      return runId === RUN_ID && resultSource
        ? structuredClone(resultSource)
        : null;
    },
  };
  const authorityResultReader = {
    async readFinalized(runId: string) {
      return runId === RUN_ID && resultSource
        ? structuredClone(resultSource.authority)
        : null;
    },
  };
  const viewerAuthorizer: ResultViewerAuthorizerPort = {
    async readViewerContext(runId, viewerId) {
      if (runId !== RUN_ID) return null;
      const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1.find(
        (candidate) => viewerId === `viewer-${candidate}`,
      );
      return seatId ? viewerFixture(seatId, viewerId) : null;
    },
  };
  const replayPolicyPort: PressureReplayPolicyPort = {
    async listActions(source) {
      return replayActionsFixture(source.participantMode);
    },
  };
  const replayPolicy = new PressureReplayPolicyEvaluatorV1(replayPolicyPort);
  const result = new PressureResultQueryServiceV1(
    resultReader,
    viewerAuthorizer,
    replayPolicy,
  );
  const narrative = new NarrativeOutboxConsumerV1(
    narrativeOutbox,
    { async readCommitted(job) { return narrativeSource(job); } },
    new PublishingProjector(() => resultSource, (next) => { resultSource = next; }),
    { nowMs: () => 10_000 },
    { leaseMs: 1_000, infrastructureRetryMs: 50 },
  );
  const replayExecutions = new MemoryReplayExecutions();
  const replayCreator = new MemoryReplayCreator(replayExecutions);
  const replay = new PressureReplayCommandHandlerV1(
    authorityResultReader,
    viewerAuthorizer,
    replayPolicy,
    replayExecutions,
    {
      async resolveSamePressureRoute() { return structuredClone(replayTarget); },
      async resolveLatestPressureRoute() { return null; },
    },
    replayCreator,
  );

  let genesisN1Handoff!: MemoryGenesisN1Handoff;
  const runtime = composePressureChapterRuntimeV1({
    genesis,
    n1Handoff(starter) {
      genesisN1Handoff = new MemoryGenesisN1Handoff(genesisStore, starter);
      return genesisN1Handoff;
    },
    chapter: {
      states,
      content,
      seeds: new WorkingSeed(),
      ledgerOpening: working.openingPort,
      projections: working.projectionPort,
      formalActions: working.formalPort,
      beatResolution: working.beatPort,
      decisionClose: new AllRequiredClosed(),
      defaults: working.defaultPort,
      settlement: settlements,
      finaleRequest: finaleRequests,
    },
    finale,
    narrative,
    result,
    replay,
  });

  const genesisRequestFingerprint = digest("genesis-request");
  const initializeCommand = {
    routeSnapshot: routeRecord.snapshot,
    genesis: {
      runId: RUN_ID,
      idempotencyKey: `genesis:${RUN_ID}`,
      requestFingerprint: genesisRequestFingerprint,
    },
  };
  const initialized = await runtime.initializeRun(initializeCommand);
  const genesisRetry = await runtime.initializeRun(initializeCommand);
  assert.equal(genesisStore.record?.record.snapshot.nodeId, "P0");
  assert.equal(genesisStore.record?.record.snapshot.sequence, 0);
  assert.equal(initialized.genesis.status, "COMMITTED");
  assert.equal(genesisRetry.genesis.status, "REPLAYED");
  assert.deepEqual(genesisRetry.handoff, initialized.handoff);
  assert.equal(genesisStore.handoffInsertCount, 1);
  assert.equal(genesisStore.handoffStatus, "PENDING");
  assert.equal(await states.read(RUN_ID), null, "Genesis must not directly open N1");
  assert.equal(states.n1OpenCount, 0);

  const openN1Command: OpenPressureN1FromGenesisHandoffCommandV1 = {
    routeSnapshot: routeRecord.snapshot,
    genesis: initialized.genesis.committed,
    handoff: initialized.handoff,
    idempotencyKey: `open-n1:${RUN_ID}`,
    requestFingerprint: digest("open-n1-request"),
    nowMs: 1_000,
  };
  await assert.rejects(
    runtime.openN1FromGenesisHandoff({
      ...openN1Command,
      handoff: {
        ...openN1Command.handoff,
        outboxDedupeKey: `${openN1Command.handoff.outboxDedupeKey}:wrong`,
      },
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("PRESSURE_RUNTIME_CONTEXT_MISMATCH")
      && error.message.includes("command.handoff.outboxDedupeKey"),
  );
  assert.equal(states.n1OpenCount, 0, "a non-exact outbox key must fail closed");
  genesisN1Handoff.failAfterStartBeforeAckOnce();
  await assert.rejects(
    runtime.openN1FromGenesisHandoff(openN1Command),
    /SIMULATED_CRASH_AFTER_N1_START_BEFORE_ACK/,
  );
  assert.equal(states.n1OpenCount, 1);
  assert.equal(genesisStore.handoffStatus, "PENDING");

  const opened = await runtime.openN1FromGenesisHandoff(openN1Command);
  assert.equal(opened.status, "REPLAYED");
  assert.equal(opened.sourceDedupeKey, initialized.handoff.outboxDedupeKey);
  assert.equal(opened.outboxStatus, "ACKNOWLEDGED");
  assert.equal(genesisStore.handoffStatus, "ACKNOWLEDGED");
  assert.equal(states.n1OpenCount, 1, "crash recovery must reuse the existing N1");

  const handoffRetry = await runtime.openN1FromGenesisHandoff(openN1Command);
  assert.equal(handoffRetry.status, "REPLAYED");
  assert.equal(states.n1OpenCount, 1, "ack retry must not create another N1");
  let state = handoffRetry.chapter;

  const processed = Object.fromEntries(
    CHAPTER_IDS_V1.map((chapterId) => [chapterId, 0]),
  ) as Record<ChapterIdV1, number>;
  let nowMs = 1_001;
  while (state.phase !== "FINALE_REQUESTED") {
    assert.equal(state.phase, "ACTIVE");
    const chapterId = state.currentChapterId;
    const command = await humanAction(
      working,
      content,
      routeRecord.snapshot,
      state,
      processed[chapterId],
    );
    state = await runtime.submitAction({ ...command, nowMs: nowMs += 1 });
    processed[chapterId] += 1;
  }

  assert.deepEqual(processed, POINT_COUNTS);
  assert.equal(settlements.commitCount, 7);
  assert.deepEqual(
    settlements.bundles.map((bundle) => [bundle.chapterId, bundle.committedWorldSequence]),
    CHAPTER_IDS_V1.map((chapterId, index) => [chapterId, index + 1]),
  );
  assert.equal(new Set(settlements.bundles.map((bundle) => bundle.chapterId)).size, 7);
  assert.equal(finaleRequests.uniqueCount, 1);

  const source = await finaleSource.readN7FrozenSource(RUN_ID) as N7FrozenFinaleSourceV1;
  const finalized = await runtime.finalize({
    runId: RUN_ID,
    idempotencyKey: `finale:${RUN_ID}`,
    requestFingerprint: source.sourceFingerprint,
    decidedAt: DECIDED_AT,
  });
  assert.equal(finalized.status, "COMMITTED");
  assert.equal(finalized.record.resultArtifact.authoritativeResultStatus, "FINALIZED");
  resultSource = projectTerminalToResultReadModel(finalized.record);

  const pending = await runtime.getResult({
    runId: RUN_ID,
    viewerId: `viewer-${ACTOR}`,
  });
  assert.equal(pending.authoritativeResultStatus, "FINALIZED");
  assert.equal(pending.payload.narrative.status, "PENDING");
  assert.equal(pending.payload.narrative.text, null);
  const authorityBeforeNarrative = sha256Canonical(terminal.record);
  const authorityCommitHash = terminal.record!.authorityCommitHash;

  assert.deepEqual(await runtime.consumeNarrative("openovel-worker"), {
    kind: "ACKNOWLEDGED",
    outboxId: `finale_narrative_${RUN_ID}_public`,
    status: "PUBLISHED",
  });
  assert.deepEqual(await runtime.consumeNarrative("openovel-worker"), {
    kind: "ACKNOWLEDGED",
    outboxId: `finale_narrative_${RUN_ID}_${ACTOR}`,
    status: "PUBLISHED",
  });
  assert.equal(sha256Canonical(terminal.record), authorityBeforeNarrative);
  assert.equal(terminal.record!.authorityCommitHash, authorityCommitHash);

  const published = await runtime.getResult({
    runId: RUN_ID,
    viewerId: `viewer-${ACTOR}`,
  });
  assert.equal(published.payload.narrative.status, "PUBLISHED");
  assert.equal(published.decisionHash, pending.decisionHash);
  assert.equal(published.sourceCommitHash, pending.sourceCommitHash);
  assert.equal(published.payload.viewerSeat.seatId, ACTOR);
  assert.equal(published.payload.viewerSeat.roleKey, `role.${ACTOR}`);
  assert.ok(published.payload.viewerSeat.causes.length > 0);
  const cabinetSerialized = JSON.stringify(published);
  assert.match(cabinetSerialized, /桑田诏|财政/);
  assert.doesNotMatch(cabinetSerialized, /role\.qingliu_law/);
  assert.doesNotMatch(cabinetSerialized, /role\.sili_weaving/);
  assert.equal("seatOutcomes" in published.payload, false);

  const sourceRunBeforeReplay = structuredClone({
    terminal: terminal.record,
    result: resultSource,
    bundles: settlements.bundles,
  });
  const replayAction = replayActionsFixture("SOLO")[0]!;
  const replayReceipt = await runtime.replay(
    `viewer-${ACTOR}`,
    replayCommandFixture(replayAction),
  );
  assert.deepEqual(validateReplayCreationReceiptV1(replayReceipt), replayReceipt);
  assert.equal(replayReceipt.launchKind, "CREATE_RUN");
  assert.equal(replayReceipt.createdRunId, "replayed-run-1");
  assert.equal(replayCreator.createdRuns, 1);
  assert.deepEqual({
    terminal: terminal.record,
    result: resultSource,
    bundles: settlements.bundles,
  }, sourceRunBeforeReplay);
});

test("runtime remains a thin dependency graph with no Provider, persistence or rule evaluator", () => {
  const directory = join(process.cwd(), "apps", "api", "src", "pressure-chapter", "runtime");
  const facadeSource = readFileSync(
    join(directory, "pressure-chapter-runtime.facade.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    facadeSource,
    /ports\.chapters\.start\s*\(/,
    "initializeRun must not retain a direct N1 opening capability",
  );
  const source = ["composition.ts", "contracts.ts"]
    .map((file) => readFileSync(join(directory, file), "utf8"))
    .concat(facadeSource)
    .join("\n");
  for (const forbidden of [
    "@prisma/client",
    "PrismaService",
    "evaluateSangtianPressureFinaleV1",
    "settleB0ChapterV1",
    "OpenAI",
    "Anthropic",
    "worldSequence +=",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace("+", "\\+")));
  }
  assert.match(source, /PressureChapterOrchestratorService/);
  assert.match(source, /ChapterSettlementPort/);
  assert.match(source, /RuntimeNarrativePortV1/);
  assert.match(source, /RuntimeResultQueryPortV1/);
});

class MemoryRouteRepository implements RunRouteRepositoryPort {
  private readonly records = new Map<string, StoredRunRouteRecordV1>();
  async findByRunId(runId: string) {
    return structuredClone(this.records.get(runId) ?? null);
  }
  async insertIfAbsent(record: StoredRunRouteRecordV1) {
    const existing = this.records.get(record.runId);
    if (existing) return { status: "EXISTING" as const, record: structuredClone(existing) };
    this.records.set(record.runId, structuredClone(record));
    return { status: "INSERTED" as const, record: structuredClone(record) };
  }
}

class P0Content implements GenesisContentPort {
  async loadP0() { return p0World(); }
}

class MemoryGenesisStore implements GenesisAtomicCommitPort {
  record: CommittedGenesisV1 | null = null;
  handoffInsertCount = 0;
  private handoff: {
    descriptor: PersistedGenesisN1HandoffV1;
    status: "PENDING" | "LEASED" | "ACKNOWLEDGED";
    attempts: number;
  } | null = null;

  get handoffStatus() {
    return this.handoff?.status ?? null;
  }

  async readCommitted(runId: string) {
    return this.record?.record.runId === runId ? structuredClone(this.record) : null;
  }
  async commitOnce(candidate: GenesisAtomicRecordV1) {
    if (this.record) return { status: "ALREADY_COMMITTED" as const, committed: structuredClone(this.record) };
    this.record = { record: structuredClone(candidate), receipt: buildGenesisCommitReceipt(candidate) };
    this.handoff = {
      descriptor: genesisHandoff(candidate),
      status: "PENDING",
      attempts: 0,
    };
    this.handoffInsertCount += 1;
    return { status: "COMMITTED" as const, committed: structuredClone(this.record) };
  }

  claimHandoff(expected: PersistedGenesisN1HandoffV1) {
    assert.ok(this.handoff, "Genesis handoff must be committed atomically");
    assert.deepEqual(this.handoff.descriptor, expected);
    if (this.handoff.status === "ACKNOWLEDGED") {
      return { replayed: true, attempt: this.handoff.attempts };
    }
    assert.equal(this.handoff.status, "PENDING", "only an expired/released lease can retry");
    this.handoff.status = "LEASED";
    this.handoff.attempts += 1;
    return { replayed: this.handoff.attempts > 1, attempt: this.handoff.attempts };
  }

  releaseHandoffAfterCrash(expectedDedupeKey: string) {
    assert.equal(this.handoff?.descriptor.outboxDedupeKey, expectedDedupeKey);
    assert.equal(this.handoff?.status, "LEASED");
    this.handoff.status = "PENDING";
  }

  acknowledgeHandoff(expectedDedupeKey: string) {
    assert.equal(this.handoff?.descriptor.outboxDedupeKey, expectedDedupeKey);
    if (this.handoff.status !== "ACKNOWLEDGED") {
      assert.equal(this.handoff.status, "LEASED");
      this.handoff.status = "ACKNOWLEDGED";
    }
  }
}

class MemoryOrchestratorStates implements ChapterOrchestratorStatePort {
  private readonly records = new Map<string, ChapterOrchestratorStateV1>();
  n1OpenCount = 0;
  async read(runId: string) { return structuredClone(this.records.get(runId) ?? null); }
  async compareAndSwap(input: Parameters<ChapterOrchestratorStatePort["compareAndSwap"]>[0]) {
    const current = this.records.get(input.runId) ?? null;
    if ((current?.revision ?? null) !== input.expectedRevision) {
      return { status: "CONFLICT" as const, current: structuredClone(current) };
    }
    if (input.expectedRevision === null && input.next.currentChapterId === "N1") {
      this.n1OpenCount += 1;
    }
    this.records.set(input.runId, structuredClone(input.next));
    return { status: "COMMITTED" as const, current: structuredClone(input.next) };
  }
}

class MemoryGenesisN1Handoff implements RuntimeGenesisN1HandoffPortV1 {
  private crashAfterStartBeforeAck = false;

  constructor(
    private readonly store: MemoryGenesisStore,
    private readonly starter: RuntimeChapterHandoffStartPortV1,
  ) {}

  failAfterStartBeforeAckOnce() {
    this.crashAfterStartBeforeAck = true;
  }

  async openFromGenesisHandoff(
    command: Readonly<OpenPressureN1FromGenesisHandoffCommandV1>,
  ) {
    const claim = this.store.claimHandoff(command.handoff);
    const chapter = await this.starter.start({
      routeSnapshot: command.routeSnapshot,
      genesisWorldStateHash:
        command.genesis.record.snapshot.initialWorldState.stateHash,
      genesisHash: command.genesis.record.snapshot.genesisHash,
      nowMs: command.nowMs,
    });
    if (this.crashAfterStartBeforeAck) {
      this.crashAfterStartBeforeAck = false;
      this.store.releaseHandoffAfterCrash(command.handoff.outboxDedupeKey);
      throw new Error("SIMULATED_CRASH_AFTER_N1_START_BEFORE_ACK");
    }
    this.store.acknowledgeHandoff(command.handoff.outboxDedupeKey);
    return {
      status: claim.replayed ? "REPLAYED" as const : "OPENED" as const,
      sourceTaskType: "OPEN_CHAPTER" as const,
      sourceAuthority: "GENESIS_FROZEN" as const,
      sourceDedupeKey: command.handoff.outboxDedupeKey,
      sourceCommitHash: command.handoff.sourceCommitHash,
      outboxStatus: "ACKNOWLEDGED" as const,
      chapter,
    };
  }
}

function genesisHandoff(
  candidate: GenesisAtomicRecordV1,
): PersistedGenesisN1HandoffV1 {
  return {
    schemaVersion: "pressure_genesis_n1_handoff_v1",
    taskType: "OPEN_CHAPTER",
    checkpoint: "PERSISTED",
    sourceAuthority: "GENESIS_FROZEN",
    runId: candidate.runId,
    chapterId: "N1",
    genesisHash: candidate.snapshot.genesisHash,
    sourceCommitHash: candidate.commit.commitHash,
    outboxDedupeKey: buildGenesisOpenN1OutboxDedupeKeyV1(
      candidate.runId,
      candidate.commit.commitHash,
    ),
  };
}

class MemoryWorkingLedger implements WorkingLedgerPort {
  private readonly events = new Map<string, WorkingLedgerEventV1[]>();
  async read(key: WorkingLedgerKeyV1) {
    return structuredClone(this.events.get(ledgerKey(key)) ?? []);
  }
  async append(input: Parameters<WorkingLedgerPort["append"]>[0]): Promise<WorkingLedgerAppendResultV1> {
    const current = this.events.get(ledgerKey(input.key)) ?? [];
    if ((current.at(-1)?.eventHash ?? null) !== input.expectedHeadHash) {
      return { status: "HEAD_MISMATCH", events: structuredClone(current) };
    }
    this.events.set(ledgerKey(input.key), [...current, ...structuredClone(input.events)]);
    return { status: "APPENDED", events: structuredClone(input.events) };
  }
}

class DynamicAuthoredContent implements AuthoredChapterContentPort {
  readonly descriptors = new Map<ChapterIdV1, AuthoredChapterRuntimeV1>(
    CHAPTER_IDS_V1.map((chapterId) => [chapterId, authoredChapter(chapterId, POINT_COUNTS[chapterId])]),
  );
  async load(input: { chapterId: ChapterIdV1 }) {
    return structuredClone(this.descriptors.get(input.chapterId)!);
  }
}

class WorkingSeed implements ChapterWorkingSeedPort {
  async load(input: Parameters<ChapterWorkingSeedPort["load"]>[0]) {
    return createChapterWorkingState({
      runId: input.routeSnapshot.runId,
      chapterId: input.chapter.chapterId,
    });
  }
}

class DynamicInteractionAccess implements PressureInteractionAccessPort {
  constructor(
    private readonly ledger: MemoryWorkingLedger,
    private readonly runtimes: Map<string, AuthoredChapterRuntimeV1>,
  ) {}
  async load(input: { runId: string; chapterRuntimeId: string }): Promise<PressureInteractionAccessV1> {
    const projection = projectWorkingLedger(await this.ledger.read(input));
    const descriptor = this.runtimes.get(input.chapterRuntimeId)!;
    const pointId = projection.nextDecisionPin?.decisionPointId ?? null;
    const decision = descriptor.decisions.find((candidate) => candidate.decisionPointId === pointId);
    return {
      routeHash: projection.routeHash,
      runId: projection.key.runId,
      chapterRuntimeId: projection.key.chapterRuntimeId,
      chapterId: projection.chapterId,
      workingRevision: projection.state.revision,
      workingStateHash: projection.stateHash,
      activeDecisionPointId: pointId,
      controlledSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
      controlEpochBySeat: Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [seatId, 1])),
      allowedActionTypes: [...(decision?.execution.allowedActionTypes ?? [])],
      interactableSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
      visibleEvidenceRefs: [],
      resourceAvailability: [],
    };
  }
}

class W5MemoryHarness {
  private readonly ledger = new MemoryWorkingLedger();
  private readonly runtimes = new Map<string, AuthoredChapterRuntimeV1>();
  private readonly ledgerService = new WorkingLedgerService(this.ledger);
  private readonly formalService = new FormalPressureInteractionService(
    new DynamicInteractionAccess(this.ledger, this.runtimes),
    this.ledger,
  );
  private readonly beatService = new WorkingBeatApplicationService(this.ledger);

  constructor(private readonly content: DynamicAuthoredContent) {}

  readonly openingPort: WorkingLedgerOpeningPort = {
    open: async (command) => {
      this.runtimes.set(
        command.chapterRuntimeId,
        this.content.descriptors.get(command.chapterDefinition.chapterId)!,
      );
      return this.ledgerService.open(command);
    },
  };
  readonly projectionPort: WorkingProjectionReaderPort = {
    load: async (input) => projectWorkingLedger(await this.ledger.read(input)),
  };
  readonly formalPort: FormalActionSubmissionPort = {
    submit: (command) => this.formalService.submit(command),
  };
  readonly beatPort: DecisionBeatResolutionPort = {
    resolve: async (input) => {
      const before = await this.projectionPort.load({
        runId: input.routeSnapshot.runId,
        chapterRuntimeId: input.chapterRuntimeId,
      });
      const accepted = before.acceptedActions.get(input.actionIds[0]!)!;
      const applied = await this.beatService.apply({
        routeSnapshot: input.routeSnapshot,
        chapterRuntimeId: input.chapterRuntimeId,
        chapterDefinition: input.chapterDefinition,
        actionId: input.actionIds[0]!,
        actionInputFingerprint: accepted.inputFingerprint,
        resolverVersion: input.resolverVersion,
      });
      return {
        status: applied.status,
        resolution: applied.resolution,
        projection: await this.projectionPort.load({
          runId: input.routeSnapshot.runId,
          chapterRuntimeId: input.chapterRuntimeId,
        }),
      };
    },
  };
  readonly defaultPort: DeterministicDefaultActionPort = {
    async submit() { throw new Error("E2E does not request a default"); },
  };
}

class AllRequiredClosed implements DecisionCloseEvaluatorPort {
  async isClosed(input: Parameters<DecisionCloseEvaluatorPort["isClosed"]>[0]) {
    return input.active.seats
      .filter((seat) => seat.requirement === "REQUIRED")
      .every((seat) => seat.completion !== "PENDING");
  }
}

class MemoryChapterSettlement implements ChapterSettlementPort {
  readonly bundles: FrozenChapterBundleV1[] = [];
  private readonly byInputHash = new Map<string, FrozenChapterBundleV1>();
  commitCount = 0;
  async settle(input: Parameters<ChapterSettlementPort["settle"]>[0]) {
    const existing = this.byInputHash.get(input.settlementInput.inputHash);
    if (existing) return { status: "REPLAYED" as const, frozenBundle: structuredClone(existing) };
    const bundle = frozenBundle(input);
    this.byInputHash.set(input.settlementInput.inputHash, structuredClone(bundle));
    this.bundles.push(structuredClone(bundle));
    this.commitCount += 1;
    return { status: "SETTLED" as const, frozenBundle: structuredClone(bundle) };
  }
}

class MemoryFinaleRequests implements FinaleRequestPort {
  private readonly keys = new Set<string>();
  async request(input: Parameters<FinaleRequestPort["request"]>[0]) {
    const replay = this.keys.has(input.idempotencyKey);
    this.keys.add(input.idempotencyKey);
    return { status: replay ? "REPLAYED" as const : "REQUESTED" as const };
  }
  get uniqueCount() { return this.keys.size; }
}

class MemoryN7FinaleSource implements N7FrozenFinaleSourceReaderPort {
  constructor(
    private readonly route: RunRouteSnapshotV1,
    private readonly genesis: MemoryGenesisStore,
    private readonly settlement: MemoryChapterSettlement,
  ) {}
  async readN7FrozenSource(runId: string) {
    if (runId !== this.route.runId || this.settlement.bundles.length !== 7 || !this.genesis.record) return null;
    const policy = compileSangtianContentFinalePolicyV1({
      contentPackageVersion: this.route.contentPackageVersion,
      contentPackageSha256: this.route.contentPackageSha256,
    });
    const finalWorldState = this.settlement.bundles[6]!.frozenWorldState;
    const causalEdges = this.settlement.bundles.flatMap((bundle) => structuredClone(bundle.causalEdges));
    const finaleInputWithoutHash = {
      schemaVersion: "sangtian_finale_input_v1" as const,
      runId,
      routeHash: this.route.routeHash,
      runSeed: this.route.runSeed,
      genesisHash: this.genesis.record.record.snapshot.genesisHash,
      frozenChapterBundles: structuredClone(this.settlement.bundles),
      finalWorldState: structuredClone(finalWorldState),
      causalEdges,
      policyVersion: policy.policyVersion,
      policyHash: policy.policyHash,
    };
    const finaleInput = {
      ...finaleInputWithoutHash,
      inputHash: sha256Canonical(finaleInputWithoutHash),
    };
    return withN7FrozenFinaleSourceFingerprintV1({
      schemaVersion: "n7_frozen_finale_source_v1",
      runId,
      triggerKind: "N7_FROZEN",
      terminalChapterId: "N7",
      terminalWorldSequence: 7,
      routeHash: this.route.routeHash,
      runSeed: this.route.runSeed,
      genesisHash: this.genesis.record.record.snapshot.genesisHash,
      frozenChapterBundles: structuredClone(this.settlement.bundles),
      finalWorldState: structuredClone(finalWorldState),
      causalEdges,
      policy,
      terminalResultContext: compileTerminalResultContextV1({
        roomId: "room-pressure-1",
        participantMode: this.route.participantMode,
        completedAt: DECIDED_AT,
        frozenRoute: this.route.route,
        resultContractRegistryVersion: this.route.resultContractRegistryVersion,
        narrativeProfileVersion: this.route.narrativeProfileVersion,
        finaleInput,
      }),
    });
  }
}

class MemoryTerminalCommitter implements AuthorityFirstTerminalCommitterPort {
  record: AuthorityFirstTerminalRecordV1 | null = null;
  async readCommitted(runId: string) {
    return this.record?.runId === runId ? structuredClone(this.record) : null;
  }
  async commitOnce(record: Readonly<AuthorityFirstTerminalRecordV1>) {
    if (this.record) return { status: "REPLAYED" as const, record: structuredClone(this.record) };
    this.record = structuredClone(record);
    return { status: "COMMITTED" as const, record: structuredClone(record) };
  }
}

class MemoryNarrativeOutbox implements NarrativeOutboxPortV1 {
  private jobs: OpenNovelNarrativeProjectionJobV1[] = [];
  private claimed: OpenNovelNarrativeProjectionJobV1 | null = null;
  seed(jobs: OpenNovelNarrativeProjectionJobV1[]) { this.jobs = structuredClone(jobs); }
  async claimNext(): Promise<NarrativeOutboxClaimV1> {
    const job = this.jobs[0];
    if (!job) return { kind: "EMPTY" };
    this.claimed = structuredClone(job);
    return {
      kind: "CLAIMED",
      outboxId: job.jobId,
      fence: 1,
      attemptCount: 0,
      maxAttempts: 3,
      job: structuredClone(job),
    };
  }
  async acknowledge(request: { outboxId: string }) {
    assert.equal(request.outboxId, this.claimed?.jobId);
    this.jobs.shift();
    this.claimed = null;
  }
  async retry() { throw new Error("unexpected narrative retry"); }
  async deadLetter() {
    this.jobs.shift();
    this.claimed = null;
  }
}

class PublishingProjector implements OpenNovelNarrativeProjectorPortV1 {
  constructor(
    private readonly readResult: () => PressureResultReadModelSourceV1 | null,
    private readonly writeResult: (value: PressureResultReadModelSourceV1) => void,
  ) {}
  async project(input: Parameters<OpenNovelNarrativeProjectorPortV1["project"]>[0]) {
    const job = input.job;
    const base = {
      schemaVersion: "openovel_narrative_artifact_v1" as const,
      jobId: job.jobId,
      runId: job.runId,
      projectionKind: job.projectionKind,
      sourceId: job.sourceId,
      sourceCommitHash: job.sourceCommitHash,
      sourceContentHash: job.sourceContentHash,
      audience: structuredClone(job.audience),
      narrativeProfileVersion: job.narrativeProfileVersion,
      projectorVersion: "openovel-pressure-e2e-v1",
      text: `Published narrative for ${job.audience.kind === "PUBLIC" ? "public" : job.audience.seatId}`,
      usedFactRefs: [] as string[],
      validationReportHash: digest(`validation-${job.jobId}`),
      renderMode: "PROVIDER" as const,
      status: "PUBLISHED" as const,
    };
    const artifact: OpenNovelNarrativeArtifactV1 = {
      ...base,
      contentHash: computeNarrativeArtifactContentHash(base),
    };
    if (job.audience.kind === "SEAT") {
      const source = this.readResult();
      assert.ok(source);
      const narrative = source.narratives.find((item) => item.seatId === job.audience.seatId)!;
      narrative.status = "PUBLISHED";
      narrative.text = artifact.text;
      narrative.contentHash = artifact.contentHash;
      this.writeResult(structuredClone(source));
    }
    return {
      logicalProjectionKey: digest(`logical-${job.jobId}`),
      requestFingerprint: digest(`request-${job.jobId}`),
      projectionId: `projection-${job.jobId}`,
      status: "PUBLISHED" as const,
      deliveryState: "ACTIVE" as const,
      artifact,
      retryAtMs: null,
      errorCode: null,
    };
  }
}

class MemoryReplayExecutions implements ReplayExecutionReaderPort {
  readonly records = new Map<string, StoredReplayExecutionV1>();
  async readExecution(sourceRunId: string, idempotencyKey: string) {
    return structuredClone(this.records.get(`${sourceRunId}\u0000${idempotencyKey}`) ?? null);
  }
}

class MemoryReplayCreator implements ReplayCreationTransactionPort {
  createdRuns = 0;
  constructor(private readonly executions: MemoryReplayExecutions) {}
  async createOnce(request: Readonly<ReplayCreationRequestV1>) {
    const key = `${request.sourceRunId}\u0000${request.idempotencyKey}`;
    const existing = this.executions.records.get(key);
    if (existing) return structuredClone(existing.receipt);
    this.createdRuns += 1;
    const base: Omit<ReplayCreationReceiptV1, "receiptHash"> = {
      schemaVersion: "replay_creation_receipt_v1",
      sourceRunId: request.sourceRunId,
      actionId: request.action.actionId,
      launchKind: "CREATE_RUN",
      createdRunId: `replayed-run-${this.createdRuns}`,
      createdLobbyId: null,
      navigationTarget: null,
      frozenTargetRouteHash: request.target!.targetDescriptorHash,
    };
    const receipt = { ...base, receiptHash: sha256Canonical(base) };
    this.executions.records.set(key, {
      sourceRunId: request.sourceRunId,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: request.requestFingerprint,
      receipt,
    });
    return structuredClone(receipt);
  }
}

async function humanAction(
  working: W5MemoryHarness,
  content: DynamicAuthoredContent,
  routeSnapshot: RunRouteSnapshotV1,
  state: ChapterOrchestratorStateV1,
  ordinal: number,
) {
  const projection = await working.projectionPort.load({
    runId: state.runId,
    chapterRuntimeId: state.chapterRuntimeId,
  });
  const pointId = state.activeDecision!.decisionPointId;
  const optionId = content.descriptors.get(state.currentChapterId)!.definition.decisionPoints
    .find((point) => point.decisionPointId === pointId)!.options[0]!.optionId;
  const payload = { optionId };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action_${state.currentChapterId}_${pointId}_${ordinal}`,
    runId: state.runId,
    chapterRuntimeId: state.chapterRuntimeId,
    chapterId: state.currentChapterId,
    decisionPointId: pointId,
    seatId: ACTOR,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: projection.state.revision,
    status: "SEALED" as const,
    actionType: "DECIDE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: `idem_${state.currentChapterId}_${pointId}_${ordinal}`,
  };
  const withRequest = { ...body, requestFingerprint: computeDecisionActionRequestFingerprint(body) };
  const action: DecisionActionV1 = { ...withRequest, sealedHash: sha256Canonical(withRequest) };
  const intent = emptyIntent();
  const formalBase = { routeSnapshot, action, intent };
  return {
    routeSnapshot,
    subjectId: "human-player",
    action,
    intent,
    inputFingerprint: computeFormalInteractionInputFingerprint(formalBase),
  };
}

function authoredChapter(chapterId: ChapterIdV1, count: number): AuthoredChapterRuntimeV1 {
  const points: PressureChapterDefinition["decisionPoints"] = [];
  const decisions: AuthoredChapterRuntimeV1["decisions"] = [];
  for (let index = 0; index < count; index += 1) {
    const decisionPointId = `${chapterId.toLowerCase()}-point-${index + 1}`;
    const optionId = `${decisionPointId}-option`;
    const requirementId = `${decisionPointId}-complete`;
    points.push({
      decisionPointId,
      kernelId: `${decisionPointId}-kernel`,
      chapterId,
      sourceOrder: index + 1,
      prompt: `Decision ${index + 1}`,
      requirementIds: [requirementId],
      ...(index > 0 ? { activation: { allSatisfiedRequirementIds: [`${chapterId.toLowerCase()}-point-${index}-complete`] } } : {}),
      priority: { duePressureCount: count - index },
      options: [{
        optionId,
        sourceOrder: 1,
        label: "Proceed",
        workingDelta: {
          setFacts: { [`fact.${decisionPointId}`]: true },
          satisfyRequirementIds: [requirementId],
        },
      }],
    });
    decisions.push({
      decisionPointId,
      execution: {
        decisionPointKey: decisionPointId,
        chapterId,
        ordinal: index + 1,
        mode: "SOLO_BEAT",
        purpose: `Resolve ${decisionPointId}`,
        requiredSeatIds: [ACTOR],
        allowedActionTypes: ["DECIDE", "DEFAULT"],
        perSeatActionBudget: { [ACTOR]: 1 },
        closeCondition: { op: "COMPARE", factRef: "seat.ready", comparator: "EQ", value: true },
        deadlinePolicy: null,
        absenceDefaultPolicy: defaultPolicy(`${decisionPointId}-absence`, optionId),
        aiFailureDefaultPolicy: defaultPolicy(`${decisionPointId}-ai-failure`, optionId),
        beatResolutionPolicy: "pressure-working-beat-v1",
        allowedWorkingDeltaTypes: ["FACT"],
        feedbackVisibilityPolicy: "AUDIENCE_PROJECTED",
        reactionPolicy: { enabled: false, eligibleSeatIds: [], trigger: null, maxDepth: 0 },
      },
      seatRequirements: Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
        seatId,
        seatId === ACTOR ? "REQUIRED" : "NOT_REQUIRED",
      ])) as AuthoredChapterRuntimeV1["decisions"][number]["seatRequirements"],
    });
  }
  const definition: PressureChapterDefinition = {
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId,
    sequence: CHAPTER_IDS_V1.indexOf(chapterId) + 1,
    decisionPoints: points,
    requirementDependencies: [],
  };
  const body = {
    schemaVersion: "pressure_authored_chapter_runtime_v1" as const,
    chapterId,
    definition,
    decisions,
    chapterClosePolicy: {
      kind: "ALL_AUTHORED_DECISION_POINTS_COMPLETED" as const,
      decisionPointIds: points.map((point) => point.decisionPointId),
    },
    contentPolicyVersion: `sangtian-${chapterId.toLowerCase()}-policy-v1`,
    contentPolicyHash: digest(`content-policy-${chapterId}`),
    settlementContractVersion: "sangtian-settlement-v1",
    settlementContractHash: digest("settlement-contract"),
  };
  return { ...body, descriptorHash: sha256Canonical(body) };
}

function frozenBundle(input: Parameters<ChapterSettlementPort["settle"]>[0]): FrozenChapterBundleV1 {
  const settlement = input.settlementInput;
  const sequence = settlement.baseWorldSequence + 1;
  const world = chapterWorld(sequence);
  const nextChapterId: FrozenChapterBundleV1["carryForward"]["nextChapterId"] =
    sequence === 7 ? "FINALE" : `N${sequence + 1}` as ChapterIdV1;
  const carryBody = {
    nextChapterId,
    unlockedContentRefs: [],
    unresolvedCommitmentRefs: [],
    pendingConsequenceRefs: [],
  };
  const body = {
    schemaVersion: "sangtian_frozen_chapter_bundle_v1" as const,
    runId: settlement.runId,
    chapterId: settlement.chapterId,
    chapterSequence: sequence as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    baseWorldSequence: settlement.baseWorldSequence,
    committedWorldSequence: sequence,
    previousFrozenHash: settlement.previousFrozenHash,
    decisionLedgerHash: settlement.decisionLedgerHash,
    finalWorkingStateHash: settlement.finalWorkingStateHash,
    settlementPolicyVersion: settlement.contentPolicyVersion,
    worldDelta: { factMutations: [], resourceMutations: [] },
    committedWorldStateHash: world.stateHash,
    frozenWorldState: world,
    causalEdges: [],
    carryForward: { ...carryBody, carryForwardHash: sha256Canonical(carryBody) },
  };
  return { ...body, bundleHash: sha256Canonical(body) };
}

function p0World(): WorldStateV1 {
  return worldState(0, { "frozen.P0.LOCKED": true, "fact.public.relief": false });
}

function chapterWorld(sequence: number): WorldStateV1 {
  return worldState(sequence, { "fact.public.relief": sequence === 7 });
}

function worldState(sequence: number, factValues: Record<string, boolean>): WorldStateV1 {
  const trackValue = sequence === 7 ? 3 : 0;
  const tracksBody = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(TRACK_IDS_V1.map((trackId) => [trackId, trackValue])) as Record<TrackIdV1, number>,
  };
  const tracks = { ...tracksBody, stateHash: sha256Canonical(tracksBody) };
  const knowledgeBySeat = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const body = {
      seatId,
      knownFactRefs: ["fact.public.relief"],
      secretRefs: [`secret.${seatId}`],
      disclosedToSeatIds: [] as SeatIdV1[],
    };
    return [seatId, { ...body, stateHash: sha256Canonical(body) }];
  })) as WorldStateV1["knowledgeBySeat"];
  const seatArcs = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<WorldStateV1["seatArcs"]>((all, seatId) => {
    const body = {
      seatId,
      arcStage: `stage-${sequence}`,
      publicGoalProgress: sequence,
      privateGoalProgress: sequence,
      gainRefs: sequence === 7 ? [`gain.${seatId}`] : [],
      lossRefs: [],
      costRefs: [],
    };
    all[seatId] = { ...body, stateHash: sha256Canonical(body) };
    return all;
  }, {} as WorldStateV1["seatArcs"]);
  const body = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: sequence,
    factValues,
    resources: { grain: Math.max(0, 7 - sequence) },
    tracks,
    objects: sequence === 7 ? [{
      objectId: "relief-ledger",
      version: 7,
      stateCode: "SEALED",
      holderSeatId: ACTOR,
      quantity: null,
      tags: ["public"],
      factRefs: ["fact.public.relief"],
    }] : [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  return { ...body, stateHash: sha256Canonical(body) } as WorldStateV1;
}

function projectTerminalToResultReadModel(
  terminal: AuthorityFirstTerminalRecordV1,
): PressureResultReadModelSourceV1 {
  const authority = structuredClone(terminal.resultArtifact);
  return {
    authority,
    narratives: pressureNarrativeReadSetFixture(authority).narratives,
  };
}

function narrativeSource(job: Readonly<OpenNovelNarrativeProjectionJobV1>) {
  const authorizedSeatIds = job.audience.kind === "SEAT" ? [job.audience.seatId] : [];
  return {
    schemaVersion: "authoritative_narrative_source_snapshot_v1" as const,
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    facts: job.allowedFactIds.map((factId) => ({
      factId,
      text: `Frozen fact ${factId}`,
      temporalStatus: "FROZEN",
      visibility: job.audience.kind === "PUBLIC" ? "PUBLIC" : "AUTHORIZED",
      authorizedSeatIds,
    })),
    objects: job.allowedObjectVersionIds.map((objectVersionId) => ({
      objectVersionId,
      label: `Object ${objectVersionId}`,
      stateText: "Frozen object state",
      visibility: "PUBLIC",
      authorizedSeatIds: [],
    })),
    knowledge: job.allowedKnowledgeIds.map((knowledgeId) => ({
      knowledgeId,
      text: `Authorized knowledge ${knowledgeId}`,
      visibility: "AUTHORIZED",
      authorizedSeatIds,
    })),
    claims: [
      {
        kind: "OUTCOME",
        refId: "world-outcome",
        statement: "The common world outcome is frozen",
        required: true,
        visibility: "PUBLIC",
        authorizedSeatIds: [],
      },
      ...PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        kind: "VERDICT",
        refId: `verdict-${seatId}`,
        statement: `Frozen verdict for ${seatId}`,
        required: true,
        visibility: "AUTHORIZED",
        authorizedSeatIds: [seatId],
      })),
    ],
    publicVariant: {
      kind: "FINALE",
      terminalKind: "PRESSURE_FINALE",
      worldOutcomeRef: "world-outcome",
      viewerVerdictRef: null,
    },
    seatVariants: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      variant: {
        kind: "FINALE",
        terminalKind: "PRESSURE_FINALE",
        worldOutcomeRef: "world-outcome",
        viewerVerdictRef: `verdict-${seatId}`,
      },
    })),
  };
}

function routeRegistry(): PressureChapterRouteRegistry {
  const acceptedPackage = loadSangtianPressureChapterPackageV1();
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "pressure-route-registry-v1",
    defaultRouteKey: "sangtian-pressure",
    routes: [{
      routeKey: "sangtian-pressure",
      worldId: "sangtian",
      status: "PUBLISHED",
      createEnabled: true,
      participantModes: ["SOLO", "MULTIPLAYER"],
      route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
      contentPackageVersion: acceptedPackage.manifest.packageVersion,
      contentPackageSha256: acceptedPackage.manifest.contentSha256,
      orchestrationPackageVersion: "sangtian-orchestration-v1",
      orchestrationPackageSha256: digest("orchestration"),
      runtimeContractVersion: "pressure-runtime-v1",
      runtimeContractSha256: digest("runtime"),
      testMatrixVersion: "pressure-tests-v1",
      testMatrixSha256: digest("tests"),
      narrativeProfileVersion: "openovel-pressure-v1",
      featureSetVersion: "pressure-feature-v1",
      resultContractRegistryVersion: RESULT_CONTRACT_REGISTRY_VERSION_V1,
      controlTopologyVersion: "six-seat-control-v1",
      handlerKey: "pressure_chapter_v1",
      resultAdapterKey: "SangtianPressureResultV1Adapter",
      presentationSchemaVersion: "sangtian_pressure_result_v1",
      rendererKey: "sangtian_pressure_endgame_v1",
    }],
  };
  return new PressureChapterRouteRegistry({
    ...base,
    registryHash: computePressureChapterRouteRegistryHash(base),
  });
}

function defaultPolicy(policyRef: string, optionId: string) {
  const body = { policyRef, actionType: "DEFAULT", payload: { optionId } };
  return { ...body, policyHash: sha256Canonical(body) };
}

function emptyIntent(): WorkingActionIntentV1 {
  return {
    visibility: "PRIVATE",
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
}

function digest(label: string): string { return sha256Canonical({ label }); }
function ledgerKey(key: WorkingLedgerKeyV1): string { return `${key.runId}:${key.chapterRuntimeId}`; }
