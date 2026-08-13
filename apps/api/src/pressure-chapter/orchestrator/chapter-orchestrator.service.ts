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
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  buildChapterWorkingSet,
  createChapterWorkingState,
} from "@ai-story/templates";
import {
  measurePressureDecisionStageV1,
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
    const settlementInput = compileSettlementInput(state, descriptor, result.projection);
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
    return this.driveSettlement(route, settling, nowMs);
  }

  private async driveSettlement(
    route: RunRouteSnapshotV1,
    state: ChapterOrchestratorStateV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    if (state.phase !== "SETTLING") failChapterOrchestrator(ERROR.INVALID_PHASE, state.phase);
    const descriptor = await this.loadDescriptor(route, state.currentChapterId, state.descriptorHash);
    const projection = await this.loadProjection(state);
    assertChapterClose(descriptor, projection.state.completedDecisionPointIds);
    const settlementInput = compileSettlementInput(state, descriptor, projection);
    if (state.settlementInputHash !== settlementInput.inputHash) {
      failChapterOrchestrator(ERROR.SETTLEMENT_MISMATCH, "sealed-input");
    }
    const result = await measurePressureDecisionStageV1(
      "settlementMs",
      () => this.settlement.settle({
        routeSnapshot: route,
        settlementInput,
        chapterDescriptorHash: descriptor.descriptorHash,
        seatParticipation: compileSeatParticipation(state.chapterSeatSummaries),
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
    return this.driveFrozen(route, frozen, nowMs);
  }

  private async driveFrozen(
    route: RunRouteSnapshotV1,
    state: ChapterOrchestratorStateV1,
    nowMs: number,
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
      }),
    );
  }

  private async openChapter(input: {
    route: RunRouteSnapshotV1;
    chapterId: ChapterIdV1;
    authorityBase: ChapterAuthorityBaseV1;
    expected: ChapterOrchestratorStateV1 | null;
    nowMs: number;
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
    const seed = await this.seeds.load({
      routeSnapshot: input.route,
      chapter: descriptor,
      authorityBase: input.authorityBase,
    });
    if (
      seed.runId !== input.route.runId
      || seed.chapterId !== input.chapterId
      || seed.revision !== 0
    ) failChapterOrchestrator(ERROR.CONTENT_INVALID, "working-seed");
    await this.ledgerOpening.open({
      routeSnapshot: input.route,
      chapterRuntimeId,
      chapterDefinition: descriptor.definition,
      initialState: seed,
    });
    const projection = await this.projections.load({
      runId: input.route.runId,
      chapterRuntimeId,
    });
    const workingSet = buildChapterWorkingSet(descriptor.definition, seed);
    if (
      !workingSet
      || projection.nextDecisionPin?.decisionPointId !== workingSet.decisionPoint.decisionPointId
      || projection.state.revision !== 0
    ) failChapterOrchestrator(ERROR.CONTENT_INVALID, "initial-kernel-pin");
    const active = buildActiveDecision(descriptor, workingSet.decisionPoint.decisionPointId, input.nowMs);
    const next = withOrchestratorHashV1({
      schemaVersion: "pressure_chapter_orchestrator_state_v1",
      runId: input.route.runId,
      routeHash: input.route.routeHash,
      revision: input.expected ? input.expected.revision + 1 : 0,
      phase: "ACTIVE",
      currentChapterId: input.chapterId,
      chapterRuntimeId,
      descriptorHash: descriptor.descriptorHash,
      authorityBase: structuredClone(input.authorityBase),
      activeDecision: active,
      chapterSeatSummaries: initialSeatSummaries(),
      settlementInputHash: null,
      frozenBundleHash: null,
    });
    const saved = await this.states.compareAndSwap({
      runId: input.route.runId,
      expectedRevision: input.expected?.revision ?? null,
      next,
    });
    if (saved.status === "COMMITTED") return next;
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

    const nextActive = structuredClone(active);
    const nextSummaries = structuredClone(state.chapterSeatSummaries);
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
      foldRecordedAction(nextActive, nextSummaries, {
        seatId,
        actionId: accepted.action.actionId,
        defaultCode: recoveredDefaultCode(accepted.action.idempotencyKey, decision),
        actionBudget: budget,
      });
    }
    const next = nextState(state, {
      activeDecision: nextActive,
      chapterSeatSummaries: nextSummaries,
    });
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

function compileSettlementInput(
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

function compileSeatParticipation(summaries: ChapterSeatSummaryV1[]) {
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
