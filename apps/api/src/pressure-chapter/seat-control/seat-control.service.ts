import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import { assertInitialRoleControlTopology } from "../run-router";
import { SEAT_CONTROL_ERROR_CODES as ERROR, failSeatControl } from "./errors";
import type {
  CommittedSeatControlCommandV1,
  ExplicitHandoffToAiCommandV1,
  FrozenDeadlineTakeoverCommandV1,
  FrozenDeadlineTakeoverProofV1,
  FrozenDefaultSourceProofV1,
  FrozenSeatControlPolicyReaderPort,
  FrozenSeatControlPolicyV1,
  HumanSeatAssignmentV1,
  InitializeSeatControlCommandV1,
  ReclaimSeatControlCommandV1,
  RecordSeatPresenceCommandV1,
  ResolveSeatDefaultCommandV1,
  SeatAuthorityRecordV1,
  SeatControlAuthorityPort,
  SeatControlCommandReceiptV1,
  SeatControlCommandResultV1,
  SeatControlDecisionAuthorityPort,
  SeatControlEventTypeV1,
  SeatControlEventV1,
  SeatControlGenesisAuthorityReaderPort,
  SeatControlOperationV1,
  SeatControlSnapshotV1,
  SeatDefaultDirectivePort,
  SeatDefaultDirectiveV1,
  SeatPresencePort,
  SeatPresenceRecordV1,
  SeatSubmissionAuthorityV1,
} from "./types";

const NON_EMPTY = /\S/;

export class SeatControlService {
  constructor(
    private readonly genesis: SeatControlGenesisAuthorityReaderPort,
    private readonly policies: FrozenSeatControlPolicyReaderPort,
    private readonly authority: SeatControlAuthorityPort,
    private readonly presence: SeatPresencePort,
    private readonly defaults: SeatDefaultDirectivePort,
    private readonly decisionAuthority: SeatControlDecisionAuthorityPort,
  ) {}

  async initialize(
    command: InitializeSeatControlCommandV1,
  ): Promise<SeatControlCommandResultV1> {
    assertNonEmpty(command.runId, "runId");
    assertNonEmpty(command.idempotencyKey, "idempotencyKey");
    const assignments = normalizeHumanAssignments(command.humanAssignments);
    const requestFingerprint = sha256Canonical({
      schemaVersion: "pressure_initialize_seat_control_request_v1",
      operation: "INITIALIZE",
      runId: command.runId,
      humanAssignments: assignments,
    });
    const replay = await this.readAuthorityReplay(
      command.runId,
      command.idempotencyKey,
      "INITIALIZE",
      requestFingerprint,
    );
    if (replay) return { status: "REPLAYED", committed: replay };

    const genesis = await this.genesis.readGenesisAuthority(command.runId);
    if (!genesis) failSeatControl(ERROR.GENESIS_NOT_COMMITTED, command.runId);
    assertGenesisAuthority(genesis, command.runId);
    assertInitialRoleControlTopology(genesis.controlTopology);
    const policy = await this.policies.readFrozenPolicy(command.runId);
    if (!policy) failSeatControl(ERROR.FROZEN_POLICY_MISSING, command.runId);
    assertFrozenPolicy(policy);
    assertAssignmentsMatchTopology(assignments, genesis.controlTopology);

    const initializationInputHash = sha256Canonical({
      schemaVersion: "pressure_seat_control_initialization_input_v1",
      runId: command.runId,
      genesisAtomicRecordHash: genesis.genesisAtomicRecordHash,
      initialTopologyHash: genesis.controlTopology.topologyHash,
      frozenPolicyHash: policy.policyHash,
      humanAssignments: assignments,
    });
    const humanBySeat = new Map(
      assignments.map((assignment) => [
        assignment.seatId,
        assignment.humanControllerId,
      ]),
    );
    const events: SeatControlEventV1[] = [];
    const controls: SeatAuthorityRecordV1[] = [];
    let previousEventHash = genesis.genesisHash;
    const orderedInitialControls = [...genesis.controlTopology.seatControls].sort(
      (left, right) => compareCanonicalText(left.seatId, right.seatId),
    );
    for (const [index, initial] of orderedInitialControls.entries()) {
      const humanControllerId = humanBySeat.get(initial.seatId) ?? null;
      const aiControllerId = designatedAiControllerId(
        command.runId,
        initial.seatId,
        genesis.genesisHash,
      );
      const activeControllerId = humanControllerId ?? aiControllerId;
      const event = buildEvent({
        runId: command.runId,
        eventSequence: index + 1,
        eventType: "CONTROL_INITIALIZED",
        seatId: initial.seatId,
        fromMode: null,
        toMode: initial.mode,
        fromControllerId: null,
        toControllerId: activeControllerId,
        fromControlEpoch: 0,
        toControlEpoch: 1,
        frozenPolicyHash: policy.policyHash,
        authorizationProofHash: initializationInputHash,
        previousEventHash,
      });
      events.push(event);
      controls.push({
        seatId: initial.seatId,
        mode: initial.mode,
        originalHumanControllerId: humanControllerId,
        designatedAiControllerId: aiControllerId,
        activeControllerId,
        controlEpoch: 1,
        submissionFenceToken: controlFence(
          "SUBMISSION",
          command.runId,
          initial.seatId,
          1,
          activeControllerId,
          event.eventHash,
        ),
        reclaimFenceToken: humanControllerId
          ? controlFence(
              "RECLAIM",
              command.runId,
              initial.seatId,
              1,
              humanControllerId,
              event.eventHash,
            )
          : null,
        lastAuthorityEventHash: event.eventHash,
      });
      previousEventHash = event.eventHash;
    }

    const snapshot = buildSnapshot({
      runId: command.runId,
      participantMode: genesis.controlTopology.participantMode,
      routeHash: genesis.routeHash,
      genesisHash: genesis.genesisHash,
      genesisAtomicRecordHash: genesis.genesisAtomicRecordHash,
      initialTopologyHash: genesis.controlTopology.topologyHash,
      controlTopologyVersion: genesis.controlTopology.controlTopologyVersion,
      frozenPolicy: policy,
      stateRevision: 1,
      timelineLength: events.length,
      timelineHeadHash: previousEventHash,
      seatControls: controls,
      initializationInputHash,
    });
    const receipt = buildReceipt({
      operation: "INITIALIZE",
      runId: command.runId,
      seatId: null,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
      snapshot,
      events,
    });
    const candidate = { snapshot, events, receipt };
    const committed = await this.authority.initializeOnce(candidate);
    if (committed.status === "ALREADY_INITIALIZED") {
      failSeatControl(ERROR.RUN_ALREADY_INITIALIZED, command.runId);
    }
    assertCommittedResult(
      committed.committed,
      command.runId,
      command.idempotencyKey,
      requestFingerprint,
      "INITIALIZE",
    );
    return {
      status: committed.status === "COMMITTED" ? "COMMITTED" : "REPLAYED",
      committed: committed.committed,
    };
  }

  async explicitHandoffToAi(
    command: ExplicitHandoffToAiCommandV1,
  ): Promise<SeatControlCommandResultV1> {
    assertBaseTransitionCommand(command);
    assertNonEmpty(command.humanControllerId, "humanControllerId");
    assertSha(command.expectedSubmissionFenceToken, "expectedSubmissionFenceToken");
    const requestFingerprint = sha256Canonical({
      schemaVersion: "pressure_explicit_handoff_request_v1",
      ...command,
    });
    const replay = await this.readAuthorityReplay(
      command.runId,
      command.idempotencyKey,
      "EXPLICIT_HANDOFF",
      requestFingerprint,
    );
    if (replay) return { status: "REPLAYED", committed: replay };
    const snapshot = await this.requireSnapshot(command.runId);
    const seat = requireSeat(snapshot, command.seatId);
    assertEpoch(seat, command.expectedControlEpoch);
    if (seat.submissionFenceToken !== command.expectedSubmissionFenceToken) {
      failSeatControl(ERROR.FENCE_REJECTED, command.seatId);
    }
    if (
      seat.mode !== "HUMAN_ACTIVE" ||
      seat.originalHumanControllerId !== command.humanControllerId ||
      seat.activeControllerId !== command.humanControllerId
    ) {
      failSeatControl(ERROR.CONTROLLER_FORBIDDEN, command.seatId);
    }
    const authorizationProofHash = sha256Canonical({
      schemaVersion: "pressure_explicit_handoff_authorization_v1",
      runId: command.runId,
      seatId: command.seatId,
      humanControllerId: command.humanControllerId,
      controlEpoch: seat.controlEpoch,
      submissionFenceToken: command.expectedSubmissionFenceToken,
      frozenPolicyHash: snapshot.frozenPolicy.policyHash,
    });
    return this.commitTransition({
      snapshot,
      seat,
      operation: "EXPLICIT_HANDOFF",
      eventType: "EXPLICIT_HANDOFF_TO_AI",
      toMode: "AI_ACTIVE",
      toControllerId: seat.designatedAiControllerId,
      authorizationProofHash,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
    });
  }

  async takeoverAtFrozenDeadline(
    command: FrozenDeadlineTakeoverCommandV1,
  ): Promise<SeatControlCommandResultV1> {
    assertBaseTransitionCommand(command);
    assertSha(command.expectedStateHash, "expectedStateHash");
    assertDeadlineProof(command.proof);
    const requestFingerprint = sha256Canonical({
      schemaVersion: "pressure_deadline_takeover_request_v1",
      ...command,
    });
    const replay = await this.readAuthorityReplay(
      command.runId,
      command.idempotencyKey,
      "DEADLINE_TAKEOVER",
      requestFingerprint,
    );
    if (replay) return { status: "REPLAYED", committed: replay };
    const snapshot = await this.requireSnapshot(command.runId);
    if (snapshot.stateHash !== command.expectedStateHash) {
      failSeatControl(ERROR.CONTROL_CHANGED, "STATE_HASH");
    }
    const seat = requireSeat(snapshot, command.seatId);
    assertEpoch(seat, command.expectedControlEpoch);
    if (seat.mode !== "HUMAN_ACTIVE") {
      failSeatControl(ERROR.TRANSITION_NOT_ALLOWED, "TAKEOVER_REQUIRES_HUMAN");
    }
    assertDeadlineProofMatches(command.proof, command, snapshot);
    if (
      !(await this.decisionAuthority.verifyFrozenDeadlineTakeover({
        proof: command.proof,
        authorityStateHash: snapshot.stateHash,
        frozenPolicyHash: snapshot.frozenPolicy.policyHash,
      }))
    ) {
      failSeatControl(ERROR.FROZEN_POLICY_MISMATCH, "UNSEALED_DEADLINE_PROOF");
    }
    return this.commitTransition({
      snapshot,
      seat,
      operation: "DEADLINE_TAKEOVER",
      eventType: "FROZEN_DEADLINE_TAKEOVER",
      toMode: "AI_ACTIVE",
      toControllerId: seat.designatedAiControllerId,
      authorizationProofHash: command.proof.proofHash,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
    });
  }

  async reclaimByHuman(
    command: ReclaimSeatControlCommandV1,
  ): Promise<SeatControlCommandResultV1> {
    assertBaseTransitionCommand(command);
    assertNonEmpty(command.humanControllerId, "humanControllerId");
    assertSha(command.expectedReclaimFenceToken, "expectedReclaimFenceToken");
    const requestFingerprint = sha256Canonical({
      schemaVersion: "pressure_human_reclaim_request_v1",
      ...command,
    });
    const replay = await this.readAuthorityReplay(
      command.runId,
      command.idempotencyKey,
      "HUMAN_RECLAIM",
      requestFingerprint,
    );
    if (replay) return { status: "REPLAYED", committed: replay };
    const snapshot = await this.requireSnapshot(command.runId);
    const seat = requireSeat(snapshot, command.seatId);
    assertEpoch(seat, command.expectedControlEpoch);
    if (seat.reclaimFenceToken !== command.expectedReclaimFenceToken) {
      failSeatControl(ERROR.FENCE_REJECTED, command.seatId);
    }
    if (
      !snapshot.frozenPolicy.humanReclaimAllowed ||
      seat.mode !== "AI_ACTIVE" ||
      seat.originalHumanControllerId !== command.humanControllerId
    ) {
      failSeatControl(ERROR.CONTROLLER_FORBIDDEN, command.seatId);
    }
    const authorizationProofHash = sha256Canonical({
      schemaVersion: "pressure_human_reclaim_authorization_v1",
      runId: command.runId,
      seatId: command.seatId,
      humanControllerId: command.humanControllerId,
      controlEpoch: seat.controlEpoch,
      reclaimFenceToken: command.expectedReclaimFenceToken,
      frozenPolicyHash: snapshot.frozenPolicy.policyHash,
    });
    return this.commitTransition({
      snapshot,
      seat,
      operation: "HUMAN_RECLAIM",
      eventType: "HUMAN_RECLAIMED",
      toMode: "HUMAN_ACTIVE",
      toControllerId: command.humanControllerId,
      authorizationProofHash,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
    });
  }

  async assertSubmissionAuthority(input: {
    runId: string;
    seatId: SeatIdV1;
    controllerId: string;
    controlEpoch: number;
    submissionFenceToken: string;
  }): Promise<SeatSubmissionAuthorityV1> {
    assertNonEmpty(input.runId, "runId");
    assertSeatId(input.seatId);
    assertNonEmpty(input.controllerId, "controllerId");
    assertPositiveInteger(input.controlEpoch, "controlEpoch");
    assertSha(input.submissionFenceToken, "submissionFenceToken");
    const snapshot = await this.requireSnapshot(input.runId);
    const seat = requireSeat(snapshot, input.seatId);
    assertEpoch(seat, input.controlEpoch);
    if (seat.submissionFenceToken !== input.submissionFenceToken) {
      failSeatControl(ERROR.FENCE_REJECTED, input.seatId);
    }
    if (seat.activeControllerId !== input.controllerId) {
      failSeatControl(ERROR.CONTROLLER_FORBIDDEN, input.seatId);
    }
    return {
      schemaVersion: "pressure_seat_submission_authority_v1",
      runId: input.runId,
      seatId: input.seatId,
      controllerKind: seat.mode === "HUMAN_ACTIVE" ? "HUMAN" : "AI",
      controlEpoch: seat.controlEpoch,
      submissionFenceToken: seat.submissionFenceToken,
      authorityStateHash: snapshot.stateHash,
    };
  }

  /** Presence is advisory: this method cannot call the authority write port. */
  async recordPresence(
    command: RecordSeatPresenceCommandV1,
  ): Promise<{ status: "APPLIED" | "REPLAYED" | "STALE"; record: SeatPresenceRecordV1 }> {
    assertNonEmpty(command.runId, "runId");
    assertSeatId(command.seatId);
    assertNonEmpty(command.humanControllerId, "humanControllerId");
    assertNonEmpty(command.sessionId, "sessionId");
    assertPositiveInteger(command.signalSequence, "signalSequence");
    assertNonEmpty(command.idempotencyKey, "idempotencyKey");
    if (command.status !== "ONLINE" && command.status !== "DISCONNECTED") {
      failSeatControl(ERROR.INVALID_COMMAND, "presence.status");
    }
    const snapshot = await this.requireSnapshot(command.runId);
    const seat = requireSeat(snapshot, command.seatId);
    if (seat.originalHumanControllerId !== command.humanControllerId) {
      failSeatControl(ERROR.CONTROLLER_FORBIDDEN, command.seatId);
    }
    const requestFingerprint = sha256Canonical({
      schemaVersion: "pressure_seat_presence_request_v1",
      ...command,
    });
    const base = {
      schemaVersion: "pressure_seat_presence_record_v1" as const,
      ...command,
      requestFingerprint,
    };
    const candidate = { ...base, recordHash: sha256Canonical(base) };
    const result = await this.presence.record(candidate);
    if (result.status === "STALE") {
      if (
        result.record.runId !== command.runId ||
        result.record.seatId !== command.seatId ||
        result.record.humanControllerId !== command.humanControllerId ||
        result.record.signalSequence < command.signalSequence
      ) {
        failSeatControl(ERROR.PORT_RESULT_INVALID, "STALE_PRESENCE_RECORD");
      }
    } else if (
      result.record.runId !== command.runId ||
      result.record.idempotencyKey !== command.idempotencyKey ||
      result.record.requestFingerprint !== requestFingerprint
    ) {
      failSeatControl(ERROR.IDEMPOTENCY_KEY_REUSED, command.idempotencyKey);
    }
    return result;
  }

  /**
   * Produces an action envelope only. It never switches controller or writes a
   * DecisionAction; Interaction must submit the directive through its action API.
   */
  async resolveDeterministicDefault(
    command: ResolveSeatDefaultCommandV1,
  ): Promise<{ status: "COMMITTED" | "REPLAYED"; directive: SeatDefaultDirectiveV1 }> {
    assertBaseTransitionCommand(command);
    assertSha(command.expectedStateHash, "expectedStateHash");
    assertDefaultProof(command.sourceProof);
    const requestFingerprint = sha256Canonical({
      schemaVersion: "pressure_resolve_seat_default_request_v1",
      ...command,
    });
    const replay = await this.defaults.readCommitted(
      command.runId,
      command.idempotencyKey,
    );
    if (replay) {
      assertDefaultReplay(replay, command.idempotencyKey, requestFingerprint);
      return { status: "REPLAYED", directive: replay };
    }
    const snapshot = await this.requireSnapshot(command.runId);
    if (snapshot.stateHash !== command.expectedStateHash) {
      failSeatControl(ERROR.CONTROL_CHANGED, "STATE_HASH");
    }
    const seat = requireSeat(snapshot, command.seatId);
    assertEpoch(seat, command.expectedControlEpoch);
    assertDefaultProofMatches(command.sourceProof, command, snapshot, seat);
    if (
      !(await this.decisionAuthority.verifyFrozenDefaultSource({
        proof: command.sourceProof,
        authorityStateHash: snapshot.stateHash,
        frozenPolicyHash: snapshot.frozenPolicy.policyHash,
      }))
    ) {
      failSeatControl(ERROR.FROZEN_POLICY_MISMATCH, "UNSEALED_DEFAULT_PROOF");
    }
    const base = {
      schemaVersion: "pressure_seat_default_directive_v1" as const,
      runId: command.runId,
      decisionPointId: command.sourceProof.decisionPointId,
      seatId: command.seatId,
      controlEpoch: seat.controlEpoch,
      trigger: command.sourceProof.trigger,
      defaultPolicyRef: snapshot.frozenPolicy.deterministicDefaultPolicyRef,
      defaultPolicyHash: snapshot.frozenPolicy.deterministicDefaultPolicyHash,
      canonicalActionPayloadHash: command.sourceProof.canonicalActionPayloadHash,
      sourceProofHash: command.sourceProof.proofHash,
      authorityStateHash: snapshot.stateHash,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
    };
    const directive = { ...base, directiveHash: sha256Canonical(base) };
    const result = await this.defaults.commitOnce(directive);
    assertDefaultReplay(
      result.directive,
      command.idempotencyKey,
      requestFingerprint,
    );
    return result;
  }

  private async requireSnapshot(runId: string): Promise<SeatControlSnapshotV1> {
    const snapshot = await this.authority.readSnapshot(runId);
    if (!snapshot) failSeatControl(ERROR.RUN_NOT_INITIALIZED, runId);
    assertSnapshotInvariants(snapshot);
    return snapshot;
  }

  private async readAuthorityReplay(
    runId: string,
    idempotencyKey: string,
    operation: SeatControlOperationV1,
    requestFingerprint: string,
  ): Promise<CommittedSeatControlCommandV1 | null> {
    const replay = await this.authority.readCommittedCommand(
      runId,
      idempotencyKey,
    );
    if (!replay) return null;
    assertCommittedResult(
      replay,
      runId,
      idempotencyKey,
      requestFingerprint,
      operation,
    );
    return replay;
  }

  private async commitTransition(input: {
    snapshot: SeatControlSnapshotV1;
    seat: SeatAuthorityRecordV1;
    operation: Exclude<SeatControlOperationV1, "INITIALIZE">;
    eventType: Exclude<SeatControlEventTypeV1, "CONTROL_INITIALIZED">;
    toMode: "HUMAN_ACTIVE" | "AI_ACTIVE";
    toControllerId: string;
    authorizationProofHash: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<SeatControlCommandResultV1> {
    const nextEpoch = input.seat.controlEpoch + 1;
    const event = buildEvent({
      runId: input.snapshot.runId,
      eventSequence: input.snapshot.timelineLength + 1,
      eventType: input.eventType,
      seatId: input.seat.seatId,
      fromMode: input.seat.mode,
      toMode: input.toMode,
      fromControllerId: input.seat.activeControllerId,
      toControllerId: input.toControllerId,
      fromControlEpoch: input.seat.controlEpoch,
      toControlEpoch: nextEpoch,
      frozenPolicyHash: input.snapshot.frozenPolicy.policyHash,
      authorizationProofHash: input.authorizationProofHash,
      previousEventHash: input.snapshot.timelineHeadHash,
    });
    const nextSeat: SeatAuthorityRecordV1 = {
      ...input.seat,
      mode: input.toMode,
      activeControllerId: input.toControllerId,
      controlEpoch: nextEpoch,
      submissionFenceToken: controlFence(
        "SUBMISSION",
        input.snapshot.runId,
        input.seat.seatId,
        nextEpoch,
        input.toControllerId,
        event.eventHash,
      ),
      reclaimFenceToken: input.seat.originalHumanControllerId
        ? controlFence(
            "RECLAIM",
            input.snapshot.runId,
            input.seat.seatId,
            nextEpoch,
            input.seat.originalHumanControllerId,
            event.eventHash,
          )
        : null,
      lastAuthorityEventHash: event.eventHash,
    };
    const nextControls = input.snapshot.seatControls
      .map((control) =>
        control.seatId === input.seat.seatId ? nextSeat : control,
      )
      .sort((left, right) => compareCanonicalText(left.seatId, right.seatId));
    const nextSnapshot = buildSnapshot({
      ...withoutStateHash(input.snapshot),
      stateRevision: input.snapshot.stateRevision + 1,
      timelineLength: input.snapshot.timelineLength + 1,
      timelineHeadHash: event.eventHash,
      seatControls: nextControls,
    });
    const receipt = buildReceipt({
      operation: input.operation,
      runId: input.snapshot.runId,
      seatId: input.seat.seatId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      snapshot: nextSnapshot,
      events: [event],
    });
    const candidate = { snapshot: nextSnapshot, events: [event], receipt };
    const result = await this.authority.commitTransition({
      expectedStateRevision: input.snapshot.stateRevision,
      expectedStateHash: input.snapshot.stateHash,
      expectedSeatId: input.seat.seatId,
      expectedControlEpoch: input.seat.controlEpoch,
      candidate,
    });
    if (result.status === "CONFLICT") {
      failSeatControl(ERROR.ATOMIC_COMMIT_CONFLICT, input.seat.seatId);
    }
    assertCommittedResult(
      result.committed,
      input.snapshot.runId,
      input.idempotencyKey,
      input.requestFingerprint,
      input.operation,
    );
    return {
      status: result.status === "COMMITTED" ? "COMMITTED" : "REPLAYED",
      committed: result.committed,
    };
  }
}

function normalizeHumanAssignments(
  assignments: readonly HumanSeatAssignmentV1[],
): HumanSeatAssignmentV1[] {
  if (!Array.isArray(assignments)) {
    failSeatControl(ERROR.INVALID_COMMAND, "humanAssignments");
  }
  const normalized = assignments.map((assignment, index) => {
    if (!assignment || typeof assignment !== "object") {
      failSeatControl(ERROR.INVALID_COMMAND, `humanAssignments[${index}]`);
    }
    assertSeatId(assignment.seatId);
    assertNonEmpty(
      assignment.humanControllerId,
      `humanAssignments[${index}].humanControllerId`,
    );
    return {
      seatId: assignment.seatId,
      humanControllerId: assignment.humanControllerId,
    };
  });
  normalized.sort((left, right) =>
    compareCanonicalText(left.seatId, right.seatId),
  );
  if (
    new Set(normalized.map((assignment) => assignment.seatId)).size !==
      normalized.length ||
    new Set(normalized.map((assignment) => assignment.humanControllerId)).size !==
      normalized.length
  ) {
    failSeatControl(ERROR.INVALID_COMMAND, "DUPLICATE_HUMAN_ASSIGNMENT");
  }
  return normalized;
}

function assertAssignmentsMatchTopology(
  assignments: HumanSeatAssignmentV1[],
  topology: { seatControls: Array<{ seatId: SeatIdV1; mode: string }> },
): void {
  const expected = topology.seatControls
    .filter((control) => control.mode === "HUMAN_ACTIVE")
    .map((control) => control.seatId)
    .sort(compareCanonicalText);
  const actual = assignments
    .map((assignment) => assignment.seatId)
    .sort(compareCanonicalText);
  if (
    actual.length !== expected.length ||
    actual.some((seatId, index) => seatId !== expected[index])
  ) {
    failSeatControl(ERROR.GENESIS_MISMATCH, "HUMAN_ASSIGNMENTS_VS_TOPOLOGY");
  }
}

function assertGenesisAuthority(
  genesis: Awaited<
    ReturnType<SeatControlGenesisAuthorityReaderPort["readGenesisAuthority"]>
  > & {},
  runId: string,
): void {
  if (
    genesis.schemaVersion !== "pressure_seat_control_genesis_authority_v1" ||
    genesis.runId !== runId ||
    !isSha256(genesis.routeHash) ||
    !isSha256(genesis.genesisHash) ||
    !isSha256(genesis.genesisAtomicRecordHash)
  ) {
    failSeatControl(ERROR.GENESIS_MISMATCH, runId);
  }
}

function assertFrozenPolicy(policy: FrozenSeatControlPolicyV1): void {
  if (
    policy.schemaVersion !== "pressure_frozen_seat_control_policy_v1" ||
    policy.disconnectPolicy !== "PRESENCE_ADVISORY_ONLY" ||
    typeof policy.humanReclaimAllowed !== "boolean"
  ) {
    failSeatControl(ERROR.FROZEN_POLICY_MISMATCH, "SHAPE");
  }
  assertNonEmpty(policy.policyVersion, "policyVersion");
  assertNonEmpty(policy.takeoverDeadlinePolicyRef, "takeoverDeadlinePolicyRef");
  assertSha(policy.takeoverDeadlinePolicyHash, "takeoverDeadlinePolicyHash");
  assertNonEmpty(
    policy.deterministicDefaultPolicyRef,
    "deterministicDefaultPolicyRef",
  );
  assertSha(
    policy.deterministicDefaultPolicyHash,
    "deterministicDefaultPolicyHash",
  );
  assertSha(policy.policyHash, "policyHash");
  const { policyHash, ...base } = policy;
  if (sha256Canonical(base) !== policyHash) {
    failSeatControl(ERROR.FROZEN_POLICY_MISMATCH, "POLICY_HASH");
  }
}

function assertDeadlineProof(proof: FrozenDeadlineTakeoverProofV1): void {
  if (proof?.schemaVersion !== "pressure_frozen_deadline_takeover_proof_v1") {
    failSeatControl(ERROR.INVALID_COMMAND, "proof.schemaVersion");
  }
  assertNonEmpty(proof.runId, "proof.runId");
  assertNonEmpty(proof.decisionPointId, "proof.decisionPointId");
  assertSeatId(proof.seatId);
  assertPositiveInteger(proof.expectedControlEpoch, "proof.expectedControlEpoch");
  assertNonEmpty(proof.deadlinePolicyRef, "proof.deadlinePolicyRef");
  assertSha(proof.deadlinePolicyHash, "proof.deadlinePolicyHash");
  assertSha(proof.closedWorkingInputHash, "proof.closedWorkingInputHash");
  assertSha(proof.proofHash, "proof.proofHash");
  const { proofHash, ...base } = proof;
  if (sha256Canonical(base) !== proofHash) {
    failSeatControl(ERROR.INVALID_COMMAND, "proof.proofHash");
  }
}

function assertDeadlineProofMatches(
  proof: FrozenDeadlineTakeoverProofV1,
  command: FrozenDeadlineTakeoverCommandV1,
  snapshot: SeatControlSnapshotV1,
): void {
  if (
    proof.runId !== command.runId ||
    proof.seatId !== command.seatId ||
    proof.expectedControlEpoch !== command.expectedControlEpoch ||
    proof.deadlinePolicyRef !==
      snapshot.frozenPolicy.takeoverDeadlinePolicyRef ||
    proof.deadlinePolicyHash !==
      snapshot.frozenPolicy.takeoverDeadlinePolicyHash
  ) {
    failSeatControl(ERROR.FROZEN_POLICY_MISMATCH, "DEADLINE_PROOF");
  }
}

function assertDefaultProof(proof: FrozenDefaultSourceProofV1): void {
  if (proof?.schemaVersion !== "pressure_frozen_default_source_proof_v1") {
    failSeatControl(ERROR.INVALID_COMMAND, "sourceProof.schemaVersion");
  }
  assertNonEmpty(proof.runId, "sourceProof.runId");
  assertNonEmpty(proof.decisionPointId, "sourceProof.decisionPointId");
  assertSeatId(proof.seatId);
  assertPositiveInteger(
    proof.expectedControlEpoch,
    "sourceProof.expectedControlEpoch",
  );
  if (proof.trigger !== "HUMAN_DEADLINE" && proof.trigger !== "AI_FAILURE") {
    failSeatControl(ERROR.INVALID_COMMAND, "sourceProof.trigger");
  }
  assertNonEmpty(proof.defaultPolicyRef, "sourceProof.defaultPolicyRef");
  assertSha(proof.defaultPolicyHash, "sourceProof.defaultPolicyHash");
  assertSha(
    proof.canonicalActionPayloadHash,
    "sourceProof.canonicalActionPayloadHash",
  );
  assertSha(proof.causeInputHash, "sourceProof.causeInputHash");
  assertSha(proof.proofHash, "sourceProof.proofHash");
  const { proofHash, ...base } = proof;
  if (sha256Canonical(base) !== proofHash) {
    failSeatControl(ERROR.INVALID_COMMAND, "sourceProof.proofHash");
  }
}

function assertDefaultProofMatches(
  proof: FrozenDefaultSourceProofV1,
  command: ResolveSeatDefaultCommandV1,
  snapshot: SeatControlSnapshotV1,
  seat: SeatAuthorityRecordV1,
): void {
  if (
    proof.runId !== command.runId ||
    proof.seatId !== command.seatId ||
    proof.expectedControlEpoch !== command.expectedControlEpoch ||
    proof.defaultPolicyRef !==
      snapshot.frozenPolicy.deterministicDefaultPolicyRef ||
    proof.defaultPolicyHash !==
      snapshot.frozenPolicy.deterministicDefaultPolicyHash ||
    // Both default triggers are submitted by the reserved AI controller. A
    // HUMAN_DEADLINE proof is resolved only after the frozen-deadline
    // takeover has fenced the human controller and advanced controlEpoch.
    seat.mode !== "AI_ACTIVE"
  ) {
    failSeatControl(ERROR.FROZEN_POLICY_MISMATCH, "DEFAULT_PROOF");
  }
}

function buildEvent(
  input: Omit<SeatControlEventV1, "schemaVersion" | "eventHash">,
): SeatControlEventV1 {
  const base = {
    schemaVersion: "pressure_seat_control_event_v1" as const,
    ...input,
  };
  return { ...base, eventHash: sha256Canonical(base) };
}

function buildSnapshot(
  input: Omit<SeatControlSnapshotV1, "schemaVersion" | "stateHash">,
): SeatControlSnapshotV1 {
  const seatControls = input.seatControls
    .map((control) => ({ ...control }))
    .sort((left, right) => compareCanonicalText(left.seatId, right.seatId));
  assertAuthorityRecords(seatControls);
  const base = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    ...input,
    frozenPolicy: structuredClone(input.frozenPolicy),
    seatControls,
  };
  return { ...base, stateHash: sha256Canonical(base) };
}

function buildReceipt(input: {
  operation: SeatControlOperationV1;
  runId: string;
  seatId: SeatIdV1 | null;
  idempotencyKey: string;
  requestFingerprint: string;
  snapshot: SeatControlSnapshotV1;
  events: SeatControlEventV1[];
}): SeatControlCommandReceiptV1 {
  const base = {
    schemaVersion: "pressure_seat_control_command_receipt_v1" as const,
    operation: input.operation,
    runId: input.runId,
    seatId: input.seatId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    resultingStateRevision: input.snapshot.stateRevision,
    resultingStateHash: input.snapshot.stateHash,
    authorityEventHashes: input.events.map((event) => event.eventHash),
  };
  return { ...base, receiptHash: sha256Canonical(base) };
}

function assertCommittedResult(
  committed: CommittedSeatControlCommandV1,
  runId: string,
  idempotencyKey: string,
  requestFingerprint: string,
  operation: SeatControlOperationV1,
): void {
  const receipt = committed?.receipt;
  if (
    !receipt ||
    receipt.runId !== runId ||
    receipt.idempotencyKey !== idempotencyKey ||
    receipt.requestFingerprint !== requestFingerprint ||
    receipt.operation !== operation
  ) {
    failSeatControl(ERROR.IDEMPOTENCY_KEY_REUSED, idempotencyKey);
  }
  const { receiptHash, ...base } = receipt;
  if (
    sha256Canonical(base) !== receiptHash ||
    receipt.resultingStateHash !== committed.snapshot.stateHash ||
    receipt.resultingStateRevision !== committed.snapshot.stateRevision ||
    receipt.authorityEventHashes.length !== committed.events.length ||
    receipt.authorityEventHashes.some(
      (hash, index) => hash !== committed.events[index]?.eventHash,
    )
  ) {
    failSeatControl(ERROR.PORT_RESULT_INVALID, "COMMITTED_COMMAND");
  }
  assertSnapshotInvariants(committed.snapshot);
}

function assertSnapshotInvariants(snapshot: SeatControlSnapshotV1): void {
  if (
    snapshot.schemaVersion !== "pressure_seat_control_snapshot_v1" ||
    !isSha256(snapshot.stateHash) ||
    !isSha256(snapshot.timelineHeadHash) ||
    !isSha256(snapshot.initializationInputHash) ||
    !Number.isSafeInteger(snapshot.stateRevision) ||
    snapshot.stateRevision < 1 ||
    !Number.isSafeInteger(snapshot.timelineLength) ||
    snapshot.timelineLength < PRESSURE_CHAPTER_SEAT_IDS_V1.length
  ) {
    failSeatControl(ERROR.PORT_RESULT_INVALID, "SNAPSHOT_SHAPE");
  }
  const { stateHash, ...base } = snapshot;
  if (sha256Canonical(base) !== stateHash) {
    failSeatControl(ERROR.PORT_RESULT_INVALID, "SNAPSHOT_HASH");
  }
  assertFrozenPolicy(snapshot.frozenPolicy);
  assertAuthorityRecords(snapshot.seatControls);
}

function assertAuthorityRecords(records: SeatAuthorityRecordV1[]): void {
  if (
    records.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    records.some(
      (record, index) => record.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index],
    )
  ) {
    failSeatControl(ERROR.PORT_RESULT_INVALID, "SIX_ORDERED_SEATS");
  }
  const activeControllers = new Set<string>();
  for (const record of records) {
    assertPositiveInteger(record.controlEpoch, `${record.seatId}.controlEpoch`);
    assertNonEmpty(record.designatedAiControllerId, `${record.seatId}.aiController`);
    assertNonEmpty(record.activeControllerId, `${record.seatId}.activeController`);
    assertSha(record.submissionFenceToken, `${record.seatId}.submissionFence`);
    assertSha(record.lastAuthorityEventHash, `${record.seatId}.lastEventHash`);
    if (
      (record.mode === "HUMAN_ACTIVE" &&
        (record.originalHumanControllerId === null ||
          record.activeControllerId !== record.originalHumanControllerId)) ||
      (record.mode === "AI_ACTIVE" &&
        record.activeControllerId !== record.designatedAiControllerId) ||
      (record.originalHumanControllerId === null &&
        record.reclaimFenceToken !== null) ||
      (record.originalHumanControllerId !== null &&
        !isSha256(record.reclaimFenceToken))
    ) {
      failSeatControl(ERROR.PORT_RESULT_INVALID, `${record.seatId}.CONTROLLER_UNIQUE`);
    }
    if (activeControllers.has(record.activeControllerId)) {
      failSeatControl(ERROR.PORT_RESULT_INVALID, "CONTROLLER_ASSIGNED_TWICE");
    }
    activeControllers.add(record.activeControllerId);
  }
}

function requireSeat(
  snapshot: SeatControlSnapshotV1,
  seatId: SeatIdV1,
): SeatAuthorityRecordV1 {
  const seat = snapshot.seatControls.find((control) => control.seatId === seatId);
  if (!seat) failSeatControl(ERROR.PORT_RESULT_INVALID, `MISSING_${seatId}`);
  return seat;
}

function assertEpoch(seat: SeatAuthorityRecordV1, expected: number): void {
  if (seat.controlEpoch !== expected) {
    failSeatControl(
      ERROR.STALE_CONTROL_EPOCH,
      `${seat.seatId}:${expected}->${seat.controlEpoch}`,
    );
  }
}

function assertBaseTransitionCommand(command: {
  runId: string;
  seatId: SeatIdV1;
  expectedControlEpoch: number;
  idempotencyKey: string;
}): void {
  assertNonEmpty(command.runId, "runId");
  assertSeatId(command.seatId);
  assertPositiveInteger(command.expectedControlEpoch, "expectedControlEpoch");
  assertNonEmpty(command.idempotencyKey, "idempotencyKey");
}

function assertDefaultReplay(
  directive: SeatDefaultDirectiveV1,
  idempotencyKey: string,
  requestFingerprint: string,
): void {
  if (
    directive.idempotencyKey !== idempotencyKey ||
    directive.requestFingerprint !== requestFingerprint
  ) {
    failSeatControl(ERROR.IDEMPOTENCY_KEY_REUSED, idempotencyKey);
  }
  const { directiveHash, ...base } = directive;
  if (sha256Canonical(base) !== directiveHash) {
    failSeatControl(ERROR.PORT_RESULT_INVALID, "DEFAULT_DIRECTIVE_HASH");
  }
}

function withoutStateHash(
  snapshot: SeatControlSnapshotV1,
): Omit<SeatControlSnapshotV1, "schemaVersion" | "stateHash"> {
  const { schemaVersion: _schemaVersion, stateHash: _stateHash, ...base } = snapshot;
  return base;
}

function designatedAiControllerId(
  runId: string,
  seatId: SeatIdV1,
  genesisHash: string,
): string {
  return `pressure-ai:${sha256Canonical({ runId, seatId, genesisHash }).slice(0, 32)}`;
}

function controlFence(
  kind: "SUBMISSION" | "RECLAIM",
  runId: string,
  seatId: SeatIdV1,
  controlEpoch: number,
  controllerId: string,
  authorityEventHash: string,
): string {
  return sha256Canonical({
    schemaVersion: "pressure_seat_control_fence_v1",
    kind,
    runId,
    seatId,
    controlEpoch,
    controllerId,
    authorityEventHash,
  });
}

function assertSeatId(value: string): asserts value is SeatIdV1 {
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(value as SeatIdV1)) {
    failSeatControl(ERROR.INVALID_COMMAND, `seatId:${value}`);
  }
}

function assertNonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !NON_EMPTY.test(value)) {
    failSeatControl(ERROR.INVALID_COMMAND, path);
  }
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    failSeatControl(ERROR.INVALID_COMMAND, path);
  }
}

function assertSha(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) failSeatControl(ERROR.INVALID_COMMAND, path);
}
