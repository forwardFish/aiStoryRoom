import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  assertSangtianPressureRouteV1,
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  type DeterministicDefaultPolicyV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  AuthoredDecisionRuntimeV1,
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import {
  validateAuthoredChapterRuntimeV1,
  validateOrchestratorStateV1,
} from "../orchestrator/validation";
import type {
  FrozenDefaultSourceProofV1,
  FrozenDeadlineTakeoverProofV1,
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
} from "../seat-control/types";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { workingStateHash } from "../working-ledger/working-ledger";
import type {
  DeadlineDefaultExpectedDecisionV1,
  DeadlineDefaultProductionResultV1,
  PressureDeadlineDefaultCoordinatorPortV1,
  PressureDeadlineDefaultProductionDependenciesV1,
} from "./contracts";
import {
  DEADLINE_DEFAULT_PRODUCTION_ERROR_CODES_V1 as ERROR,
  failDeadlineDefaultProductionV1,
} from "./errors";

/**
 * Production bridge from a frozen W4 deadline/AI failure to W7 authority.
 * It persists deterministic proof before every seat transition/directive and
 * calls only the existing W4 runtime default methods. It has no Provider or
 * Narrative dependency, keeping all AI fill decisions zero-LLM.
 */
export class PressureDeadlineDefaultProductionServiceV1
implements PressureDeadlineDefaultCoordinatorPortV1 {
  constructor(
    private readonly ports: PressureDeadlineDefaultProductionDependenciesV1,
  ) {}

  async advanceExpiredDecision(input: Readonly<{
    routeSnapshot: RunRouteSnapshotV1;
    expected: DeadlineDefaultExpectedDecisionV1;
    nowMs: number;
  }>): Promise<DeadlineDefaultProductionResultV1> {
    const context = await this.loadContext(input.routeSnapshot, input.expected);
    if (context.kind === "STALE") return context;
    const { route, state, decision, projection } = context;
    const deadline = decision.execution.deadlinePolicy;
    if (
      !deadline
      || deadline.expiryAction !== "APPLY_DEFAULT"
      || state.activeDecision!.deadlineAtMs === null
      || input.nowMs < state.activeDecision!.deadlineAtMs
    ) {
      return failDeadlineDefaultProductionV1(
        ERROR.DEADLINE_NOT_APPLICABLE,
        "activeDecision.deadline",
        "FROZEN_APPLY_DEFAULT_DEADLINE_NOT_REACHED",
      );
    }

    const defaultCandidates = pendingRequiredSeats(state).filter(
      (pending) => !hasAcceptedAction(projection, state, pending.seatId),
    );

    // Freeze every pending human seat that has no already-accepted W5 action.
    // Doing all transitions before any directive gives every directive the
    // same final authority state hash. W5-accepted/W4-unrecorded actions are
    // preserved and reconciled by runtime.resume below instead of defaulted.
    let seats = await this.requireSeatSnapshot(route);
    for (const pending of defaultCandidates) {
      const authority = requireSeat(seats, pending.seatId);
      if (authority.mode === "AI_ACTIVE") continue;
      const proof = deadlineTakeoverProof(
        route,
        state,
        projection,
        seats,
        authority,
      );
      await this.persistProof("DEADLINE_TAKEOVER", proof, seats);
      await this.ports.seatControl.takeoverAtFrozenDeadline({
        runId: route.runId,
        seatId: authority.seatId,
        expectedControlEpoch: authority.controlEpoch,
        expectedStateHash: seats.stateHash,
        proof,
        idempotencyKey: `pressure-deadline-takeover-v1:${proof.proofHash}`,
      });
      seats = await this.requireSeatSnapshot(route);
    }

    for (const pending of defaultCandidates) {
      const authority = requireSeat(seats, pending.seatId);
      if (
        authority.mode !== "AI_ACTIVE"
        || authority.activeControllerId !== authority.designatedAiControllerId
      ) {
        return failDeadlineDefaultProductionV1(
          ERROR.AUTHORITY_INVALID,
          `seat.${authority.seatId}`,
          "DEFAULT_REQUIRES_CURRENT_AI_AUTHORITY",
        );
      }
      const proof = defaultSourceProof({
        route,
        state,
        projection,
        seats,
        authority,
        trigger: "HUMAN_DEADLINE",
        policy: decision.execution.absenceDefaultPolicy,
        causeCode: "FROZEN_DEADLINE_REACHED",
      });
      await this.persistProof("DEFAULT_SOURCE", proof, seats);
      await this.ports.seatControl.resolveDeterministicDefault({
        runId: route.runId,
        seatId: authority.seatId,
        expectedControlEpoch: authority.controlEpoch,
        expectedStateHash: seats.stateHash,
        sourceProof: proof,
        idempotencyKey: defaultActionIdempotencyKey(
          state,
          decision,
          authority.seatId,
          "DEADLINE",
        ),
      });
    }

    const hasRecoveryWork = defaultCandidates.length !== pendingRequiredSeats(state).length;
    return {
      kind: "APPLIED",
      state: validateRuntimeResult(
        hasRecoveryWork
          ? await this.ports.runtime.resume(route, input.nowMs)
          : await this.ports.runtime.advanceDeadline(route, input.nowMs),
        route,
      ),
    };
  }

  async applyAiFailure(input: Readonly<{
    routeSnapshot: RunRouteSnapshotV1;
    expected: DeadlineDefaultExpectedDecisionV1;
    seatId: SeatIdV1;
    failureCode: string;
    nowMs: number;
  }>): Promise<DeadlineDefaultProductionResultV1> {
    text(input.failureCode, "failureCode");
    const context = await this.loadContext(input.routeSnapshot, input.expected);
    if (context.kind === "STALE") return context;
    const { route, state, decision, projection } = context;
    const pending = state.activeDecision!.seats.find(
      (seat) => seat.seatId === input.seatId,
    );
    if (
      !pending
      || pending.requirement !== "REQUIRED"
      || pending.completion !== "PENDING"
      || pending.actionCount !== 0
    ) {
      return { kind: "STALE", state };
    }
    const seats = await this.requireSeatSnapshot(route);
    const authority = requireSeat(seats, input.seatId);
    if (
      authority.mode !== "AI_ACTIVE"
      || authority.activeControllerId !== authority.designatedAiControllerId
    ) {
      return failDeadlineDefaultProductionV1(
        ERROR.AUTHORITY_INVALID,
        `seat.${authority.seatId}`,
        "AI_FAILURE_REQUIRES_CURRENT_AI_AUTHORITY",
      );
    }
    const proof = defaultSourceProof({
      route,
      state,
      projection,
      seats,
      authority,
      trigger: "AI_FAILURE",
      policy: decision.execution.aiFailureDefaultPolicy,
      causeCode: input.failureCode,
    });
    await this.persistProof("DEFAULT_SOURCE", proof, seats);
    await this.ports.seatControl.resolveDeterministicDefault({
      runId: route.runId,
      seatId: authority.seatId,
      expectedControlEpoch: authority.controlEpoch,
      expectedStateHash: seats.stateHash,
      sourceProof: proof,
      idempotencyKey: defaultActionIdempotencyKey(
        state,
        decision,
        authority.seatId,
        "AI_FAILURE",
      ),
    });
    return {
      kind: "APPLIED",
      state: validateRuntimeResult(
        await this.ports.runtime.applyAiFailure(
          route,
          input.seatId,
          input.nowMs,
        ),
        route,
      ),
    };
  }

  private async loadContext(
    routeRaw: RunRouteSnapshotV1,
    expected: DeadlineDefaultExpectedDecisionV1,
  ): Promise<
    | {
        kind: "ACTIVE";
        route: RunRouteSnapshotV1;
        state: ChapterOrchestratorStateV1;
        decision: AuthoredDecisionRuntimeV1;
        projection: WorkingLedgerProjectionV1;
      }
    | { kind: "STALE"; state: ChapterOrchestratorStateV1 }
  > {
    const route = validateRunRouteSnapshotV1(routeRaw);
    assertSangtianPressureRouteV1(route.route);
    const raw = await this.ports.orchestrators.read(route.runId);
    if (!raw) return invalid(ERROR.AUTHORITY_INVALID, "orchestrator", "MISSING");
    const state = validateOrchestratorStateV1(raw);
    if (state.runId !== route.runId || state.routeHash !== route.routeHash) {
      return invalid(ERROR.AUTHORITY_INVALID, "orchestrator", "ROUTE_MISMATCH");
    }
    if (
      state.phase !== "ACTIVE"
      || !state.activeDecision
      || state.chapterRuntimeId !== expected.chapterRuntimeId
      || state.activeDecision.decisionPointId !== expected.decisionPointId
      || state.revision !== expected.expectedOrchestratorRevision
    ) {
      return { kind: "STALE", state };
    }
    const descriptor = validateAuthoredChapterRuntimeV1(await this.ports.content.load({
      routeSnapshot: route,
      chapterId: state.currentChapterId,
    }));
    if (descriptor.descriptorHash !== state.descriptorHash) {
      return invalid(ERROR.CONTENT_INVALID, "content", "DESCRIPTOR_HASH_MISMATCH");
    }
    const decision = descriptor.decisions.find(
      (candidate) => candidate.decisionPointId === expected.decisionPointId,
    );
    if (!decision || sha256Canonical(decision) !== state.activeDecision.policyHash) {
      return invalid(ERROR.CONTENT_INVALID, "content.decision", "POLICY_MISMATCH");
    }
    const projection = await this.ports.working.load({
      runId: route.runId,
      chapterRuntimeId: state.chapterRuntimeId,
    });
    if (
      projection.key.runId !== route.runId
      || projection.key.chapterRuntimeId !== state.chapterRuntimeId
      || projection.routeHash !== route.routeHash
      || projection.chapterId !== state.currentChapterId
      || projection.stateHash !== workingStateHash(projection.state)
      || projection.nextDecisionPin?.decisionPointId !== expected.decisionPointId
    ) {
      return invalid(ERROR.AUTHORITY_INVALID, "working", "PROJECTION_MISMATCH");
    }
    return { kind: "ACTIVE", route, state, decision, projection };
  }

  private async requireSeatSnapshot(
    route: RunRouteSnapshotV1,
  ): Promise<SeatControlSnapshotV1> {
    const snapshot = await this.ports.seats.readSnapshot(route.runId);
    if (
      !snapshot
      || snapshot.schemaVersion !== "pressure_seat_control_snapshot_v1"
      || snapshot.runId !== route.runId
      || snapshot.routeHash !== route.routeHash
      || !isSha256(snapshot.stateHash)
      || !isSha256(snapshot.frozenPolicy.policyHash)
    ) {
      return invalid(ERROR.AUTHORITY_INVALID, "seatAuthority", "SNAPSHOT_MISMATCH");
    }
    return snapshot;
  }

  private async persistProof(
    proofKind: "DEADLINE_TAKEOVER" | "DEFAULT_SOURCE",
    proof: FrozenDeadlineTakeoverProofV1 | FrozenDefaultSourceProofV1,
    seats: SeatControlSnapshotV1,
  ): Promise<void> {
    const result = await this.ports.proofs.persistOnce({
      proofKind,
      proof,
      authorityStateHash: seats.stateHash,
      frozenPolicyHash: seats.frozenPolicy.policyHash,
    });
    if (result.status !== "COMMITTED" && result.status !== "REPLAYED") {
      return invalid(
        ERROR.PROOF_PERSISTENCE_INVALID,
        "proofs.persistOnce",
        "UNKNOWN_RESULT",
      );
    }
  }
}

function pendingRequiredSeats(state: ChapterOrchestratorStateV1) {
  return state.activeDecision!.seats.filter((seat) =>
    seat.requirement === "REQUIRED"
    && seat.completion === "PENDING"
    && seat.actionCount === 0
    && seat.actionIds.length === 0
  );
}

function hasAcceptedAction(
  projection: WorkingLedgerProjectionV1,
  state: ChapterOrchestratorStateV1,
  seatId: SeatIdV1,
): boolean {
  return [...projection.acceptedActions.values()].some((accepted) =>
    accepted.action.runId === state.runId
    && accepted.action.chapterRuntimeId === state.chapterRuntimeId
    && accepted.action.chapterId === state.currentChapterId
    && accepted.action.decisionPointId === state.activeDecision!.decisionPointId
    && accepted.action.seatId === seatId
    && accepted.action.status === "SEALED"
  );
}

function deadlineTakeoverProof(
  route: RunRouteSnapshotV1,
  state: ChapterOrchestratorStateV1,
  projection: WorkingLedgerProjectionV1,
  seats: SeatControlSnapshotV1,
  authority: SeatAuthorityRecordV1,
): FrozenDeadlineTakeoverProofV1 {
  const base = {
    schemaVersion: "pressure_frozen_deadline_takeover_proof_v1" as const,
    runId: route.runId,
    decisionPointId: state.activeDecision!.decisionPointId,
    seatId: authority.seatId,
    expectedControlEpoch: authority.controlEpoch,
    deadlinePolicyRef: seats.frozenPolicy.takeoverDeadlinePolicyRef,
    deadlinePolicyHash: seats.frozenPolicy.takeoverDeadlinePolicyHash,
    closedWorkingInputHash: sha256Canonical({
      schemaVersion: "pressure_deadline_closed_working_input_v1",
      runId: route.runId,
      routeHash: route.routeHash,
      chapterRuntimeId: state.chapterRuntimeId,
      orchestratorRevision: state.revision,
      orchestratorHash: state.orchestratorHash,
      decisionPointId: state.activeDecision!.decisionPointId,
      deadlineAtMs: state.activeDecision!.deadlineAtMs,
      workingRevision: projection.state.revision,
      workingStateHash: projection.stateHash,
      authorityStateHash: seats.stateHash,
    }),
  };
  return { ...base, proofHash: sha256Canonical(base) };
}

function defaultSourceProof(input: {
  route: RunRouteSnapshotV1;
  state: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1;
  seats: SeatControlSnapshotV1;
  authority: SeatAuthorityRecordV1;
  trigger: "HUMAN_DEADLINE" | "AI_FAILURE";
  policy: DeterministicDefaultPolicyV1;
  causeCode: string;
}): FrozenDefaultSourceProofV1 {
  const base = {
    schemaVersion: "pressure_frozen_default_source_proof_v1" as const,
    runId: input.route.runId,
    decisionPointId: input.state.activeDecision!.decisionPointId,
    seatId: input.authority.seatId,
    expectedControlEpoch: input.authority.controlEpoch,
    trigger: input.trigger,
    defaultPolicyRef: input.seats.frozenPolicy.deterministicDefaultPolicyRef,
    defaultPolicyHash: input.seats.frozenPolicy.deterministicDefaultPolicyHash,
    canonicalActionPayloadHash: sha256Canonical(input.policy.payload),
    causeInputHash: sha256Canonical({
      schemaVersion: "pressure_default_cause_input_v1",
      runId: input.route.runId,
      routeHash: input.route.routeHash,
      chapterRuntimeId: input.state.chapterRuntimeId,
      orchestratorRevision: input.state.revision,
      orchestratorHash: input.state.orchestratorHash,
      decisionPointId: input.state.activeDecision!.decisionPointId,
      seatId: input.authority.seatId,
      controlEpoch: input.authority.controlEpoch,
      authorityStateHash: input.seats.stateHash,
      trigger: input.trigger,
      causeCode: input.causeCode,
      authoredDefaultPolicyHash: input.policy.policyHash,
      canonicalActionPayloadHash: sha256Canonical(input.policy.payload),
      workingRevision: input.projection.state.revision,
      workingStateHash: input.projection.stateHash,
    }),
  };
  return { ...base, proofHash: sha256Canonical(base) };
}

/**
 * Must stay byte-for-byte aligned with ChapterOrchestratorService.submitDefault.
 * The seat directive authorizes the exact formal action, so both layers use
 * the same idempotency identity rather than a private proof-storage key.
 */
function defaultActionIdempotencyKey(
  state: ChapterOrchestratorStateV1,
  decision: AuthoredDecisionRuntimeV1,
  seatId: SeatIdV1,
  reason: "DEADLINE" | "AI_FAILURE",
): string {
  const policy = reason === "DEADLINE"
    ? decision.execution.absenceDefaultPolicy
    : decision.execution.aiFailureDefaultPolicy;
  return [
    "pressure-default-v1",
    state.runId,
    state.chapterRuntimeId,
    decision.decisionPointId,
    seatId,
    reason,
    policy.policyHash,
  ].join(":");
}

function requireSeat(
  snapshot: SeatControlSnapshotV1,
  seatId: SeatIdV1,
): SeatAuthorityRecordV1 {
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId)) {
    return invalid(ERROR.AUTHORITY_INVALID, "seatId", "UNKNOWN_SEAT");
  }
  const seat = snapshot.seatControls.find((candidate) => candidate.seatId === seatId);
  if (
    !seat
    || !Number.isSafeInteger(seat.controlEpoch)
    || seat.controlEpoch < 1
    || !isSha256(seat.submissionFenceToken)
  ) {
    return invalid(ERROR.AUTHORITY_INVALID, `seat.${seatId}`, "INVALID_RECORD");
  }
  return seat;
}

function validateRuntimeResult(
  raw: ChapterOrchestratorStateV1,
  route: RunRouteSnapshotV1,
): ChapterOrchestratorStateV1 {
  const state = validateOrchestratorStateV1(raw);
  if (state.runId !== route.runId || state.routeHash !== route.routeHash) {
    return invalid(ERROR.RUNTIME_RESULT_INVALID, "runtime.state", "ROUTE_MISMATCH");
  }
  return state;
}

function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(ERROR.AUTHORITY_INVALID, path, "NON_EMPTY_STRING");
  }
}

function invalid<T = never>(
  code: Parameters<typeof failDeadlineDefaultProductionV1>[0],
  path: string,
  detail: string,
): T {
  return failDeadlineDefaultProductionV1(code, path, detail);
}
