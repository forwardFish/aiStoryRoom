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
import { recordPressureDecisionCommittedAuthorityV1 } from "../observability/decision-convergence-timing";
import type {
  AiDecisionPolicyInputV1,
  AiDecisionPolicySelectionV1,
  AppendPreparedAutomationActionCommandV1,
  DecisionAutomationTaskV1,
  DecisionConvergenceDependenciesV1,
  PreparedAutomationActionBatchV1,
} from "./contracts";
import {
  PressureDecisionConvergenceServiceV1,
  withDecisionConvergenceSnapshotHashV1,
} from "./convergence.service";
import {
  buildAiDecisionPolicyInputV1,
  withAiDecisionPolicySelectionHashV1,
  withDecisionAutomationTaskHashV1,
} from "./service";
import { planPreparedActionLedgerV1 } from "./prepared-action-batch";

const NOW = 1_900_000_000_000;
const POLICY_HASH = digest("published-ai-policy");
const loaded = loadSangtianPressureChapterPackageV1();

for (let humanCount = 1; humanCount <= 6; humanCount += 1) {
  test(`decision-scoped convergence handles ${humanCount} completed human seat(s)`, async () => {
    const harness = await Harness.create(humanCount, false);
    const result = await harness.service.converge(harness.command("HTTP_POST_SUBMIT"));

    assert.equal(result.metrics.snapshotReadCount, 1);
    assert.equal(result.metrics.policyCallCount, 6 - humanCount);
    assert.equal(result.metrics.compileCount, 6 - humanCount);
    assert.equal(result.metrics.appendTxCount, 6 - humanCount);
    assert.equal(result.metrics.providerCallCount, 0);
    assert.ok(result.metrics.resumeCount <= 1);
    assert.deepEqual(harness.appendedSeatIds, PRESSURE_CHAPTER_SEAT_IDS_V1.slice(humanCount));
  });
}

test("a required pending human gates policy, compiler, W5 writes and resume", async () => {
  const harness = await Harness.create(2, true);
  const result = await harness.service.converge(harness.command("HTTP_POST_SUBMIT"));

  assert.equal(result.outcome, "WAITING_FOR_HUMANS");
  assert.equal(result.metrics.pendingHumanCount, 1);
  assert.equal(result.metrics.policyCallCount, 0);
  assert.equal(result.metrics.compileCount, 0);
  assert.equal(result.metrics.appendTxCount, 0);
  assert.equal(result.metrics.resumeCount, 0);
});

test("the recovery worker groups all seat discoveries into one decision batch", async () => {
  const harness = await Harness.create(1, false);
  harness.scannerTasks = harness.makeScannerTasks();
  const result = await harness.service.tick("recovery-worker");

  assert.equal(result.kind, "ACKNOWLEDGED");
  assert.equal(harness.snapshotReads, 1);
  assert.equal(harness.scans, 1);
  assert.equal(harness.resumeCalls, 1);
  assert.equal(harness.appendedSeatIds.length, 5);
});

test("production batch port commits one HUMAN plus five AI actions in one submission", async () => {
  const harness = await Harness.create(1, true);
  const legacy = harness.dependencies.preparedActions.submitPrepared;
  harness.dependencies.preparedActions.submitPreparedBatch = async (
    batch: PreparedAutomationActionBatchV1,
  ) => {
    const results = [];
    for (const item of batch.actions) results.push(await legacy(item));
    return {
      status: "COMMITTED" as const,
      batchId: batch.batchId,
      actionIds: results.map((item) => item.actionId),
      replayedActionIds: results.filter((item) => item.status === "REPLAYED").map((item) => item.actionId),
      eventHashes: results.flatMap((item) => item.eventHash ?? []),
      ledgerHeadHash: results.at(-1)!.ledgerHeadHash,
      orchestratorState: structuredClone(batch.beatPlan.postBeatOrchestratorState),
      projection: null,
      conflictReason: null,
    };
  };

  const result = await harness.service.converge({
    ...harness.command("HTTP_POST_SUBMIT"),
    humanAction: humanCommand(harness),
  });

  assert.equal(result.outcome, "BATCH_COMPLETED");
  assert.equal(result.metrics.appendTxCount, 1);
  assert.equal(harness.appendedSeatIds.length, 6);
});

test("committed SETTLING authority uses request-scoped resume without durable rereads", async () => {
  const harness = await Harness.create(1, true);
  const legacy = harness.dependencies.preparedActions.submitPrepared;
  harness.dependencies.preparedActions.submitPreparedBatch = async (batch) => {
    const results = [];
    for (const item of batch.actions) results.push(await legacy(item));
    const actionProjection = planPreparedActionLedgerV1({
      projection: harness.projection,
      actions: batch.actions,
    }).projection;
    const projection = appendBeatEventToWorkingLedgerProjection(
      actionProjection,
      batch.beatPlan.event,
    );
    return {
      status: "COMMITTED" as const,
      batchId: batch.batchId,
      actionIds: results.map((item) => item.actionId),
      replayedActionIds: [],
      eventHashes: results.flatMap((item) => item.eventHash ?? []),
      ledgerHeadHash: projection.headHash,
      orchestratorState: structuredClone(batch.beatPlan.postBeatOrchestratorState),
      projection,
      conflictReason: null,
    };
  };

  const result = await harness.service.converge({
    ...harness.command("HTTP_POST_SUBMIT"),
    humanAction: humanCommand(harness),
  });

  assert.equal(result.outcome, "BATCH_COMPLETED");
  assert.equal(harness.fastSettlementResumeCalls, 1);
  assert.equal(harness.resumeCalls, 0);
});

test("all already-accepted actions resume without submitting an empty batch", async () => {
  const harness = await Harness.create(1, false);
  harness.allCompilesAlreadyAccepted = true;
  let batchCalls = 0;
  harness.dependencies.preparedActions.submitPreparedBatch = async () => {
    batchCalls += 1;
    throw new Error("empty batch must not be submitted");
  };

  const result = await harness.service.converge(harness.command("HTTP_POST_SUBMIT"));

  assert.equal(result.outcome, "BATCH_COMPLETED");
  assert.equal(result.actionIds.length, 5);
  assert.equal(result.metrics.replayCount, 5);
  assert.equal(result.metrics.appendTxCount, 0);
  assert.equal(result.metrics.resumeCount, 1);
  assert.equal(batchCalls, 0);
});

test("request-scoped committed opening authority skips the post-resume projection reread", async () => {
  const harness = await Harness.create(1, false);
  harness.recordRuntimeAuthority = true;

  const result = await harness.service.converge(harness.command("HTTP_POST_SUBMIT"));

  assert.ok(result.committedAuthority);
  assert.equal(harness.projectionReloads, 0);
});

test("HTTP convergence commits one pending human and five AI actions in one batch", async () => {
  const harness = await Harness.create(1, true);
  const legacy = harness.dependencies.preparedActions.submitPrepared;
  harness.dependencies.preparedActions.submitPreparedBatch = async (batch) => {
    const results = [];
    for (const item of batch.actions) results.push(await legacy(item));
    return {
      status: "COMMITTED" as const,
      batchId: batch.batchId,
      actionIds: results.map((item) => item.actionId),
      replayedActionIds: [],
      eventHashes: results.flatMap((item) => item.eventHash ?? []),
      ledgerHeadHash: results.at(-1)!.ledgerHeadHash,
      orchestratorState: structuredClone(batch.beatPlan.postBeatOrchestratorState),
      projection: null,
      conflictReason: null,
    };
  };
  const command = {
    ...harness.command("HTTP_POST_SUBMIT"),
    humanAction: humanCommand(harness),
  };

  const result = await harness.service.converge(command);

  assert.equal(result.outcome, "BATCH_COMPLETED");
  assert.equal(result.metrics.pendingHumanCount, 1);
  assert.equal(result.metrics.appendTxCount, 1);
  assert.deepEqual(harness.appendedSeatIds, PRESSURE_CHAPTER_SEAT_IDS_V1);
});

test("production batch port reduces five prepared AI appends to one submission", async () => {
  const harness = await Harness.create(1, false);
  harness.seedCompletedHumanAction();
  const legacy = harness.dependencies.preparedActions.submitPrepared;
  harness.dependencies.preparedActions.submitPreparedBatch = async (batch) => {
    const results = [];
    for (const item of batch.actions) results.push(await legacy(item));
    return {
      status: "COMMITTED" as const,
      batchId: batch.batchId,
      actionIds: results.map((item) => item.actionId),
      replayedActionIds: results
        .filter((item) => item.status === "REPLAYED")
        .map((item) => item.actionId),
      eventHashes: results.flatMap((item) => item.eventHash ?? []),
      ledgerHeadHash: results.at(-1)!.ledgerHeadHash,
      orchestratorState: structuredClone(batch.beatPlan.postBeatOrchestratorState),
      projection: null,
      conflictReason: null,
    };
  };

  const result = await harness.service.converge(harness.command("HTTP_POST_SUBMIT"));

  assert.equal(result.outcome, "BATCH_COMPLETED");
  assert.equal(result.metrics.appendTxCount, 1);
  assert.equal(harness.appendedSeatIds.length, 5);
});

test("worker drain performs one decision-scoped tick regardless of lane limit", async () => {
  const harness = await Harness.create(2, true);
  harness.scannerTasks = harness.makeScannerTasks();
  const drained = await harness.service.drain("recovery-worker", 8);

  assert.equal(drained.results.length, 1);
  assert.equal(harness.scans, 1);
  assert.equal(harness.policyCalls, 0);
});

test("sequential W5 head conflict stops the batch and invokes resume once", async () => {
  const harness = await Harness.create(1, false);
  harness.headConflictAt = 2;
  const result = await harness.service.converge(harness.command("HTTP_POST_SUBMIT"));

  assert.equal(result.outcome, "BATCH_PARTIAL");
  assert.equal(result.metrics.headConflictCount, 1);
  assert.equal(result.metrics.appendTxCount, 3);
  assert.equal(result.metrics.resumeCount, 1);
});

test("published policy pin mismatch hard fails before W5", async () => {
  const harness = await Harness.create(1, false);
  harness.policyHashOverride = digest("wrong-policy");

  await assert.rejects(() => harness.service.converge(harness.command("HTTP_POST_SUBMIT")));
  assert.equal(harness.appendedSeatIds.length, 0);
  assert.equal(harness.resumeCalls, 0);
});

test("deadline remains delegated to the authority-first coordinator", async () => {
  const harness = await Harness.create(1, false);
  harness.deadlineAtMs = NOW;
  const result = await harness.service.converge(harness.command("HTTP_POST_SUBMIT"));

  assert.equal(result.outcome, "DEADLINE_ADVANCED");
  assert.equal(harness.deadlineCalls, 1);
  assert.equal(harness.policyCalls, 0);
  assert.equal(harness.appendedSeatIds.length, 0);
});

test("HTTP and recovery attempts converge on deterministic action identity", async () => {
  const harness = await Harness.create(1, false);
  await Promise.all([
    harness.service.converge(harness.command("HTTP_POST_SUBMIT")),
    harness.service.converge(harness.command("RECOVERY")),
  ]);

  assert.equal(new Set(harness.actionIds).size, 5);
  assert.ok(harness.replayCount >= 0);
});

test("convergence dependency graph exposes no Provider, LLM, Narrative or model-network capability", async () => {
  const harness = await Harness.create(1, false);
  assert.deepEqual(
    Object.keys(harness.dependencies).sort(),
    [
      "clock",
      "compiler",
      "content",
      "deadlineDefaults",
      "diagnostics",
      "policy",
      "preparedActions",
      "runtime",
      "scanner",
      "snapshots",
    ].sort(),
  );
});

class Harness {
  readonly content = new SangtianAuthoredChapterContentAdapterV1();
  readonly dependencies: DecisionConvergenceDependenciesV1;
  readonly service: PressureDecisionConvergenceServiceV1;
  readonly appendedSeatIds: SeatIdV1[] = [];
  readonly actionIds: string[] = [];
  readonly committed = new Map<string, string>();
  scannerTasks: DecisionAutomationTaskV1[] = [];
  scans = 0;
  snapshotReads = 0;
  policyCalls = 0;
  compileCalls = 0;
  resumeCalls = 0;
  fastSettlementResumeCalls = 0;
  deadlineCalls = 0;
  replayCount = 0;
  projectionReloads = 0;
  recordRuntimeAuthority = false;
  allCompilesAlreadyAccepted = false;
  headConflictAt: number | null = null;
  policyHashOverride: string | null = null;
  deadlineAtMs: number | null = NOW + 300_000;
  private head = digest("opening-ledger-head");

  private constructor(
    readonly route: RunRouteSnapshotV1,
    readonly descriptor: AuthoredChapterRuntimeV1,
    readonly chapter: ChapterOrchestratorStateV1,
    readonly projection: WorkingLedgerProjectionV1,
    readonly seatAuthority: SeatControlSnapshotV1,
  ) {
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
          const { orchestratorHash: _ignored, ...chapterBody } =
            structuredClone(this.chapter);
          if (chapterBody.activeDecision) {
            chapterBody.activeDecision.deadlineAtMs = this.deadlineAtMs;
          }
          const chapter = withOrchestratorHashV1(chapterBody);
          return withDecisionConvergenceSnapshotHashV1({
            schemaVersion: "pressure_decision_convergence_authority_snapshot_v1",
            routeSnapshot: structuredClone(this.route),
            chapter,
            projection: cloneProjection(this.projection),
            seatAuthority: structuredClone(this.seatAuthority),
            aiPolicyArtifactHash: POLICY_HASH,
            capturedAtMs: NOW,
          });
        },
        loadWorkingProjection: async () => {
          this.projectionReloads += 1;
          return cloneProjection(this.projection);
        },
      },
      content: { load: async () => structuredClone(this.descriptor) },
      policy: {
        artifactSha256: POLICY_HASH,
        select: (input) => {
          this.policyCalls += 1;
          return selection(input, this.policyHashOverride ?? POLICY_HASH);
        },
      },
      compiler: {
        compile: (input) => {
          this.compileCalls += 1;
          const command = compiledCommand(input, this.route);
          if (this.allCompilesAlreadyAccepted) {
            return {
              kind: "ALREADY_ACCEPTED" as const,
              actionId: command.action.actionId,
              idempotencyKey: command.action.idempotencyKey,
              inputFingerprint: command.inputFingerprint,
            };
          }
          return {
            kind: "COMMAND" as const,
            command,
          };
        },
      },
      preparedActions: {
        submitPrepared: async (input) => this.append(input),
      },
      runtime: {
        resume: async () => {
          this.resumeCalls += 1;
          if (this.recordRuntimeAuthority) {
            recordPressureDecisionCommittedAuthorityV1({
              chapter: structuredClone(this.chapter),
              workingProjection: cloneProjection(this.projection),
              chapterDescriptor: structuredClone(this.descriptor),
            });
          }
          return structuredClone(this.chapter);
        },
        resumeFromCommittedSettlementAuthority: async () => {
          this.fastSettlementResumeCalls += 1;
          return structuredClone(this.chapter);
        },
      },
      deadlineDefaults: {
        advanceExpiredDecision: async () => {
          this.deadlineCalls += 1;
          return { kind: "APPLIED" as const, state: structuredClone(this.chapter) };
        },
        applyAiFailure: async () => {
          throw new Error("not used by deterministic convergence");
        },
      },
      diagnostics: { record: () => undefined },
      clock: { nowMs: () => NOW },
    };
    this.service = new PressureDecisionConvergenceServiceV1(this.dependencies, { retryMs: 10 });
  }

  static async create(humanCount: number, pendingHuman: boolean): Promise<Harness> {
    const humanSeats = PRESSURE_CHAPTER_SEAT_IDS_V1.slice(0, humanCount);
    const route = makeRoute(humanSeats);
    const content = new SangtianAuthoredChapterContentAdapterV1();
    const descriptor = await content.load({ routeSnapshot: route, chapterId: "N1" });
    const decision = descriptor.decisions.find((item) =>
      PRESSURE_CHAPTER_SEAT_IDS_V1.every((seatId) => item.seatRequirements[seatId] === "REQUIRED"),
    );
    assert.ok(decision, "N1 fixture must expose an all-seat decision");
    const working = createChapterWorkingState({
      runId: route.runId,
      chapterId: "N1",
      facts: loadPublishedSangtianActionReleaseV1().compileChapterActionEffects({
        chapterId: "N1",
        confirmedActions: [],
        defaultEvents: [],
      }).settlementFacts,
    });
    const point = descriptor.definition.decisionPoints.find(
      (item) => item.decisionPointId === decision.decisionPointId,
    )!;
    const workingSet = buildChapterWorkingSet(descriptor.definition, working);
    assert.ok(workingSet);
    assert.equal(workingSet.decisionPoint.decisionPointId, point.decisionPointId);
    const stateHash = workingStateHash(working);
    const activeSeats = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => {
      const human = index < humanCount;
      const pending = human && pendingHuman && index === humanCount - 1;
      return {
        seatId,
        requirement: decision.seatRequirements[seatId],
        completion: human && !pending ? "SEALED_ACTIONS" as const : "PENDING" as const,
        actionIds: human && !pending ? [`human-${seatId}`] : [],
        actionCount: human && !pending ? 1 : 0,
        defaultCode: null,
      };
    });
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
        seats: activeSeats,
      },
      chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
        seatId,
        requirement: decision.seatRequirements[seatId],
        sealedActionIds: index < humanCount && !(pendingHuman && index === humanCount - 1)
          ? [`human-${seatId}`]
          : [],
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
      headHash: digest("opening-ledger-head"),
      headSequence: 0,
      state: working,
      stateHash,
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
    return new Harness(route, descriptor, chapter, projection, makeSeatSnapshot(route));
  }

  command(trigger: "HTTP_POST_SUBMIT" | "RECOVERY") {
    return {
      trigger,
      runId: this.route.runId,
      expectedRouteHash: this.route.routeHash,
      source: {
        chapterRuntimeId: this.chapter.chapterRuntimeId,
        chapterId: this.chapter.currentChapterId,
        decisionPointId: this.chapter.activeDecision!.decisionPointId,
      },
      nowMs: NOW,
      humanSubmitMs: trigger === "HTTP_POST_SUBMIT" ? 2 : 0,
      humanAction: null,
    } as const;
  }

  makeScannerTasks(): DecisionAutomationTaskV1[] {
    return this.chapter.activeDecision!.seats
      .filter((seat) => seat.requirement === "REQUIRED" && seat.completion === "PENDING")
      .map((seat) => {
        const authority = this.seatAuthority.seatControls.find((item) => item.seatId === seat.seatId)!;
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
      });
  }

  seedCompletedHumanAction(): void {
    const original = humanCommand(this);
    const actionId = this.chapter.activeDecision!.seats
      .find((seat) => seat.seatId === original.action.seatId)!
      .actionIds[0]!;
    const { sealedHash: _oldSealedHash, ...unsealedAction } = structuredClone(original.action);
    const actionBody = {
      ...unsealedAction,
      actionId,
    };
    const requestFingerprint = computeDecisionActionRequestFingerprint(actionBody);
    const sealedBody = { ...actionBody, requestFingerprint };
    const action = { ...sealedBody, sealedHash: digest(sealedBody) };
    const commandBody = {
      ...structuredClone(original),
      action,
    };
    const command = {
      ...commandBody,
      inputFingerprint: computeFormalInteractionInputFingerprint(commandBody),
    };
    const planned = planPreparedActionLedgerV1({
      projection: this.projection,
      actions: [{ command, authority: {} } as AppendPreparedAutomationActionCommandV1],
    });
    Object.assign(this.projection, planned.projection);
    this.head = planned.projection.headHash;
  }

  private async append(input: AppendPreparedAutomationActionCommandV1) {
    const action = input.command.action;
    const prior = this.committed.get(action.idempotencyKey);
    if (prior) {
      this.replayCount += 1;
      return {
        status: "REPLAYED" as const,
        actionId: action.actionId,
        eventHash: prior,
        ledgerHeadHash: this.head,
        staleReason: null,
      };
    }
    if (this.headConflictAt === this.appendedSeatIds.length) {
      return {
        status: "HEAD_CONFLICT" as const,
        actionId: action.actionId,
        eventHash: null,
        ledgerHeadHash: this.head,
        staleReason: null,
      };
    }
    const eventHash = digest(`event:${action.actionId}`);
    this.committed.set(action.idempotencyKey, eventHash);
    this.appendedSeatIds.push(action.seatId);
    this.actionIds.push(action.actionId);
    this.head = eventHash;
    return {
      status: "APPENDED" as const,
      actionId: action.actionId,
      eventHash,
      ledgerHeadHash: eventHash,
      staleReason: null,
    };
  }
}

function makeRoute(humanSeats: readonly SeatIdV1[]): RunRouteSnapshotV1 {
  const participantMode: ParticipantModeV1 = humanSeats.length === 1 ? "SOLO" : "MULTIPLAYER";
  const topologyBody = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure_control_topology_v1",
    participantMode,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humanSeats.includes(seatId) ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  const topologyHash = sha256Canonical(topologyBody);
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: `run-${humanSeats.length}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-test-v1",
    testMatrixSha256: digest("test"),
    runSeed: `seed-${humanSeats.length}`,
    narrativeProfileVersion: "pressure-narrative-v1",
    featureSetVersion: "pressure-features-v1",
    resultContractRegistryVersion: "pressure-result-v1",
    participantMode,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [...humanSeats],
    controlTopologyVersion: topologyBody.controlTopologyVersion,
    initialRoleControlSnapshotHash: topologyHash,
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
  const frozenPolicy = { ...frozenPolicyBody, policyHash: sha256Canonical(frozenPolicyBody) };
  const seatControls: SeatAuthorityRecordV1[] = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
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

function selection(input: AiDecisionPolicyInputV1, policyHash: string): AiDecisionPolicySelectionV1 {
  const actionType = input.eligibleActionTypes.find((item) => item !== "DEFAULT_PASS")
    ?? "DEFAULT_PASS";
  return withAiDecisionPolicySelectionHashV1({
    policyRef: "sangtian.ai.decision.v1",
    policyVersion: "sangtian-ai-decision-1.0.0",
    policyHash,
    resolvedContentPackageVersion: input.contentPackageVersion,
    resolvedContentPackageSha256: input.contentPackageSha256,
    inputHash: input.inputHash,
    actionType,
  });
}

function compiledCommand(
  input: Parameters<DecisionConvergenceDependenciesV1["compiler"]["compile"]>[0],
  route: RunRouteSnapshotV1,
): SubmitOrchestratedActionCommandV1 {
  const seatId = input.seatAuthority.seatId;
  const idempotencyKey = `pressure-ai-action-v1:${route.runId}:${input.chapter.chapterRuntimeId}:${input.chapter.activeDecision!.decisionPointId}:${seatId}:${input.seatAuthority.controlEpoch}`;
  const actionId = `action_${digest(idempotencyKey)}`;
  const payload = {
    source: "CONTENT_OWNED_AI_POLICY",
    policyRef: input.selection.policyRef,
    policyVersion: input.selection.policyVersion,
    policyHash: input.selection.policyHash,
    selectionHash: input.selection.selectionHash,
  };
  const actionBase = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId,
    runId: route.runId,
    chapterRuntimeId: input.chapter.chapterRuntimeId,
    chapterId: input.chapter.currentChapterId,
    decisionPointId: input.chapter.activeDecision!.decisionPointId,
    seatId,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: input.seatAuthority.controlEpoch,
    expectedWorkingRevision: input.projection.state.revision,
    status: "SEALED" as const,
    actionType: input.selection.actionType,
    payload,
    payloadHash: digest(payload),
    idempotencyKey,
  };
  const withRequest = {
    ...actionBase,
    requestFingerprint: computeDecisionActionRequestFingerprint(actionBase),
  };
  const action = { ...withRequest, sealedHash: digest(withRequest) };
  const intent = {
    visibility: "PRIVATE" as const,
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
  const command = {
    routeSnapshot: route,
    subjectId: input.seatAuthority.activeControllerId,
    action,
    intent,
    nowMs: NOW,
  };
  return {
    ...command,
    inputFingerprint: computeFormalInteractionInputFingerprint(command),
  };
}

function humanCommand(harness: Harness): SubmitOrchestratedActionCommandV1 {
  const seatId = harness.route.humanSeatIdsAtStart[0]! as SeatIdV1;
  const authority = harness.seatAuthority.seatControls.find((item) => item.seatId === seatId)!;
  const authored = harness.descriptor.decisions.find(
    (item) => item.decisionPointId === harness.chapter.activeDecision!.decisionPointId,
  )!;
  const actionType = authored.execution.allowedActionTypes[0]!;
  const idempotencyKey = `human-action:${harness.route.runId}:${seatId}`;
  const actionId = `action_${digest(idempotencyKey)}`;
  const payload = { optionCode: actionType, customText: null };
  const actionBase = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId,
    runId: harness.route.runId,
    chapterRuntimeId: harness.chapter.chapterRuntimeId,
    chapterId: harness.chapter.currentChapterId,
    decisionPointId: harness.chapter.activeDecision!.decisionPointId,
    seatId,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: authority.controlEpoch,
    expectedWorkingRevision: harness.projection.state.revision,
    status: "SEALED" as const,
    actionType,
    payload,
    payloadHash: digest(payload),
    idempotencyKey,
  };
  const requestFingerprint = computeDecisionActionRequestFingerprint(actionBase);
  const sealedBase = { ...actionBase, requestFingerprint };
  const action = { ...sealedBase, sealedHash: digest(sealedBase) };
  const intent = {
    visibility: "PRIVATE" as const,
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
  const command = {
    routeSnapshot: structuredClone(harness.route),
    subjectId: authority.activeControllerId,
    action,
    intent,
    nowMs: NOW,
  };
  return {
    ...command,
    inputFingerprint: computeFormalInteractionInputFingerprint(command),
  };
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
    acceptedActions: new Map(value.acceptedActions),
    actionsByIdempotencyKey: new Map(value.actionsByIdempotencyKey),
    commitmentActionsByIdempotencyKey: new Map(value.commitmentActionsByIdempotencyKey ?? []),
    appliedBeats: new Map(value.appliedBeats),
    pendingReservations: new Map(value.pendingReservations),
    commitments: new Map(value.commitments),
    evidenceRefsByAction: new Map(value.evidenceRefsByAction),
    knowledgeBySeat: new Map(value.knowledgeBySeat),
    seatArcProgressBySeat: new Map(value.seatArcProgressBySeat),
  };
}

function digest(value: unknown): string {
  return sha256Canonical(value);
}

// Keep the published policy input builder linked into this test compilation.
void buildAiDecisionPolicyInputV1;
