import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  withRunRouteHash,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import { SangtianAuthoredChapterContentAdapterV1 } from "../integration/content.adapters";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
} from "../seat-control/types";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import type { AcceptedFormalActionV1 } from "../working-ledger/contracts";
import { workingStateHash } from "../working-ledger/working-ledger";
import type {
  PersistPressureSeatDecisionProofCommandV1,
  PressureSeatDecisionProofWriterPortV1,
} from "./contracts";
import { PressureDeadlineDefaultProductionServiceV1 } from "./service";
import {
  PrismaPressureSeatDecisionProofWriterV1,
  type PressureSeatDecisionProofWriterPrismaV1,
} from "./prisma-proof-writer";
import { emptySeatEnvelope } from "../seat-control-persistence/envelope";

const NOW = 1_900_000_000_000;
const HUMAN: SeatIdV1 = "cabinet_finance";
const AI_SEAT: SeatIdV1 = "qingliu_law";

test("expired decision persists proofs, takes over humans, resolves every directive, then advances W4", async () => {
  const harness = await Harness.create([HUMAN]);

  const result = await harness.service.advanceExpiredDecision({
    routeSnapshot: harness.route,
    expected: expected(harness.state),
    nowMs: NOW,
  });

  assert.equal(result.kind, "APPLIED");
  assert.equal(harness.advanceCalls, 1);
  assert.equal(harness.aiFailureCalls, 0);
  assert.deepEqual(
    harness.events.map((event) => event.split(":").slice(0, 2).join(":")),
    [
      "proof:DEADLINE_TAKEOVER",
      "takeover:cabinet_finance",
      ...PRESSURE_CHAPTER_SEAT_IDS_V1.flatMap((seatId) => [
        "proof:DEFAULT_SOURCE",
        `directive:${seatId}`,
      ]),
      "runtime:advance",
    ],
  );
  assert.ok(harness.snapshot.seatControls.every((seat) => seat.mode === "AI_ACTIVE"));
  assert.equal(harness.proofs.commands.length, 7);
  assert.equal(
    harness.proofs.commands.filter((command) => command.proofKind === "DEFAULT_SOURCE").length,
    6,
  );
  assert.ok(
    harness.proofs.commands.every((command) =>
      command.proof.proofHash === sha256Canonical(
        Object.fromEntries(
          Object.entries(command.proof).filter(([key]) => key !== "proofHash"),
        ),
      ),
    ),
  );
});

test("AI failure persists one frozen default proof and directive before runtime.applyAiFailure", async () => {
  const harness = await Harness.create([HUMAN]);

  const result = await harness.service.applyAiFailure({
    routeSnapshot: harness.route,
    expected: expected(harness.state),
    seatId: AI_SEAT,
    failureCode: "PRESSURE_DECISION_AUTOMATION_POLICY_INVALID",
    nowMs: NOW - 1,
  });

  assert.equal(result.kind, "APPLIED");
  assert.equal(harness.advanceCalls, 0);
  assert.equal(harness.aiFailureCalls, 1);
  assert.deepEqual(harness.events, [
    `proof:DEFAULT_SOURCE:${AI_SEAT}`,
    `directive:${AI_SEAT}`,
    `runtime:ai-failure:${AI_SEAT}`,
  ]);
  const command = harness.proofs.commands[0]!;
  assert.equal(command.proofKind, "DEFAULT_SOURCE");
  assert.equal("trigger" in command.proof && command.proof.trigger, "AI_FAILURE");
});

test("stale retries perform no proof, seat-control, or runtime writes", async () => {
  const harness = await Harness.create([HUMAN]);
  const result = await harness.service.advanceExpiredDecision({
    routeSnapshot: harness.route,
    expected: {
      ...expected(harness.state),
      expectedOrchestratorRevision: harness.state.revision + 1,
    },
    nowMs: NOW,
  });

  assert.equal(result.kind, "STALE");
  assert.deepEqual(harness.events, []);
  assert.equal(harness.proofs.commands.length, 0);
});

test("deadline preserves W5-accepted human action and resumes W4 before defaulting it", async () => {
  const harness = await Harness.create([HUMAN]);
  harness.acceptAction(HUMAN);

  const result = await harness.service.advanceExpiredDecision({
    routeSnapshot: harness.route,
    expected: expected(harness.state),
    nowMs: NOW,
  });

  assert.equal(result.kind, "APPLIED");
  assert.equal(harness.resumeCalls, 1);
  assert.equal(harness.advanceCalls, 0);
  assert.ok(!harness.events.includes(`takeover:${HUMAN}`));
  assert.ok(!harness.events.includes(`directive:${HUMAN}`));
  assert.equal(
    harness.proofs.commands.filter((command) => command.proof.seatId === HUMAN).length,
    0,
  );
  assert.equal(harness.events.at(-1), "runtime:resume");
});

test("Prisma proof writer commits once, replays exact proof, and rejects binding reuse", async () => {
  const harness = await Harness.create([HUMAN]);
  await harness.service.applyAiFailure({
    routeSnapshot: harness.route,
    expected: expected(harness.state),
    seatId: AI_SEAT,
    failureCode: "TEST_AI_FAILURE",
    nowMs: NOW - 1,
  });
  const command = harness.proofs.commands[0]!;
  const prisma = new InMemoryProofPrisma(harness.snapshot);
  const writer = new PrismaPressureSeatDecisionProofWriterV1(prisma);

  assert.equal((await writer.persistOnce(command)).status, "COMMITTED");
  assert.equal((await writer.persistOnce(command)).status, "REPLAYED");
  assert.equal(prisma.createCalls, 1);
  await assert.rejects(
    () => writer.persistOnce({
      ...command,
      authorityStateHash: digest("different-authority"),
    }),
    (error: unknown) => readCode(error) === "PRESSURE_DEADLINE_DEFAULT_PROOF_PERSISTENCE_INVALID",
  );
});

class Harness {
  readonly events: string[] = [];
  readonly proofs = new InMemoryProofWriter(this.events);
  readonly service: PressureDeadlineDefaultProductionServiceV1;
  advanceCalls = 0;
  resumeCalls = 0;
  aiFailureCalls = 0;

  private constructor(
    readonly route: RunRouteSnapshotV1,
    readonly descriptor: AuthoredChapterRuntimeV1,
    public state: ChapterOrchestratorStateV1,
    readonly projection: WorkingLedgerProjectionV1,
    public snapshot: SeatControlSnapshotV1,
  ) {
    this.service = new PressureDeadlineDefaultProductionServiceV1({
      orchestrators: { read: async () => structuredClone(this.state) },
      working: { load: async () => structuredClone(this.projection) },
      content: { load: async () => structuredClone(this.descriptor) },
      seats: { readSnapshot: async () => structuredClone(this.snapshot) },
      proofs: this.proofs,
      seatControl: {
        takeoverAtFrozenDeadline: async (command) => {
          assert.ok(this.proofs.has(command.proof.proofHash));
          this.events.push(`takeover:${command.seatId}`);
          this.mutateSeat(command.seatId);
          return {} as never;
        },
        resolveDeterministicDefault: async (command) => {
          assert.ok(this.proofs.has(command.sourceProof.proofHash));
          assert.equal(command.expectedStateHash, this.snapshot.stateHash);
          this.events.push(`directive:${command.seatId}`);
          return {} as never;
        },
      },
      runtime: {
        resume: async () => {
          this.events.push("runtime:resume");
          this.resumeCalls += 1;
          this.bumpState();
          return structuredClone(this.state);
        },
        advanceDeadline: async () => {
          this.events.push("runtime:advance");
          this.advanceCalls += 1;
          this.bumpState();
          return structuredClone(this.state);
        },
        applyAiFailure: async (_route, seatId) => {
          this.events.push(`runtime:ai-failure:${seatId}`);
          this.aiFailureCalls += 1;
          this.bumpState();
          return structuredClone(this.state);
        },
      },
    });
  }

  static async create(humans: SeatIdV1[]): Promise<Harness> {
    const route = makeRoute(humans);
    const content = new SangtianAuthoredChapterContentAdapterV1();
    const descriptor = await content.load({ routeSnapshot: route, chapterId: "N1" });
    const state = makeState(route, descriptor);
    return new Harness(
      route,
      descriptor,
      state,
      makeProjection(route, state, descriptor),
      makeSeatSnapshot(route, humans),
    );
  }

  private mutateSeat(seatId: SeatIdV1): void {
    const seatControls = structuredClone(this.snapshot.seatControls);
    const seat = seatControls.find((candidate) => candidate.seatId === seatId)!;
    seat.mode = "AI_ACTIVE";
    seat.activeControllerId = seat.designatedAiControllerId;
    seat.controlEpoch += 1;
    seat.submissionFenceToken = digest(`submission:${seatId}:${seat.controlEpoch}`);
    seat.reclaimFenceToken = digest(`reclaim:${seatId}:${seat.controlEpoch}`);
    seat.lastAuthorityEventHash = digest(`event:${seatId}:${seat.controlEpoch}`);
    const body = {
      ...this.snapshot,
      stateRevision: this.snapshot.stateRevision + 1,
      timelineLength: this.snapshot.timelineLength + 1,
      timelineHeadHash: seat.lastAuthorityEventHash,
      seatControls,
    };
    delete (body as Partial<SeatControlSnapshotV1>).stateHash;
    this.snapshot = {
      ...(body as Omit<SeatControlSnapshotV1, "stateHash">),
      stateHash: sha256Canonical(body),
    };
  }

  acceptAction(seatId: SeatIdV1): void {
    const action = {
      schemaVersion: "sangtian_decision_action_v1" as const,
      actionId: `accepted-${seatId}`,
      runId: this.route.runId,
      chapterRuntimeId: this.state.chapterRuntimeId,
      chapterId: this.state.currentChapterId,
      decisionPointId: this.state.activeDecision!.decisionPointId,
      seatId,
      actionOrdinal: 1,
      actionRevision: 1,
      controlEpoch: 1,
      expectedWorkingRevision: this.projection.state.revision,
      status: "SEALED" as const,
      actionType: "TEST_ACCEPTED",
      payload: {},
      payloadHash: digest({}),
      idempotencyKey: `accepted:${seatId}`,
      requestFingerprint: digest(`request:${seatId}`),
      sealedHash: digest(`sealed:${seatId}`),
    };
    const accepted: AcceptedFormalActionV1 = {
      action,
      routeHash: this.route.routeHash,
      inputFingerprint: digest(`input:${seatId}`),
      intent: {
        visibility: "PRIVATE",
        targetSeatIds: [],
        evidenceRefs: [],
        resourceReservations: [],
        commitmentMutations: [],
        knowledgeGrants: [],
        seatArcProgress: [],
      },
      audienceSeatIds: [seatId],
      eventHash: digest(`event:${seatId}`),
    };
    this.projection.acceptedActions.set(action.actionId, accepted);
    this.projection.actionsByIdempotencyKey.set(action.idempotencyKey, accepted);
  }

  private bumpState(): void {
    const body = {
      ...this.state,
      revision: this.state.revision + 1,
    };
    delete (body as Partial<ChapterOrchestratorStateV1>).orchestratorHash;
    this.state = withOrchestratorHashV1(
      body as Omit<ChapterOrchestratorStateV1, "orchestratorHash">,
    );
  }
}

class InMemoryProofWriter implements PressureSeatDecisionProofWriterPortV1 {
  readonly commands: PersistPressureSeatDecisionProofCommandV1[] = [];
  private readonly hashes = new Set<string>();

  constructor(private readonly events: string[]) {}

  async persistOnce(command: Readonly<PersistPressureSeatDecisionProofCommandV1>) {
    const replay = this.hashes.has(command.proof.proofHash);
    if (!replay) {
      this.hashes.add(command.proof.proofHash);
      this.commands.push(structuredClone(command));
    }
    this.events.push(`proof:${command.proofKind}:${command.proof.seatId}`);
    return { status: replay ? "REPLAYED" as const : "COMMITTED" as const };
  }

  has(hash: string): boolean {
    return this.hashes.has(hash);
  }
}

class InMemoryProofPrisma implements PressureSeatDecisionProofWriterPrismaV1 {
  private row: any;
  createCalls = 0;

  constructor(snapshot: SeatControlSnapshotV1) {
    this.row = {
      runId: snapshot.runId,
      stateRevision: snapshot.stateRevision,
      stateHash: snapshot.stateHash,
      snapshotJson: emptySeatEnvelope(snapshot),
      version: 1,
    };
  }

  readonly pressureSeatControlSnapshot = {
    findUnique: async () => structuredClone(this.row),
    create: async () => { throw new Error("not used"); },
    updateMany: async ({ where, data }: any) => {
      if (where.version !== this.row.version) return { count: 0 };
      this.createCalls += 1;
      this.row = {
        ...this.row,
        snapshotJson: structuredClone(data.snapshotJson),
        version: this.row.version + 1,
      };
      return { count: 1 };
    },
  };

  async $transaction<T>(operation: (tx: any) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

function expected(state: ChapterOrchestratorStateV1) {
  return {
    chapterRuntimeId: state.chapterRuntimeId,
    decisionPointId: state.activeDecision!.decisionPointId,
    expectedOrchestratorRevision: state.revision,
  };
}

function makeRoute(humans: SeatIdV1[]): RunRouteSnapshotV1 {
  const loaded = loadSangtianPressureChapterPackageV1();
  const topology = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure_control_topology_v1",
    participantMode: humans.length === 1 ? "SOLO" as const : "MULTIPLAYER" as const,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humans.includes(seatId) ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: `run-deadline-production-${humans.length}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure_orchestration_v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure_runtime_contract_v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure_test_matrix_v1",
    testMatrixSha256: digest("matrix"),
    runSeed: "deadline-production-seed",
    narrativeProfileVersion: "pressure_narrative_v1",
    featureSetVersion: "pressure_feature_set_v1",
    resultContractRegistryVersion: "pressure_result_registry_v1",
    participantMode: topology.participantMode,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [...humans],
    controlTopologyVersion: topology.controlTopologyVersion,
    initialRoleControlSnapshotHash: sha256Canonical(topology),
  });
}

function makeState(
  route: RunRouteSnapshotV1,
  descriptor: AuthoredChapterRuntimeV1,
): ChapterOrchestratorStateV1 {
  const decision = descriptor.decisions.find(
    (candidate) => candidate.decisionPointId === "N1.weir_crisis",
  )!;
  return withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: 0,
    phase: "ACTIVE",
    currentChapterId: "N1",
    chapterRuntimeId: `chapter-${route.runId}`,
    descriptorHash: descriptor.descriptorHash,
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: digest("world"),
      previousFrozenHash: digest("frozen"),
    },
    activeDecision: {
      decisionPointId: decision.decisionPointId,
      policyHash: sha256Canonical(decision),
      openedAtMs: NOW - 300_001,
      deadlineAtMs: NOW,
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        seatId,
        requirement: decision.seatRequirements[seatId],
        completion: decision.seatRequirements[seatId] === "REQUIRED"
          ? "PENDING" as const
          : "NOT_REQUIRED" as const,
        actionIds: [],
        actionCount: 0,
        defaultCode: null,
      })),
    },
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: decision.seatRequirements[seatId],
      sealedActionIds: [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: null,
    frozenBundleHash: null,
  });
}

function makeProjection(
  route: RunRouteSnapshotV1,
  state: ChapterOrchestratorStateV1,
  descriptor: AuthoredChapterRuntimeV1,
): WorkingLedgerProjectionV1 {
  const working = createChapterWorkingState({ runId: route.runId, chapterId: "N1" });
  const stateHash = workingStateHash(working);
  const point = descriptor.definition.decisionPoints.find(
    (candidate) => candidate.decisionPointId === state.activeDecision!.decisionPointId,
  )!;
  return {
    key: { runId: route.runId, chapterRuntimeId: state.chapterRuntimeId },
    chapterId: "N1",
    routeHash: route.routeHash,
    chapterDefinitionHash: descriptor.descriptorHash,
    headHash: digest("head"),
    headSequence: 0,
    state: working,
    stateHash,
    nextDecisionPin: {
      schemaVersion: "pressure_decision_pin_v1",
      chapterId: "N1",
      stateRevision: working.revision,
      stateFingerprint: stateHash,
      decisionPointId: point.decisionPointId,
      kernelId: point.kernelId,
      optionIds: point.options.map((option) => option.optionId),
    },
    acceptedActions: new Map(),
    actionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
}

function makeSeatSnapshot(
  route: RunRouteSnapshotV1,
  humans: SeatIdV1[],
): SeatControlSnapshotV1 {
  const policyBase = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "pressure_seat_control_v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline.takeover.v1",
    takeoverDeadlinePolicyHash: digest("deadline-policy"),
    deterministicDefaultPolicyRef: "default.v1",
    deterministicDefaultPolicyHash: digest("default-policy"),
    humanReclaimAllowed: true,
  };
  const frozenPolicy = { ...policyBase, policyHash: sha256Canonical(policyBase) };
  const seatControls: SeatAuthorityRecordV1[] = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const human = humans.includes(seatId);
    const ai = `pressure-ai:${seatId}`;
    return {
      seatId,
      mode: human ? "HUMAN_ACTIVE" : "AI_ACTIVE",
      originalHumanControllerId: human ? `human:${seatId}` : null,
      designatedAiControllerId: ai,
      activeControllerId: human ? `human:${seatId}` : ai,
      controlEpoch: 1,
      submissionFenceToken: digest(`submission:${seatId}:1`),
      reclaimFenceToken: human ? digest(`reclaim:${seatId}:1`) : null,
      lastAuthorityEventHash: digest(`event:${seatId}:1`),
    };
  });
  const body = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId: route.runId,
    participantMode: route.participantMode,
    routeHash: route.routeHash,
    genesisHash: digest("genesis"),
    genesisAtomicRecordHash: digest("genesis-atomic"),
    initialTopologyHash: route.initialRoleControlSnapshotHash,
    controlTopologyVersion: route.controlTopologyVersion,
    frozenPolicy,
    stateRevision: 1,
    timelineLength: 6,
    timelineHeadHash: digest("timeline"),
    seatControls,
    initializationInputHash: digest("initialization"),
  };
  return { ...body, stateHash: sha256Canonical(body) };
}

function digest(value: unknown): string {
  return sha256Canonical(value);
}

function readCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return String((error as { code?: unknown }).code ?? "");
}
