import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  buildChapterWorkingSet,
  createChapterWorkingState,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
  pinChapterWorkingSet,
} from "@ai-story/templates";
import { SangtianAuthoredChapterContentAdapterV1 } from "../integration/content.adapters";
import { SangtianServerDecisionWorkingIntentCompilerV1 } from "../integration/decision-command.compiler";
import { computeFormalInteractionInputFingerprint } from "../interaction/formal-interaction.service";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
  SubmitOrchestratedActionCommandV1,
} from "../orchestrator/contracts";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import type { SeatAuthorityRecordV1, SeatControlSnapshotV1 } from "../seat-control/types";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { workingStateHash } from "../working-ledger/working-ledger";
import type {
  DecisionConvergenceDependenciesV1,
  PreparedAutomationActionBatchResultV1,
  PreparedAutomationActionBatchV1,
} from "../decision-automation/contracts";
import { PressureAiDecisionCommandCompilerV1 } from "../decision-automation/compiler";
import {
  PressureDecisionConvergenceServiceV1,
  withDecisionConvergenceSnapshotHashV1,
} from "../decision-automation/convergence.service";
import { PublishedSangtianAiDecisionPolicyAdapterV1 } from "../decision-automation/content-policy.adapter";
import {
  AcceptedBeatSubmitAuthorityAdapterV1,
  AcceptedNpcCouncilDecisionPolicyAdapterV1,
} from "../decision-automation/mc-authority.adapters";
import { planPreparedActionLedgerV1 } from "../decision-automation/prepared-action-batch";
import {
  PrismaPreparedAutomationActionSubmissionV1,
  preparedDecisionStateFromProjectionV1,
  preparedOrchestratorEventRowV1,
  serializePreparedLedgerProjectionV1,
  type PreparedAutomationPrismaClientV1,
} from "./prepared-automation-action.prisma-adapter";

const source = readFileSync(
  resolve(__dirname, "prepared-automation-action.prisma-adapter.ts"),
  "utf8",
);

test("prepared W5 append is one bounded Serializable transaction", () => {
  assert.match(source, /TransactionIsolationLevel\.Serializable/u);
  assert.match(source, /maxWait:\s*500/u);
  assert.match(source, /timeout:\s*10_000/u);
  assert.equal((source.match(/pressureFastSerializableTransaction\(/gu) ?? []).length >= 2, true);
});

test("prepared W5 batch writes actions, ledger events, orchestrator state and one runtime CAS", () => {
  assert.match(source, /pressureDecisionAction\.create/u);
  assert.match(source, /storyEvent\.createMany/u);
  assert.match(source, /PRESSURE_CHAPTER_ORCHESTRATOR_STATE/u);
  assert.match(source, /pressureChapterRuntime\.updateMany/u);
  assert.doesNotMatch(source, /storyRun\.updateMany/u);
  assert.doesNotMatch(source, /pressureChapterSettlement\.create/u);
  assert.doesNotMatch(source, /pressureFinale|narrativeProvider|openovel/iu);
});

test("same deterministic action is checked for replay before the head fence", () => {
  const replay = source.indexOf("const replay = findFormalInteractionReplayV1");
  const head = source.indexOf("currentHead !== raw.authority.expectedLedgerHeadHash");
  assert.ok(replay >= 0 && head > replay);
});

test("ledger head conflict is returned before any write", () => {
  const head = source.indexOf("currentHead !== raw.authority.expectedLedgerHeadHash");
  const actionWrite = source.indexOf("await persistFormalAction(tx, event)");
  assert.ok(head >= 0 && actionWrite > head);
  assert.match(source.slice(head, actionWrite), /status:\s*"HEAD_CONFLICT"/u);
});

for (const reason of [
  "ROUTE",
  "ORCHESTRATOR_REVISION",
  "ORCHESTRATOR_HASH",
  "CHAPTER_OR_DECISION",
  "DESCRIPTOR",
  "DECISION_POLICY",
  "WORKING_REVISION",
  "WORKING_STATE",
  "DEADLINE",
  "SEAT_AUTHORITY",
  "SEAT_CONTROLLER",
  "SEAT_EPOCH",
  "SEAT_FENCE",
  "AI_POLICY",
]) {
  test(`prepared append has a fail-closed ${reason} fence`, () => {
    assert.match(source, new RegExp(`"${reason}"`, "u"));
  });
}

test("a completed W4 seat cannot append a second action", () => {
  assert.match(source, /activeSeat\.completion !== "PENDING"/u);
  assert.match(source, /activeSeat\.actionCount !== 0/u);
  assert.match(source, /activeSeat\.actionIds\.length !== 0/u);
});

const MC_PERSISTENCE_NOW = 1_900_000_000_000;
const MC_PERSISTENCE_INTERMEDIATE_DECISION = "N1.weir_crisis";
const MC_PERSISTENCE_FINAL_DECISION = "N1.final_dispatch";
const mcPersistenceLoaded = loadSangtianPressureChapterPackageV1();

test("production Prisma MC intermediate batch commits one human, Beat progression, and Narrative in one transaction", async () => {
  const fixture = await buildMcPersistenceFixture(MC_PERSISTENCE_INTERMEDIATE_DECISION);
  const database = new McPreparedPrismaHarness(fixture);
  const writer = new PrismaPreparedAutomationActionSubmissionV1(database.client);

  const result = await writer.submitPreparedBatch(fixture.batch);

  assert.equal(result.status, "COMMITTED");
  assert.equal(database.transactionCalls, 1);
  assert.equal(database.actionRows.length, 1);
  assert.equal(
    fixture.batch.actions.filter((item) => item.authority.actorKind === "AI").length,
    0,
  );
  assert.equal(database.narrativeRows.length, fixture.batch.beatPlan.narrativeJobs.length);
  assert.ok(database.narrativeRows.length > 0);
  assert.equal(database.outboxRows.length, fixture.batch.beatPlan.narrativeJobs.length);
  assert.equal(database.runtime.state, "DECISION_POINT_OPEN");
  assert.equal(result.orchestratorState.phase, "ACTIVE");
  assert.equal(result.orchestratorState.settlementInputHash, null);
  assert.equal(fixture.batch.beatPlan.settlementInput, null);
});

test("production Prisma MC final batch writes one canonical human/NPC batch and no Settlement row", async () => {
  const fixture = await buildMcPersistenceFixture(MC_PERSISTENCE_FINAL_DECISION);
  const database = new McPreparedPrismaHarness(fixture);
  const writer = new PrismaPreparedAutomationActionSubmissionV1(database.client);

  const result = await writer.submitPreparedBatch(fixture.batch);

  assert.equal(result.status, "COMMITTED");
  assert.equal(database.transactionCalls, 1);
  assert.equal(database.actionRows.length, 6);
  assert.equal(fixture.batch.actions.filter((item) => item.authority.actorKind === "HUMAN").length, 1);
  assert.equal(fixture.batch.actions.filter((item) => item.authority.actorKind === "AI").length, 5);
  assert.equal(fixture.batch.mcAuthority?.npcDecisions.length, 5);
  assert.equal(database.runtime.state, "CHAPTER_SETTLING");
  assert.equal(result.orchestratorState.phase, "SETTLING");
  assert.ok(fixture.batch.beatPlan.settlementInput);
  assert.equal(database.settlementWrites, 0, "Settlement remains outside the MC persistence transaction");
});

test("production Prisma MC action-only recovery writes no duplicate actions and completes the Beat once", async () => {
  const fixture = await buildMcPersistenceFixture(MC_PERSISTENCE_FINAL_DECISION);
  const database = new McPreparedPrismaHarness(fixture);
  database.seedActionOnly(fixture.batch);
  const seededActionCount = database.actionRows.length;
  const writer = new PrismaPreparedAutomationActionSubmissionV1(database.client);

  const result = await writer.submitPreparedBatch(fixture.batch);

  assert.equal(result.status, "COMMITTED");
  assert.equal(result.replayedActionIds.length, fixture.batch.actions.length);
  assert.equal(database.actionRows.length, seededActionCount);
  assert.equal(database.runtime.state, "CHAPTER_SETTLING");
  assert.equal(result.ledgerHeadHash, fixture.batch.beatPlan.event.eventHash);
  assert.equal(database.narrativeRows.length, fixture.batch.beatPlan.narrativeJobs.length);
});

test("production Prisma MC complete replay performs no second action, Beat, Narrative, or runtime write", async () => {
  const fixture = await buildMcPersistenceFixture(MC_PERSISTENCE_FINAL_DECISION);
  const database = new McPreparedPrismaHarness(fixture);
  const writer = new PrismaPreparedAutomationActionSubmissionV1(database.client);
  const committed = await writer.submitPreparedBatch(fixture.batch);
  assert.equal(committed.status, "COMMITTED");
  const before = database.writeCounts();

  const replay = await writer.submitPreparedBatch(fixture.batch);

  assert.equal(replay.status, "REPLAYED");
  assert.deepEqual(database.writeCounts(), before);
  assert.equal(database.transactionCalls, 2, "replay performs only the idempotent repository check");
  assert.equal(replay.replayedActionIds.length, fixture.batch.actions.length);
  assert.equal(replay.ledgerHeadHash, fixture.batch.beatPlan.event.eventHash);
});

test("production Prisma MC current submission fence drift fails closed before every write", async () => {
  const fixture = await buildMcPersistenceFixture(MC_PERSISTENCE_INTERMEDIATE_DECISION);
  const database = new McPreparedPrismaHarness(fixture);
  const submittingSeat = fixture.batch.actions[0]!.command.action.seatId;
  const current = database.seatSnapshot.seatControls.find((item) => item.seatId === submittingSeat)!;
  current.submissionFenceToken = mcPersistenceDigest("current-fence-drift");
  const writer = new PrismaPreparedAutomationActionSubmissionV1(database.client);

  const result = await writer.submitPreparedBatch(fixture.batch);

  assert.equal(result.status, "CONFLICT");
  assert.equal(result.conflictReason, "SEAT_FENCE");
  assert.deepEqual(database.writeCounts(), {
    actionRows: 0,
    storyEventRows: 0,
    narrativeRows: 0,
    outboxRows: 0,
    runtimeUpdates: 0,
    settlementWrites: 0,
  });
});

interface McPersistenceFixtureV1 {
  route: RunRouteSnapshotV1;
  descriptor: AuthoredChapterRuntimeV1;
  chapter: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1;
  seatSnapshot: SeatControlSnapshotV1;
  batch: PreparedAutomationActionBatchV1;
}

async function buildMcPersistenceFixture(
  decisionPointId: typeof MC_PERSISTENCE_INTERMEDIATE_DECISION
    | typeof MC_PERSISTENCE_FINAL_DECISION,
): Promise<McPersistenceFixtureV1> {
  const humanSeats = [PRESSURE_CHAPTER_SEAT_IDS_V1[0]!] as const;
  const route = makeMcPersistenceRoute(humanSeats, decisionPointId);
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const descriptor = await content.load({ routeSnapshot: route, chapterId: "N1" });
  const decision = descriptor.decisions.find(
    (candidate) => candidate.decisionPointId === decisionPointId,
  );
  assert.ok(decision);
  const working = createMcPersistenceWorkingState(descriptor, decisionPointId, route.runId);
  const workingSet = buildChapterWorkingSet(descriptor.definition, working);
  assert.ok(workingSet);
  assert.equal(workingSet.decisionPoint.decisionPointId, decisionPointId);
  const chapter = withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: 7,
    phase: "ACTIVE",
    currentChapterId: "N1",
    chapterRuntimeId: `chapter-N1-${mcPersistenceDigest(route.runId).slice(0, 12)}`,
    descriptorHash: descriptor.descriptorHash,
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: mcPersistenceDigest("world"),
      previousFrozenHash: mcPersistenceDigest("genesis"),
    },
    activeDecision: {
      decisionPointId: decision.decisionPointId,
      policyHash: sha256Canonical(decision),
      openedAtMs: MC_PERSISTENCE_NOW - 1_000,
      deadlineAtMs: MC_PERSISTENCE_NOW + 300_000,
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        seatId,
        requirement: decision.seatRequirements[seatId],
        completion: "PENDING" as const,
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
  const projection: WorkingLedgerProjectionV1 = {
    key: { runId: route.runId, chapterRuntimeId: chapter.chapterRuntimeId },
    chapterId: "N1",
    routeHash: route.routeHash,
    chapterDefinitionHash: sha256Canonical(descriptor.definition),
    headHash: mcPersistenceDigest(`opening:${route.runId}:${decisionPointId}`),
    headSequence: 0,
    state: working,
    stateHash: workingStateHash(working),
    nextDecisionPin: pinChapterWorkingSet(workingSet),
    acceptedActions: new Map(),
    actionsByIdempotencyKey: new Map(),
    commitmentActionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
  const seatSnapshot = makeMcPersistenceSeatSnapshot(route);
  const humanCommand = makeMcPersistenceHumanCommand({
    route,
    descriptor,
    chapter,
    projection,
    seatSnapshot,
  });
  const legacyPolicy = new PublishedSangtianAiDecisionPolicyAdapterV1();
  const npcPolicy = new AcceptedNpcCouncilDecisionPolicyAdapterV1();
  const compiler = new PressureAiDecisionCommandCompilerV1(
    new SangtianServerDecisionWorkingIntentCompilerV1(),
  );
  let captured: PreparedAutomationActionBatchV1 | null = null;
  const dependencies: DecisionConvergenceDependenciesV1 = {
    scanner: { scanActive: async () => [] },
    snapshots: {
      capture: async () => withDecisionConvergenceSnapshotHashV1({
        schemaVersion: "pressure_decision_convergence_authority_snapshot_v1",
        routeSnapshot: structuredClone(route),
        chapter: structuredClone(chapter),
        projection: cloneMcPersistenceProjection(projection),
        seatAuthority: structuredClone(seatSnapshot),
        aiPolicyArtifactHash: legacyPolicy.artifactSha256,
        capturedAtMs: MC_PERSISTENCE_NOW,
      }),
    },
    content: { load: async () => structuredClone(descriptor) },
    beatSubmitAuthority: new AcceptedBeatSubmitAuthorityAdapterV1(),
    npcCouncilPolicy: npcPolicy,
    policy: {
      artifactSha256: legacyPolicy.artifactSha256,
      select: () => { throw new Error("legacy policy is forbidden in MC fixture"); },
    },
    compiler: {
      compile: () => { throw new Error("legacy compiler is forbidden in MC fixture"); },
      compileNpcDecision: (input) => compiler.compileNpcDecision(input),
    },
    preparedActions: {
      submitPrepared: async () => { throw new Error("per-seat writer is forbidden"); },
      submitPreparedBatch: async (batch): Promise<PreparedAutomationActionBatchResultV1> => {
        captured = structuredClone(batch);
        return {
          status: "CONFLICT",
          batchId: batch.batchId,
          actionIds: [],
          replayedActionIds: [],
          eventHashes: [],
          ledgerHeadHash: projection.headHash,
          orchestratorState: structuredClone(batch.beatPlan.postBeatOrchestratorState),
          projection: null,
          conflictReason: "HEAD_CONFLICT",
        };
      },
    },
    runtime: {
      resume: async () => structuredClone(chapter),
      resumeFromCommittedSettlementAuthority: async () => structuredClone(chapter),
    },
    deadlineDefaults: {
      advanceExpiredDecision: async () => ({ kind: "STALE" as const, state: structuredClone(chapter) }),
      applyAiFailure: async () => ({ kind: "STALE" as const, state: structuredClone(chapter) }),
    },
    diagnostics: { record: () => undefined },
    clock: { nowMs: () => MC_PERSISTENCE_NOW },
  };
  const service = new PressureDecisionConvergenceServiceV1(dependencies, { retryMs: 10 });
  await service.converge({
    trigger: "HTTP_POST_SUBMIT",
    runId: route.runId,
    expectedRouteHash: route.routeHash,
    source: {
      chapterRuntimeId: chapter.chapterRuntimeId,
      chapterId: chapter.currentChapterId,
      decisionPointId,
    },
    nowMs: MC_PERSISTENCE_NOW,
    humanSubmitMs: 1,
    humanAction: humanCommand,
  });
  assert.ok(captured, "MC convergence did not create a prepared production batch");
  return {
    route,
    descriptor,
    chapter,
    projection,
    seatSnapshot,
    batch: captured,
  };
}

class McPreparedPrismaHarness {
  readonly client: PreparedAutomationPrismaClientV1;
  readonly actionRows: Record<string, unknown>[] = [];
  readonly storyEventRows: Record<string, unknown>[] = [];
  readonly narrativeRows: Record<string, unknown>[] = [];
  readonly outboxRows: Record<string, unknown>[] = [];
  readonly orchestratorRows = new Map<string, Record<string, unknown>>();
  readonly seatSnapshot: SeatControlSnapshotV1;
  readonly runtime: Record<string, any>;
  transactionCalls = 0;
  runtimeUpdates = 0;
  settlementWrites = 0;

  constructor(private readonly fixture: McPersistenceFixtureV1) {
    this.seatSnapshot = structuredClone(fixture.seatSnapshot);
    this.runtime = {
      id: fixture.chapter.chapterRuntimeId,
      runId: fixture.route.runId,
      chapterId: fixture.chapter.currentChapterId,
      routeHash: fixture.route.routeHash,
      workingRevision: fixture.projection.state.revision,
      workingStateJson: structuredClone(fixture.projection.state),
      workingStateHash: fixture.projection.stateHash,
      ledgerProjectionJson: serializePreparedLedgerProjectionV1(fixture.projection),
      lockVersion: 1,
      decisionStateJson: preparedDecisionStateFromProjectionV1(
        fixture.projection,
        fixture.chapter.activeDecision!.seats
          .filter((seat) => seat.requirement === "REQUIRED")
          .map((seat) => seat.seatId),
        fixture.chapter.activeDecision!.policyHash,
        fixture.chapter.orchestratorHash,
      ),
      state: "DECISION_POINT_OPEN",
    };
    const currentOrchestrator = preparedOrchestratorEventRowV1(fixture.chapter);
    this.orchestratorRows.set(String(currentOrchestrator.dedupeKey), currentOrchestrator);
    const tx = this.createTransaction();
    this.client = {
      $transaction: async <T>(operation: (transaction: any) => Promise<T>) => {
        this.transactionCalls += 1;
        return operation(tx);
      },
    } as PreparedAutomationPrismaClientV1;
  }

  seedActionOnly(batch: PreparedAutomationActionBatchV1): void {
    const actionPlan = planPreparedActionLedgerV1({
      projection: this.fixture.projection,
      actions: batch.actions,
    });
    this.runtime.ledgerProjectionJson = serializePreparedLedgerProjectionV1(actionPlan.projection);
    this.actionRows.push(...batch.actions.map((item) => ({
      id: item.command.action.actionId,
      seeded: true,
    })));
  }

  writeCounts() {
    return {
      actionRows: this.actionRows.length,
      storyEventRows: this.storyEventRows.length,
      narrativeRows: this.narrativeRows.length,
      outboxRows: this.outboxRows.length,
      runtimeUpdates: this.runtimeUpdates,
      settlementWrites: this.settlementWrites,
    };
  }

  private createTransaction(): Record<string, unknown> {
    const createMany = async (
      target: Record<string, unknown>[],
      input: { data: Record<string, unknown>[] },
    ) => {
      target.push(...structuredClone(input.data));
      return { count: input.data.length };
    };
    const createOne = async (
      target: Record<string, unknown>[],
      input: { data: Record<string, unknown> },
    ) => {
      const row = structuredClone(input.data);
      target.push(row);
      return row;
    };
    return {
      storyEvent: {
        findMany: async () => [],
        findUnique: async (input: Record<string, any>) => {
          const dedupeKey = input.where?.dedupeKey;
          const row = this.orchestratorRows.get(String(dedupeKey));
          return row ? structuredClone(row) : null;
        },
        createMany: async (input: { data: Record<string, unknown>[] }) => {
          for (const row of input.data) {
            if (row.type === "PRESSURE_CHAPTER_ORCHESTRATOR_STATE") {
              this.orchestratorRows.set(String(row.dedupeKey), structuredClone(row));
            }
          }
          return createMany(this.storyEventRows, input);
        },
        create: async (input: { data: Record<string, unknown> }) => {
          if (input.data.type === "PRESSURE_CHAPTER_ORCHESTRATOR_STATE") {
            this.orchestratorRows.set(
              String(input.data.dedupeKey),
              structuredClone(input.data),
            );
          }
          return createOne(this.storyEventRows, input);
        },
      },
      pressureChapterRuntime: {
        findUnique: async () => structuredClone(this.runtime),
        updateMany: async (input: { where: Record<string, any>; data: Record<string, any> }) => {
          const where = input.where;
          if (
            where.id !== this.runtime.id
            || where.runId !== this.runtime.runId
            || where.lockVersion !== this.runtime.lockVersion
            || where.workingRevision !== this.runtime.workingRevision
            || where.workingStateHash !== this.runtime.workingStateHash
          ) return { count: 0 };
          const data = structuredClone(input.data);
          this.runtime.lockVersion += Number(data.lockVersion?.increment ?? 0);
          for (const [key, value] of Object.entries(data)) {
            if (key === "lockVersion") continue;
            this.runtime[key] = value;
          }
          this.runtimeUpdates += 1;
          return { count: 1 };
        },
      },
      pressureDecisionAction: {
        createMany: (input: { data: Record<string, unknown>[] }) => createMany(this.actionRows, input),
        create: (input: { data: Record<string, unknown> }) => createOne(this.actionRows, input),
      },
      pressureRunRouteSnapshot: { findUnique: async () => null },
      pressureSeatControlSnapshot: {
        findUnique: async () => ({
          runId: this.seatSnapshot.runId,
          stateRevision: this.seatSnapshot.stateRevision,
          snapshotJson: structuredClone(this.seatSnapshot),
          stateHash: this.seatSnapshot.stateHash,
          version: 1,
        }),
      },
      storyRun: { findUnique: async () => null },
      pressureNarrativeProjection: {
        createMany: (input: { data: Record<string, unknown>[] }) => createMany(this.narrativeRows, input),
        create: async (input: { data: Record<string, unknown> }) => {
          await createOne(this.narrativeRows, input);
          return { id: String(input.data.runId ?? "projection") };
        },
      },
      pressureOutboxTask: {
        createMany: (input: { data: Record<string, unknown>[] }) => createMany(this.outboxRows, input),
        create: (input: { data: Record<string, unknown> }) => createOne(this.outboxRows, input),
      },
    };
  }
}

function makeMcPersistenceHumanCommand(input: Readonly<{
  route: RunRouteSnapshotV1;
  descriptor: AuthoredChapterRuntimeV1;
  chapter: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1;
  seatSnapshot: SeatControlSnapshotV1;
}>): SubmitOrchestratedActionCommandV1 {
  const viewerSeatId = input.route.humanSeatIdsAtStart[0]! as SeatIdV1;
  const authority = input.seatSnapshot.seatControls.find(
    (item) => item.seatId === viewerSeatId,
  )!;
  const decision = input.descriptor.decisions.find(
    (item) => item.decisionPointId === input.chapter.activeDecision!.decisionPointId,
  )!;
  const actionType = decision.execution.allowedActionTypes.find(
    (candidate) => candidate !== "DEFAULT_PASS",
  ) ?? "DEFAULT_PASS";
  const idempotencyKey = `persistence-human:${input.route.runId}:${viewerSeatId}`;
  const actionId = `action_${mcPersistenceDigest(idempotencyKey)}`;
  const payload = { optionCode: actionType, customText: null };
  const actionBase = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId,
    runId: input.route.runId,
    chapterRuntimeId: input.chapter.chapterRuntimeId,
    chapterId: input.chapter.currentChapterId,
    decisionPointId: input.chapter.activeDecision!.decisionPointId,
    seatId: viewerSeatId,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: authority.controlEpoch,
    expectedWorkingRevision: input.projection.state.revision,
    status: "SEALED" as const,
    actionType,
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey,
  };
  const requestFingerprint = computeDecisionActionRequestFingerprint(actionBase);
  const sealedBody = { ...actionBase, requestFingerprint };
  const action = { ...sealedBody, sealedHash: sha256Canonical(sealedBody) };
  const intent = new SangtianServerDecisionWorkingIntentCompilerV1().compile({
    routeHash: input.route.routeHash,
    chapterRuntimeId: input.chapter.chapterRuntimeId,
    chapterId: input.chapter.currentChapterId,
    decisionPointId: input.chapter.activeDecision!.decisionPointId,
    seatId: viewerSeatId,
    actionType,
  });
  const body = {
    routeSnapshot: structuredClone(input.route),
    subjectId: authority.activeControllerId,
    action,
    intent,
    nowMs: MC_PERSISTENCE_NOW,
  };
  return { ...body, inputFingerprint: computeFormalInteractionInputFingerprint(body) };
}

function createMcPersistenceWorkingState(
  descriptor: AuthoredChapterRuntimeV1,
  decisionPointId: string,
  runId: string,
) {
  const state = createChapterWorkingState({
    runId,
    chapterId: "N1",
    facts: loadPublishedSangtianActionReleaseV1().compileChapterActionEffects({
      chapterId: "N1",
      confirmedActions: [],
      defaultEvents: [],
    }).settlementFacts,
  });
  const targetIndex = descriptor.definition.decisionPoints.findIndex(
    (point) => point.decisionPointId === decisionPointId,
  );
  assert.ok(targetIndex >= 0);
  state.completedDecisionPointIds = descriptor.definition.decisionPoints
    .slice(0, targetIndex)
    .map((point) => point.decisionPointId);
  state.revision = targetIndex;
  state.lastBeatId = targetIndex > 0 ? `fixture-beat-${targetIndex}` : null;
  return state;
}

function makeMcPersistenceRoute(
  humanSeats: readonly SeatIdV1[],
  decisionPointId: string,
): RunRouteSnapshotV1 {
  const topologyBody = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure-control-topology-v1",
    participantMode: "SOLO" as const,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humanSeats.includes(seatId)
        ? "HUMAN_ACTIVE" as const
        : "AI_ACTIVE" as const,
    })),
  };
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: `run-mc-persistence-${decisionPointId.replaceAll(".", "-")}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: mcPersistenceLoaded.manifest.packageVersion,
    contentPackageSha256: mcPersistenceLoaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: mcPersistenceDigest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: mcPersistenceDigest("runtime"),
    testMatrixVersion: "pressure-test-v1",
    testMatrixSha256: mcPersistenceDigest("test"),
    runSeed: `seed-persistence-${decisionPointId}`,
    narrativeProfileVersion: "pressure-narrative-v1",
    featureSetVersion: "pressure-features-v1",
    resultContractRegistryVersion: "pressure-result-v1",
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [...humanSeats],
    controlTopologyVersion: topologyBody.controlTopologyVersion,
    initialRoleControlSnapshotHash: sha256Canonical(topologyBody),
  });
}

function makeMcPersistenceSeatSnapshot(route: RunRouteSnapshotV1): SeatControlSnapshotV1 {
  const humans = new Set(route.humanSeatIdsAtStart);
  const frozenPolicyBody = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "pressure-seat-control-v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline-v1",
    takeoverDeadlinePolicyHash: mcPersistenceDigest("deadline-policy"),
    deterministicDefaultPolicyRef: "default-v1",
    deterministicDefaultPolicyHash: mcPersistenceDigest("default-policy"),
    humanReclaimAllowed: true,
  };
  const frozenPolicy = {
    ...frozenPolicyBody,
    policyHash: sha256Canonical(frozenPolicyBody),
  };
  const seatControls: SeatAuthorityRecordV1[] = PRESSURE_CHAPTER_SEAT_IDS_V1.map(
    (seatId) => {
      const human = humans.has(seatId);
      const ai = `pressure-ai:${seatId}`;
      const controller = human ? `human:${seatId}` : ai;
      return {
        seatId,
        mode: human ? "HUMAN_ACTIVE" : "AI_ACTIVE",
        originalHumanControllerId: human ? controller : null,
        designatedAiControllerId: ai,
        activeControllerId: controller,
        controlEpoch: 1,
        submissionFenceToken: mcPersistenceDigest(`submit:${seatId}`),
        reclaimFenceToken: human ? mcPersistenceDigest(`reclaim:${seatId}`) : null,
        lastAuthorityEventHash: mcPersistenceDigest(`authority:${seatId}`),
      };
    },
  );
  const body = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId: route.runId,
    participantMode: route.participantMode,
    routeHash: route.routeHash,
    genesisHash: mcPersistenceDigest("genesis"),
    genesisAtomicRecordHash: mcPersistenceDigest("genesis-atomic"),
    initialTopologyHash: route.initialRoleControlSnapshotHash,
    controlTopologyVersion: route.controlTopologyVersion,
    frozenPolicy,
    stateRevision: 1,
    timelineLength: 6,
    timelineHeadHash: mcPersistenceDigest("timeline"),
    seatControls,
    initializationInputHash: mcPersistenceDigest("initialization"),
  };
  return { ...body, stateHash: sha256Canonical(body) };
}

function cloneMcPersistenceProjection(
  value: WorkingLedgerProjectionV1,
): WorkingLedgerProjectionV1 {
  return {
    ...structuredClone({
      key: value.key,
      chapterId: value.chapterId,
      routeHash: value.routeHash,
      chapterDefinitionHash: value.chapterDefinitionHash,
      headHash: value.headHash,
      headSequence: value.headSequence,
      state: value.state,
      stateHash: value.stateHash,
      nextDecisionPin: value.nextDecisionPin,
    }),
    acceptedActions: new Map(
      [...value.acceptedActions].map(([key, item]) => [key, structuredClone(item)]),
    ),
    actionsByIdempotencyKey: new Map(
      [...value.actionsByIdempotencyKey].map(([key, item]) => [key, structuredClone(item)]),
    ),
    commitmentActionsByIdempotencyKey: new Map(value.commitmentActionsByIdempotencyKey ?? []),
    appliedBeats: new Map(
      [...value.appliedBeats].map(([key, item]) => [key, structuredClone(item)]),
    ),
    pendingReservations: new Map(
      [...value.pendingReservations].map(([key, item]) => [key, structuredClone(item)]),
    ),
    commitments: new Map(
      [...value.commitments].map(([key, item]) => [key, structuredClone(item)]),
    ),
    evidenceRefsByAction: new Map(
      [...value.evidenceRefsByAction].map(([key, item]) => [key, [...item]]),
    ),
    knowledgeBySeat: new Map(
      [...value.knowledgeBySeat].map(([key, item]) => [key, [...item]]),
    ),
    seatArcProgressBySeat: new Map(value.seatArcProgressBySeat),
  };
}

function mcPersistenceDigest(value: unknown): string {
  return sha256Canonical(value);
}
