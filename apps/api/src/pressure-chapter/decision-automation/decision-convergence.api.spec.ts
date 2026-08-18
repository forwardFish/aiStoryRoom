import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type ParticipantModeV1,
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
import {
  appendBeatEventToWorkingLedgerProjection,
  workingStateHash,
} from "../working-ledger/working-ledger";
import type {
  DecisionAutomationTaskV1,
  DecisionConvergenceDependenciesV1,
  PreparedAutomationActionBatchResultV1,
  PreparedAutomationActionBatchV1,
} from "./contracts";
import { PressureAiDecisionCommandCompilerV1 } from "./compiler";
import {
  PressureDecisionConvergenceServiceV1,
  withDecisionConvergenceSnapshotHashV1,
} from "./convergence.service";
import { PublishedSangtianAiDecisionPolicyAdapterV1 } from "./content-policy.adapter";
import {
  AcceptedBeatSubmitAuthorityAdapterV1,
  AcceptedNpcCouncilDecisionPolicyAdapterV1,
} from "./mc-authority.adapters";
import { planPreparedActionLedgerV1 } from "./prepared-action-batch";
import { withDecisionAutomationTaskHashV1 } from "./service";

const NOW = 1_900_000_000_000;
const loaded = loadSangtianPressureChapterPackageV1();
const INTERMEDIATE_DECISION = "N1.weir_crisis";
const FINAL_DECISION = "N1.final_dispatch";

test("MC intermediate Beat commits only the submitting human and performs zero NPC/Settlement work", async () => {
  const harness = await McHarness.create({ decisionPointId: INTERMEDIATE_DECISION });
  const result = await harness.service.converge(harness.httpCommand());

  assert.equal(result.outcome, "BATCH_COMPLETED");
  assert.equal(harness.batchCalls, 1);
  assert.equal(harness.batches[0]?.mcAuthority?.beatSubmit.plan.mode, "INTERMEDIATE_ACTION_ONLY");
  assert.deepEqual(harness.batches[0]?.actions.map((item) => item.authority.actorKind), ["HUMAN"]);
  assert.equal(harness.batches[0]?.beatPlan.settlementInput, null);
  assert.equal(harness.batches[0]?.beatPlan.postBeatOrchestratorState.phase, "ACTIVE");
  assert.ok((harness.batches[0]?.beatPlan.narrativeJobs.length ?? 0) > 0);
  assert.equal(harness.npcPolicyCalls, 0);
  assert.equal(harness.npcCompileCalls, 0);
  assert.equal(harness.actionWrites, 1);
  assert.equal(harness.npcActionWrites, 0);
  assert.equal(harness.settlementCalls, 0);
  assert.equal(result.metrics.policyCallCount, 0);
  assert.equal(result.metrics.compileCount, 0);
  assert.equal(result.metrics.npcWriteCount, 0);
  assert.equal(result.metrics.resumeCount, 0);
  assert.equal(result.metrics.fastSettlementResumeCalls, 0);
  assert.equal(result.metrics.providerCallCount, 0);
});

test("MC intermediate multiplayer Beat still submits one MA-authorized human and does not fill pending humans or NPCs", async () => {
  const humanSeats = PRESSURE_CHAPTER_SEAT_IDS_V1.slice(0, 3);
  const harness = await McHarness.create({
    decisionPointId: INTERMEDIATE_DECISION,
    humanSeats,
  });
  const result = await harness.service.converge(harness.httpCommand());

  assert.equal(result.outcome, "BATCH_COMPLETED");
  assert.deepEqual(
    harness.batches[0]?.actions.map((item) => item.command.action.seatId),
    [humanSeats[0]],
  );
  assert.equal(harness.npcPolicyCalls, 0);
  assert.equal(harness.npcCompileCalls, 0);
  assert.equal(harness.npcActionWrites, 0);
  const resolving = harness.batches[0]!.nextOrchestratorState.activeDecision!;
  assert.equal(resolving.seats.find((seat) => seat.seatId === humanSeats[1])?.requirement, "NOT_REQUIRED");
  assert.equal(resolving.seats.find((seat) => seat.seatId === humanSeats[2])?.requirement, "NOT_REQUIRED");
});

test("MC final Beat resolves only MA-planned NPCs with final MB and commits one canonical batch", async () => {
  const harness = await McHarness.create({ decisionPointId: FINAL_DECISION });
  const result = await harness.service.converge(harness.httpCommand());
  const batch = harness.batches[0]!;
  const plan = batch.mcAuthority!.beatSubmit.plan;

  assert.equal(result.outcome, "BATCH_COMPLETED");
  assert.equal(harness.batchCalls, 1);
  assert.equal(plan.mode, "CHAPTER_COUNCIL_COMMIT");
  assert.equal(plan.invokeSettlement, true);
  assert.deepEqual(plan.humanSubmissionSeatIds, [harness.viewerSeatId]);
  assert.deepEqual(
    plan.npcResolutionSeatIds,
    PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => seatId !== harness.viewerSeatId),
  );
  assert.equal(batch.actions.length, 6);
  assert.equal(batch.actions.filter((item) => item.authority.actorKind === "HUMAN").length, 1);
  assert.equal(batch.actions.filter((item) => item.authority.actorKind === "AI").length, 5);
  assert.equal(batch.mcAuthority!.npcDecisions.length, 5);
  for (const prepared of batch.mcAuthority!.npcDecisions) {
    assert.equal(prepared.input.schemaVersion, "sangtian_npc_decision_policy_input_v1");
    assert.equal(prepared.resolution.schemaVersion, "sangtian_npc_decision_resolution_v1");
    assert.equal(prepared.resolution.inputHash, prepared.input.inputHash);
    assert.equal(prepared.resolution.providerCallCount, 0);
    assert.equal(sha256Canonical(stripHash(prepared.resolution, "resolutionHash")), prepared.resolution.resolutionHash);
    const action = batch.actions.find((item) => item.command.action.seatId === prepared.seatId)!;
    assert.equal(action.authority.expectedNpcResolutionHash, prepared.resolution.resolutionHash);
    assert.equal((action.command.action.payload as Record<string, unknown>).resolutionHash, prepared.resolution.resolutionHash);
  }
  assert.ok(batch.beatPlan.settlementInput);
  assert.equal(batch.beatPlan.postBeatOrchestratorState.phase, "SETTLING");
  assert.equal(harness.npcPolicyCalls, 5);
  assert.equal(harness.npcCompileCalls, 5);
  assert.equal(harness.actionWrites, 6);
  assert.equal(harness.npcActionWrites, 5);
  assert.equal(harness.settlementCalls, 1);
  assert.equal(harness.resumeCalls, 0);
  assert.equal(harness.fastSettlementResumeCalls, 1);
  assert.equal(result.metrics.appendTxCount, 1);
  assert.equal(result.metrics.npcWriteCount, 5);
  assert.equal(result.metrics.resumeCount, 1);
  assert.equal(result.metrics.fastSettlementResumeCalls, 1);
  assert.equal(result.metrics.providerCallCount, 0);
});

test("MC action-only recovery reproduces final MB identity and completes without duplicate actions", async () => {
  const harness = await McHarness.create({ decisionPointId: FINAL_DECISION });
  harness.batchMode = "CONFLICT";
  const first = await harness.service.converge(harness.httpCommand());
  assert.equal(first.outcome, "STALE_SKIPPED");
  const firstBatch = structuredClone(harness.batches[0]!);
  harness.seedAcceptedActions(firstBatch);
  harness.resetExecutionCounters();
  harness.batchMode = "COMMIT";

  const recovered = await harness.service.converge(harness.recoveryCommand());
  const recoveredBatch = harness.batches[0]!;

  assert.equal(recovered.outcome, "BATCH_COMPLETED");
  assert.equal(harness.batchCalls, 1);
  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.npcActionWrites, 0);
  assert.equal(harness.settlementCalls, 1);
  assert.deepEqual(
    recoveredBatch.mcAuthority?.npcDecisions.map((item) => item.resolution.resolutionHash),
    firstBatch.mcAuthority?.npcDecisions.map((item) => item.resolution.resolutionHash),
    "action-only recovery must reproduce the exact final MB identities",
  );
  assert.deepEqual(
    recoveredBatch.actions.map((item) => item.command.action.actionId),
    firstBatch.actions.map((item) => item.command.action.actionId),
  );
  assert.equal(recovered.metrics.npcWriteCount, 0);
  assert.equal(recovered.metrics.fastSettlementResumeCalls, 1);
});

test("MC complete batch replay produces no second action, Narrative, or Settlement", async () => {
  const harness = await McHarness.create({ decisionPointId: FINAL_DECISION });
  harness.batchMode = "CONFLICT";
  await harness.service.converge(harness.httpCommand());
  const firstBatch = structuredClone(harness.batches[0]!);
  harness.seedAcceptedActions(firstBatch);
  harness.resetExecutionCounters();
  harness.batchMode = "REPLAY";

  const replay = await harness.service.converge(harness.httpCommand());

  assert.equal(replay.outcome, "BATCH_COMPLETED");
  assert.equal(harness.batchCalls, 1, "one idempotent repository check, never a second write batch");
  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.npcActionWrites, 0);
  assert.equal(harness.narrativeWrites, 0);
  assert.equal(harness.settlementCalls, 0);
  assert.equal(harness.resumeCalls, 0);
  assert.equal(harness.fastSettlementResumeCalls, 0);
  assert.equal(replay.metrics.npcWriteCount, 0);
  assert.equal(replay.metrics.resumeCount, 0);
  assert.equal(replay.metrics.fastSettlementResumeCalls, 0);
});

test("MC batch conflict is atomic and never resumes or exposes partial action success", async () => {
  const harness = await McHarness.create({ decisionPointId: FINAL_DECISION });
  harness.batchMode = "CONFLICT";
  const result = await harness.service.converge(harness.httpCommand());

  assert.equal(result.outcome, "STALE_SKIPPED");
  assert.deepEqual(result.actionIds, []);
  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.narrativeWrites, 0);
  assert.equal(harness.settlementCalls, 0);
  assert.equal(result.metrics.resumeCount, 0);
  assert.equal(result.metrics.fastSettlementResumeCalls, 0);
});

test("MC rejects tampered MA, MB identity, and human control epoch before the production batch port", async () => {
  {
    const harness = await McHarness.create({ decisionPointId: INTERMEDIATE_DECISION });
    const accepted = harness.dependencies.beatSubmitAuthority;
    harness.dependencies.beatSubmitAuthority = {
      resolve(input) {
        const resolved = structuredClone(accepted.resolve(input));
        resolved.plan.invokeSettlement = true;
        return resolved;
      },
    };
    await assert.rejects(
      () => harness.service.converge(harness.httpCommand()),
      /Prepared MA authority binding is invalid|INTERMEDIATE/u,
    );
    assert.equal(harness.batchCalls, 0);
  }
  {
    const harness = await McHarness.create({ decisionPointId: FINAL_DECISION });
    const accepted = harness.dependencies.npcCouncilPolicy;
    harness.dependencies.npcCouncilPolicy = {
      artifactSha256: accepted.artifactSha256,
      identityPolicyArtifactSha256: accepted.identityPolicyArtifactSha256,
      resolve(input) {
        const resolved = structuredClone(accepted.resolve(input));
        resolved.resolution.resolutionHash = digest("tampered-final-mb");
        return resolved;
      },
    };
    await assert.rejects(
      () => harness.service.converge(harness.httpCommand()),
      /FINAL_MB_AUTHORITY_BINDING_MISMATCH|Prepared NPC decision binding is invalid/u,
    );
    assert.equal(harness.batchCalls, 0);
  }
  {
    const harness = await McHarness.create({ decisionPointId: INTERMEDIATE_DECISION });
    const command = harness.humanCommand();
    command.action.controlEpoch += 1;
    const withoutSealed = stripHash(command.action, "sealedHash");
    const withoutRequest = stripHash(withoutSealed, "requestFingerprint");
    command.action.requestFingerprint = computeDecisionActionRequestFingerprint(withoutRequest);
    command.action.sealedHash = sha256Canonical(stripHash(command.action, "sealedHash"));
    command.inputFingerprint = computeFormalInteractionInputFingerprint(command);
    await assert.rejects(
      () => harness.service.converge(harness.httpCommand(command)),
      (error: unknown) => Boolean(
        error
        && typeof error === "object"
        && "details" in error
        && (error as { details?: { detail?: unknown } }).details?.detail
          === "AUTHORITY_BINDING_MISMATCH",
      ),
    );
    assert.equal(harness.batchCalls, 0);
  }
});

test("MC recovery worker remains decision-scoped and uses the same convergence service", async () => {
  const harness = await McHarness.create({ decisionPointId: INTERMEDIATE_DECISION });
  const command = harness.humanCommand();
  harness.seedAcceptedActionsFromCommands([command]);
  harness.scannerTasks = harness.makeScannerTasks();

  const result = await harness.service.tick("mc-recovery-worker");

  assert.equal(result.kind, "ACKNOWLEDGED");
  assert.equal(harness.scans, 1);
  assert.equal(harness.snapshotReads, 1);
  assert.equal(harness.batchCalls, 1);
  assert.equal(harness.npcPolicyCalls, 0);
  assert.equal(harness.npcCompileCalls, 0);
  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.settlementCalls, 0);
});

test("MC expired decisions remain delegated to the authority-first deadline coordinator", async () => {
  const harness = await McHarness.create({ decisionPointId: INTERMEDIATE_DECISION });
  harness.deadlineAtMs = NOW;
  const result = await harness.service.converge(harness.httpCommand());

  assert.equal(result.outcome, "DEADLINE_ADVANCED");
  assert.equal(harness.deadlineCalls, 1);
  assert.equal(harness.batchCalls, 0);
  assert.equal(harness.npcPolicyCalls, 0);
  assert.equal(harness.settlementCalls, 0);
});

test("MC production dependency graph exposes no Provider, model, Narrative writer, or parallel action writer", async () => {
  const harness = await McHarness.create({ decisionPointId: INTERMEDIATE_DECISION });
  assert.deepEqual(Object.keys(harness.dependencies).sort(), [
    "beatSubmitAuthority",
    "clock",
    "compiler",
    "content",
    "deadlineDefaults",
    "diagnostics",
    "npcCouncilPolicy",
    "policy",
    "preparedActions",
    "runtime",
    "scanner",
    "snapshots",
  ].sort());
});

type BatchMode = "COMMIT" | "REPLAY" | "CONFLICT";

class McHarness {
  readonly content = new SangtianAuthoredChapterContentAdapterV1();
  readonly dependencies: DecisionConvergenceDependenciesV1;
  readonly service: PressureDecisionConvergenceServiceV1;
  readonly batches: PreparedAutomationActionBatchV1[] = [];
  scannerTasks: DecisionAutomationTaskV1[] = [];
  batchMode: BatchMode = "COMMIT";
  deadlineAtMs: number | null = NOW + 300_000;
  scans = 0;
  snapshotReads = 0;
  batchCalls = 0;
  actionWrites = 0;
  npcActionWrites = 0;
  narrativeWrites = 0;
  npcPolicyCalls = 0;
  npcCompileCalls = 0;
  resumeCalls = 0;
  fastSettlementResumeCalls = 0;
  settlementCalls = 0;
  deadlineCalls = 0;
  projection: WorkingLedgerProjectionV1;

  private constructor(
    readonly route: RunRouteSnapshotV1,
    readonly descriptor: AuthoredChapterRuntimeV1,
    readonly chapter: ChapterOrchestratorStateV1,
    projection: WorkingLedgerProjectionV1,
    readonly seatAuthority: SeatControlSnapshotV1,
  ) {
    this.projection = projection;
    const legacyPolicy = new PublishedSangtianAiDecisionPolicyAdapterV1();
    const acceptedNpcPolicy = new AcceptedNpcCouncilDecisionPolicyAdapterV1();
    const actualCompiler = new PressureAiDecisionCommandCompilerV1(
      new SangtianServerDecisionWorkingIntentCompilerV1(),
    );
    this.dependencies = {
      scanner: {
        scanActive: async () => {
          this.scans += 1;
          return structuredClone(this.scannerTasks);
        },
      },
      snapshots: {
        capture: async () => {
          this.snapshotReads += 1;
          const { orchestratorHash: _ignored, ...body } = structuredClone(this.chapter);
          if (body.activeDecision) body.activeDecision.deadlineAtMs = this.deadlineAtMs;
          const chapter = withOrchestratorHashV1(body);
          return withDecisionConvergenceSnapshotHashV1({
            schemaVersion: "pressure_decision_convergence_authority_snapshot_v1",
            routeSnapshot: structuredClone(this.route),
            chapter,
            projection: cloneProjection(this.projection),
            seatAuthority: structuredClone(this.seatAuthority),
            aiPolicyArtifactHash: legacyPolicy.artifactSha256,
            capturedAtMs: NOW,
          });
        },
        loadWorkingProjection: async () => cloneProjection(this.projection),
      },
      content: { load: async () => structuredClone(this.descriptor) },
      beatSubmitAuthority: new AcceptedBeatSubmitAuthorityAdapterV1(),
      npcCouncilPolicy: {
        artifactSha256: acceptedNpcPolicy.artifactSha256,
        identityPolicyArtifactSha256: acceptedNpcPolicy.identityPolicyArtifactSha256,
        resolve: (input) => {
          this.npcPolicyCalls += 1;
          return acceptedNpcPolicy.resolve(input);
        },
      },
      policy: {
        artifactSha256: legacyPolicy.artifactSha256,
        select: () => {
          throw new Error("legacy per-seat policy must not run in MC convergence");
        },
      },
      compiler: {
        compile: () => {
          throw new Error("legacy per-seat compiler must not run in MC convergence");
        },
        compileNpcDecision: (input) => {
          this.npcCompileCalls += 1;
          return actualCompiler.compileNpcDecision(input);
        },
      },
      preparedActions: {
        submitPrepared: async () => {
          throw new Error("production MC must use submitPreparedBatch");
        },
        submitPreparedBatch: async (batch) => this.submitBatch(batch),
      },
      runtime: {
        resume: async () => {
          this.resumeCalls += 1;
          return structuredClone(this.chapter);
        },
        resumeFromCommittedSettlementAuthority: async (_route, authority) => {
          this.fastSettlementResumeCalls += 1;
          this.settlementCalls += 1;
          return structuredClone(authority.state);
        },
      },
      deadlineDefaults: {
        advanceExpiredDecision: async () => {
          this.deadlineCalls += 1;
          return { kind: "APPLIED" as const, state: structuredClone(this.chapter) };
        },
        applyAiFailure: async () => {
          throw new Error("MC deterministic council has no Provider failure default");
        },
      },
      diagnostics: { record: () => undefined },
      clock: { nowMs: () => NOW },
    };
    this.service = new PressureDecisionConvergenceServiceV1(this.dependencies, {
      retryMs: 10,
    });
  }

  static async create(input: Readonly<{
    decisionPointId: typeof INTERMEDIATE_DECISION | typeof FINAL_DECISION;
    humanSeats?: readonly SeatIdV1[];
  }>): Promise<McHarness> {
    const humanSeats = input.humanSeats ?? [PRESSURE_CHAPTER_SEAT_IDS_V1[0]!];
    const route = makeRoute(humanSeats, input.decisionPointId);
    const content = new SangtianAuthoredChapterContentAdapterV1();
    const descriptor = await content.load({ routeSnapshot: route, chapterId: "N1" });
    const decision = descriptor.decisions.find(
      (candidate) => candidate.decisionPointId === input.decisionPointId,
    );
    assert.ok(decision, `missing authored decision ${input.decisionPointId}`);
    const working = createWorkingStateForDecision(descriptor, input.decisionPointId, route.runId);
    const workingSet = buildChapterWorkingSet(descriptor.definition, working);
    assert.ok(workingSet);
    assert.equal(workingSet.decisionPoint.decisionPointId, input.decisionPointId);
    const chapter = withOrchestratorHashV1({
      schemaVersion: "pressure_chapter_orchestrator_state_v1",
      runId: route.runId,
      routeHash: route.routeHash,
      revision: 7,
      phase: "ACTIVE",
      currentChapterId: "N1",
      chapterRuntimeId: `chapter-N1-${digest(route.runId).slice(0, 12)}`,
      descriptorHash: descriptor.descriptorHash,
      authorityBase: {
        baseWorldSequence: 0,
        baseWorldStateHash: digest("world"),
        previousFrozenHash: digest("genesis"),
      },
      activeDecision: {
        decisionPointId: decision.decisionPointId,
        policyHash: sha256Canonical(decision),
        openedAtMs: NOW - 1_000,
        deadlineAtMs: NOW + 300_000,
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
      headHash: digest(`opening:${route.runId}:${input.decisionPointId}`),
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
    return new McHarness(
      route,
      descriptor,
      chapter,
      projection,
      makeSeatSnapshot(route),
    );
  }

  get viewerSeatId(): SeatIdV1 {
    return this.route.humanSeatIdsAtStart[0]! as SeatIdV1;
  }

  humanCommand(): SubmitOrchestratedActionCommandV1 {
    const authority = this.seatAuthority.seatControls.find(
      (item) => item.seatId === this.viewerSeatId,
    )!;
    const decision = this.descriptor.decisions.find(
      (item) => item.decisionPointId === this.chapter.activeDecision!.decisionPointId,
    )!;
    const actionType = decision.execution.allowedActionTypes.find(
      (candidate) => candidate !== "DEFAULT_PASS",
    ) ?? "DEFAULT_PASS";
    const idempotencyKey = `human-action:${this.route.runId}:${this.viewerSeatId}`;
    const actionId = `action_${digest(idempotencyKey)}`;
    const payload = { optionCode: actionType, customText: null };
    const actionBase = {
      schemaVersion: "sangtian_decision_action_v1" as const,
      actionId,
      runId: this.route.runId,
      chapterRuntimeId: this.chapter.chapterRuntimeId,
      chapterId: this.chapter.currentChapterId,
      decisionPointId: this.chapter.activeDecision!.decisionPointId,
      seatId: this.viewerSeatId,
      actionOrdinal: 1,
      actionRevision: 1,
      controlEpoch: authority.controlEpoch,
      expectedWorkingRevision: this.projection.state.revision,
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
      routeHash: this.route.routeHash,
      chapterRuntimeId: this.chapter.chapterRuntimeId,
      chapterId: this.chapter.currentChapterId,
      decisionPointId: this.chapter.activeDecision!.decisionPointId,
      seatId: this.viewerSeatId,
      actionType,
    });
    const body = {
      routeSnapshot: structuredClone(this.route),
      subjectId: authority.activeControllerId,
      action,
      intent,
      nowMs: NOW,
    };
    return {
      ...body,
      inputFingerprint: computeFormalInteractionInputFingerprint(body),
    };
  }

  httpCommand(humanAction = this.humanCommand()) {
    return {
      trigger: "HTTP_POST_SUBMIT" as const,
      runId: this.route.runId,
      expectedRouteHash: this.route.routeHash,
      source: {
        chapterRuntimeId: this.chapter.chapterRuntimeId,
        chapterId: this.chapter.currentChapterId,
        decisionPointId: this.chapter.activeDecision!.decisionPointId,
      },
      nowMs: NOW,
      humanSubmitMs: 2,
      humanAction,
    };
  }

  recoveryCommand() {
    return {
      trigger: "RECOVERY" as const,
      runId: this.route.runId,
      expectedRouteHash: this.route.routeHash,
      source: {
        chapterRuntimeId: this.chapter.chapterRuntimeId,
        chapterId: this.chapter.currentChapterId,
        decisionPointId: this.chapter.activeDecision!.decisionPointId,
      },
      nowMs: NOW,
      humanSubmitMs: 0,
      humanAction: null,
    };
  }

  makeScannerTasks(): DecisionAutomationTaskV1[] {
    return this.chapter.activeDecision!.seats.map((seat) => {
      const authority = this.seatAuthority.seatControls.find(
        (item) => item.seatId === seat.seatId,
      )!;
      return withDecisionAutomationTaskHashV1({
        schemaVersion: "pressure_decision_automation_task_v1",
        runId: this.route.runId,
        routeHash: this.route.routeHash,
        chapterRuntimeId: this.chapter.chapterRuntimeId,
        chapterId: this.chapter.currentChapterId,
        decisionPointId: this.chapter.activeDecision!.decisionPointId,
        seatId: seat.seatId,
        expectedOrchestratorRevision: this.chapter.revision,
        expectedWorkingRevision: this.projection.state.revision,
        expectedControlEpoch: authority.controlEpoch,
        expectedControllerMode: authority.mode,
        expectedDeadlineAtMs: this.deadlineAtMs,
        expectedSeatAuthorityStateHash: this.seatAuthority.stateHash,
      });
    }).sort((left, right) => (
      Number(left.expectedControllerMode === "HUMAN_ACTIVE")
        - Number(right.expectedControllerMode === "HUMAN_ACTIVE")
      || left.seatId.localeCompare(right.seatId)
    ));
  }

  seedAcceptedActions(batch: PreparedAutomationActionBatchV1): void {
    this.seedAcceptedActionsFromCommands(batch.actions.map((item) => item.command));
  }

  seedAcceptedActionsFromCommands(commands: readonly SubmitOrchestratedActionCommandV1[]): void {
    const actions = commands.map((command) => ({
      command: structuredClone(command),
      authority: {} as PreparedAutomationActionBatchV1["actions"][number]["authority"],
    }));
    this.projection = planPreparedActionLedgerV1({
      projection: this.projection,
      actions,
    }).projection;
  }

  resetExecutionCounters(): void {
    this.batches.length = 0;
    this.batchCalls = 0;
    this.actionWrites = 0;
    this.npcActionWrites = 0;
    this.narrativeWrites = 0;
    this.npcPolicyCalls = 0;
    this.npcCompileCalls = 0;
    this.resumeCalls = 0;
    this.fastSettlementResumeCalls = 0;
    this.settlementCalls = 0;
  }

  private async submitBatch(
    batch: PreparedAutomationActionBatchV1,
  ): Promise<PreparedAutomationActionBatchResultV1> {
    this.batchCalls += 1;
    this.batches.push(structuredClone(batch));
    const actionIds = batch.actions.map((item) => item.command.action.actionId);
    if (this.batchMode === "CONFLICT") {
      return {
        status: "CONFLICT",
        batchId: batch.batchId,
        actionIds: [],
        replayedActionIds: [],
        eventHashes: [],
        ledgerHeadHash: this.projection.headHash,
        orchestratorState: structuredClone(batch.beatPlan.postBeatOrchestratorState),
        projection: null,
        conflictReason: "HEAD_CONFLICT",
      };
    }
    if (this.batchMode === "REPLAY") {
      return {
        status: "REPLAYED",
        batchId: batch.batchId,
        actionIds,
        replayedActionIds: actionIds,
        eventHashes: [batch.beatPlan.event.eventHash],
        ledgerHeadHash: batch.beatPlan.event.eventHash,
        orchestratorState: structuredClone(batch.beatPlan.postBeatOrchestratorState),
        projection: cloneProjection(this.projection),
        conflictReason: null,
      };
    }
    const newActions = batch.actions.filter((item) => (
      !this.projection.acceptedActions.has(item.command.action.actionId)
    ));
    const actionPlan = planPreparedActionLedgerV1({
      projection: this.projection,
      actions: newActions,
    });
    const postBeat = appendBeatEventToWorkingLedgerProjection(
      actionPlan.projection,
      batch.beatPlan.event,
    );
    this.actionWrites += newActions.length;
    this.npcActionWrites += newActions.filter(
      (item) => item.authority.actorKind === "AI",
    ).length;
    this.narrativeWrites += batch.beatPlan.narrativeJobs.length;
    this.projection = postBeat;
    return {
      status: "COMMITTED",
      batchId: batch.batchId,
      actionIds,
      replayedActionIds: batch.actions
        .filter((item) => !newActions.includes(item))
        .map((item) => item.command.action.actionId),
      eventHashes: [
        ...actionPlan.events.map((event) => event.eventHash),
        batch.beatPlan.event.eventHash,
      ],
      ledgerHeadHash: batch.beatPlan.event.eventHash,
      orchestratorState: structuredClone(batch.beatPlan.postBeatOrchestratorState),
      projection: cloneProjection(postBeat),
      conflictReason: null,
    };
  }
}

function createWorkingStateForDecision(
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
  state.lastBeatId = targetIndex > 0
    ? `fixture-beat-${targetIndex}`
    : null;
  return state;
}

function makeRoute(
  humanSeats: readonly SeatIdV1[],
  decisionPointId: string,
): RunRouteSnapshotV1 {
  const participantMode: ParticipantModeV1 = humanSeats.length === 1
    ? "SOLO"
    : "MULTIPLAYER";
  const topologyBody = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure-control-topology-v1",
    participantMode,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humanSeats.includes(seatId)
        ? "HUMAN_ACTIVE" as const
        : "AI_ACTIVE" as const,
    })),
  };
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: `run-mc-${decisionPointId.replaceAll(".", "-")}-${humanSeats.length}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-test-v1",
    testMatrixSha256: digest("test"),
    runSeed: `seed-${decisionPointId}-${humanSeats.length}`,
    narrativeProfileVersion: "pressure-narrative-v1",
    featureSetVersion: "pressure-features-v1",
    resultContractRegistryVersion: "pressure-result-v1",
    participantMode,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [...humanSeats],
    controlTopologyVersion: topologyBody.controlTopologyVersion,
    initialRoleControlSnapshotHash: sha256Canonical(topologyBody),
  });
}

function makeSeatSnapshot(route: RunRouteSnapshotV1): SeatControlSnapshotV1 {
  const humans = new Set(route.humanSeatIdsAtStart);
  const frozenPolicyBody = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "pressure-seat-control-v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline-v1",
    takeoverDeadlinePolicyHash: digest("deadline-policy"),
    deterministicDefaultPolicyRef: "default-v1",
    deterministicDefaultPolicyHash: digest("default-policy"),
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
        submissionFenceToken: digest(`submit:${seatId}`),
        reclaimFenceToken: human ? digest(`reclaim:${seatId}`) : null,
        lastAuthorityEventHash: digest(`authority:${seatId}`),
      };
    },
  );
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

function cloneProjection(value: WorkingLedgerProjectionV1): WorkingLedgerProjectionV1 {
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

function stripHash<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const clone = structuredClone(value) as T;
  delete (clone as Record<PropertyKey, unknown>)[key as PropertyKey];
  return clone as Omit<T, K>;
}

function digest(value: unknown): string {
  return sha256Canonical(value);
}
