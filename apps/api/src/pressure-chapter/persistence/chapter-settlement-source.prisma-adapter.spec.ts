import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type DecisionActionV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  type PressureChapterDefinition,
} from "@ai-story/templates";
import { buildGenesisAtomicRecord, buildGenesisCommitReceipt } from "../genesis";
import {
  computeDurableChapterSettlementPreparationFingerprintV1,
  type DurableChapterSettlementSourcePreparationV1,
} from "../integration/chapter-settlement.adapter";
import {
  FormalPressureInteractionService,
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import type {
  PressureInteractionAccessPort,
  PressureInteractionAccessV1,
} from "../interaction/contracts";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import { WorkingBeatApplicationService } from "../working-ledger/beat-application.service";
import type {
  WorkingActionIntentV1,
  WorkingLedgerEventV1,
  WorkingLedgerPort,
} from "../working-ledger/contracts";
import { projectWorkingLedger } from "../working-ledger/working-ledger";
import { WorkingLedgerService } from "../working-ledger/working-ledger.service";
import {
  PrismaDurableChapterSettlementSourceRepository,
  type ChapterSettlementSourcePrismaClient,
} from "./chapter-settlement-source.prisma-adapter";
import { PressurePersistenceError } from "./errors";

const ACTOR: SeatIdV1 = "cabinet_finance";
const TARGET: SeatIdV1 = "jiangnan_merchant";

test("W4 close source is sealed once, replayed by fingerprint, and read losslessly by W6", async () => {
  const fixture = await sourceFixture();
  const repository = new PrismaDurableChapterSettlementSourceRepository(fixture.fake.client);
  const prepared = await repository.prepareSource(fixture.preparation);
  assert.equal(prepared.status, "PREPARED");
  assert.equal(prepared.schemaVersion, "pressure_chapter_settlement_preparation_receipt_v1");
  assert.equal(prepared.sealedInputHash, fixture.preparation.settlementInput.inputHash);
  assert.equal(fixture.fake.runtime.closeInputHash, fixture.preparation.settlementInput.inputHash);
  assert.equal(fixture.fake.sourceWriteTransactions, 1);
  assert.equal(fixture.fake.worldWriteCalls, 0);

  const source = await repository.readSealedSource({
    runId: fixture.route.runId,
    chapterRuntimeId: "runtime-n1",
  });
  assert(source);
  assert.equal(source.sourceHash, prepared.sourceHash);
  assert.equal(source.closeFence.closeFenceHash, prepared.closeFenceHash);
  assert.equal(source.settlementMaterial.actions[0]?.actionId, fixture.action.actionId);
  assert.deepEqual(source.settlementMaterial.actions[0]?.evidenceRefs, ["evidence-ledger"]);
  assert.deepEqual(source.settlementMaterial.resources, [{
    resourceId: "grain",
    quantity: 10,
    version: 0,
  }]);

  const replayed = await repository.prepareSource(fixture.preparation);
  assert.equal(replayed.status, "REPLAYED");
  assert.deepEqual(replayed, { ...prepared, status: "REPLAYED" });
  assert.equal(fixture.fake.sourceEventCount(), 1);
});

test("W4 source preparation fails closed on post-close working-state drift", async () => {
  const fixture = await sourceFixture();
  fixture.fake.runtime.workingStateHash = digest("post-close-drift");
  const repository = new PrismaDurableChapterSettlementSourceRepository(fixture.fake.client);
  await assert.rejects(
    repository.prepareSource(fixture.preparation),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_AUTHORITY_FENCE_MISMATCH",
  );
  assert.equal(fixture.fake.sourceEventCount(), 0);
  assert.equal(fixture.fake.runtime.closeInputHash, null);
  assert.equal(fixture.fake.worldWriteCalls, 0);
});

test("durable settlement material preserves mixed and all-default multi-action chapters", async () => {
  const mixed = await sourceFixture({
    actionSources: ["HUMAN", { defaultCode: "AI_TIMEOUT_HOLD_V1" }],
  });
  const mixedRepository = new PrismaDurableChapterSettlementSourceRepository(mixed.fake.client);
  await mixedRepository.prepareSource(mixed.preparation);
  const mixedSource = await mixedRepository.readSealedSource({
    runId: mixed.route.runId,
    chapterRuntimeId: "runtime-n1",
  });
  assert(mixedSource);
  assert.deepEqual(
    mixedSource.settlementMaterial.actions.map((action) => action.source),
    ["HUMAN", "DEFAULT"],
  );
  assert.deepEqual(
    mixedSource.settlementMaterial.seats.find((seat) => seat.seatId === ACTOR),
    {
      seatId: ACTOR,
      requirement: "REQUIRED",
      completion: "MIXED_ACTIONS",
      defaultCodes: ["AI_TIMEOUT_HOLD_V1"],
    },
  );

  const allDefault = await sourceFixture({
    actionSources: [
      { defaultCode: "AI_TIMEOUT_HOLD_V1" },
      { defaultCode: "DEADLINE_HOLD_V1" },
    ],
  });
  const allDefaultRepository = new PrismaDurableChapterSettlementSourceRepository(
    allDefault.fake.client,
  );
  await allDefaultRepository.prepareSource(allDefault.preparation);
  const allDefaultSource = await allDefaultRepository.readSealedSource({
    runId: allDefault.route.runId,
    chapterRuntimeId: "runtime-n1",
  });
  assert(allDefaultSource);
  assert.deepEqual(
    allDefaultSource.settlementMaterial.actions.map((action) => action.source),
    ["DEFAULT", "DEFAULT"],
  );
  assert.deepEqual(
    allDefaultSource.settlementMaterial.seats.find((seat) => seat.seatId === ACTOR),
    {
      seatId: ACTOR,
      requirement: "REQUIRED",
      completion: "DEFAULTED",
      defaultCodes: ["AI_TIMEOUT_HOLD_V1", "DEADLINE_HOLD_V1"],
    },
  );
});

test("durable source fails closed when persisted seat summaries diverge from W4 participation", async () => {
  const fixture = await sourceFixture({
    actionSources: ["HUMAN", { defaultCode: "AI_TIMEOUT_HOLD_V1" }],
  });
  const row = fixture.fake.storyEvents.find(
    (event) => event.type === "PRESSURE_CHAPTER_ORCHESTRATOR_STATE",
  );
  assert(row);
  const stored = structuredClone(row.payloadJson) as ReturnType<typeof withOrchestratorHashV1>;
  const actor = stored.chapterSeatSummaries.find((summary) => summary.seatId === ACTOR);
  assert(actor);
  actor.defaultCodes = ["DIFFERENT_POLICY_V1"];
  const { orchestratorHash: _ignored, ...body } = stored;
  row.payloadJson = withOrchestratorHashV1(body);

  const repository = new PrismaDurableChapterSettlementSourceRepository(fixture.fake.client);
  await assert.rejects(
    repository.prepareSource(fixture.preparation),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_AUTHORITY_FENCE_MISMATCH",
  );
  assert.equal(fixture.fake.sourceEventCount(), 0);
  assert.equal(fixture.fake.runtime.closeInputHash, null);
});

class MemoryLedger implements WorkingLedgerPort {
  readonly events: WorkingLedgerEventV1[] = [];
  async read(): Promise<WorkingLedgerEventV1[]> {
    return structuredClone(this.events);
  }
  async append(input: Parameters<WorkingLedgerPort["append"]>[0]) {
    const head = this.events.at(-1)?.eventHash ?? null;
    if (head !== input.expectedHeadHash) {
      return { status: "HEAD_MISMATCH" as const, events: structuredClone(this.events) };
    }
    this.events.push(...structuredClone(input.events));
    return { status: "APPENDED" as const, events: structuredClone(input.events) };
  }
}

class StaticAccess implements PressureInteractionAccessPort {
  constructor(private readonly value: PressureInteractionAccessV1) {}
  async load(): Promise<PressureInteractionAccessV1> {
    return structuredClone(this.value);
  }
}

class SourceFake {
  readonly storyEvents: Array<Record<string, any>>;
  sourceWriteTransactions = 0;
  worldWriteCalls = 0;

  constructor(
    readonly runtime: Record<string, any>,
    private readonly route: RunRouteSnapshotV1,
    private readonly world: ReturnType<typeof worldFixture>,
    initialEvents: Array<Record<string, any>>,
  ) {
    this.storyEvents = structuredClone(initialEvents);
  }

  readonly client: ChapterSettlementSourcePrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      const eventsBefore = structuredClone(this.storyEvents);
      const runtimeBefore = structuredClone(this.runtime);
      try {
        const result = await operation(this.tx());
        if (this.storyEvents.length > eventsBefore.length) this.sourceWriteTransactions += 1;
        return result;
      } catch (error) {
        this.storyEvents.splice(0, this.storyEvents.length, ...eventsBefore);
        Object.assign(this.runtime, runtimeBefore);
        throw error;
      }
    },
  };

  sourceEventCount(): number {
    return this.storyEvents.filter((event) => event.type === "PRESSURE_CHAPTER_SETTLEMENT_SOURCE").length;
  }

  private tx(): any {
    return {
      storyEvent: {
        findMany: async ({ where }: any) => this.storyEvents
          .filter((row) => row.runId === where.runId && row.type === where.type)
          .map((row) => structuredClone(row)),
        findUnique: async ({ where }: any) => structuredClone(
          this.storyEvents.find((row) => row.dedupeKey === where.dedupeKey) ?? null,
        ),
        create: async ({ data }: any) => {
          if (this.storyEvents.some((row) => row.dedupeKey === data.dedupeKey)) {
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
          const row = structuredClone(data);
          this.storyEvents.push(row);
          return structuredClone(row);
        },
      },
      pressureChapterRuntime: {
        findUnique: async ({ where }: any) => (
          where.id === this.runtime.id ? structuredClone(this.runtime) : null
        ),
        updateMany: async ({ where, data }: any) => {
          if (
            where.id !== this.runtime.id
            || where.runId !== this.runtime.runId
            || where.state !== this.runtime.state
            || where.workingRevision !== this.runtime.workingRevision
            || where.workingStateHash !== this.runtime.workingStateHash
            || where.closeInputHash !== this.runtime.closeInputHash
            || where.lockVersion !== this.runtime.lockVersion
          ) return { count: 0 };
          this.runtime.closeInputHash = data.closeInputHash;
          this.runtime.lockVersion += data.lockVersion.increment;
          return { count: 1 };
        },
      },
      pressureRunRouteSnapshot: {
        findUnique: async () => ({ runId: this.route.runId, routeHash: this.route.routeHash }),
      },
      storyRun: {
        findUnique: async () => ({
          id: this.route.runId,
          worldSequence: this.world.worldSequence,
          stateJson: structuredClone(this.world),
        }),
      },
      pressureGenesisCommit: {
        findUnique: async () => ({
          runId: this.route.runId,
          commitManifestJson: genesisManifest(this.route, this.world),
        }),
      },
      pressureChapterSettlement: { findUnique: async () => null },
    };
  }
}

type FixtureActionSource = "HUMAN" | Readonly<{ defaultCode: string }>;

async function sourceFixture(
  options: Readonly<{ actionSources?: readonly FixtureActionSource[] }> = {},
) {
  const route = routeFixture();
  const chapter = chapterFixture();
  const initial = createChapterWorkingState({ runId: route.runId, chapterId: "N1" });
  const ledger = new MemoryLedger();
  await new WorkingLedgerService(ledger).open({
    routeSnapshot: route,
    chapterRuntimeId: "runtime-n1",
    chapterDefinition: chapter,
    initialState: initial,
  });
  const actionSources = options.actionSources ?? ["HUMAN"];
  const actions: DecisionActionV1[] = [];
  for (const [index, source] of actionSources.entries()) {
    const before = projectWorkingLedger(await ledger.read());
    const action = actionFixture(route, before.state.revision, index + 1, source);
    const intent = intentFixture(index + 1, source);
    const formalInput = { routeSnapshot: route, action, intent };
    const inputFingerprint = computeFormalInteractionInputFingerprint(formalInput);
    await new FormalPressureInteractionService(
      new StaticAccess({
        routeHash: route.routeHash,
        runId: route.runId,
        chapterRuntimeId: "runtime-n1",
        chapterId: "N1",
        workingRevision: before.state.revision,
        workingStateHash: before.stateHash,
        activeDecisionPointId: action.decisionPointId,
        controlledSeatIds: [ACTOR],
        controlEpochBySeat: { [ACTOR]: 4 },
        allowedActionTypes: ["DECIDE"],
        interactableSeatIds: [TARGET],
        visibleEvidenceRefs: ["evidence-ledger"],
        resourceAvailability: [{ resourceId: "grain", availableAmount: 10 }],
      }),
      ledger,
    ).submit({ ...formalInput, subjectId: "user-a", inputFingerprint });
    await new WorkingBeatApplicationService(ledger).apply({
      routeSnapshot: route,
      chapterRuntimeId: "runtime-n1",
      chapterDefinition: chapter,
      actionId: action.actionId,
      actionInputFingerprint: inputFingerprint,
      resolverVersion: "pressure-beat-resolver-v1",
    });
    actions.push(action);
  }
  const projection = projectWorkingLedger(await ledger.read());
  const world = worldFixture();
  const reservations = [...projection.pendingReservations.values()]
    .map((reservation) => ({ ...reservation }))
    .sort((left, right) => left.reservationKey.localeCompare(right.reservationKey));
  const inputBody = {
    schemaVersion: "sangtian_chapter_settlement_input_v1" as const,
    runId: route.runId,
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1" as const,
    baseWorldSequence: 0,
    baseWorldStateHash: world.stateHash,
    runRouteHash: route.routeHash,
    previousFrozenHash: genesisManifest(route, world).record.snapshot.genesisHash,
    decisionLedgerHash: projection.headHash,
    finalWorkingStateHash: projection.stateHash,
    sealedDecisionActionIds: [...projection.acceptedActions.keys()].sort(),
    reservationLedgerHash: sha256Canonical(reservations),
    contentPolicyVersion: "sangtian-policy-v1",
    contentPolicyHash: digest("policy"),
    settlementContractVersion: "pressure-settlement-v1",
    settlementContractHash: digest("settlement-contract"),
  };
  const settlementInput = { ...inputBody, inputHash: sha256Canonical(inputBody) };
  const defaultCodes = actionSources.flatMap((source) => (
    source === "HUMAN" ? [] : [source.defaultCode]
  )).sort();
  const hasNonDefault = actionSources.some((source) => source === "HUMAN");
  const actorCompletion = defaultCodes.length === 0
    ? "SEALED_ACTIONS" as const
    : hasNonDefault
      ? "MIXED_ACTIONS" as const
      : "DEFAULTED" as const;
  const seatParticipation = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => (
    seatId === ACTOR
      ? {
          seatId,
          requirement: "REQUIRED" as const,
          completion: actorCompletion,
          defaultCodes,
        }
      : {
          seatId,
          requirement: "NOT_REQUIRED" as const,
          completion: "NOT_REQUIRED" as const,
          defaultCodes: [],
        }
  ));
  const chapterDescriptorHash = digest("descriptor");
  const preparationBody = {
    schemaVersion: "pressure_chapter_settlement_preparation_v1" as const,
    routeHash: route.routeHash,
    settlementInput,
    chapterDescriptorHash,
    seatParticipation,
  };
  const preparation: DurableChapterSettlementSourcePreparationV1 = {
    ...preparationBody,
    preparationFingerprint:
      computeDurableChapterSettlementPreparationFingerprintV1(preparationBody),
  };
  const orchestrator = withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: 0,
    phase: "SETTLING",
    currentChapterId: "N1",
    chapterRuntimeId: "runtime-n1",
    descriptorHash: chapterDescriptorHash,
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: world.stateHash,
      previousFrozenHash: genesisManifest(route, world).record.snapshot.genesisHash,
    },
    activeDecision: null,
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => (
      seatId === ACTOR
        ? {
            seatId,
            requirement: "REQUIRED" as const,
            sealedActionIds: actions.map((candidate) => candidate.actionId).sort(),
            defaultActionIds: actions
              .filter((candidate) => candidate.idempotencyKey.startsWith("pressure-default-v1:"))
              .map((candidate) => candidate.actionId)
              .sort(),
            defaultCodes,
          }
        : {
            seatId,
            requirement: "NOT_REQUIRED" as const,
            sealedActionIds: [],
            defaultActionIds: [],
            defaultCodes: [],
          }
    )),
    settlementInputHash: settlementInput.inputHash,
    frozenBundleHash: null,
  });
  const storyEvents = [
    ...ledger.events.map((event) => ({
      id: `ledger-${event.sequence}`,
      runId: event.runId,
      type: "PRESSURE_WORKING_LEDGER_EVENT",
      payloadJson: event,
      dedupeKey: `ledger-${event.eventHash}`,
    })),
    {
      id: "orchestrator-0",
      runId: route.runId,
      type: "PRESSURE_CHAPTER_ORCHESTRATOR_STATE",
      payloadJson: orchestrator,
      dedupeKey: `pressure-orchestrator:${route.runId}:0`,
    },
  ];
  const runtime = {
    id: "runtime-n1",
    runId: route.runId,
    chapterId: "N1",
    chapterSequence: 1,
    state: "CHAPTER_SETTLING",
    baseWorldSequence: 0,
    baseWorldStateHash: world.stateHash,
    previousFrozenHash: genesisManifest(route, world).record.snapshot.genesisHash,
    routeHash: route.routeHash,
    workingRevision: projection.state.revision,
    workingStateHash: projection.stateHash,
    closeInputHash: null,
    lockVersion: 7,
  };
  return {
    route,
    action: actions[0]!,
    actions,
    preparation,
    fake: new SourceFake(runtime, route, world, storyEvents),
  };
}

function routeFixture(): RunRouteSnapshotV1 {
  const topology = controlTopology("MULTIPLAYER", [ACTOR, TARGET]);
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: "run-source",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: "sangtian-content-v1",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "sangtian-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-tests-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "seed-source",
    narrativeProfileVersion: "openovel-pressure-v1",
    featureSetVersion: "pressure-feature-v1",
    resultContractRegistryVersion: "pressure-result-registry-v1",
    participantMode: "MULTIPLAYER",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [ACTOR, TARGET],
    controlTopologyVersion: "pressure-control-v1",
    initialRoleControlSnapshotHash: topology.topologyHash,
  });
}

function controlTopology(
  participantMode: "SOLO" | "MULTIPLAYER",
  humanSeats: readonly string[],
) {
  const base = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure-control-v1",
    participantMode,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humanSeats.includes(seatId) ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  return { ...base, topologyHash: sha256Canonical(base) };
}

function genesisManifest(route: RunRouteSnapshotV1, world: any) {
  const topology = controlTopology(route.participantMode, route.humanSeatIdsAtStart);
  const base = {
    schemaVersion: "pressure_stored_run_route_v1" as const,
    runId: route.runId,
    routeKey: "sangtian",
    registryVersion: "test-registry-v1",
    registryHash: digest("registry"),
    handlerKey: "pressure_chapter_v1" as const,
    resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    createRequestFingerprint: digest("create-request"),
    snapshot: route,
    controlTopology: topology,
  };
  const stored = { ...base, recordHash: sha256Canonical(base) };
  const record = buildGenesisAtomicRecord(stored, world, {
    runId: route.runId,
    idempotencyKey: `genesis:${route.runId}`,
    requestFingerprint: digest("genesis-request"),
  });
  return { record, receipt: buildGenesisCommitReceipt(record) };
}

function chapterFixture(): PressureChapterDefinition {
  return {
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N1",
    sequence: 1,
    requirementDependencies: [],
    decisionPoints: [1, 2].map((ordinal) => ({
      decisionPointId: ordinal === 1 ? "dp-investigate" : `dp-investigate-${ordinal}`,
      kernelId: `kernel-investigate-${ordinal}`,
      chapterId: "N1" as const,
      sourceOrder: ordinal,
      prompt: `Investigate the ledger ${ordinal}`,
      requirementIds: [`req-clue-${ordinal}`],
      ...(ordinal === 1
        ? {}
        : { activation: { allSatisfiedRequirementIds: [`req-clue-${ordinal - 1}`] } }),
      options: [{
        optionId: `inspect-ledger-${ordinal}`,
        sourceOrder: 1,
        label: "Inspect",
        workingDelta: {
          setFacts: { [`clue.ledger.${ordinal}`]: true },
          incrementCounters: { investigation: 1 },
          satisfyRequirementIds: [`req-clue-${ordinal}`],
        },
      }],
    })),
  };
}

function actionFixture(
  route: RunRouteSnapshotV1,
  revision: number,
  ordinal = 1,
  source: FixtureActionSource = "HUMAN",
): DecisionActionV1 {
  const decisionPointId = ordinal === 1 ? "dp-investigate" : `dp-investigate-${ordinal}`;
  const payload = { optionId: `inspect-ledger-${ordinal}` };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action-source-${ordinal}`,
    runId: route.runId,
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1" as const,
    decisionPointId,
    seatId: ACTOR,
    actionOrdinal: ordinal,
    actionRevision: 1,
    controlEpoch: 4,
    expectedWorkingRevision: revision,
    status: "SEALED" as const,
    actionType: "DECIDE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: source === "HUMAN"
      ? `action-source-idempotency-${ordinal}`
      : [
          "pressure-default-v1",
          route.runId,
          "runtime-n1",
          decisionPointId,
          ACTOR,
          "AI_FAILURE",
          digest(`default-policy-${ordinal}`),
        ].join(":"),
  };
  const withRequest = { ...body, requestFingerprint: computeDecisionActionRequestFingerprint(body) };
  return { ...withRequest, sealedHash: sha256Canonical(withRequest) };
}

function intentFixture(
  ordinal = 1,
  source: FixtureActionSource = "HUMAN",
): WorkingActionIntentV1 {
  return {
    visibility: "PARTICIPANTS",
    targetSeatIds: [TARGET],
    evidenceRefs: ["evidence-ledger"],
    resourceReservations: source === "HUMAN"
      ? [{
          reservationKey: `reserve-grain-${ordinal}`,
          resourceId: "grain",
          amount: 2,
        }]
      : [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
}

function worldFixture() {
  const trackBody = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(TRACK_IDS_V1.map((trackId) => [trackId, 0])),
  };
  const tracks = { ...trackBody, stateHash: sha256Canonical(trackBody) };
  const knowledgeBySeat = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const body = { seatId, knownFactRefs: [], secretRefs: [], disclosedToSeatIds: [] as SeatIdV1[] };
    return [seatId, { ...body, stateHash: sha256Canonical(body) }];
  }));
  const seatArcs = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const body = {
      seatId,
      arcStage: "P0_FROZEN",
      publicGoalProgress: 0,
      privateGoalProgress: 0,
      gainRefs: [] as string[],
      lossRefs: [] as string[],
      costRefs: [] as string[],
    };
    return [seatId, { ...body, stateHash: sha256Canonical(body) }];
  }));
  const body = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: 0,
    factValues: { "frozen.P0.LOCKED": true },
    resources: { grain: 10 },
    tracks,
    objects: [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  return { ...body, stateHash: sha256Canonical(body) };
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
