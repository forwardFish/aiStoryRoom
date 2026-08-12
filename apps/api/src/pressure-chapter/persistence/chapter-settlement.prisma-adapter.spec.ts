import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  type B0ChapterPolicyEvaluationDraftV1,
  type B0ChapterSeatArcDeltaV1,
  type DecisionActionV1,
  type KnowledgeStateV1,
  type SeatArcStateV1,
  type SeatIdV1,
  type TrackIdV1,
  type TrackStateV1,
  type WorldStateV1,
} from "@ai-story/shared";
import { createChapterWorkingState } from "@ai-story/templates";
import {
  sealAEmotionAuthorityOutboxJobV1,
} from "../a-emotion-production/compiler";
import type {
  SangtianAEmotionContentSourceCompilerV1,
} from "../a-emotion-production/content-source";
import {
  computeChapterSettlementRequestFingerprintV1,
  sealChapterCloseFenceV1,
  sealChapterSettlementSourceV1,
} from "../chapter-settlement/chapter-commit-record";
import { ChapterSettlementOrchestrator } from "../chapter-settlement/chapter-settlement.orchestrator";
import type {
  AtomicChapterCommitRecordV1,
  AtomicChapterCommitterPort,
  ChapterSettlementKeyV1,
  ChapterSettlementSourcePort,
  ChapterSettlementSourceV1,
  ContentOwnedChapterPolicyPort,
} from "../chapter-settlement/types";
import type { WorkingActionIntentV1 } from "../working-ledger/contracts";
import type {
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
} from "../narrative-authority/contracts";
import { computeWorkingActionInputFingerprintV1 } from "../working-ledger/fingerprint";
import {
  buildWorkingLedgerEvents,
  projectWorkingLedger,
  workingStateHash,
} from "../working-ledger/working-ledger";
import {
  PrismaAtomicChapterCommitter,
  type ChapterSettlementPrismaClient,
} from "./chapter-settlement.prisma-adapter";

const ACTOR: SeatIdV1 = "cabinet_finance";
const TARGET: SeatIdV1 = "jiangnan_merchant";
const digest = (label: string): string => sha256Canonical({ label });

test("B0 authority commit persists all artifacts and is the only worldSequence advance", async () => {
  const fixture = await atomicFixture();
  const fake = new ChapterCommitFake(fixture.record, fixture.baseWorld, fixture.ledgerEvents);
  const repository = chapterRepository(fake);

  const first = await repository.commitOnce(fixture.record);
  assert.equal(first.status, "COMMITTED");
  assert.equal(fake.run.worldSequence, 1);
  assert.equal(fake.runtime.state, "CHAPTER_FROZEN");
  assert.equal(
    fake.settlement?.frozenBundleHash,
    fixture.record.frozenChapterBundle.bundleHash,
    "settlement row exposes the authoritative frozen bundle lookup hash",
  );
  assert.equal(fake.seatArcs.length, 0, "seat arcs are embedded in commitManifestJson");
  assert.equal(fake.rootEvents.length, 1);
  assert.equal(fake.outbox.length, 9);
  assert.equal(fake.projections.length, 7);
  assert.equal(
    fake.outbox.filter((row) => row.taskType === "PROJECT_CHAPTER_NARRATIVE").length,
    7,
  );
  assert.equal(
    fake.outbox.filter((row) => row.taskType === "INTERACTION_COMPILE_REQUESTED").length,
    1,
  );
  assert(fake.calls.indexOf("settlement.create") < fake.calls.indexOf("runtime.freeze"));
  assert(fake.calls.indexOf("runtime.freeze") < fake.calls.indexOf("world.cas"));
  assert(fake.calls.indexOf("world.cas") < fake.calls.lastIndexOf("tx.commit"));

  const second = await repository.commitOnce(fixture.record);
  assert.equal(second.status, "ALREADY_COMMITTED");
  assert.equal(fake.settlementWrites, 1);
  assert.equal(fake.run.worldSequence, 1);
  assert.equal(fake.projections.length, 7, "replay must not duplicate projections");
  assert.equal(fake.outbox.length, 9, "replay must not duplicate outbox tasks");

  fake.settlement!.outboxDedupeKeysJson = [];
  await assert.rejects(
    () => repository.readCommitted(fixture.record),
    /Stored chapter settlement manifest is invalid/i,
  );
});

test("B0 commit fails closed when the worldSequence fence moved", async () => {
  const fixture = await atomicFixture();
  const fake = new ChapterCommitFake(fixture.record, fixture.baseWorld, fixture.ledgerEvents);
  fake.run.worldSequence = 1;
  const repository = chapterRepository(fake);
  await assert.rejects(
    repository.commitOnce(fixture.record),
    (error: unknown) => (
      error instanceof Error
      && error.message.includes("world authority fence mismatch")
    ),
  );
  assert.equal(fake.settlementWrites, 0);
});

test("B0 downstream failure rolls back authority, projections, outbox and world CAS", async () => {
  const fixture = await atomicFixture();
  const fake = new ChapterCommitFake(fixture.record, fixture.baseWorld, fixture.ledgerEvents);
  fake.failTaskType = "INTERACTION_COMPILE_REQUESTED";
  const repository = chapterRepository(fake);

  await assert.rejects(() => repository.commitOnce(fixture.record), /injected outbox failure/i);
  assert.equal(fake.settlementWrites, 0);
  assert.equal(fake.bundle, null);
  assert.equal(fake.seatArcs.length, 0);
  assert.equal(fake.projections.length, 0);
  assert.equal(fake.outbox.length, 0);
  assert.equal(fake.rootEvents.length, 0);
  assert.equal(fake.run.worldSequence, 0);
  assert.equal(fake.runtime.state, "CHAPTER_SETTLING");
});

class ChapterCommitFake {
  readonly calls: string[] = [];
  readonly seatArcs: Array<Record<string, any>> = [];
  readonly rootEvents: Array<Record<string, any>> = [];
  readonly outbox: Array<Record<string, any>> = [];
  readonly projections: Array<Record<string, any>> = [];
  failTaskType: string | null = null;
  settlement: Record<string, any> | null = null;
  bundle: Record<string, any> | null = null;
  settlementWrites = 0;
  readonly runtime: Record<string, any>;
  readonly run: Record<string, any>;

  constructor(
    record: AtomicChapterCommitRecordV1,
    baseWorld: WorldStateV1,
    private readonly ledgerEvents: unknown[],
  ) {
    this.runtime = {
      id: record.chapterRuntimeId,
      runId: record.runId,
      chapterId: record.chapterId,
      chapterSequence: 1,
      state: "CHAPTER_SETTLING",
      routeHash: record.sealedInput.runRouteHash,
      previousFrozenHash: record.sealedInput.previousFrozenHash,
      workingRevision: record.commitFence.expectedWorkingRevision,
      workingStateHash: record.commitFence.expectedWorkingStateHash,
      lockVersion: 9,
    };
    this.run = {
      id: record.runId,
      worldSequence: 0,
      reservedWorldSequence: 0,
      stateJson: structuredClone(baseWorld),
    };
  }

  readonly tx = {
    pressureChapterSettlement: {
      findUnique: async (_input: any): Promise<any> => null,
      create: async (_input: any): Promise<any> => ({ id: "" }),
    },
    pressureFrozenChapterBundle: {
      create: async (_input: any): Promise<any> => ({ id: "" }),
    },
    pressureSeatArcSnapshot: {
      create: async (_input: any): Promise<any> => ({}),
    },
    pressureChapterRuntime: {
      findUnique: async (_input: any): Promise<any> => null,
      updateMany: async (_input: any): Promise<any> => ({ count: 0 }),
    },
    storyRun: {
      findUnique: async (_input: any): Promise<any> => null,
      updateMany: async (_input: any): Promise<any> => ({ count: 0 }),
    },
    storyEvent: {
      findMany: async (_input: any): Promise<any[]> => [],
      create: async (_input: any): Promise<any> => ({}),
    },
    pressureOutboxTask: {
      create: async (_input: any): Promise<any> => ({}),
    },
    pressureNarrativeProjection: {
      create: async (_input: any): Promise<any> => ({ id: "" }),
    },
  };

  readonly client: ChapterSettlementPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.installDelegates();
      this.calls.push("tx.begin");
      const before = this.snapshot();
      try {
        const result = await operation(this.tx);
        this.calls.push("tx.commit");
        return result;
      } catch (error) {
        this.restore(before);
        this.calls.push("tx.rollback");
        throw error;
      }
    },
  };

  private installDelegates(): void {
    this.tx.pressureChapterSettlement.findUnique = async () => this.settlement
      ? {
          id: this.settlement.id,
          runId: this.settlement.runId,
          chapterRuntimeId: this.settlement.chapterRuntimeId,
          commitManifestJson: structuredClone(this.settlement.commitManifestJson),
          outboxDedupeKeysJson: structuredClone(this.settlement.outboxDedupeKeysJson),
          commitHash: this.settlement.commitHash,
        }
      : null;
    this.tx.pressureChapterSettlement.create = async ({ data }: any) => {
      this.calls.push("settlement.create");
      this.settlementWrites += 1;
      this.settlement = structuredClone(data);
      return { id: data.id };
    };
    this.tx.pressureFrozenChapterBundle.create = async ({ data }: any) => {
      this.calls.push("bundle.create");
      this.bundle = structuredClone(data);
      return { id: data.id };
    };
    this.tx.pressureSeatArcSnapshot.create = async ({ data }: any) => {
      this.calls.push("seat-arc.create");
      this.seatArcs.push(structuredClone(data));
      return data;
    };
    this.tx.pressureChapterRuntime.findUnique = async () => structuredClone(this.runtime);
    this.tx.pressureChapterRuntime.updateMany = async ({ where, data }: any) => {
      this.calls.push("runtime.freeze");
      if (
        where.id !== this.runtime.id
        || where.state !== this.runtime.state
        || where.lockVersion !== this.runtime.lockVersion
      ) return { count: 0 };
      this.runtime.state = data.state;
      this.runtime.lockVersion += data.lockVersion.increment;
      return { count: 1 };
    };
    this.tx.storyRun.findUnique = async () => structuredClone(this.run);
    this.tx.storyRun.updateMany = async ({ where, data }: any) => {
      this.calls.push("world.cas");
      if (where.id !== this.run.id || where.worldSequence !== this.run.worldSequence) {
        return { count: 0 };
      }
      Object.assign(this.run, structuredClone(data));
      return { count: 1 };
    };
    this.tx.storyEvent.findMany = async () => this.ledgerEvents.map((payloadJson) => ({
      runId: this.run.id,
      payloadJson: structuredClone(payloadJson),
    }));
    this.tx.storyEvent.create = async ({ data }: any) => {
      this.calls.push("root-event.create");
      this.rootEvents.push(structuredClone(data));
      return data;
    };
    this.tx.pressureOutboxTask.create = async ({ data }: any) => {
      this.calls.push("outbox.create");
      if (data.taskType === this.failTaskType) throw new Error("injected outbox failure");
      this.outbox.push(structuredClone(data));
      return data;
    };
    this.tx.pressureNarrativeProjection.create = async ({ data }: any) => {
      this.calls.push("projection.create");
      const row = { id: `projection-${this.projections.length + 1}`, ...structuredClone(data) };
      this.projections.push(row);
      return { id: row.id };
    };
  }

  private snapshot(): Record<string, any> {
    return structuredClone({
      seatArcs: this.seatArcs,
      rootEvents: this.rootEvents,
      outbox: this.outbox,
      projections: this.projections,
      settlement: this.settlement,
      bundle: this.bundle,
      settlementWrites: this.settlementWrites,
      runtime: this.runtime,
      run: this.run,
    });
  }

  private restore(before: Record<string, any>): void {
    this.seatArcs.splice(0, this.seatArcs.length, ...before.seatArcs);
    this.rootEvents.splice(0, this.rootEvents.length, ...before.rootEvents);
    this.outbox.splice(0, this.outbox.length, ...before.outbox);
    this.projections.splice(0, this.projections.length, ...before.projections);
    this.settlement = before.settlement;
    this.bundle = before.bundle;
    this.settlementWrites = before.settlementWrites;
    Object.keys(this.runtime).forEach((key) => delete this.runtime[key]);
    Object.assign(this.runtime, before.runtime);
    Object.keys(this.run).forEach((key) => delete this.run[key]);
    Object.assign(this.run, before.run);
  }
}

function chapterRepository(fake: ChapterCommitFake): PrismaAtomicChapterCommitter {
  return new PrismaAtomicChapterCommitter(
    fake.client,
    narrativeCompilerStub(),
    {
      compileChapter(input: any) {
        const job = sealAEmotionAuthorityOutboxJobV1({
          schemaVersion: "a_emotion_authority_outbox_job_v1",
          sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
          runId: input.record.runId,
          sourceId: input.record.receipt.settlementId,
          sourceCommitHash: input.record.receipt.commitHash,
          signalId: `chapter:${input.record.receipt.commitHash}`,
        });
        return [{
          dedupeKey: `aemotion:${job.jobHash}`,
          job,
          source: {} as never,
        }];
      },
    } satisfies Pick<SangtianAEmotionContentSourceCompilerV1, "compileChapter">,
  );
}

function narrativeCompilerStub(): ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1 {
  return {
    compile: () => ({}),
    deriveAudienceAllowlist: (job) => ({
      audience: structuredClone(job.audience),
      allowedFactIds: [],
      allowedObjectVersionIds: [],
      allowedKnowledgeIds: [],
    }),
  };
}

async function atomicFixture(): Promise<{
  record: AtomicChapterCommitRecordV1;
  baseWorld: WorldStateV1;
  ledgerEvents: unknown[];
}> {
  const runId = "run-w6-persistence";
  const chapterRuntimeId = "runtime-n1";
  const routeHash = digest("route");
  const initial = createChapterWorkingState({ runId, chapterId: "N1" });
  const pin = {
    schemaVersion: "pressure_decision_pin_v1" as const,
    chapterId: "N1" as const,
    stateRevision: 0,
    stateFingerprint: workingStateHash(initial),
    decisionPointId: "dp-investigate",
    kernelId: "kernel-investigate",
    optionIds: ["inspect-ledger"],
  };
  const [opened] = buildWorkingLedgerEvents({
    key: { runId, chapterRuntimeId },
    chapterId: "N1",
    previousEvents: [],
    payloads: [{
      eventType: "WORKING_LEDGER_OPENED",
      routeHash,
      chapterDefinitionHash: digest("chapter-definition"),
      initialState: initial,
      initialStateHash: workingStateHash(initial),
      nextDecisionPin: pin,
    }],
  });
  const action = decisionAction(runId, chapterRuntimeId);
  const intent = actionIntent();
  const inputFingerprint = computeWorkingActionInputFingerprintV1({
    routeHash,
    action,
    intent,
  });
  const [accepted] = buildWorkingLedgerEvents({
    key: { runId, chapterRuntimeId },
    chapterId: "N1",
    previousEvents: [opened!],
    payloads: [{
      eventType: "FORMAL_ACTION_ACCEPTED",
      routeHash,
      inputFingerprint,
      action,
      intent,
      audienceSeatIds: [ACTOR, TARGET],
    }],
  });
  // If canonicalization changes, use the event projector error as a fixture
  // guard instead of weakening persistence validation.
  const ledgerEvents = [opened!, accepted!];
  const projection = projectWorkingLedger(ledgerEvents);
  const reservationLedger = [...projection.pendingReservations.values()]
    .map((value) => ({ ...value }))
    .sort((left, right) => left.reservationKey.localeCompare(right.reservationKey));
  const baseWorld = worldState(runId);
  const inputBase = {
    schemaVersion: "sangtian_chapter_settlement_input_v1" as const,
    runId,
    chapterRuntimeId,
    chapterId: "N1" as const,
    baseWorldSequence: 0,
    baseWorldStateHash: baseWorld.stateHash,
    runRouteHash: routeHash,
    previousFrozenHash: digest("previous-frozen"),
    decisionLedgerHash: projection.headHash,
    finalWorkingStateHash: projection.stateHash,
    sealedDecisionActionIds: [action.actionId],
    reservationLedgerHash: sha256Canonical(reservationLedger),
    contentPolicyVersion: "sangtian-chapter-policy-v1",
    contentPolicyHash: digest("content-policy"),
    settlementContractVersion: "pressure-settlement-contract-v1",
    settlementContractHash: digest("settlement-contract"),
  };
  const sealedInput = { ...inputBase, inputHash: sha256Canonical(inputBase) };
  const closeFence = sealChapterCloseFenceV1({
    schemaVersion: "pressure_chapter_close_fence_v1",
    runId,
    chapterRuntimeId,
    chapterId: "N1",
    lifecycleState: "CHAPTER_SETTLING",
    closedWorkingRevision: 0,
    observedWorkingRevision: 0,
    closedWorkingStateHash: projection.stateHash,
    observedWorkingStateHash: projection.stateHash,
    closedDecisionLedgerHash: projection.headHash,
    observedDecisionLedgerHash: projection.headHash,
    closedActionCount: 1,
    observedActionCount: 1,
    baseWorldSequenceAtClose: 0,
    observedWorldSequence: 0,
    baseWorldStateHashAtClose: baseWorld.stateHash,
    observedWorldStateHash: baseWorld.stateHash,
    runRouteHashAtClose: routeHash,
    previousFrozenHashAtClose: inputBase.previousFrozenHash,
    reservationLedgerHashAtClose: inputBase.reservationLedgerHash,
    contentPolicyVersionAtClose: inputBase.contentPolicyVersion,
    contentPolicyHashAtClose: inputBase.contentPolicyHash,
    settlementContractVersionAtClose: inputBase.settlementContractVersion,
    settlementContractHashAtClose: inputBase.settlementContractHash,
  });
  const source = sealChapterSettlementSourceV1({
    schemaVersion: "pressure_chapter_settlement_source_v1",
    closeFence,
    sealedInput,
    settlementMaterial: {
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => index === 0
        ? {
            seatId,
            requirement: "REQUIRED" as const,
            completion: "SEALED_ACTIONS" as const,
            defaultCodes: [],
          }
        : {
            seatId,
            requirement: "NOT_REQUIRED" as const,
            completion: "NOT_REQUIRED" as const,
            defaultCodes: [],
          }),
      resources: [{ resourceId: "grain", quantity: 10, version: 0 }],
      actions: [{
        actionId: action.actionId,
        decisionPointId: action.decisionPointId,
        seatId: action.seatId,
        source: "HUMAN" as const,
        actionType: "SUPPORT_EDICT",
        payload: { choice: "support" },
        resourceCommitments: [{
          commitmentId: "commitment-N1",
          reservationKey: "reservation-N1",
          resourceId: "grain",
          amount: 2,
          expectedResourceVersion: 0,
        }],
        evidenceRefs: ["evidence.edict"],
      }],
    },
    baseWorldState: baseWorld,
  });
  const capture = new CaptureCommitter();
  const orchestrator = new ChapterSettlementOrchestrator(
    new StaticSource(source),
    new DeterministicPolicy(),
    capture,
  );
  const idempotencyKey = "settle:run-w6-persistence:N1";
  const result = await orchestrator.settle({
    authorityTrigger: "CHAPTER_CLOSE",
    runId,
    chapterRuntimeId,
    idempotencyKey,
    requestFingerprint: computeChapterSettlementRequestFingerprintV1({
      runId,
      chapterRuntimeId,
      idempotencyKey,
      sealedInputHash: source.sealedInput.inputHash,
    }),
  });
  return { record: result.record, baseWorld, ledgerEvents };
}

class StaticSource implements ChapterSettlementSourcePort {
  constructor(private readonly source: ChapterSettlementSourceV1) {}
  async readSealedSource(): Promise<ChapterSettlementSourceV1> {
    return structuredClone(this.source);
  }
}

class CaptureCommitter implements AtomicChapterCommitterPort {
  record: AtomicChapterCommitRecordV1 | null = null;
  async readCommitted(): Promise<null> { return null; }
  async commitOnce(record: Readonly<AtomicChapterCommitRecordV1>) {
    this.record = structuredClone(record);
    return { status: "COMMITTED" as const, record: structuredClone(record) };
  }
}

class DeterministicPolicy implements ContentOwnedChapterPolicyPort {
  async evaluateChapter(
    input: Parameters<ContentOwnedChapterPolicyPort["evaluateChapter"]>[0],
  ): Promise<B0ChapterPolicyEvaluationDraftV1> {
    const actionId = input.b0Input.wireInput.sealedDecisionActionIds[0]!;
    const factRef = "fact.chapter.N1.complete";
    const carry = {
      nextChapterId: "N2" as const,
      unlockedContentRefs: ["content.N2"],
      unresolvedCommitmentRefs: [],
      pendingConsequenceRefs: ["consequence.N1"],
    };
    return {
      schemaVersion: "b0_chapter_policy_evaluation_v1",
      b0InputHash: input.b0Input.b0InputHash,
      contentPolicyVersion: input.b0Input.wireInput.contentPolicyVersion,
      contentPolicyHash: input.b0Input.wireInput.contentPolicyHash,
      resourceDispositions: [{ commitmentId: "commitment-N1", disposition: "CONSUMED" }],
      mutations: [{
        mutationId: "mutation-N1-complete",
        entityType: "WORLD",
        entityId: factRef,
        attribute: "canonical.fact",
        operation: "SET",
        value: { before: false, after: true },
        originActionIds: [actionId],
      }],
      seatArcDeltas: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        seatId,
        delta: {
          seatId,
          beforeStateHash: input.baseWorldState.seatArcs[seatId].stateHash,
          afterState: seatArcState(seatId, "N1_FROZEN", 1),
          sourceRefs: [actionId],
        } as unknown as B0ChapterSeatArcDeltaV1["delta"],
      })),
      trackDelta: { civilian_land: 1 },
      carryForward: { ...carry, carryForwardHash: sha256Canonical(carry) },
      causalEdges: [{
        edgeId: "edge-N1-complete",
        fromActionIds: [actionId],
        toMutationIds: ["mutation-N1-complete"],
        relation: "ENABLES",
        evidenceRefs: ["evidence.edict"],
      }],
    };
  }
}

function decisionAction(runId: string, chapterRuntimeId: string): DecisionActionV1 {
  const payload = { optionId: "inspect-ledger" };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: "action-N1",
    runId,
    chapterRuntimeId,
    chapterId: "N1" as const,
    decisionPointId: "dp-investigate",
    seatId: ACTOR,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: 0,
    status: "SEALED" as const,
    actionType: "DECIDE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: "idem-action-N1",
  };
  const requested = { ...body, requestFingerprint: computeDecisionActionRequestFingerprint(body) };
  return { ...requested, sealedHash: sha256Canonical(requested) };
}

function actionIntent(): WorkingActionIntentV1 {
  return {
    visibility: "PARTICIPANTS",
    targetSeatIds: [TARGET],
    evidenceRefs: ["evidence.edict"],
    resourceReservations: [{
      reservationKey: "reservation-N1",
      resourceId: "grain",
      amount: 2,
    }],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
}

function worldState(runId: string): WorldStateV1 {
  const trackBase = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(
      TRACK_IDS_V1.map((trackId) => [trackId, 0]),
    ) as Record<TrackIdV1, number>,
  };
  const tracks: TrackStateV1 = { ...trackBase, stateHash: sha256Canonical(trackBase) };
  const knowledgeBySeat = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const base = {
      seatId,
      knownFactRefs: ["fact.public.sangtian_edict"],
      secretRefs: [`secret.${seatId}.initial`],
      disclosedToSeatIds: [] as SeatIdV1[],
    };
    return [seatId, { ...base, stateHash: sha256Canonical(base) }];
  })) as unknown as Record<SeatIdV1, KnowledgeStateV1>;
  const seatArcs = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
    seatId,
    seatArcState(seatId, "N1_OPEN", 0),
  ])) as unknown as Record<SeatIdV1, SeatArcStateV1>;
  const base = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: 0,
    factValues: {
      "fact.public.sangtian_edict": true,
      "fact.chapter.N1.complete": false,
    },
    resources: { grain: 10 },
    tracks,
    objects: [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  void runId;
  return { ...base, stateHash: sha256Canonical(base) } as WorldStateV1;
}

function seatArcState(
  seatId: SeatIdV1,
  arcStage: string,
  progress: number,
): SeatArcStateV1 {
  const base = {
    seatId,
    arcStage,
    publicGoalProgress: progress,
    privateGoalProgress: progress,
    gainRefs: progress ? [`gain.${seatId}`] : [],
    lossRefs: [],
    costRefs: [],
  };
  return { ...base, stateHash: sha256Canonical(base) };
}
