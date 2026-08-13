import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compileB0ChapterSettlementInputV1,
  sealB0ChapterPolicyEvaluationV1,
  sha256Canonical,
  type B0ChapterSettlementMaterialV1,
  type CanonicalJsonValue,
  type PressureChapterSubmitDecisionCommandV1,
  type SeatIdV1,
  type SealedChapterSettlementInputV1,
} from "@ai-story/shared";
import {
  buildChapterWorkingSet,
  completePressureBeat,
  compileInitialWorldState,
  createChapterWorkingState,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
  pinChapterWorkingSet,
} from "@ai-story/templates";
import type { PressureChapterGameProjectionV1 } from "../game-projection/contracts";
import type { PressureChapterHttpAccessV1 } from "../http/contracts";
import type { SubmitFormalInteractionCommandV1 } from "../interaction/contracts";
import type {
  ActiveDecisionStateV1,
  AuthoredChapterRuntimeV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import {
  PressureChapterRunRouterService,
  type RunRouteRepositoryPort,
} from "../run-router";
import type {
  StoredRunRouteRecordV1 as ApiStoredRunRouteRecordV1,
} from "../run-router/types";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import {
  PressureDecisionCommandCompilerV1,
  SangtianServerDecisionWorkingIntentCompilerV1,
} from "./decision-command.compiler";
import { SangtianDeterministicDefaultActionAdapterV1 } from "./deterministic-default.adapter";
import { SangtianContentOwnedChapterPolicyAdapterV1 } from "./content-policy.adapter";
import {
  SangtianAuthoredChapterContentAdapterV1,
  SangtianChapterWorkingSeedAdapterV1,
  SangtianGenesisContentAdapterV1,
  SangtianPressureGameContentMapperV1,
  SangtianReleaseActionPresentationCatalogAdapterV1,
  createPublishedSangtianRouteRegistryPortV1,
} from "./content.adapters";
import { PressureChapterIntegrationError } from "./errors";
import { SangtianPressureGameChapterReaderAdapterV1 } from "./game-projection.adapters";
import { SangtianAuthoritativeBeatCompilerV1 } from "./working-ledger.adapters";

const digest = (label: string): string => sha256Canonical({ label });
const RUN_ID = "run-pressure-integration-v1";
const CHAPTER_RUNTIME_ID = "chapter-runtime-N1";
const ACTOR: SeatIdV1 = "cabinet_finance";

class MemoryRoutes implements RunRouteRepositoryPort {
  private readonly records = new Map<string, ApiStoredRunRouteRecordV1>();

  async findByRunId(runId: string): Promise<ApiStoredRunRouteRecordV1 | null> {
    const record = this.records.get(runId);
    return record ? structuredClone(record) : null;
  }

  async insertIfAbsent(record: ApiStoredRunRouteRecordV1) {
    const current = this.records.get(record.runId);
    if (current) return { status: "EXISTING" as const, record: structuredClone(current) };
    this.records.set(record.runId, structuredClone(record));
    return { status: "INSERTED" as const, record: structuredClone(record) };
  }
}

async function storedRoute(): Promise<ApiStoredRunRouteRecordV1> {
  const registry = createPublishedSangtianRouteRegistryPortV1({
    registryVersion: "registry-1.0.0",
    orchestrationPackageVersion: "orchestration-1.0.0",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "runtime-1.0.0",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "tests-1.0.0",
    testMatrixSha256: digest("tests"),
    narrativeProfileVersion: "openovel-1.0.0",
    featureSetVersion: "feature-1.0.0",
    resultContractRegistryVersion: "result-1.0.0",
    controlTopologyVersion: "control-1.0.0",
  });
  const router = new PressureChapterRunRouterService(new MemoryRoutes(), registry);
  return (await router.create({
    runId: RUN_ID,
    routeKey: null,
    participantMode: "SOLO",
    humanSeatIdsAtStart: [ACTOR],
    runSeed: "integration-seed",
  })).route;
}

test("accepted content composes P0 and all N1-N7 dynamic authored runtimes", async () => {
  const stored = await storedRoute();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const expectedCounts = [1, 4, 4, 2, 7, 3, 5];
  for (let index = 0; index < expectedCounts.length; index += 1) {
    const chapterId = `N${index + 1}` as AuthoredChapterRuntimeV1["chapterId"];
    const descriptor = await content.load({ routeSnapshot: stored.snapshot, chapterId });
    assert.equal(descriptor.decisions.length, expectedCounts[index]);
    assert.deepEqual(
      descriptor.chapterClosePolicy.decisionPointIds,
      descriptor.decisions.map((decision) => decision.decisionPointId),
    );
    for (const decision of descriptor.decisions) {
      const authoredPoint = descriptor.definition.decisionPoints.find(
        (candidate) => candidate.decisionPointId === decision.decisionPointId,
      );
      assert.ok(authoredPoint);
      assert.deepEqual(
        authoredPoint.options.map((option) => option.optionId),
        decision.execution.allowedActionTypes,
      );
      for (const option of authoredPoint.options) {
        assert.equal(JSON.stringify(option.workingDelta).includes("worldSequence"), false);
      }
    }
  }
  const p0 = await new SangtianGenesisContentAdapterV1().loadP0({
    route: stored.snapshot,
    controlTopology: stored.controlTopology,
  });
  assert.equal(p0.worldSequence, 0);
  assert.equal("settlement" in p0, false);
});

test("N1 WorkingState seeds the published action reducer identities", async () => {
  const stored = await storedRoute();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const chapter = await content.load({ routeSnapshot: stored.snapshot, chapterId: "N1" });
  const worldState = await new SangtianGenesisContentAdapterV1().loadP0({
    route: stored.snapshot,
    controlTopology: stored.controlTopology,
  });
  const previousFrozenHash = digest("genesis-frozen");
  const seed = await new SangtianChapterWorkingSeedAdapterV1({
    async readAuthorityBase() {
      return {
        routeHash: stored.snapshot.routeHash,
        sourceFrozenHash: previousFrozenHash,
        worldState,
      };
    },
  }).load({
    routeSnapshot: stored.snapshot,
    chapter,
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: worldState.stateHash,
      previousFrozenHash,
    },
  });

  assert.equal(seed.facts.evacuationCoveragePct, 0);
  assert.equal(seed.facts.criticalWeirsSecuredCount, 0);
  assert.equal(seed.facts.verifiedBreachRecordCount, 0);
  assert.equal(seed.facts.disasterSeverity, 4);
  assert.equal(seed.facts["fact.P0.edict_issued"], true);
});

test("server decision compiler derives authority fields and rejects controlEpoch zero", async () => {
  const stored = await storedRoute();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const descriptor = await content.load({ routeSnapshot: stored.snapshot, chapterId: "N1" });
  const projection = workingProjection(stored, descriptor);
  const decision = descriptor.decisions[0]!;
  const option = decision.execution.allowedActionTypes.find(
    (actionType) => actionType !== "DEFAULT_PASS",
  )!;
  const submissionFenceToken = digest("submission-fence");
  const game = gameProjection(stored, decision, option, submissionFenceToken);
  const compiler = new PressureDecisionCommandCompilerV1(
    { read: async () => structuredClone(game) },
    { load: async () => cloneProjection(projection) },
    content,
    new SangtianServerDecisionWorkingIntentCompilerV1(),
  );
  const access: PressureChapterHttpAccessV1 = {
    schemaVersion: "pressure_chapter_http_access_v1",
    roomId: game.roomId,
    runId: RUN_ID,
    subjectId: "subject-1",
    viewerId: "viewer-1",
  };
  const publicCommand = decisionCommand(stored, decision.decisionPointId, option, submissionFenceToken);
  const compiled = await compiler.compile({
    access,
    storedRoute: stored,
    command: publicCommand,
    nowMs: 100,
  });
  assert.equal(compiled.action.actionType, option);
  assert.equal(compiled.action.actionOrdinal, 1);
  assert.equal(compiled.action.actionRevision, 1);
  assert.deepEqual(compiled.action.payload, { optionCode: option, customText: null });
  assert.deepEqual(compiled.intent, {
    visibility: "PARTICIPANTS",
    targetSeatIds: [...decision.execution.requiredSeatIds],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  });
  await assert.rejects(
    () => compiler.compile({
      access,
      storedRoute: stored,
      command: { ...publicCommand, controlEpoch: 0 },
      nowMs: 101,
    }),
    (error: unknown) => (
      error instanceof PressureChapterIntegrationError
      && error.code === "INTEGRATION_DECISION_COMMAND_MISMATCH"
    ),
  );
  await assert.rejects(
    () => compiler.compile({
      access,
      storedRoute: stored,
      command: {
        ...publicCommand,
        settlementFacts: { evacuationCoveragePct: 100 },
      } as unknown as PressureChapterSubmitDecisionCommandV1,
      nowMs: 102,
    }),
    (error: unknown) => (
      error instanceof PressureChapterIntegrationError
      && error.code === "INTEGRATION_DECISION_COMMAND_MISMATCH"
      && error.detail === "EXACT_FIELDS"
    ),
  );
  await assert.rejects(
    () => compiler.compile({
      access,
      storedRoute: stored,
      command: { ...publicCommand, sourceEventId: "event-not-valid-for-normal-action" },
      nowMs: 103,
    }),
    (error: unknown) => (
      error instanceof PressureChapterIntegrationError
      && error.code === "INTEGRATION_DECISION_COMMAND_MISMATCH"
      && error.path === "decision.sourceEventId"
      && error.detail === "NON_INVESTIGATION_MUST_BE_NULL"
    ),
  );
});

test("N6 investigation commands consume one visible ACKed aggregate and server-seal evidence", async () => {
  const stored = await storedRoute();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const descriptor = await content.load({ routeSnapshot: stored.snapshot, chapterId: "N6" });
  const decision = descriptor.decisions.find(
    (candidate) => candidate.decisionPointId === "N6.ledger_exchange",
  )!;
  assert.ok(decision);
  const chapterRuntimeId = "chapter-runtime-N6";
  const state = createChapterWorkingState({
    runId: RUN_ID,
    chapterId: "N6",
  });
  state.completedDecisionPointIds = [descriptor.decisions[0]!.decisionPointId];
  const set = buildChapterWorkingSet(descriptor.definition, state);
  assert.ok(set);
  assert.equal(set.decisionPoint.decisionPointId, decision.decisionPointId);
  const working = workingProjection(stored, descriptor, chapterRuntimeId);
  working.state = state;
  working.stateHash = sha256Canonical(state);
  working.nextDecisionPin = pinChapterWorkingSet(set);
  const submissionFenceToken = digest("N6-submission-fence");
  const access: PressureChapterHttpAccessV1 = {
    schemaVersion: "pressure_chapter_http_access_v1",
    roomId: "room-1",
    runId: RUN_ID,
    subjectId: "subject-1",
    viewerId: "viewer-1",
  };

  async function compile(actionType: string, disclosure: "HIDDEN" | "SUSPECTED", acknowledged = true) {
    const sourceEventId = `event-${disclosure.toLowerCase()}`;
    const game = investigationGameProjection({
      stored,
      decision,
      actionType,
      disclosure,
      sourceEventId,
      chapterRuntimeId,
      submissionFenceToken,
      acknowledged,
    });
    const compiler = new PressureDecisionCommandCompilerV1(
      { read: async () => structuredClone(game) },
      { load: async () => cloneProjection(working) },
      content,
      new SangtianServerDecisionWorkingIntentCompilerV1(),
    );
    const command: PressureChapterSubmitDecisionCommandV1 = {
      schemaVersion: PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1,
      commandType: "SUBMIT_DECISION",
      runId: RUN_ID,
      routeHash: stored.snapshot.routeHash,
      chapterRuntimeId,
      chapterId: "N6",
      seatId: "qingliu_law",
      controlEpoch: 1,
      expectedWorkingRevision: 0,
      decisionPointId: decision.decisionPointId,
      submissionFenceToken,
      idempotencyKey: `n6-${actionType.toLowerCase()}`,
      optionCode: actionType,
      customText: null,
      sourceEventId,
    };
    return { compiled: await compiler.compile({ access, storedRoute: stored, command, nowMs: 200 }), game };
  }

  const investigated = await compile("INVESTIGATE_LEDGER_SOURCE", "HIDDEN");
  assert.deepEqual(investigated.compiled.action.payload, {
    interactionKind: "A_EMOTION_INVESTIGATION",
    investigationCode: "INVESTIGATE_LEDGER_SOURCE",
    responseToEventId: "event-hidden",
    sharedObjectId: "original-grain-ledger",
  });
  assert.deepEqual(investigated.compiled.intent.evidenceRefs, []);

  const confirmed = await compile("CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE", "SUSPECTED");
  assert.deepEqual(confirmed.compiled.action.payload, {
    interactionKind: "A_EMOTION_INVESTIGATION",
    investigationCode: "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
    responseToEventId: "event-suspected",
    sharedObjectId: "original-grain-ledger",
  });
  assert.deepEqual(confirmed.compiled.intent.evidenceRefs, [
    `evidence.a-emotion.${sha256Canonical({
      schemaVersion: "pressure_a_emotion_investigation_evidence_v1",
      runId: RUN_ID,
      viewerSeatId: "qingliu_law",
      sourceEventId: "event-suspected",
      sourceProjectionVersion: 3,
      sourceProjectionHash: digest("event-suspected-projection"),
      disclosure: "SUSPECTED",
    })}`,
  ]);

  await assert.rejects(
    () => compile("CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE", "SUSPECTED", false),
    (error: unknown) => (
      error instanceof PressureChapterIntegrationError
      && error.code === "INTEGRATION_DECISION_COMMAND_MISMATCH"
      && error.path === "decision.sourceEventId"
      && error.detail === "NOT_VISIBLE_ACKNOWLEDGED_LATEST_SOURCE"
    ),
  );
  await assert.rejects(
    () => compile("CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE", "HIDDEN"),
    (error: unknown) => (
      error instanceof PressureChapterIntegrationError
      && error.code === "INTEGRATION_DECISION_COMMAND_MISMATCH"
      && error.detail === "NOT_VISIBLE_ACKNOWLEDGED_LATEST_SOURCE"
    ),
  );
});

test("game chapter reader keeps decision projection viewer-scoped", async () => {
  const stored = await storedRoute();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const descriptor = await content.load({ routeSnapshot: stored.snapshot, chapterId: "N2" });
  const runtimeId = "chapter-runtime-N2";
  const projection = workingProjection(stored, descriptor, runtimeId);
  const decision = descriptor.decisions[0]!;
  const required = new Set(decision.execution.requiredSeatIds);
  const activeDecision: ActiveDecisionStateV1 = {
    decisionPointId: decision.decisionPointId,
    policyHash: sha256Canonical(decision.execution),
    openedAtMs: 10,
    deadlineAtMs: 100,
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: required.has(seatId) ? "REQUIRED" : "NOT_REQUIRED",
      completion: required.has(seatId) ? "PENDING" : "NOT_REQUIRED",
      actionIds: [],
      actionCount: 0,
      defaultCode: null,
    })),
  };
  const state = withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: RUN_ID,
    routeHash: stored.snapshot.routeHash,
    revision: 2,
    phase: "ACTIVE",
    currentChapterId: "N2",
    chapterRuntimeId: runtimeId,
    descriptorHash: descriptor.descriptorHash,
    authorityBase: {
      baseWorldSequence: 1,
      baseWorldStateHash: digest("N1-world"),
      previousFrozenHash: digest("N1-frozen"),
    },
    activeDecision,
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: required.has(seatId) ? "REQUIRED" : "NOT_REQUIRED",
      sealedActionIds: [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: null,
    frozenBundleHash: null,
  });
  const reader = new SangtianPressureGameChapterReaderAdapterV1(
    { readStoredRoute: async () => structuredClone(stored) },
    { read: async () => structuredClone(state), compareAndSwap: async () => {
      throw new Error("READ_ONLY_TEST");
    } },
    { load: async () => cloneProjection(projection) },
    content,
    new SangtianPressureGameContentMapperV1(
      new SangtianReleaseActionPresentationCatalogAdapterV1(),
    ),
  );
  const viewerSeatId: SeatIdV1 = "jiangnan_merchant";
  const source = await reader.readCurrent({
    runId: RUN_ID,
    routeHash: stored.snapshot.routeHash,
    viewerSeatId,
  });
  assert.ok(source);
  assert.equal(source.viewerSeatId, viewerSeatId);
  assert.equal(source.chapter.chapterId, "N2");
  assert.equal(source.decision?.requirement, "NOT_REQUIRED");
  assert.ok(source.decision?.options.every(
    (option) => option.label.trim() && option.description.trim(),
  ));
  assert.ok(source.decision?.options.every(
    (option) => !option.label.startsWith("internal:"),
  ));
  assert.ok(source.projectionVersion >= 1);
});

test("authoritative Beat compiler is permutation-stable and Working-only", async () => {
  const stored = await storedRoute();
  const loaded = loadSangtianPressureChapterPackageV1();
  const descriptor = await new SangtianAuthoredChapterContentAdapterV1().load({
    routeSnapshot: stored.snapshot,
    chapterId: "N1",
  });
  const state = createChapterWorkingState({ runId: RUN_ID, chapterId: "N1" });
  const workingSet = buildChapterWorkingSet(descriptor.definition, state);
  assert.ok(workingSet);
  const allowed = descriptor.decisions[0]!.execution.allowedActionTypes;
  const actions = [
    { actionId: "beat-action-a", actionType: allowed[0]!, sealedHash: digest("beat-a") },
    { actionId: "beat-action-b", actionType: allowed[1]!, sealedHash: digest("beat-b") },
  ];
  const compiler = new SangtianAuthoritativeBeatCompilerV1();
  const base = {
    routeHash: stored.snapshot.routeHash,
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageHash: loaded.manifest.contentSha256,
    chapterDefinition: descriptor.definition,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    decisionPointId: descriptor.decisions[0]!.decisionPointId,
    baseState: state,
    baseStateFingerprint: workingSet.stateFingerprint,
  };
  const first = compiler.compile({ ...base, actions });
  const reversed = compiler.compile({ ...base, actions: [...actions].reverse() });
  assert.equal(first.artifactHash, reversed.artifactHash);
  assert.equal(first.actionSetHash, reversed.actionSetHash);
  assert.equal(JSON.stringify(first.authoredBeatResult).includes("worldSequence"), false);
  assert.deepEqual(first.authoredBeatResult.workingDelta.setFacts, {
    "chapter.N1.weir_crisis.closed": true,
  });
  assert.match(first.authoredBeatResult.resultHash, /^[A-F0-9]{64}$/u);
  assert.doesNotThrow(() => completePressureBeat(
    descriptor.definition,
    state,
    first.authoredBeatResult,
  ));
  const rebound = compiler.compile({
    ...base,
    actions: [
      { ...actions[0]!, actionType: actions[1]!.actionType },
      { ...actions[1]!, actionType: actions[0]!.actionType },
    ],
  });
  assert.notEqual(first.actionSetHash, rebound.actionSetHash);
});

test("frozen content default submits one server-authored formal action", async () => {
  const stored = await storedRoute();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const descriptor = await content.load({ routeSnapshot: stored.snapshot, chapterId: "N1" });
  const projection = workingProjection(stored, descriptor);
  const decision = descriptor.decisions[0]!;
  const captured: SubmitFormalInteractionCommandV1[] = [];
  const adapter = new SangtianDeterministicDefaultActionAdapterV1(
    content,
    { load: async () => cloneProjection(projection) },
    { authorize: async () => ({ subjectId: "pressure-system-default", controlEpoch: 1 }) },
    {
      submit: async (command) => {
        captured.push(structuredClone(command));
        return {
          status: "ACCEPTED" as const,
          event: {
            schemaVersion: "pressure_working_ledger_event_v1" as const,
            runId: RUN_ID,
            chapterRuntimeId: CHAPTER_RUNTIME_ID,
            chapterId: "N1" as const,
            sequence: 2,
            previousEventHash: digest("previous"),
            payload: {
              eventType: "FORMAL_ACTION_ACCEPTED" as const,
              routeHash: stored.snapshot.routeHash,
              inputFingerprint: command.inputFingerprint,
              action: structuredClone(command.action),
              intent: structuredClone(command.intent),
              audienceSeatIds: [ACTOR],
            },
            eventHash: digest("default-event"),
          },
        };
      },
    },
  );
  const result = await adapter.submit({
    routeSnapshot: stored.snapshot,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    chapterId: "N1",
    decisionPointId: decision.decisionPointId,
    seatId: ACTOR,
    expectedWorkingRevision: 0,
    policy: decision.execution.absenceDefaultPolicy,
    reason: "DEADLINE",
    idempotencyKey: "pressure-default-integration-v1",
  });
  assert.equal(result.status, "ACCEPTED");
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.action.actionType, "DEFAULT_PASS");
  assert.deepEqual(captured[0]!.action.payload, { reason: "ABSENT" });
  assert.equal(captured[0]!.action.controlEpoch, 1);
});

test("content-owned policy compiles sealed identities and ignores payload rule fields", async () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  const world = compileInitialWorldState(loaded);
  const release = loadPublishedSangtianActionReleaseV1();
  const chapterInputs: Array<Parameters<
    typeof release.compileChapterActionEffects
  >[0]> = [];
  const aggregationModes: string[] = [];
  const adapter = new SangtianContentOwnedChapterPolicyAdapterV1({
    ...release,
    compileChapterActionEffects: (input) => {
      chapterInputs.push(structuredClone(input));
      const result = release.compileChapterActionEffects(input);
      aggregationModes.push(result.aggregationMode);
      return result;
    },
  });
  const first = b0Input(world.stateHash, world.worldSequence, "MIXED");
  const draft = await adapter.evaluateChapter({ b0Input: first, baseWorldState: world });
  const sealed = sealB0ChapterPolicyEvaluationV1(draft);
  assert.equal(sealed.b0InputHash, first.b0InputHash);
  assert.equal(sealed.contentPolicyVersion, first.wireInput.contentPolicyVersion);
  const outcomeMutation = sealed.mutations.find(
    (mutation) => mutation.entityId === "chapter.N1.outcome_band",
  );
  assert.ok(outcomeMutation);
  assert.equal(
    (outcomeMutation.value as { after?: unknown }).after,
    "HIGH",
  );
  assert.equal(sealed.trackDelta && typeof sealed.trackDelta === "object", true);
  assert.equal(chapterInputs[0]!.defaultEvents.length, 0);
  assert.equal(aggregationModes[0], "ACTION_CONTRIBUTIONS");

  const allDefault = b0Input(world.stateHash, world.worldSequence, "ALL_DEFAULT");
  await adapter.evaluateChapter({ b0Input: allDefault, baseWorldState: world });
  assert.equal(chapterInputs[1]!.defaultEvents.length, 1);
  assert.equal(aggregationModes[1], "DEFAULT_TRAJECTORY_ONCE");

  const unknown = b0Input(world.stateHash, world.worldSequence, "UNKNOWN_ACTION");
  await assert.rejects(
    () => adapter.evaluateChapter({ b0Input: unknown, baseWorldState: world }),
    (error: unknown) => (
      error instanceof PressureChapterIntegrationError
      && error.code === "INTEGRATION_CONTENT_MISMATCH"
      && error.path === "contentPolicy.actionEffects"
    ),
  );
});

function decisionCommand(
  stored: ApiStoredRunRouteRecordV1,
  decisionPointId: string,
  optionCode: string,
  submissionFenceToken: string,
): PressureChapterSubmitDecisionCommandV1 {
  return {
    schemaVersion: PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1,
    commandType: "SUBMIT_DECISION",
    runId: RUN_ID,
    routeHash: stored.snapshot.routeHash,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    chapterId: "N1",
    seatId: ACTOR,
    controlEpoch: 1,
    expectedWorkingRevision: 0,
    decisionPointId,
    submissionFenceToken,
    idempotencyKey: "decision-command-integration-v1",
    optionCode,
    customText: null,
    sourceEventId: null,
  };
}

function workingProjection(
  stored: ApiStoredRunRouteRecordV1,
  descriptor: AuthoredChapterRuntimeV1,
  chapterRuntimeId = CHAPTER_RUNTIME_ID,
): WorkingLedgerProjectionV1 {
  const state = createChapterWorkingState({
    runId: RUN_ID,
    chapterId: descriptor.chapterId,
  });
  const set = buildChapterWorkingSet(descriptor.definition, state);
  assert.ok(set);
  return {
    key: { runId: RUN_ID, chapterRuntimeId },
    chapterId: descriptor.chapterId,
    routeHash: stored.snapshot.routeHash,
    chapterDefinitionHash: sha256Canonical(descriptor.definition),
    headHash: digest("head"),
    headSequence: 1,
    state,
    stateHash: digest("working-state"),
    nextDecisionPin: pinChapterWorkingSet(set),
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

function cloneProjection(value: WorkingLedgerProjectionV1): WorkingLedgerProjectionV1 {
  return {
    ...structuredClone({
      ...value,
      acceptedActions: undefined,
      actionsByIdempotencyKey: undefined,
      appliedBeats: undefined,
      pendingReservations: undefined,
      commitments: undefined,
      evidenceRefsByAction: undefined,
      knowledgeBySeat: undefined,
      seatArcProgressBySeat: undefined,
    }),
    acceptedActions: new Map(value.acceptedActions),
    actionsByIdempotencyKey: new Map(value.actionsByIdempotencyKey),
    appliedBeats: new Map(value.appliedBeats),
    pendingReservations: new Map(value.pendingReservations),
    commitments: new Map(value.commitments),
    evidenceRefsByAction: new Map(value.evidenceRefsByAction),
    knowledgeBySeat: new Map(value.knowledgeBySeat),
    seatArcProgressBySeat: new Map(value.seatArcProgressBySeat),
  } as WorkingLedgerProjectionV1;
}

function gameProjection(
  stored: ApiStoredRunRouteRecordV1,
  decision: AuthoredChapterRuntimeV1["decisions"][number],
  option: string,
  submissionFenceToken: string,
): PressureChapterGameProjectionV1 {
  return {
    schemaVersion: "pressure_chapter_game_projection_v1",
    projectionVersion: 1,
    roomId: "room-1",
    runId: RUN_ID,
    route: {
      routeHash: stored.snapshot.routeHash,
      participantMode: "SOLO",
      runtimeProfile: stored.snapshot.route.runtimeProfile,
      contentPackageVersion: stored.snapshot.contentPackageVersion,
      controlTopologyVersion: stored.snapshot.controlTopologyVersion,
    },
    chapter: {
      chapterRuntimeId: CHAPTER_RUNTIME_ID,
      chapterId: "N1",
      chapterNumber: 1,
      title: "N1",
      phase: "ACTIVE",
      workingRevision: 0,
    },
    viewer: {
      seatId: ACTOR,
      roleName: "Actor",
      control: {
        mode: "HUMAN_ACTIVE",
        controlEpoch: 1,
        canSubmit: true,
        canReclaim: false,
        submissionFenceToken,
        reclaimFenceToken: null,
      },
    },
    metrics: [],
    situation: { goal: "goal", risk: "risk", judgment: "judgment" },
    resources: [],
    tokens: [],
    decision: {
      decisionPointId: decision.decisionPointId,
      mode: decision.execution.mode,
      requirement: "REQUIRED",
      title: "title",
      summary: "summary",
      expectedWorkingRevision: 0,
      options: [{
        code: option,
        label: "option",
        description: "option",
        actionType: option,
        preferredEntry: "PLAN",
      }],
      submitLabel: "submit",
      customActionAllowed: false,
    },
    capabilities: {
      canSubmitDecision: true,
      canTalk: true,
      canInvestigate: true,
      canUseToken: true,
      canPlan: true,
      canReclaimControl: false,
      allowedActionTypes: [option],
    },
    narrative: {
      status: "PENDING",
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: "source",
      sourceCommitHash: digest("source"),
      text: null,
      contentHash: null,
      renderMode: null,
    },
    feedPage: {
      schemaVersion: "a_emotion_feed_page_v1",
      roomId: "room-1",
      runId: RUN_ID,
      viewerSeatId: ACTOR,
      items: [],
      unreadCount: 0,
      nextCursor: null,
      serverSequence: 0,
    },
    projectionHash: digest("projection"),
  };
}

function investigationGameProjection(input: {
  stored: ApiStoredRunRouteRecordV1;
  decision: AuthoredChapterRuntimeV1["decisions"][number];
  actionType: string;
  disclosure: "HIDDEN" | "SUSPECTED";
  sourceEventId: string;
  chapterRuntimeId: string;
  submissionFenceToken: string;
  acknowledged: boolean;
}): PressureChapterGameProjectionV1 {
  const game = gameProjection(
    input.stored,
    input.decision,
    input.actionType,
    input.submissionFenceToken,
  );
  game.chapter = {
    chapterRuntimeId: input.chapterRuntimeId,
    chapterId: "N6",
    chapterNumber: 6,
    title: "N6",
    phase: "ACTIVE",
    workingRevision: 0,
  };
  game.viewer.seatId = "qingliu_law";
  game.viewer.roleName = "Qingliu Law";
  game.decision = {
    ...game.decision!,
    decisionPointId: input.decision.decisionPointId,
    options: [{
      code: input.actionType,
      label: input.actionType,
      description: input.actionType,
      actionType: input.actionType,
      preferredEntry: "INVESTIGATE",
    }],
  };
  game.capabilities.allowedActionTypes = [input.actionType];
  game.feedPage.viewerSeatId = "qingliu_law";
  game.feedPage.items = [{
    schemaVersion: "a_emotion_viewer_projection_v1",
    eventId: input.sourceEventId,
    projectionVersion: 3,
    roomId: game.roomId,
    runId: game.runId,
    viewerSeatId: "qingliu_law",
    category: "SUSPICIOUS",
    disclosure: input.disclosure,
    severity: "MAJOR",
    title: "Ledger source",
    safeSummary: "A viewer-safe ledger source summary.",
    statusLabel: input.disclosure,
    visibleImpacts: [],
    knownFactRefs: [],
    responseOptions: [{
      code: input.actionType,
      label: input.actionType,
      preferredEntry: "INVESTIGATE",
      consumesManeuverOnSubmit: true,
    }],
    recommendedPresentation: "CENTER_CARD",
    centerCard: null,
    keyModal: null,
    eventSequence: 8,
    occurredAt: "2026-08-12T00:00:00.000Z",
    projectionHash: digest(`${input.sourceEventId}-projection`),
    isUnread: false,
    isAcknowledged: input.acknowledged,
    isResolved: false,
  }];
  game.feedPage.serverSequence = 8;
  game.projectionHash = sha256Canonical({ game: "n6", eventId: input.sourceEventId });
  return game;
}

function b0Input(
  baseWorldStateHash: string,
  baseWorldSequence: number,
  mode: "MIXED" | "ALL_DEFAULT" | "UNKNOWN_ACTION",
) {
  const loaded = loadSangtianPressureChapterPackageV1();
  const evidenceRef = "evidence.N1.breach_chain";
  const mixedActionTypes = [
    "EVACUATE_WEIRS",
    "SUPPORT_WEIR",
    "SEAL_BREACH_RECORD",
    "DEFAULT_PASS",
    "DEFAULT_PASS",
    "DEFAULT_PASS",
  ];
  const actions: B0ChapterSettlementMaterialV1["actions"] =
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => {
      const actionType = mode === "ALL_DEFAULT"
        ? "DEFAULT_PASS"
        : mode === "UNKNOWN_ACTION" && index === 0
          ? "CLIENT_SUPPLIED_RULE_ACTION"
          : mixedActionTypes[index]!;
      const source = actionType === "DEFAULT_PASS" ? "DEFAULT" as const : "HUMAN" as const;
      const payload: CanonicalJsonValue = index === 0
        ? {
          optionCode: actionType,
          customText: null,
            settlementFacts: {
              evacuationCoveragePct: 0,
              criticalWeirsSecuredCount: 0,
              verifiedBreachRecordCount: 0,
              disasterSeverity: 4,
            },
        }
        : { optionCode: actionType, customText: null };
      return {
        actionId: `action-${index + 1}`,
        decisionPointId: "N1.weir_crisis",
        seatId,
        source,
        actionType,
        // Deliberately hostile legacy payload member: the adapter proves that
        // only the sealed identity above reaches the policy compiler.
        payload,
        resourceCommitments: [],
        evidenceRefs: [evidenceRef],
      };
    });
  const wireBase = {
    schemaVersion: "sangtian_chapter_settlement_input_v1" as const,
    runId: RUN_ID,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    chapterId: "N1" as const,
    baseWorldSequence,
    baseWorldStateHash,
    runRouteHash: digest("route-policy"),
    previousFrozenHash: digest("previous-policy"),
    decisionLedgerHash: digest("ledger-policy"),
    finalWorkingStateHash: digest("working-policy"),
    sealedDecisionActionIds: actions.map((action) => action.actionId),
    reservationLedgerHash: digest("reservation-policy"),
    contentPolicyVersion: loaded.content.chapters[0]!.settlementPolicy.policyVersion,
    contentPolicyHash: sha256Canonical(loaded.content.chapters[0]!.settlementPolicy),
    settlementContractVersion: "b0.settlement.v1",
    settlementContractHash: digest("b0-contract"),
  };
  const wireInput: SealedChapterSettlementInputV1 = {
    ...wireBase,
    inputHash: sha256Canonical(wireBase),
  };
  const material: B0ChapterSettlementMaterialV1 = {
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => {
      const isDefault = actions[index]!.source === "DEFAULT";
      return {
        seatId,
        requirement: "REQUIRED" as const,
        completion: isDefault ? "DEFAULTED" as const : "SEALED_ACTIONS" as const,
        defaultCodes: isDefault ? ["ABSENCE_DEFAULT_PASS"] : [],
      };
    }),
    resources: [
      { resourceId: "resource.credit", quantity: 100, version: 1 },
      { resourceId: "resource.grain", quantity: 100, version: 1 },
      { resourceId: "resource.troops", quantity: 100, version: 1 },
    ],
    actions,
  };
  return compileB0ChapterSettlementInputV1({ wireInput, settlementMaterial: material });
}
