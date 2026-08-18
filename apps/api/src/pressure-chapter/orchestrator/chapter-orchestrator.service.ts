import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  chapterSequence,
  compareCanonicalText,
  nextChapterId,
  sha256Canonical,
  validateDecisionActionV1,
  validateBeatResolutionV1,
  validateFrozenChapterBundleV1,
  validateRunRouteSnapshotV1,
  validateSealedChapterSettlementInputV1,
  type ChapterIdV1,
  type FrozenChapterBundleV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  buildChapterWorkingSet,
  createChapterWorkingState,
  type ChapterWorkingState,
} from "@ai-story/templates";
import { planWorkingLedgerOpeningV1 } from "../working-ledger/working-ledger.service";
import { workingLedgerProjectionCacheHashV1 } from "../working-ledger/projection-cache";
import {
  measurePressureDecisionStageV1,
  recordPressureDecisionCommittedAuthorityV1,
  recordPressureDecisionW4ConflictV1,
} from "../observability/decision-convergence-timing";
import type {
  ActiveDecisionSeatV1,
  ActiveDecisionStateV1,
  AuthoredChapterContentPort,
  AuthoredChapterRuntimeV1,
  AuthoredDecisionRuntimeV1,
  ChapterAuthorityBaseV1,
  ChapterOrchestratorStatePort,
  ChapterOrchestratorStateV1,
  ChapterSeatSummaryV1,
  ChapterSettlementPort,
  CommittedSettlementResumeAuthorityV1,
  ChapterWorkingSeedPort,
  DecisionBeatResolutionPort,
  DecisionCloseEvaluatorPort,
  DeterministicDefaultActionPort,
  FinaleRequestPort,
  FormalActionSubmissionPort,
  StartChapterRunCommandV1,
  SubmitOrchestratedActionCommandV1,
  WorkingLedgerOpeningPort,
  WorkingProjectionReaderPort,
} from "./contracts";
import {
  CHAPTER_ORCHESTRATOR_ERROR_CODES as ERROR,
  failChapterOrchestrator,
} from "./errors";
import {
  validateAuthoredChapterRuntimeV1,
  validateOrchestratorStateV1,
  withOrchestratorHashV1,
} from "./validation";

const RESOLVER_VERSION = "pressure_orchestrated_beat_v1";
const MAX_CAS_ATTEMPTS = 8;

export class PressureChapterOrchestratorService {
  constructor(
    private readonly states: ChapterOrchestratorStatePort,
    private readonly content: AuthoredChapterContentPort,
    private readonly seeds: ChapterWorkingSeedPort,
    private readonly ledgerOpening: WorkingLedgerOpeningPort,
    private readonly projections: WorkingProjectionReaderPort,
    private readonly formalActions: FormalActionSubmissionPort,
    private readonly beatResolution: DecisionBeatResolutionPort,
    private readonly decisionClose: DecisionCloseEvaluatorPort,
    private readonly defaults: DeterministicDefaultActionPort,
    private readonly settlement: ChapterSettlementPort,
    private readonly finale: FinaleRequestPort,
  ) {}

  async start(command: StartChapterRunCommandV1): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    assertNow(command.nowMs);
    assertHash(command.genesisWorldStateHash, "genesisWorldStateHash");
    assertHash(command.genesisHash, "genesisHash");
    const existing = await this.readState(route.runId);
    if (existing) {
      assertRoute(existing, route);
      return this.resume(route, command.nowMs);
    }
    return this.openChapter({
      route,
      chapterId: "N1",
      authorityBase: {
        baseWorldSequence: 0,
        baseWorldStateHash: command.genesisWorldStateHash,
        previousFrozenHash: command.genesisHash,
      },
      expected: null,
      nowMs: command.nowMs,
    });
  }

  async resume(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(routeSnapshot);
    assertNow(nowMs);
    let state = await this.requireState(route.runId);
    assertRoute(state, route);
    if (state.phase === "ACTIVE") {
      state = await measurePressureDecisionStageV1(
        "orchestratorReconcileMs",
        () => this.reconcileAcceptedActions(route, state),
      );
    }
    switch (state.phase) {
      case "ACTIVE": {
        const deadlineAtMs = state.activeDecision?.deadlineAtMs;
        if (deadlineAtMs !== undefined && deadlineAtMs !== null
          && nowMs >= deadlineAtMs) {
          return this.advanceDeadline(route, nowMs);
        }
        return this.maybeResolve(route, nowMs, state);
      }
      case "RESOLVING_BEAT":
        return this.driveBeatResolution(route, state, nowMs);
      case "SETTLING":
        return this.driveSettlement(route, state, nowMs);
      case "FROZEN":
        return this.driveFrozen(route, state, nowMs);
      case "FINALE_REQUESTED":
        return state;
    }
  }

  /**
   * Continues a just-committed SETTLING transition without rereading the W4
   * state, authored descriptor, or Working projection. Durable settlement
   * source preparation and all of its fences remain unchanged.
   */
  async resumeFromCommittedSettlementAuthority(
    routeSnapshot: RunRouteSnapshotV1,
    authorityValue: Readonly<CommittedSettlementResumeAuthorityV1>,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(routeSnapshot);
    assertNow(nowMs);
    const state = validateOrchestratorStateV1(authorityValue.state);
    assertRoute(state, route);
    if (state.phase !== "SETTLING") {
      failChapterOrchestrator(ERROR.INVALID_PHASE, state.phase);
    }
    const descriptor = validateAuthoredChapterRuntimeV1(authorityValue.chapterDescriptor);
    if (
      descriptor.chapterId !== state.currentChapterId
      || descriptor.descriptorHash !== state.descriptorHash
    ) failChapterOrchestrator(ERROR.SETTLEMENT_MISMATCH, "descriptor");
    const projection = structuredClone(authorityValue.workingProjection);
    assertProjectionContext(state, projection);
    assertChapterClose(descriptor, projection.state.completedDecisionPointIds);
    const suppliedInput = validateSealedChapterSettlementInputV1(authorityValue.settlementInput);
    const expectedInput = compileSettlementInputV1(state, descriptor, projection);
    if (
      state.settlementInputHash !== suppliedInput.inputHash
      || expectedInput.inputHash !== suppliedInput.inputHash
    ) failChapterOrchestrator(ERROR.SETTLEMENT_MISMATCH, "sealed-input");
    return this.driveSettlement(route, state, nowMs, {
      chapterDescriptor: descriptor,
      workingProjection: projection,
      settlementInput: suppliedInput,
    });
  }

  async submitAction(
    command: SubmitOrchestratedActionCommandV1,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    const action = validateDecisionActionV1(command.action);
    assertNow(command.nowMs);
    let state = await this.requireActive(route);
    const active = requireActiveDecision(state);
    if (
      action.runId !== route.runId
      || action.chapterRuntimeId !== state.chapterRuntimeId
      || action.chapterId !== state.currentChapterId
      || action.decisionPointId !== active.decisionPointId
    ) failChapterOrchestrator(ERROR.STALE_ACTION, action.actionId);
    if (active.deadlineAtMs !== null && command.nowMs >= active.deadlineAtMs) {
      failChapterOrchestrator(ERROR.ACTION_EXPIRED, action.actionId);
    }
    const descriptor = await this.loadDescriptor(route, state.currentChapterId, state.descriptorHash);
    const decision = requireDecision(descriptor, active.decisionPointId);
    const seat = requireSeat(active, action.seatId);
    if (seat.requirement !== "REQUIRED") {
      failChapterOrchestrator(ERROR.SEAT_NOT_REQUIRED, action.seatId);
    }
    if (seat.actionIds.includes(action.actionId)) return this.maybeResolve(route, command.nowMs);
    const budget = decision.execution.perSeatActionBudget[action.seatId];
    if (!budget || seat.actionCount >= budget || action.actionOrdinal > budget) {
      failChapterOrchestrator(ERROR.ACTION_BUDGET_EXCEEDED, action.seatId);
    }
    if (!decision.execution.allowedActionTypes.includes(action.actionType)) {
      failChapterOrchestrator(ERROR.DECISION_MISMATCH, action.actionType);
    }
    const projection = await this.loadProjection(state);
    if (action.expectedWorkingRevision !== projection.state.revision) {
      failChapterOrchestrator(ERROR.STALE_ACTION, action.actionId);
    }
    await this.formalActions.submit({
      routeSnapshot: route,
      subjectId: command.subjectId,
      action,
      intent: command.intent,
      inputFingerprint: command.inputFingerprint,
    });
    state = await this.recordAction(route, {
      expectedChapterRuntimeId: state.chapterRuntimeId,
      decisionPointId: active.decisionPointId,
      seatId: action.seatId,
      actionId: action.actionId,
      defaultCode: null,
      actionBudget: budget,
    });
    return this.maybeResolve(route, command.nowMs, state);
  }

  async advanceDeadline(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(routeSnapshot);
    assertNow(nowMs);
    let state = await this.requireActive(route);
    const active = requireActiveDecision(state);
    const descriptor = await this.loadDescriptor(route, state.currentChapterId, state.descriptorHash);
    const decision = requireDecision(descriptor, active.decisionPointId);
    const deadline = decision.execution.deadlinePolicy;
    if (!deadline || active.deadlineAtMs === null || nowMs < active.deadlineAtMs) return state;
    if (deadline.expiryAction === "FAIL_CLOSED") {
      failChapterOrchestrator(ERROR.DEADLINE_FAIL_CLOSED, active.decisionPointId);
    }
    for (const pending of active.seats.filter((seat) => (
      seat.requirement === "REQUIRED" && seat.completion === "PENDING"
    ))) {
      state = await this.submitDefault(route, state, decision, pending.seatId, "DEADLINE");
    }
    return this.maybeResolve(route, nowMs, state);
  }

  async applyAiFailure(
    routeSnapshot: RunRouteSnapshotV1,
    seatId: SeatIdV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    const route = validateRunRouteSnapshotV1(routeSnapshot);
    assertNow(nowMs);
    let state = await this.requireActive(route);
    const active = requireActiveDecision(state);
    const seat = requireSeat(active, seatId);
    if (seat.requirement !== "REQUIRED" || seat.completion !== "PENDING") {
      failChapterOrchestrator(ERROR.DEFAULT_NOT_ALLOWED, seatId);
    }
    const descriptor = await this.loadDescriptor(route, state.currentChapterId, state.descriptorHash);
    const decision = requireDecision(descriptor, active.decisionPointId);
    state = await this.submitDefault(route, state, decision, seatId, "AI_FAILURE");
    return this.maybeResolve(route, nowMs, state);
  }

  private async submitDefault(
    route: RunRouteSnapshotV1,
    state: ChapterOrchestratorStateV1,
    decision: AuthoredDecisionRuntimeV1,
    seatId: SeatIdV1,
    reason: "DEADLINE" | "AI_FAILURE",
  ): Promise<ChapterOrchestratorStateV1> {
    const projection = await this.loadProjection(state);
    const policy = reason === "DEADLINE"
      ? decision.execution.absenceDefaultPolicy
      : decision.execution.aiFailureDefaultPolicy;
    const idempotencyKey = [
      "pressure-default-v1",
      state.runId,
      state.chapterRuntimeId,
      decision.decisionPointId,
      seatId,
      reason,
      policy.policyHash,
    ].join(":");
    const result = await this.defaults.submit({
      routeSnapshot: route,
      chapterRuntimeId: state.chapterRuntimeId,
      chapterId: state.currentChapterId,
      decisionPointId: decision.decisionPointId,
      seatId,
      expectedWorkingRevision: projection.state.revision,
      policy,
      reason,
      idempotencyKey,
    });
    return this.recordAction(route, {
      expectedChapterRuntimeId: state.chapterRuntimeId,
      decisionPointId: decision.decisionPointId,
      seatId,
      actionId: result.actionId,
      defaultCode: policy.policyRef,
      actionBudget: decision.execution.perSeatActionBudget[seatId]!,
    });
  }

  private async maybeResolve(
    route: RunRouteSnapshotV1,
    nowMs: number,
    supplied?: ChapterOrchestratorStateV1,
  ): Promise<ChapterOrchestratorStateV1> {
    let state = supplied ?? await this.requireState(route.runId);
    assertRoute(state, route);
    if (state.phase !== "ACTIVE") return this.resume(route, nowMs);
    const active = requireActiveDecision(state);
    if (!active.seats.filter((seat) => seat.requirement === "REQUIRED")
      .every((seat) => seat.completion !== "PENDING")) return state;
    const descriptor = await this.loadDescriptor(route, state.currentChapterId, state.descriptorHash);
    const decision = requireDecision(descriptor, active.decisionPointId);
    const projection = await this.loadProjection(state);
    if (!await this.decisionClose.isClosed({ decision, active, projection })) return state;

    const claimed = nextState(state, {
      phase: "RESOLVING_BEAT",
      activeDecision: active,
    });
    const saved = await this.states.compareAndSwap({
      runId: state.runId,
      expectedRevision: state.revision,
      next: claimed,
    });
    if (saved.status === "CONFLICT") return this.resume(route, nowMs);
    return this.driveBeatResolution(route, claimed, nowMs);
  }

  private async driveBeatResolution(
    route: RunRouteSnapshotV1,
    state: ChapterOrchestratorStateV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    if (state.phase !== "RESOLVING_BEAT") {
      failChapterOrchestrator(ERROR.INVALID_PHASE, state.phase);
    }
    const active = requireActiveDecision(state);
    const descriptor = await this.loadDescriptor(route, state.currentChapterId, state.descriptorHash);
    const actionIds = [...new Set(active.seats.flatMap((seat) => seat.actionIds))]
      .sort(compareCanonicalText);
    if (!actionIds.length) failChapterOrchestrator(ERROR.CLOSE_POLICY_NOT_MET, "no-actions");
    const result = await measurePressureDecisionStageV1(
      "beatMs",
      () => this.beatResolution.resolve({
        routeSnapshot: route,
        chapterRuntimeId: state.chapterRuntimeId,
        chapterDefinition: descriptor.definition,
        actionIds,
        resolverVersion: RESOLVER_VERSION,
      }),
    );
    const resolutionActions = actionIds.map((actionId) => {
      const accepted = result.projection.acceptedActions.get(actionId);
      if (!accepted) failChapterOrchestrator(ERROR.DECISION_MISMATCH, `missing-action:${actionId}`);
      return accepted.action;
    });
    const resolution = validateBeatResolutionV1(result.resolution, resolutionActions);
    if (!sameStrings([...resolution.sealedActionIds].sort(compareCanonicalText), actionIds)) {
      failChapterOrchestrator(ERROR.DECISION_MISMATCH, "beat-action-set");
    }
    assertProjectionContext(state, result.projection);
    const nextPin = result.projection.nextDecisionPin;
    if (nextPin) {
      const nextDecision = buildActiveDecision(descriptor, nextPin.decisionPointId, nowMs);
      assertKernelPin(descriptor, result.projection, nextPin.decisionPointId);
      const next = nextState(state, {
        phase: "ACTIVE",
        activeDecision: nextDecision,
      });
      return measurePressureDecisionStageV1(
        "nextOpenMs",
        () => this.saveOrResume(route, state, next, nowMs),
      );
    }
    assertChapterClose(descriptor, result.projection.state.completedDecisionPointIds);
    const settlementInput = compileSettlementInputV1(state, descriptor, result.projection);
    const settling = nextState(state, {
      phase: "SETTLING",
      activeDecision: null,
      settlementInputHash: settlementInput.inputHash,
    });
    const saved = await this.states.compareAndSwap({
      runId: state.runId,
      expectedRevision: state.revision,
      next: settling,
    });
    if (saved.status === "CONFLICT") return this.resume(route, nowMs);
    return this.driveSettlement(route, settling, nowMs, {
      chapterDescriptor: descriptor,
      workingProjection: result.projection,
      settlementInput,
    });
  }

  private async driveSettlement(
    route: RunRouteSnapshotV1,
    state: ChapterOrchestratorStateV1,
    nowMs: number,
    committedAuthority?: Omit<CommittedSettlementResumeAuthorityV1, "state">,
  ): Promise<ChapterOrchestratorStateV1> {
    if (state.phase !== "SETTLING") failChapterOrchestrator(ERROR.INVALID_PHASE, state.phase);
    const descriptor = committedAuthority
      ? validateAuthoredChapterRuntimeV1(committedAuthority.chapterDescriptor)
      : await this.loadDescriptor(route, state.currentChapterId, state.descriptorHash);
    if (
      descriptor.chapterId !== state.currentChapterId
      || descriptor.descriptorHash !== state.descriptorHash
    ) failChapterOrchestrator(ERROR.SETTLEMENT_MISMATCH, "descriptor");
    const projection = committedAuthority
      ? structuredClone(committedAuthority.workingProjection)
      : await this.loadProjection(state);
    assertProjectionContext(state, projection);
    assertChapterClose(descriptor, projection.state.completedDecisionPointIds);
    const expectedSettlementInput = compileSettlementInputV1(state, descriptor, projection);
    const settlementInput = committedAuthority
      ? validateSealedChapterSettlementInputV1(committedAuthority.settlementInput)
      : expectedSettlementInput;
    if (
      state.settlementInputHash !== settlementInput.inputHash
      || expectedSettlementInput.inputHash !== settlementInput.inputHash
    ) {
      failChapterOrchestrator(ERROR.SETTLEMENT_MISMATCH, "sealed-input");
    }
    const result = await measurePressureDecisionStageV1(
      "settlementMs",
      () => this.settlement.settle({
        routeSnapshot: route,
        settlementInput,
        chapterDescriptorHash: descriptor.descriptorHash,
        seatParticipation: compileSeatParticipationV1(state.chapterSeatSummaries),
      }),
    );
    const bundle = validateFrozenChapterBundleV1(
      result.frozenBundle,
      state.authorityBase.previousFrozenHash,
    );
    if (
      bundle.runId !== state.runId
      || bundle.chapterId !== state.currentChapterId
      || bundle.decisionLedgerHash !== settlementInput.decisionLedgerHash
      || bundle.finalWorkingStateHash !== settlementInput.finalWorkingStateHash
      || bundle.baseWorldSequence !== state.authorityBase.baseWorldSequence
    ) failChapterOrchestrator(ERROR.SETTLEMENT_MISMATCH, "frozen-bundle");
    const frozen = nextState(state, {
      phase: "FROZEN",
      activeDecision: null,
      frozenBundleHash: bundle.bundleHash,
      authorityBase: {
        baseWorldSequence: bundle.committedWorldSequence,
        baseWorldStateHash: bundle.committedWorldStateHash,
        previousFrozenHash: bundle.bundleHash,
      },
    });
    const saved = await this.states.compareAndSwap({
      runId: state.runId,
      expectedRevision: state.revision,
      next: frozen,
    });
    if (saved.status === "CONFLICT") return this.resume(route, nowMs);
    return this.driveFrozen(route, frozen, nowMs, bundle);
  }

  private async driveFrozen(
    route: RunRouteSnapshotV1,
    state: ChapterOrchestratorStateV1,
    nowMs: number,
    committedBundle: FrozenChapterBundleV1 | null = null,
  ): Promise<ChapterOrchestratorStateV1> {
    if (state.phase !== "FROZEN") failChapterOrchestrator(ERROR.INVALID_PHASE, state.phase);
    if (!state.frozenBundleHash) failChapterOrchestrator(ERROR.STATE_CORRUPT, "frozen-hash");
    if (state.currentChapterId === "N7") {
      await this.finale.request({
        runId: state.runId,
        routeHash: state.routeHash,
        n7FrozenBundleHash: state.frozenBundleHash,
        idempotencyKey: `pressure-finale:${state.runId}:${state.frozenBundleHash}`,
      });
      const terminal = nextState(state, { phase: "FINALE_REQUESTED" });
      return this.saveOrResume(route, state, terminal, nowMs);
    }
    const next = nextChapterId(state.currentChapterId);
    if (next === "FINALE") failChapterOrchestrator(ERROR.N8_FORBIDDEN);
    return measurePressureDecisionStageV1(
      "nextOpenMs",
      () => this.openChapter({
        route,
        chapterId: next,
        authorityBase: state.authorityBase,
        expected: state,
        nowMs,
        committedBundle,
      }),
    );
  }

  private async openChapter(input: {
    route: RunRouteSnapshotV1;
    chapterId: ChapterIdV1;
    authorityBase: ChapterAuthorityBaseV1;
    expected: ChapterOrchestratorStateV1 | null;
    nowMs: number;
    committedBundle?: FrozenChapterBundleV1 | null;
  }): Promise<ChapterOrchestratorStateV1> {
    if (input.authorityBase.baseWorldSequence !== chapterSequence(input.chapterId) - 1) {
      failChapterOrchestrator(ERROR.STATE_CORRUPT, "base-world-sequence");
    }
    const descriptor = await this.loadDescriptor(input.route, input.chapterId);
    const chapterRuntimeId = deterministicChapterRuntimeId(
      input.route.runId,
      input.chapterId,
      input.authorityBase.previousFrozenHash,
    );
    const seedInput = {
      routeSnapshot: input.route,
      chapter: descriptor,
      authorityBase: input.authorityBase,
    };
    const seed = input.committedBundle && this.seeds.loadFromAuthority
      ? await this.seeds.loadFromAuthority({
          ...seedInput,
          source: {
            routeHash: input.route.routeHash,
            sourceFrozenHash: input.committedBundle.bundleHash,
            worldState: structuredClone(input.committedBundle.frozenWorldState),
          },
        })
      : await this.seeds.load(seedInput);
    if (
      seed.runId !== input.route.runId
      || seed.chapterId !== input.chapterId
      || seed.revision !== 0
    ) failChapterOrchestrator(ERROR.CONTENT_INVALID, "working-seed");
    const planned = planChapterOpeningV1({
      routeSnapshot: input.route,
      chapter: descriptor,
      authorityBase: input.authorityBase,
      expected: input.expected,
      seed,
      nowMs: input.nowMs,
    });
    const opening = await this.ledgerOpening.open({
      routeSnapshot: input.route,
      chapterRuntimeId,
      chapterDefinition: descriptor.definition,
      initialState: seed,
    });
    if (
      chapterRuntimeId !== planned.chapterRuntimeId
      || sha256Canonical(opening.event) !== sha256Canonical(planned.event)
      || workingLedgerProjectionCacheHashV1(opening.projection)
        !== workingLedgerProjectionCacheHashV1(planned.projection)
    ) failChapterOrchestrator(ERROR.CONTENT_INVALID, "initial-kernel-pin");
    const projection = opening.projection;
    const next = planned.state;
    const saved = await this.states.compareAndSwap({
      runId: input.route.runId,
      expectedRevision: input.expected?.revision ?? null,
      next,
    });
    if (saved.status === "COMMITTED") {
      recordPressureDecisionCommittedAuthorityV1({
        chapter: next,
        workingProjection: projection,
        chapterDescriptor: descriptor,
        frozenWorldState: input.committedBundle
          ? structuredClone(input.committedBundle.frozenWorldState)
          : null,
      });
      return next;
    }
    return this.resume(input.route, input.nowMs);
  }

  private async recordAction(
    route: RunRouteSnapshotV1,
    input: {
      expectedChapterRuntimeId: string;
      decisionPointId: string;
      seatId: SeatIdV1;
      actionId: string;
      defaultCode: string | null;
      actionBudget: number;
    },
  ): Promise<ChapterOrchestratorStateV1> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const state = await this.requireState(route.runId);
      assertRoute(state, route);
      if (
        state.chapterRuntimeId !== input.expectedChapterRuntimeId
        || state.phase !== "ACTIVE"
        || state.activeDecision?.decisionPointId !== input.decisionPointId
      ) failChapterOrchestrator(ERROR.STALE_ACTION, input.actionId);
      const active = structuredClone(state.activeDecision);
      const seat = requireSeat(active, input.seatId);
      if (seat.actionIds.includes(input.actionId)) return state;
      if (seat.requirement !== "REQUIRED") {
        failChapterOrchestrator(ERROR.SEAT_NOT_REQUIRED, input.seatId);
      }
      if (seat.actionCount >= input.actionBudget) {
        failChapterOrchestrator(ERROR.ACTION_BUDGET_EXCEEDED, input.seatId);
      }
      seat.actionIds = [...seat.actionIds, input.actionId].sort(compareCanonicalText);
      seat.actionCount += 1;
      seat.completion = input.defaultCode ? "DEFAULTED" : "SEALED_ACTIONS";
      seat.defaultCode = input.defaultCode;
      const summaries = structuredClone(state.chapterSeatSummaries);
      const summary = summaries.find((item) => item.seatId === input.seatId)!;
      summary.requirement = "REQUIRED";
      summary.sealedActionIds = [...new Set([...summary.sealedActionIds, input.actionId])]
        .sort(compareCanonicalText);
      if (input.defaultCode) {
        summary.defaultActionIds = [...new Set([...summary.defaultActionIds, input.actionId])]
          .sort(compareCanonicalText);
        summary.defaultCodes = [...new Set([...summary.defaultCodes, input.defaultCode])]
          .sort(compareCanonicalText);
      }
      const next = nextState(state, { activeDecision: active, chapterSeatSummaries: summaries });
      const saved = await this.states.compareAndSwap({
        runId: state.runId,
        expectedRevision: state.revision,
        next,
      });
      if (saved.status === "COMMITTED") return next;
    }
    failChapterOrchestrator(ERROR.CAS_CONFLICT, input.actionId);
  }

  private async reconcileAcceptedActions(
    route: RunRouteSnapshotV1,
    supplied: ChapterOrchestratorStateV1,
    attempt = 0,
  ): Promise<ChapterOrchestratorStateV1> {
    const state = supplied;
    const active = requireActiveDecision(state);
    const descriptor = await this.loadDescriptor(route, state.currentChapterId, state.descriptorHash);
    const decision = requireDecision(descriptor, active.decisionPointId);
    const projection = await this.loadProjection(state);
    const recorded = new Set(active.seats.flatMap((seat) => seat.actionIds));
    const missing = [...projection.acceptedActions.values()]
      .filter((accepted) => (
        accepted.action.decisionPointId === active.decisionPointId
        && !recorded.has(accepted.action.actionId)
      ))
      .sort((left, right) => compareCanonicalText(left.action.actionId, right.action.actionId));
    if (!missing.length) return state;

    const recordedInputs: Array<Parameters<typeof planRecordedActionsV1>[1][number]> = [];
    for (const accepted of missing) {
      const seatId = accepted.action.seatId;
      const budget = decision.execution.perSeatActionBudget[seatId];
      if (!budget) failChapterOrchestrator(ERROR.SEAT_NOT_REQUIRED, seatId);
      if (!decision.execution.allowedActionTypes.includes(accepted.action.actionType)) {
        failChapterOrchestrator(ERROR.DECISION_MISMATCH, accepted.action.actionType);
      }
      if (accepted.action.expectedWorkingRevision !== projection.state.revision) {
        failChapterOrchestrator(ERROR.STALE_ACTION, accepted.action.actionId);
      }
      recordedInputs.push({
        seatId,
        actionId: accepted.action.actionId,
        defaultCode: recoveredDefaultCode(accepted.action.idempotencyKey, decision),
        actionBudget: budget,
      });
    }
    const candidate = planRecordedActionsV1(state, recordedInputs, false);
    const requiredComplete = candidate.activeDecision!.seats
      .filter((seat) => seat.requirement === "REQUIRED")
      .every((seat) => seat.completion !== "PENDING");
    const closeInSameCas = requiredComplete && await this.decisionClose.isClosed({
      decision,
      active: candidate.activeDecision!,
      projection,
    });
    const next = closeInSameCas
      ? planRecordedActionsV1(state, recordedInputs, true)
      : candidate;
    const saved = await this.states.compareAndSwap({
      runId: state.runId,
      expectedRevision: state.revision,
      next,
    });
    if (saved.status === "COMMITTED") return next;
    recordPressureDecisionW4ConflictV1();
    if (attempt + 1 >= MAX_CAS_ATTEMPTS) {
      failChapterOrchestrator(ERROR.CAS_CONFLICT, active.decisionPointId);
    }
    const current = saved.current ?? await this.requireState(route.runId);
    assertRoute(current, route);
    if (current.phase !== "ACTIVE") return current;
    return this.reconcileAcceptedActions(route, current, attempt + 1);
  }

  private async loadDescriptor(
    route: RunRouteSnapshotV1,
    chapterId: ChapterIdV1,
    expectedHash?: string,
  ): Promise<AuthoredChapterRuntimeV1> {
    const descriptor = validateAuthoredChapterRuntimeV1(
      await this.content.load({ routeSnapshot: route, chapterId }),
    );
    if (expectedHash && descriptor.descriptorHash !== expectedHash) {
      failChapterOrchestrator(ERROR.CONTENT_INVALID, "descriptor-drift");
    }
    return descriptor;
  }

  private async loadProjection(state: ChapterOrchestratorStateV1) {
    const projection = await this.projections.load({
      runId: state.runId,
      chapterRuntimeId: state.chapterRuntimeId,
    });
    assertProjectionContext(state, projection);
    return projection;
  }

  private async requireActive(route: RunRouteSnapshotV1) {
    const state = await this.requireState(route.runId);
    assertRoute(state, route);
    if (state.phase !== "ACTIVE") failChapterOrchestrator(ERROR.INVALID_PHASE, state.phase);
    return state;
  }

  private async requireState(runId: string) {
    const state = await this.readState(runId);
    if (!state) failChapterOrchestrator(ERROR.STATE_MISSING, runId);
    return state;
  }

  private async readState(runId: string) {
    const state = await this.states.read(runId);
    return state ? validateOrchestratorStateV1(state) : null;
  }

  private async saveOrResume(
    route: RunRouteSnapshotV1,
    previous: ChapterOrchestratorStateV1,
    next: ChapterOrchestratorStateV1,
    nowMs: number,
  ) {
    const saved = await this.states.compareAndSwap({
      runId: previous.runId,
      expectedRevision: previous.revision,
      next,
    });
    return saved.status === "COMMITTED" ? next : this.resume(route, nowMs);
  }
}

function foldRecordedAction(
  active: ActiveDecisionStateV1,
  summaries: ChapterSeatSummaryV1[],
  input: {
    seatId: SeatIdV1;
    actionId: string;
    defaultCode: string | null;
    actionBudget: number;
  },
): void {
  const seat = requireSeat(active, input.seatId);
  if (seat.actionIds.includes(input.actionId)) return;
  if (seat.requirement !== "REQUIRED") {
    failChapterOrchestrator(ERROR.SEAT_NOT_REQUIRED, input.seatId);
  }
  if (seat.actionCount >= input.actionBudget) {
    failChapterOrchestrator(ERROR.ACTION_BUDGET_EXCEEDED, input.seatId);
  }
  seat.actionIds = [...seat.actionIds, input.actionId].sort(compareCanonicalText);
  seat.actionCount += 1;
  seat.completion = input.defaultCode ? "DEFAULTED" : "SEALED_ACTIONS";
  seat.defaultCode = input.defaultCode;
  const summary = summaries.find((item) => item.seatId === input.seatId);
  if (!summary) failChapterOrchestrator(ERROR.STATE_CORRUPT, `summary:${input.seatId}`);
  summary.requirement = "REQUIRED";
  summary.sealedActionIds = [...new Set([...summary.sealedActionIds, input.actionId])]
    .sort(compareCanonicalText);
  if (input.defaultCode) {
    summary.defaultActionIds = [...new Set([...summary.defaultActionIds, input.actionId])]
      .sort(compareCanonicalText);
    summary.defaultCodes = [...new Set([...summary.defaultCodes, input.defaultCode])]
      .sort(compareCanonicalText);
  }
}

export interface PlannedChapterOpeningV1 {
  chapterRuntimeId: string;
  state: ChapterOrchestratorStateV1;
  event: ReturnType<typeof planWorkingLedgerOpeningV1>["event"];
  projection: ReturnType<typeof planWorkingLedgerOpeningV1>["projection"];
}

/** Pure N1-N7 opening authority shared by ordinary W4 and the SQL7 boundary. */
export function planChapterOpeningV1(input: Readonly<{
  routeSnapshot: RunRouteSnapshotV1;
  chapter: AuthoredChapterRuntimeV1;
  authorityBase: ChapterAuthorityBaseV1;
  expected: ChapterOrchestratorStateV1 | null;
  seed: ChapterWorkingState;
  nowMs: number;
}>): PlannedChapterOpeningV1 {
  const route = validateRunRouteSnapshotV1(input.routeSnapshot);
  const chapter = validateAuthoredChapterRuntimeV1(input.chapter);
  const expected = input.expected
    ? validateOrchestratorStateV1(input.expected)
    : null;
  assertNow(input.nowMs);
  if (
    input.authorityBase.baseWorldSequence !== chapterSequence(chapter.chapterId) - 1
    || (expected !== null && (
      expected.runId !== route.runId
      || expected.routeHash !== route.routeHash
      || expected.phase !== "FROZEN"
      || expected.authorityBase.previousFrozenHash
        !== input.authorityBase.previousFrozenHash
    ))
  ) failChapterOrchestrator(ERROR.STATE_CORRUPT, "opening-authority");
  const chapterRuntimeId = deterministicChapterRuntimeId(
    route.runId,
    chapter.chapterId,
    input.authorityBase.previousFrozenHash,
  );
  const opening = planWorkingLedgerOpeningV1({
    routeSnapshot: route,
    chapterRuntimeId,
    chapterDefinition: chapter.definition,
    initialState: input.seed,
  });
  const workingSet = buildChapterWorkingSet(chapter.definition, opening.projection.state);
  if (
    !workingSet
    || opening.projection.nextDecisionPin?.decisionPointId
      !== workingSet.decisionPoint.decisionPointId
    || opening.projection.state.revision !== 0
  ) failChapterOrchestrator(ERROR.CONTENT_INVALID, "initial-kernel-pin");
  const active = buildActiveDecision(
    chapter,
    workingSet.decisionPoint.decisionPointId,
    input.nowMs,
  );
  const state = withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: expected ? expected.revision + 1 : 0,
    phase: "ACTIVE",
    currentChapterId: chapter.chapterId,
    chapterRuntimeId,
    descriptorHash: chapter.descriptorHash,
    authorityBase: structuredClone(input.authorityBase),
    activeDecision: active,
    chapterSeatSummaries: initialSeatSummaries(),
    settlementInputHash: null,
    frozenBundleHash: null,
  });
  return {
    chapterRuntimeId,
    state,
    event: opening.event,
    projection: opening.projection,
  };
}

/**
 * Pure W4 fold shared by the ordinary batch writer and recovery.  It records
 * a complete set of already-authorized W5 actions and optionally claims Beat
 * resolution in that same W4 revision.
 */
export function planRecordedActionsV1(
  stateValue: ChapterOrchestratorStateV1,
  inputs: ReadonlyArray<Readonly<{
    seatId: SeatIdV1;
    actionId: string;
    defaultCode: string | null;
    actionBudget: number;
  }>>,
  claimResolutionWhenComplete: boolean,
): ChapterOrchestratorStateV1 {
  const state = validateOrchestratorStateV1(stateValue);
  if (state.phase !== "ACTIVE" || !state.activeDecision) {
    failChapterOrchestrator(ERROR.INVALID_PHASE, state.phase);
  }
  const active = structuredClone(state.activeDecision);
  const summaries = structuredClone(state.chapterSeatSummaries);
  for (const input of inputs) foldRecordedAction(active, summaries, input);
  const complete = active.seats
    .filter((seat) => seat.requirement === "REQUIRED")
    .every((seat) => seat.completion !== "PENDING");
  return nextState(state, {
    phase: claimResolutionWhenComplete && complete ? "RESOLVING_BEAT" : "ACTIVE",
    activeDecision: active,
    chapterSeatSummaries: summaries,
  });
}

/** Pure W4 transition after a deterministic Beat has already been planned. */
export function planBeatProgressionV1(input: Readonly<{
  state: ChapterOrchestratorStateV1;
  descriptor: AuthoredChapterRuntimeV1;
  projection: Awaited<ReturnType<WorkingProjectionReaderPort["load"]>>;
  resolution: Parameters<typeof validateBeatResolutionV1>[0];
  nowMs: number;
}>): Readonly<{
  nextState: ChapterOrchestratorStateV1;
  settlementInput: ReturnType<typeof compileSettlementInputV1> | null;
}> {
  const state = validateOrchestratorStateV1(input.state);
  const descriptor = validateAuthoredChapterRuntimeV1(input.descriptor);
  assertNow(input.nowMs);
  if (
    state.phase !== "RESOLVING_BEAT"
    || !state.activeDecision
    || descriptor.chapterId !== state.currentChapterId
    || descriptor.descriptorHash !== state.descriptorHash
  ) failChapterOrchestrator(ERROR.INVALID_PHASE, state.phase);
  const actionIds = [...new Set(state.activeDecision.seats.flatMap((seat) => seat.actionIds))]
    .sort(compareCanonicalText);
  if (!actionIds.length) failChapterOrchestrator(ERROR.CLOSE_POLICY_NOT_MET, "no-actions");
  const actions = actionIds.map((actionId) => {
    const accepted = input.projection.acceptedActions.get(actionId);
    if (!accepted) failChapterOrchestrator(ERROR.DECISION_MISMATCH, `missing-action:${actionId}`);
    return accepted.action;
  });
  const resolution = validateBeatResolutionV1(input.resolution, actions);
  if (!sameStrings([...resolution.sealedActionIds].sort(compareCanonicalText), actionIds)) {
    failChapterOrchestrator(ERROR.DECISION_MISMATCH, "beat-action-set");
  }
  assertProjectionContext(state, input.projection);
  const nextPin = input.projection.nextDecisionPin;
  if (nextPin) {
    assertKernelPin(descriptor, input.projection, nextPin.decisionPointId);
    return {
      nextState: nextState(state, {
        phase: "ACTIVE",
        activeDecision: buildActiveDecision(descriptor, nextPin.decisionPointId, input.nowMs),
      }),
      settlementInput: null,
    };
  }
  assertChapterClose(descriptor, input.projection.state.completedDecisionPointIds);
  const settlementInput = compileSettlementInputV1(state, descriptor, input.projection);
  return {
    nextState: nextState(state, {
      phase: "SETTLING",
      activeDecision: null,
      settlementInputHash: settlementInput.inputHash,
    }),
    settlementInput,
  };
}

function buildActiveDecision(
  descriptor: AuthoredChapterRuntimeV1,
  decisionPointId: string,
  nowMs: number,
): ActiveDecisionStateV1 {
  const decision = requireDecision(descriptor, decisionPointId);
  const deadline = decision.execution.deadlinePolicy;
  return {
    decisionPointId,
    policyHash: sha256Canonical(decision),
    openedAtMs: nowMs,
    deadlineAtMs: deadline ? nowMs + deadline.durationMs : null,
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId): ActiveDecisionSeatV1 => {
      const requirement = decision.seatRequirements[seatId];
      return {
        seatId,
        requirement,
        completion: requirement === "REQUIRED" ? "PENDING" : "NOT_REQUIRED",
        actionIds: [],
        actionCount: 0,
        defaultCode: null,
      };
    }),
  };
}

function initialSeatSummaries(): ChapterSeatSummaryV1[] {
  return PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
    seatId,
    requirement: "NOT_REQUIRED",
    sealedActionIds: [],
    defaultActionIds: [],
    defaultCodes: [],
  }));
}

export function compileSettlementInputV1(
  state: ChapterOrchestratorStateV1,
  descriptor: AuthoredChapterRuntimeV1,
  projection: Awaited<ReturnType<WorkingProjectionReaderPort["load"]>>,
) {
  const reservationLedger = [...projection.pendingReservations.values()]
    .map((reservation) => ({ ...reservation }))
    .sort((left, right) => compareCanonicalText(left.reservationKey, right.reservationKey));
  const body = {
    schemaVersion: "sangtian_chapter_settlement_input_v1" as const,
    runId: state.runId,
    chapterRuntimeId: state.chapterRuntimeId,
    chapterId: state.currentChapterId,
    baseWorldSequence: state.authorityBase.baseWorldSequence,
    baseWorldStateHash: state.authorityBase.baseWorldStateHash,
    runRouteHash: state.routeHash,
    previousFrozenHash: state.authorityBase.previousFrozenHash,
    decisionLedgerHash: projection.headHash,
    finalWorkingStateHash: projection.stateHash,
    sealedDecisionActionIds: [...projection.acceptedActions.keys()].sort(compareCanonicalText),
    reservationLedgerHash: sha256Canonical(reservationLedger),
    contentPolicyVersion: descriptor.contentPolicyVersion,
    contentPolicyHash: descriptor.contentPolicyHash,
    settlementContractVersion: descriptor.settlementContractVersion,
    settlementContractHash: descriptor.settlementContractHash,
  };
  return validateSealedChapterSettlementInputV1({
    ...body,
    inputHash: sha256Canonical(body),
  });
}

export function compileSeatParticipationV1(summaries: ChapterSeatSummaryV1[]) {
  return summaries.map((summary) => {
    if (summary.requirement === "NOT_REQUIRED") {
      return {
        seatId: summary.seatId,
        requirement: "NOT_REQUIRED" as const,
        completion: "NOT_REQUIRED" as const,
        defaultCodes: [] as string[],
      };
    }
    const defaults = new Set(summary.defaultActionIds);
    const defaultActionCount = summary.sealedActionIds
      .filter((actionId) => defaults.has(actionId)).length;
    const nonDefaultActionCount =
      summary.sealedActionIds.length - defaultActionCount;
    const defaultCodes = [...new Set(summary.defaultCodes)]
      .sort(compareCanonicalText);
    if (defaultActionCount > 0 && nonDefaultActionCount > 0) {
      return {
        seatId: summary.seatId,
        requirement: "REQUIRED" as const,
        completion: "MIXED_ACTIONS" as const,
        defaultCodes,
      };
    }
    if (defaultActionCount > 0) {
      return {
        seatId: summary.seatId,
        requirement: "REQUIRED" as const,
        completion: "DEFAULTED" as const,
        defaultCodes,
      };
    }
    return {
      seatId: summary.seatId,
      requirement: "REQUIRED" as const,
      completion: "SEALED_ACTIONS" as const,
      defaultCodes: [],
    };
  });
}

function assertChapterClose(
  descriptor: AuthoredChapterRuntimeV1,
  completedDecisionPointIds: string[],
): void {
  const required = [...descriptor.chapterClosePolicy.decisionPointIds].sort(compareCanonicalText);
  const completed = new Set(completedDecisionPointIds);
  if (!required.every((decisionPointId) => completed.has(decisionPointId))) {
    failChapterOrchestrator(ERROR.KERNEL_EXHAUSTED_EARLY, descriptor.chapterId);
  }
}

function assertKernelPin(
  descriptor: AuthoredChapterRuntimeV1,
  projection: Awaited<ReturnType<WorkingProjectionReaderPort["load"]>>,
  expectedDecisionPointId: string,
): void {
  const selected = buildChapterWorkingSet(descriptor.definition, projection.state);
  if (
    !selected
    || selected.decisionPoint.decisionPointId !== expectedDecisionPointId
    || projection.nextDecisionPin?.decisionPointId !== expectedDecisionPointId
  ) failChapterOrchestrator(ERROR.DECISION_MISMATCH, "kernel-pin");
}

function assertProjectionContext(
  state: ChapterOrchestratorStateV1,
  projection: Awaited<ReturnType<WorkingProjectionReaderPort["load"]>>,
): void {
  if (
    projection.key.runId !== state.runId
    || projection.key.chapterRuntimeId !== state.chapterRuntimeId
    || projection.chapterId !== state.currentChapterId
    || projection.routeHash !== state.routeHash
  ) failChapterOrchestrator(ERROR.STATE_CORRUPT, "working-projection");
}

function requireDecision(
  descriptor: AuthoredChapterRuntimeV1,
  decisionPointId: string,
): AuthoredDecisionRuntimeV1 {
  const decision = descriptor.decisions.find((candidate) => candidate.decisionPointId === decisionPointId);
  if (!decision) failChapterOrchestrator(ERROR.DECISION_MISMATCH, decisionPointId);
  return decision;
}

function recoveredDefaultCode(
  idempotencyKey: string,
  decision: AuthoredDecisionRuntimeV1,
): string | null {
  if (!idempotencyKey.startsWith("pressure-default-v1:")) return null;
  const candidates = [
    { reason: "DEADLINE", policy: decision.execution.absenceDefaultPolicy },
    { reason: "AI_FAILURE", policy: decision.execution.aiFailureDefaultPolicy },
  ] as const;
  const matched = candidates.find(({ reason, policy }) => (
    idempotencyKey.endsWith(`:${reason}:${policy.policyHash}`)
  ));
  if (!matched) failChapterOrchestrator(ERROR.STATE_CORRUPT, "default-idempotency-key");
  return matched.policy.policyRef;
}

function requireActiveDecision(state: ChapterOrchestratorStateV1): ActiveDecisionStateV1 {
  if (!state.activeDecision) failChapterOrchestrator(ERROR.STATE_CORRUPT, "active-decision");
  return state.activeDecision;
}

function requireSeat(active: ActiveDecisionStateV1, seatId: SeatIdV1): ActiveDecisionSeatV1 {
  const seat = active.seats.find((candidate) => candidate.seatId === seatId);
  if (!seat) failChapterOrchestrator(ERROR.STATE_CORRUPT, `seat:${seatId}`);
  return seat;
}

function nextState(
  state: ChapterOrchestratorStateV1,
  patch: Partial<Omit<ChapterOrchestratorStateV1, "schemaVersion" | "runId" | "routeHash" | "revision" | "orchestratorHash">>,
): ChapterOrchestratorStateV1 {
  const { orchestratorHash: _hash, ...body } = state;
  return withOrchestratorHashV1({
    ...body,
    ...structuredClone(patch),
    revision: state.revision + 1,
  });
}

function deterministicChapterRuntimeId(
  runId: string,
  chapterId: ChapterIdV1,
  previousFrozenHash: string,
): string {
  return `chapter_${chapterId}_${sha256Canonical({ runId, chapterId, previousFrozenHash }).slice(0, 24)}`;
}

function assertRoute(state: ChapterOrchestratorStateV1, route: RunRouteSnapshotV1): void {
  if (state.runId !== route.runId || state.routeHash !== route.routeHash) {
    failChapterOrchestrator(ERROR.ROUTE_MISMATCH);
  }
}

function assertHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) failChapterOrchestrator(ERROR.STATE_CORRUPT, field);
}

function assertNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    failChapterOrchestrator(ERROR.STATE_CORRUPT, "nowMs");
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
