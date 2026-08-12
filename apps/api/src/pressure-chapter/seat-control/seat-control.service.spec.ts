import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  type ParticipantModeV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { SeatControlAudienceProjector } from "./audience-projector";
import { SEAT_CONTROL_ERROR_CODES, SeatControlError } from "./errors";
import { SeatControlService } from "./seat-control.service";
import type {
  CommittedSeatControlCommandV1,
  FrozenDeadlineTakeoverProofV1,
  FrozenDefaultSourceProofV1,
  FrozenSeatControlPolicyV1,
  HumanSeatAssignmentV1,
  SeatControlAuthorityPort,
  SeatControlDecisionAuthorityPort,
  SeatControlGenesisAuthorityV1,
  SeatControlInitializePortResultV1,
  SeatControlSnapshotV1,
  SeatControlTransitionCommitV1,
  SeatControlTransitionPortResultV1,
  SeatDefaultDirectivePort,
  SeatDefaultDirectiveV1,
  SeatPresencePort,
  SeatPresenceRecordV1,
  SeatPrivateProjectionPort,
  SeatPrivateProjectionRecordV1,
} from "./types";

const SEATS = [...PRESSURE_CHAPTER_SEAT_IDS_V1];

test("Solo freezes one human plus five AI across exactly six uniquely controlled seats", async () => {
  const harness = await createHarness({
    runId: "run-solo",
    participantMode: "SOLO",
    humanCount: 1,
  });
  const snapshot = harness.initialized.snapshot;
  assert.equal(snapshot.seatControls.length, 6);
  assert.equal(countMode(snapshot, "HUMAN_ACTIVE"), 1);
  assert.equal(countMode(snapshot, "AI_ACTIVE"), 5);
  assert.equal(
    new Set(snapshot.seatControls.map((seat) => seat.activeControllerId)).size,
    6,
  );
  assert.deepEqual(
    snapshot.seatControls.map((seat) => seat.seatId),
    SEATS,
  );
});

test("Multiplayer humanCount 2 through 6 always fills six seats and is permutation deterministic", async () => {
  for (const humanCount of [2, 3, 4, 5, 6]) {
    const runId = `run-mp-${humanCount}`;
    const normal = await createHarness({
      runId,
      participantMode: "MULTIPLAYER",
      humanCount,
    });
    const reversed = await createHarness({
      runId,
      participantMode: "MULTIPLAYER",
      humanCount,
      reverseAssignments: true,
    });
    assert.equal(normal.initialized.snapshot.seatControls.length, 6);
    assert.equal(
      countMode(normal.initialized.snapshot, "HUMAN_ACTIVE"),
      humanCount,
    );
    assert.equal(
      countMode(normal.initialized.snapshot, "AI_ACTIVE"),
      6 - humanCount,
    );
    assert.equal(
      normal.initialized.snapshot.stateHash,
      reversed.initialized.snapshot.stateHash,
      `human assignment order must not affect authority hash for ${humanCount}`,
    );
  }
});

test("disconnect and recovery mutate only advisory presence, never authority or epoch", async () => {
  const harness = await createHarness({
    runId: "run-presence",
    participantMode: "SOLO",
    humanCount: 1,
  });
  const initial = harness.initialized.snapshot;
  const seat = initial.seatControls[0]!;
  const disconnect = {
    runId: initial.runId,
    seatId: seat.seatId,
    humanControllerId: seat.originalHumanControllerId!,
    sessionId: "browser-a",
    signalSequence: 1,
    status: "DISCONNECTED" as const,
    idempotencyKey: "presence-offline-1",
  };
  assert.equal((await harness.service.recordPresence(disconnect)).status, "APPLIED");
  assert.equal((await harness.service.recordPresence(disconnect)).status, "REPLAYED");
  const afterDisconnect = await harness.authority.readSnapshot(initial.runId);
  assert.equal(afterDisconnect?.stateHash, initial.stateHash);
  assert.equal(afterDisconnect?.seatControls[0]?.controlEpoch, 1);
  assert.equal(harness.authority.transitionWrites, 0);

  await harness.service.recordPresence({
    ...disconnect,
    signalSequence: 2,
    status: "ONLINE",
    idempotencyKey: "presence-online-2",
  });
  assert.equal(
    (
      await harness.service.recordPresence({
        ...disconnect,
        idempotencyKey: "late-offline-signal",
      })
    ).status,
    "STALE",
  );
  const authority = await harness.service.assertSubmissionAuthority({
    runId: initial.runId,
    seatId: seat.seatId,
    controllerId: seat.activeControllerId,
    controlEpoch: seat.controlEpoch,
    submissionFenceToken: seat.submissionFenceToken,
  });
  assert.equal(authority.controlEpoch, 1);
  assert.equal(harness.presence.appliedWrites, 2);
});

test("frozen deadline proof is required for AI takeover and takeover fences the old client", async () => {
  const harness = await createHarness({
    runId: "run-deadline-takeover",
    participantMode: "SOLO",
    humanCount: 1,
  });
  const initial = harness.initialized.snapshot;
  const human = initial.seatControls[0]!;
  const proof = deadlineProof(initial, human.seatId, human.controlEpoch);
  const badProof = { ...proof, closedWorkingInputHash: digest("tampered") };
  await expectCode(
    () =>
      harness.service.takeoverAtFrozenDeadline({
        runId: initial.runId,
        seatId: human.seatId,
        expectedControlEpoch: human.controlEpoch,
        expectedStateHash: initial.stateHash,
        proof: badProof,
        idempotencyKey: "bad-takeover",
      }),
    SEAT_CONTROL_ERROR_CODES.INVALID_COMMAND,
  );
  assert.equal(harness.authority.transitionWrites, 0);

  harness.decisionAuthority.allowDeadline = false;
  await expectCode(
    () =>
      harness.service.takeoverAtFrozenDeadline({
        runId: initial.runId,
        seatId: human.seatId,
        expectedControlEpoch: human.controlEpoch,
        expectedStateHash: initial.stateHash,
        proof,
        idempotencyKey: "unsealed-takeover",
      }),
    SEAT_CONTROL_ERROR_CODES.FROZEN_POLICY_MISMATCH,
  );
  assert.equal(harness.authority.transitionWrites, 0);
  harness.decisionAuthority.allowDeadline = true;

  const result = await harness.service.takeoverAtFrozenDeadline({
    runId: initial.runId,
    seatId: human.seatId,
    expectedControlEpoch: human.controlEpoch,
    expectedStateHash: initial.stateHash,
    proof,
    idempotencyKey: "deadline-takeover-1",
  });
  const controlled = result.committed.snapshot.seatControls[0]!;
  assert.equal(controlled.mode, "AI_ACTIVE");
  assert.equal(controlled.controlEpoch, 2);
  assert.equal(result.committed.events[0]?.eventType, "FROZEN_DEADLINE_TAKEOVER");
  await expectCode(
    () =>
      harness.service.assertSubmissionAuthority({
        runId: initial.runId,
        seatId: human.seatId,
        controllerId: human.activeControllerId,
        controlEpoch: human.controlEpoch,
        submissionFenceToken: human.submissionFenceToken,
      }),
    SEAT_CONTROL_ERROR_CODES.STALE_CONTROL_EPOCH,
  );
});

test("HUMAN_DEADLINE default is authorized only after takeover establishes current AI authority", async () => {
  const harness = await createHarness({
    runId: "run-deadline-default-order",
    participantMode: "SOLO",
    humanCount: 1,
  });
  const initial = harness.initialized.snapshot;
  const human = initial.seatControls[0]!;
  const prematureProof = defaultProof(initial, human.seatId, "HUMAN_DEADLINE");
  await expectCode(
    () => harness.service.resolveDeterministicDefault({
      runId: initial.runId,
      seatId: human.seatId,
      expectedControlEpoch: human.controlEpoch,
      expectedStateHash: initial.stateHash,
      sourceProof: prematureProof,
      idempotencyKey: "premature-deadline-default",
    }),
    SEAT_CONTROL_ERROR_CODES.FROZEN_POLICY_MISMATCH,
  );
  assert.equal(harness.defaults.commitWrites, 0);

  const takeover = await harness.service.takeoverAtFrozenDeadline({
    runId: initial.runId,
    seatId: human.seatId,
    expectedControlEpoch: human.controlEpoch,
    expectedStateHash: initial.stateHash,
    proof: deadlineProof(initial, human.seatId, human.controlEpoch),
    idempotencyKey: "deadline-default-order-takeover",
  });
  const controlled = takeover.committed.snapshot;
  const proof = defaultProof(controlled, human.seatId, "HUMAN_DEADLINE");
  const resolved = await harness.service.resolveDeterministicDefault({
    runId: controlled.runId,
    seatId: human.seatId,
    expectedControlEpoch: controlled.seatControls[0]!.controlEpoch,
    expectedStateHash: controlled.stateHash,
    sourceProof: proof,
    idempotencyKey: "deadline-default-after-takeover",
  });

  assert.equal(resolved.status, "COMMITTED");
  assert.equal(resolved.directive.trigger, "HUMAN_DEADLINE");
  assert.equal(resolved.directive.authorityStateHash, controlled.stateHash);
  assert.equal(harness.defaults.commitWrites, 1);
});

test("explicit handoff is atomic and same-key same-fingerprint replay is side-effect free", async () => {
  const harness = await createHarness({
    runId: "run-handoff-idempotency",
    participantMode: "SOLO",
    humanCount: 1,
  });
  const seat = harness.initialized.snapshot.seatControls[0]!;
  const command = {
    runId: harness.initialized.snapshot.runId,
    seatId: seat.seatId,
    humanControllerId: seat.originalHumanControllerId!,
    expectedControlEpoch: seat.controlEpoch,
    expectedSubmissionFenceToken: seat.submissionFenceToken,
    idempotencyKey: "handoff-once",
  };
  assert.equal((await harness.service.explicitHandoffToAi(command)).status, "COMMITTED");
  assert.equal((await harness.service.explicitHandoffToAi(command)).status, "REPLAYED");
  assert.equal(harness.authority.transitionWrites, 1);
  await expectCode(
    () =>
      harness.service.explicitHandoffToAi({
        ...command,
        expectedSubmissionFenceToken: digest("different-fence"),
      }),
    SEAT_CONTROL_ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
  );
  assert.equal(harness.authority.transitionWrites, 1);
});

test("original human explicitly reclaims AI-controlled seat and both prior epochs are rejected", async () => {
  const harness = await createHarness({
    runId: "run-reclaim",
    participantMode: "SOLO",
    humanCount: 1,
  });
  const human = harness.initialized.snapshot.seatControls[0]!;
  const handedOff = await harness.service.explicitHandoffToAi({
    runId: harness.initialized.snapshot.runId,
    seatId: human.seatId,
    humanControllerId: human.originalHumanControllerId!,
    expectedControlEpoch: 1,
    expectedSubmissionFenceToken: human.submissionFenceToken,
    idempotencyKey: "handoff-before-reclaim",
  });
  const ai = handedOff.committed.snapshot.seatControls[0]!;
  assert.equal(ai.mode, "AI_ACTIVE");
  const reclaimed = await harness.service.reclaimByHuman({
    runId: handedOff.committed.snapshot.runId,
    seatId: ai.seatId,
    humanControllerId: ai.originalHumanControllerId!,
    expectedControlEpoch: ai.controlEpoch,
    expectedReclaimFenceToken: ai.reclaimFenceToken!,
    idempotencyKey: "reclaim-human",
  });
  const current = reclaimed.committed.snapshot.seatControls[0]!;
  assert.equal(current.mode, "HUMAN_ACTIVE");
  assert.equal(current.controlEpoch, 3);
  assert.equal(current.activeControllerId, human.originalHumanControllerId);
  assert.notEqual(current.submissionFenceToken, human.submissionFenceToken);
  assert.notEqual(current.submissionFenceToken, ai.submissionFenceToken);
  await expectCode(
    () =>
      harness.service.assertSubmissionAuthority({
        runId: reclaimed.committed.snapshot.runId,
        seatId: current.seatId,
        controllerId: ai.activeControllerId,
        controlEpoch: ai.controlEpoch,
        submissionFenceToken: ai.submissionFenceToken,
      }),
    SEAT_CONTROL_ERROR_CODES.STALE_CONTROL_EPOCH,
  );
  const verified = await harness.service.assertSubmissionAuthority({
    runId: reclaimed.committed.snapshot.runId,
    seatId: current.seatId,
    controllerId: current.activeControllerId,
    controlEpoch: current.controlEpoch,
    submissionFenceToken: current.submissionFenceToken,
  });
  assert.equal(verified.controllerKind, "HUMAN");
});

test("presence from a returning browser cannot silently reclaim AI authority", async () => {
  const harness = await createHarness({
    runId: "run-heartbeat-no-reclaim",
    participantMode: "SOLO",
    humanCount: 1,
  });
  const human = harness.initialized.snapshot.seatControls[0]!;
  const handedOff = await harness.service.explicitHandoffToAi({
    runId: harness.initialized.snapshot.runId,
    seatId: human.seatId,
    humanControllerId: human.originalHumanControllerId!,
    expectedControlEpoch: human.controlEpoch,
    expectedSubmissionFenceToken: human.submissionFenceToken,
    idempotencyKey: "handoff-heartbeat",
  });
  const aiState = handedOff.committed.snapshot;
  await harness.service.recordPresence({
    runId: aiState.runId,
    seatId: human.seatId,
    humanControllerId: human.originalHumanControllerId!,
    sessionId: "returning-browser",
    signalSequence: 1,
    status: "ONLINE",
    idempotencyKey: "return-heartbeat",
  });
  const current = await harness.authority.readSnapshot(aiState.runId);
  assert.equal(current?.stateHash, aiState.stateHash);
  assert.equal(current?.seatControls[0]?.mode, "AI_ACTIVE");
  assert.equal(current?.seatControls[0]?.controlEpoch, 2);
});

test("deterministic default is frozen-policy bound, replayable, and does not switch authority", async () => {
  const harness = await createHarness({
    runId: "run-default",
    participantMode: "SOLO",
    humanCount: 1,
  });
  const before = harness.initialized.snapshot;
  const ai = before.seatControls[1]!;
  const sourceProof = defaultProof(before, ai.seatId, "AI_FAILURE");
  const command = {
    runId: before.runId,
    seatId: ai.seatId,
    expectedControlEpoch: ai.controlEpoch,
    expectedStateHash: before.stateHash,
    sourceProof,
    idempotencyKey: "default-ai-failure",
  };
  assert.equal(
    (await harness.service.resolveDeterministicDefault(command)).status,
    "COMMITTED",
  );
  assert.equal(
    (await harness.service.resolveDeterministicDefault(command)).status,
    "REPLAYED",
  );
  const after = await harness.authority.readSnapshot(before.runId);
  assert.equal(after?.stateHash, before.stateHash);
  assert.equal(harness.authority.transitionWrites, 0);
  assert.equal(harness.defaults.commitWrites, 1);
});

test("human and active-AI private views read exactly one seat and leak no peer secret or fence", async () => {
  const harness = await createHarness({
    runId: "run-private",
    participantMode: "MULTIPLAYER",
    humanCount: 2,
  });
  const snapshot = harness.initialized.snapshot;
  const projector = new SeatControlAudienceProjector(
    harness.authority,
    harness.presence,
    harness.privateProjection,
  );
  const first = snapshot.seatControls[0]!;
  const second = snapshot.seatControls[1]!;
  const ai = snapshot.seatControls[2]!;
  const humanView = await projector.project(snapshot.runId, {
    kind: "HUMAN",
    humanControllerId: first.originalHumanControllerId!,
  });
  const serializedHuman = JSON.stringify(humanView);
  assert.equal(humanView.ownSeat.seatId, first.seatId);
  assert.equal(humanView.ownSeat.privatePayload.secret, `secret:${first.seatId}`);
  assert.ok(!serializedHuman.includes(`secret:${second.seatId}`));
  assert.ok(!serializedHuman.includes(second.originalHumanControllerId!));
  assert.ok(!serializedHuman.includes(second.submissionFenceToken));
  assert.ok(!serializedHuman.includes(ai.submissionFenceToken));
  assert.deepEqual(harness.privateProjection.readSeats, [first.seatId]);

  harness.privateProjection.readSeats.length = 0;
  const aiView = await projector.project(snapshot.runId, {
    kind: "ACTIVE_SEAT_CONTROLLER",
    seatId: ai.seatId,
    controllerId: ai.activeControllerId,
    controlEpoch: ai.controlEpoch,
    submissionFenceToken: ai.submissionFenceToken,
  });
  const serializedAi = JSON.stringify(aiView);
  assert.equal(aiView.ownSeat.privatePayload.secret, `secret:${ai.seatId}`);
  assert.ok(!serializedAi.includes(`secret:${first.seatId}`));
  assert.ok(!serializedAi.includes(first.originalHumanControllerId!));
  assert.deepEqual(harness.privateProjection.readSeats, [ai.seatId]);
});

test("non-original human cannot record presence, handoff, or reclaim", async () => {
  const harness = await createHarness({
    runId: "run-forbidden-controller",
    participantMode: "MULTIPLAYER",
    humanCount: 2,
  });
  const snapshot = harness.initialized.snapshot;
  const first = snapshot.seatControls[0]!;
  const second = snapshot.seatControls[1]!;
  await expectCode(
    () =>
      harness.service.recordPresence({
        runId: snapshot.runId,
        seatId: first.seatId,
        humanControllerId: second.originalHumanControllerId!,
        sessionId: "wrong-seat",
        signalSequence: 1,
        status: "ONLINE",
        idempotencyKey: "wrong-presence",
      }),
    SEAT_CONTROL_ERROR_CODES.CONTROLLER_FORBIDDEN,
  );
  await expectCode(
    () =>
      harness.service.explicitHandoffToAi({
        runId: snapshot.runId,
        seatId: first.seatId,
        humanControllerId: second.originalHumanControllerId!,
        expectedControlEpoch: first.controlEpoch,
        expectedSubmissionFenceToken: first.submissionFenceToken,
        idempotencyKey: "wrong-handoff",
      }),
    SEAT_CONTROL_ERROR_CODES.CONTROLLER_FORBIDDEN,
  );
  assert.equal(harness.authority.transitionWrites, 0);
  assert.equal(harness.presence.appliedWrites, 0);
});

async function createHarness(input: {
  runId: string;
  participantMode: ParticipantModeV1;
  humanCount: number;
  reverseAssignments?: boolean;
}) {
  const humanSeatIds = SEATS.slice(0, input.humanCount);
  const topologyBase = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "six-seat-control-v1",
    participantMode: input.participantMode,
    seatControls: SEATS.map((seatId) => ({
      seatId,
      mode: humanSeatIds.includes(seatId)
        ? ("HUMAN_ACTIVE" as const)
        : ("AI_ACTIVE" as const),
    })),
  };
  const controlTopology = {
    ...topologyBase,
    topologyHash: sha256Canonical(topologyBase),
  };
  const genesis: SeatControlGenesisAuthorityV1 = {
    schemaVersion: "pressure_seat_control_genesis_authority_v1" as const,
    runId: input.runId,
    routeHash: digest(`${input.runId}:route`),
    genesisHash: digest(`${input.runId}:genesis`),
    genesisAtomicRecordHash: digest(`${input.runId}:genesis-atomic`),
    controlTopology,
  };
  const policyBase = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "seat-control-policy-1.0.0",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline:pressure-v1",
    takeoverDeadlinePolicyHash: digest("deadline-policy"),
    deterministicDefaultPolicyRef: "default:pressure-v1",
    deterministicDefaultPolicyHash: digest("default-policy"),
    humanReclaimAllowed: true,
  };
  const policy: FrozenSeatControlPolicyV1 = {
    ...policyBase,
    policyHash: sha256Canonical(policyBase),
  };
  const authority = new InMemoryAuthorityPort();
  const presence = new InMemoryPresencePort();
  const defaults = new InMemoryDefaultPort();
  const privateProjection = new InMemoryPrivateProjectionPort();
  const decisionAuthority = new InMemoryDecisionAuthority(input.runId);
  const service = new SeatControlService(
    { readGenesisAuthority: async (runId) => (runId === input.runId ? genesis : null) },
    { readFrozenPolicy: async (runId) => (runId === input.runId ? policy : null) },
    authority,
    presence,
    defaults,
    decisionAuthority,
  );
  let assignments: HumanSeatAssignmentV1[] = humanSeatIds.map((seatId) => ({
    seatId,
    humanControllerId: `human:${seatId}`,
  }));
  if (input.reverseAssignments) assignments = [...assignments].reverse();
  const initialized = (
    await service.initialize({
      runId: input.runId,
      idempotencyKey: "initialize-control",
      humanAssignments: assignments,
    })
  ).committed;
  return {
    service,
    authority,
    presence,
    defaults,
    decisionAuthority,
    privateProjection,
    initialized,
  };
}

function deadlineProof(
  snapshot: SeatControlSnapshotV1,
  seatId: SeatIdV1,
  expectedControlEpoch: number,
): FrozenDeadlineTakeoverProofV1 {
  const base = {
    schemaVersion: "pressure_frozen_deadline_takeover_proof_v1" as const,
    runId: snapshot.runId,
    decisionPointId: "decision:deadline",
    seatId,
    expectedControlEpoch,
    deadlinePolicyRef: snapshot.frozenPolicy.takeoverDeadlinePolicyRef,
    deadlinePolicyHash: snapshot.frozenPolicy.takeoverDeadlinePolicyHash,
    closedWorkingInputHash: digest("closed-working-input"),
  };
  return { ...base, proofHash: sha256Canonical(base) };
}

function defaultProof(
  snapshot: SeatControlSnapshotV1,
  seatId: SeatIdV1,
  trigger: "HUMAN_DEADLINE" | "AI_FAILURE",
): FrozenDefaultSourceProofV1 {
  const seat = snapshot.seatControls.find((candidate) => candidate.seatId === seatId)!;
  const base = {
    schemaVersion: "pressure_frozen_default_source_proof_v1" as const,
    runId: snapshot.runId,
    decisionPointId: "decision:default",
    seatId,
    expectedControlEpoch: seat.controlEpoch,
    trigger,
    defaultPolicyRef: snapshot.frozenPolicy.deterministicDefaultPolicyRef,
    defaultPolicyHash: snapshot.frozenPolicy.deterministicDefaultPolicyHash,
    canonicalActionPayloadHash: digest("canonical-default-action"),
    causeInputHash: digest("default-cause-input"),
  };
  return { ...base, proofHash: sha256Canonical(base) };
}

function countMode(
  snapshot: SeatControlSnapshotV1,
  mode: "HUMAN_ACTIVE" | "AI_ACTIVE",
): number {
  return snapshot.seatControls.filter((seat) => seat.mode === mode).length;
}

function digest(label: string): string {
  return sha256Canonical({ label });
}

async function expectCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof SeatControlError);
    assert.equal(error.code, code);
    return true;
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class InMemoryAuthorityPort implements SeatControlAuthorityPort {
  private readonly snapshots = new Map<string, SeatControlSnapshotV1>();
  private readonly commands = new Map<string, CommittedSeatControlCommandV1>();
  initializationWrites = 0;
  transitionWrites = 0;

  async readSnapshot(runId: string): Promise<SeatControlSnapshotV1 | null> {
    const snapshot = this.snapshots.get(runId);
    return snapshot ? clone(snapshot) : null;
  }

  async readCommittedCommand(
    runId: string,
    idempotencyKey: string,
  ): Promise<CommittedSeatControlCommandV1 | null> {
    const committed = this.commands.get(`${runId}:${idempotencyKey}`);
    return committed ? clone(committed) : null;
  }

  async initializeOnce(
    candidate: CommittedSeatControlCommandV1,
  ): Promise<SeatControlInitializePortResultV1> {
    const key = `${candidate.snapshot.runId}:${candidate.receipt.idempotencyKey}`;
    const replay = this.commands.get(key);
    if (replay) return { status: "REPLAYED", committed: clone(replay) };
    const current = this.snapshots.get(candidate.snapshot.runId);
    if (current) return { status: "ALREADY_INITIALIZED", current: clone(current) };
    const committed = clone(candidate);
    this.snapshots.set(candidate.snapshot.runId, committed.snapshot);
    this.commands.set(key, committed);
    this.initializationWrites += 1;
    return { status: "COMMITTED", committed: clone(committed) };
  }

  async commitTransition(
    command: SeatControlTransitionCommitV1,
  ): Promise<SeatControlTransitionPortResultV1> {
    const runId = command.candidate.snapshot.runId;
    const key = `${runId}:${command.candidate.receipt.idempotencyKey}`;
    const replay = this.commands.get(key);
    if (replay) return { status: "REPLAYED", committed: clone(replay) };
    const current = this.snapshots.get(runId);
    const currentSeat = current?.seatControls.find(
      (seat) => seat.seatId === command.expectedSeatId,
    );
    if (
      !current ||
      current.stateRevision !== command.expectedStateRevision ||
      current.stateHash !== command.expectedStateHash ||
      currentSeat?.controlEpoch !== command.expectedControlEpoch
    ) {
      return { status: "CONFLICT", current: current ? clone(current) : null };
    }
    const committed = clone(command.candidate);
    this.snapshots.set(runId, committed.snapshot);
    this.commands.set(key, committed);
    this.transitionWrites += 1;
    return { status: "COMMITTED", committed: clone(committed) };
  }
}

class InMemoryPresencePort implements SeatPresencePort {
  private readonly bySeat = new Map<string, SeatPresenceRecordV1>();
  private readonly byCommand = new Map<string, SeatPresenceRecordV1>();
  appliedWrites = 0;

  async record(record: SeatPresenceRecordV1) {
    const commandKey = `${record.runId}:${record.idempotencyKey}`;
    const replay = this.byCommand.get(commandKey);
    if (replay) return { status: "REPLAYED" as const, record: clone(replay) };
    const seatKey = this.seatKey(
      record.runId,
      record.seatId,
      record.humanControllerId,
    );
    const current = this.bySeat.get(seatKey);
    if (current && current.signalSequence >= record.signalSequence) {
      return { status: "STALE" as const, record: clone(current) };
    }
    const committed = clone(record);
    this.bySeat.set(seatKey, committed);
    this.byCommand.set(commandKey, committed);
    this.appliedWrites += 1;
    return { status: "APPLIED" as const, record: clone(committed) };
  }

  async readForSeat(
    runId: string,
    seatId: SeatIdV1,
    humanControllerId: string,
  ): Promise<SeatPresenceRecordV1 | null> {
    const record = this.bySeat.get(this.seatKey(runId, seatId, humanControllerId));
    return record ? clone(record) : null;
  }

  private seatKey(runId: string, seatId: SeatIdV1, humanControllerId: string) {
    return `${runId}:${seatId}:${humanControllerId}`;
  }
}

class InMemoryDefaultPort implements SeatDefaultDirectivePort {
  private readonly directives = new Map<string, SeatDefaultDirectiveV1>();
  commitWrites = 0;

  async readCommitted(runId: string, idempotencyKey: string) {
    const directive = this.directives.get(`${runId}:${idempotencyKey}`);
    return directive ? clone(directive) : null;
  }

  async commitOnce(directive: SeatDefaultDirectiveV1) {
    const key = `${directive.runId}:${directive.idempotencyKey}`;
    const replay = this.directives.get(key);
    if (replay) return { status: "REPLAYED" as const, directive: clone(replay) };
    const committed = clone(directive);
    this.directives.set(key, committed);
    this.commitWrites += 1;
    return { status: "COMMITTED" as const, directive: clone(committed) };
  }
}

class InMemoryPrivateProjectionPort implements SeatPrivateProjectionPort {
  readonly readSeats: SeatIdV1[] = [];

  async readForSeat(input: {
    runId: string;
    seatId: SeatIdV1;
    sourceAuthorityHash: string;
  }): Promise<SeatPrivateProjectionRecordV1> {
    this.readSeats.push(input.seatId);
    const payload = {
      secret: `secret:${input.seatId}`,
      privateKnowledgeRefs: [`knowledge:${input.seatId}`],
    };
    return {
      schemaVersion: "pressure_seat_private_projection_record_v1",
      ...input,
      projectionVersion: "private-projection-v1",
      payload,
      payloadHash: sha256Canonical(payload),
    };
  }
}

class InMemoryDecisionAuthority implements SeatControlDecisionAuthorityPort {
  allowDeadline = true;
  allowDefault = true;

  constructor(private readonly runId: string) {}

  async verifyFrozenDeadlineTakeover(input: {
    proof: FrozenDeadlineTakeoverProofV1;
    authorityStateHash: string;
  }): Promise<boolean> {
    return (
      this.allowDeadline &&
      input.proof.runId === this.runId &&
      input.authorityStateHash.length === 64
    );
  }

  async verifyFrozenDefaultSource(input: {
    proof: FrozenDefaultSourceProofV1;
    authorityStateHash: string;
  }): Promise<boolean> {
    return (
      this.allowDefault &&
      input.proof.runId === this.runId &&
      input.authorityStateHash.length === 64
    );
  }
}

// This comparator is intentionally used anywhere a test fixture treats an
// array as a set. Keeping it referenced prevents accidental locale sorting in
// future fixture extensions.
assert.equal(
  [...SEATS].sort(compareCanonicalText).join("|"),
  SEATS.join("|"),
);
