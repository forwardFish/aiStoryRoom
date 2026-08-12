import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical, PRESSURE_CHAPTER_SEAT_IDS_V1 } from "@ai-story/shared";
import type {
  CommittedSeatControlCommandV1,
  SeatControlSnapshotV1,
} from "../seat-control/types";
import {
  buildFrozenSeatControlPolicyFromRouteV1,
  PrismaPressureSeatViewerMembershipReaderV1,
  PrismaSeatControlAuthorityPortV1,
  PrismaFrozenSeatControlPolicyReaderV1,
  PrismaSeatControlDecisionAuthorityPortV1,
  PrismaSeatPresencePortV1,
  PrismaSeatDefaultDirectivePortV1,
  PrismaSeatPrivateProjectionPortV1,
  PrismaPressureGameViewerReaderV1,
  emptySeatEnvelope,
  presenceKey,
  privateProjectionKey,
  proofKey,
  type PressureSeatViewerPresentationCatalogV1,
} from "./index";
import {
  PressureChapterRunRouterService,
  type StoredRunRouteRecordV1,
} from "../run-router";
import { PressureLiveAdapterError } from "../live-adapters/errors";

test("authority adapter persists immutable snapshots, replays idempotency, and rejects stale CAS", async () => {
  const prisma = createAuthorityHarness();
  const adapter = new PrismaSeatControlAuthorityPortV1(prisma as any);
  const initial = committedCommand({
    runId: "run-authority",
    revision: 1,
    operation: "INITIALIZE",
  });

  const committed = await adapter.initializeOnce(initial);
  assert.equal(committed.status, "COMMITTED");
  assert.equal((await adapter.readSnapshot("run-authority"))?.stateRevision, 1);
  assert.deepEqual(
    await adapter.readCommittedCommand("run-authority", initial.receipt.idempotencyKey),
    initial,
  );

  const replay = await adapter.initializeOnce(initial);
  assert.equal(replay.status, "REPLAYED");

  const next = committedCommand({
    runId: "run-authority",
    revision: 2,
    operation: "EXPLICIT_HANDOFF",
    previous: initial.snapshot,
  });
  const transition = await adapter.commitTransition({
    expectedStateRevision: 1,
    expectedStateHash: initial.snapshot.stateHash,
    expectedSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    expectedControlEpoch: 1,
    candidate: next,
  });
  assert.equal(transition.status, "COMMITTED");
  assert.equal((await adapter.readSnapshot("run-authority"))?.stateRevision, 2);

  const stale = await adapter.commitTransition({
    expectedStateRevision: 1,
    expectedStateHash: initial.snapshot.stateHash,
    expectedSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    expectedControlEpoch: 1,
    candidate: committedCommand({
      runId: "run-authority",
      revision: 3,
      operation: "HUMAN_RECLAIM",
      previous: next.snapshot,
    }),
  });
  assert.equal(stale.status, "CONFLICT");
  assert.equal(stale.current?.stateRevision, 2);
});

test("policy, proof, presence, default, and private projection adapters stay deterministic", async () => {
  const aux = createAuxHarness();
  const policyReader = new PrismaFrozenSeatControlPolicyReaderV1(aux as any);
  const proofReader = new PrismaSeatControlDecisionAuthorityPortV1(aux as any);
  const presence = new PrismaSeatPresencePortV1(aux as any);
  const defaults = new PrismaSeatDefaultDirectivePortV1(aux as any);
  const privateProjection = new PrismaSeatPrivateProjectionPortV1(aux as any);

  assert.equal(
    (await policyReader.readFrozenPolicy("run-aux"))?.policyVersion,
    "seat-policy-v1",
  );
  assert.equal(
    await proofReader.verifyFrozenDeadlineTakeover({
      proof: aux.deadlineProof,
      authorityStateHash: aux.snapshot.stateHash,
      frozenPolicyHash: aux.policy.policyHash,
    }),
    true,
  );
  assert.equal(
    await proofReader.verifyFrozenDefaultSource({
      proof: { ...aux.defaultProof, proofHash: digest("wrong") },
      authorityStateHash: aux.snapshot.stateHash,
      frozenPolicyHash: aux.policy.policyHash,
    }),
    false,
  );

  const applied = await presence.record(aux.presenceRecord);
  assert.equal(applied.status, "APPLIED");
  const stale = await presence.record({
    ...aux.presenceRecord,
    idempotencyKey: "presence-new",
    requestFingerprint: digest("presence-new"),
    signalSequence: 1,
    recordHash: digest("presence-stale"),
  });
  assert.equal(stale.status, "STALE");
  const replay = await presence.record(aux.presenceRecord);
  assert.equal(replay.status, "REPLAYED");
  assert.equal(
    (await presence.readForSeat("run-aux", PRESSURE_CHAPTER_SEAT_IDS_V1[0], "human-0"))?.signalSequence,
    2,
  );

  const committed = await defaults.commitOnce(aux.directive);
  assert.equal(committed.status, "COMMITTED");
  const replayed = await defaults.commitOnce(aux.directive);
  assert.equal(replayed.status, "REPLAYED");
  assert.equal(
    (await defaults.readCommitted("run-aux", aux.directive.idempotencyKey))?.directiveHash,
    aux.directive.directiveHash,
  );

  const projection = await privateProjection.readForSeat({
    runId: "run-aux",
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    sourceAuthorityHash: aux.snapshot.stateHash,
  });
  assert.equal(projection.payloadHash, aux.privateProjection.payloadHash);
});

test("seat policy bootstraps from frozen route before the first seat snapshot exists", async () => {
  const runId = "run-policy-bootstrap";
  const route = await storedRoute(runId);
  const prisma = {
    pressureSeatControlSnapshot: { findUnique: async () => null },
    pressureRunRouteSnapshot: {
      findUnique: async ({ where }: any) =>
        where.runId === runId ? { routeJson: structuredClone(route) } : null,
    },
  };
  const policy = await new PrismaFrozenSeatControlPolicyReaderV1(
    prisma as any,
  ).readFrozenPolicy(runId);
  assert.deepEqual(policy, buildFrozenSeatControlPolicyFromRouteV1(route));
  assert.equal(policy?.disconnectPolicy, "PRESENCE_ADVISORY_ONLY");
  assert.equal(policy?.humanReclaimAllowed, true);
});

test("viewer reader composes subject membership with frozen seat-control and fails closed without a catalog", async () => {
  const aux = createAuxHarness();
  const membershipReader = new PrismaPressureSeatViewerMembershipReaderV1({
    storyPlayer: {
      findUnique: async () => ({
        id: "player-row-0",
        runId: "run-aux",
        userId: "human-0",
        playerType: "human",
        status: "active",
        role: { roleKey: PRESSURE_CHAPTER_SEAT_IDS_V1[0] },
      }),
    },
  });
  const presence = new PrismaSeatPresencePortV1(aux as any);
  await presence.record(aux.presenceRecord);
  const privateProjection = new PrismaSeatPrivateProjectionPortV1(aux as any);
  const authority = {
    readSnapshot: async () => structuredClone(aux.snapshot),
    readCommittedCommand: async () => null,
    initializeOnce: async () => {
      throw new Error("not used");
    },
    commitTransition: async () => {
      throw new Error("not used");
    },
  };
  const catalog: PressureSeatViewerPresentationCatalogV1 = {
    roleNames: {
      [PRESSURE_CHAPTER_SEAT_IDS_V1[0]]: "Finance seat",
    },
    resources: {
      silver: { label: "Silver" },
    },
    tokens: {
      seal: { label: "Seal", description: "Sealed authority token" },
    },
  };
  const reader = new PrismaPressureGameViewerReaderV1(
    membershipReader,
    authority,
    presence,
    privateProjection,
    {
      readCatalog: async () => catalog,
    },
  );
  const view = await reader.readViewer({
    runId: "run-aux",
    subjectId: "human-0",
  });
  assert.equal(view?.viewer.roleName, "Finance seat");
  assert.equal(view?.viewer.control.mode, "HUMAN_ACTIVE");
  assert.equal(view?.resources[0]?.label, "Silver");
  assert.equal(view?.tokens[0]?.description, "Sealed authority token");

  const missingCatalog = new PrismaPressureGameViewerReaderV1(
    membershipReader,
    authority,
    presence,
    privateProjection,
    {
      readCatalog: async () => null,
    },
  );
  await assert.rejects(
    missingCatalog.readViewer({ runId: "run-aux", subjectId: "human-0" }),
    (error: unknown) => error instanceof PressureLiveAdapterError,
  );
});

function createAuthorityHarness() {
  let row: any = null;
  const prisma = {
    pressureSeatControlSnapshot: {
      findUnique: async ({ where }: any) =>
        row?.runId === where.runId ? structuredClone(row) : null,
      create: async ({ data }: any) => {
        row = structuredClone(data);
        return structuredClone(row);
      },
      updateMany: async ({ where, data }: any) => {
        if (!row || row.runId !== where.runId || row.version !== where.version) {
          return { count: 0 };
        }
        if (where.stateRevision != null && row.stateRevision !== where.stateRevision) return { count: 0 };
        if (where.stateHash != null && row.stateHash !== where.stateHash) return { count: 0 };
        row = {
          ...row,
          ...structuredClone(data),
          version: row.version + 1,
        };
        return { count: 1 };
      },
    },
  };
  return {
    ...prisma,
    $transaction: async (operation: any) => operation(prisma),
  };
}

function createAuxHarness() {
  const policy = frozenPolicy("run-aux");
  const snapshot = committedCommand({
    runId: "run-aux",
    revision: 1,
    operation: "INITIALIZE",
  }).snapshot;
  const deadlineProof = {
    schemaVersion: "pressure_frozen_deadline_takeover_proof_v1" as const,
    runId: "run-aux",
    decisionPointId: "decision-1",
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    expectedControlEpoch: 1,
    deadlinePolicyRef: policy.takeoverDeadlinePolicyRef,
    deadlinePolicyHash: policy.takeoverDeadlinePolicyHash,
    closedWorkingInputHash: digest("closed-working"),
    proofHash: "",
  };
  const { proofHash: _deadlineProofHash, ...deadlineProofBase } = deadlineProof;
  deadlineProof.proofHash = sha256Canonical(deadlineProofBase);
  const defaultProof = {
    schemaVersion: "pressure_frozen_default_source_proof_v1" as const,
    runId: "run-aux",
    decisionPointId: "decision-1",
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    expectedControlEpoch: 1,
    trigger: "HUMAN_DEADLINE" as const,
    defaultPolicyRef: policy.deterministicDefaultPolicyRef,
    defaultPolicyHash: policy.deterministicDefaultPolicyHash,
    canonicalActionPayloadHash: digest("payload"),
    causeInputHash: digest("cause"),
    proofHash: "",
  };
  const { proofHash: _defaultProofHash, ...defaultProofBase } = defaultProof;
  defaultProof.proofHash = sha256Canonical(defaultProofBase);
  const privatePayload = {
    schemaVersion: "pressure_game_viewer_private_payload_v1" as const,
    situation: {
      goal: "Protect the treasury.",
      risk: "Audit trail mismatch.",
      judgment: "Recheck the ledger.",
    },
    resources: [{
      resourceId: "silver",
      value: 7,
      displayValue: "7",
    }],
    tokens: [{
      tokenId: "seal",
      quantity: 1,
      available: true,
    }],
  };
  const privateProjection = {
    schemaVersion: "pressure_seat_private_projection_record_v1" as const,
    runId: "run-aux",
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    sourceAuthorityHash: snapshot.stateHash,
    projectionVersion: "viewer-private-v1",
    payload: privatePayload,
    payloadHash: sha256Canonical(privatePayload),
  };
  const directive = {
    schemaVersion: "pressure_seat_default_directive_v1" as const,
    runId: "run-aux",
    decisionPointId: "decision-1",
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    controlEpoch: 1,
    trigger: "HUMAN_DEADLINE" as const,
    defaultPolicyRef: policy.deterministicDefaultPolicyRef,
    defaultPolicyHash: policy.deterministicDefaultPolicyHash,
    canonicalActionPayloadHash: digest("payload"),
    sourceProofHash: defaultProof.proofHash,
    authorityStateHash: snapshot.stateHash,
    idempotencyKey: "default-1",
    requestFingerprint: digest("default-fingerprint"),
    directiveHash: "",
  };
  const { directiveHash: _directiveHash, ...directiveBase } = directive;
  directive.directiveHash = sha256Canonical(directiveBase);
  const presenceRecord = {
    schemaVersion: "pressure_seat_presence_record_v1" as const,
    runId: "run-aux",
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    humanControllerId: "human-0",
    sessionId: "session-0",
    signalSequence: 2,
    status: "ONLINE" as const,
    idempotencyKey: "presence-1",
    requestFingerprint: digest("presence-fingerprint"),
    recordHash: digest("presence-record"),
  };
  const envelope = emptySeatEnvelope(snapshot);
  envelope.proofs[proofKey("DEADLINE_TAKEOVER", deadlineProof.proofHash)] = {
    proofKind: "DEADLINE_TAKEOVER",
    proof: deadlineProof,
    authorityStateHash: snapshot.stateHash,
    frozenPolicyHash: policy.policyHash,
  };
  envelope.proofs[proofKey("DEFAULT_SOURCE", defaultProof.proofHash)] = {
    proofKind: "DEFAULT_SOURCE",
    proof: defaultProof,
    authorityStateHash: snapshot.stateHash,
    frozenPolicyHash: policy.policyHash,
  };
  envelope.privateProjections[
    privateProjectionKey("run-aux", PRESSURE_CHAPTER_SEAT_IDS_V1[0], snapshot.stateHash)
  ] = privateProjection;
  let row: any = {
    runId: snapshot.runId,
    stateRevision: snapshot.stateRevision,
    stateHash: snapshot.stateHash,
    snapshotJson: envelope,
    version: 1,
  };
  const prisma = {
    pressureSeatControlSnapshot: {
      findUnique: async ({ where }: any) =>
        where.runId === row.runId ? structuredClone(row) : null,
      create: async () => { throw new Error("not used"); },
      updateMany: async ({ where, data }: any) => {
        if (where.runId !== row.runId || where.version !== row.version) return { count: 0 };
        row = {
          ...row,
          snapshotJson: structuredClone(data.snapshotJson),
          version: row.version + 1,
        };
        return { count: 1 };
      },
    },
  };
  return {
    policy,
    snapshot,
    deadlineProof,
    defaultProof,
    directive,
    presenceRecord,
    privateProjection,
    ...prisma,
    $transaction: async (operation: any) => operation(prisma),
  };
}

function committedCommand(input: {
  runId: string;
  revision: number;
  operation: "INITIALIZE" | "EXPLICIT_HANDOFF" | "DEADLINE_TAKEOVER" | "HUMAN_RECLAIM";
  previous?: SeatControlSnapshotV1;
}): CommittedSeatControlCommandV1 {
  const policy = frozenPolicy(input.runId);
  const controls = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
    seatId,
    mode: index === 0 && input.revision > 1 ? "AI_ACTIVE" as const : "HUMAN_ACTIVE" as const,
    originalHumanControllerId: `human-${index}`,
    designatedAiControllerId: `ai-${index}`,
    activeControllerId: index === 0 && input.revision > 1 ? `ai-${index}` : `human-${index}`,
    controlEpoch: input.revision,
    submissionFenceToken: digest(`${input.runId}:${seatId}:submit:${input.revision}`),
    reclaimFenceToken: digest(`${input.runId}:${seatId}:reclaim:${input.revision}`),
    lastAuthorityEventHash: digest(`${input.runId}:${seatId}:event:${input.revision}`),
  }));
  const snapshotBase = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId: input.runId,
    participantMode: "SOLO" as const,
    routeHash: digest(`${input.runId}:route`),
    genesisHash: digest(`${input.runId}:genesis`),
    genesisAtomicRecordHash: digest(`${input.runId}:genesis-atomic`),
    initialTopologyHash: digest(`${input.runId}:topology`),
    controlTopologyVersion: "six-seat-control-v1",
    frozenPolicy: policy,
    stateRevision: input.revision,
    timelineLength: PRESSURE_CHAPTER_SEAT_IDS_V1.length + input.revision - 1,
    timelineHeadHash: digest(`${input.runId}:timeline:${input.revision}`),
    seatControls: controls,
    initializationInputHash: digest(`${input.runId}:init`),
  };
  const snapshot = {
    ...snapshotBase,
    stateHash: sha256Canonical(snapshotBase),
  };
  const event = {
    schemaVersion: "pressure_seat_control_event_v1" as const,
    runId: input.runId,
    eventSequence: snapshot.timelineLength,
    eventType: input.revision === 1
      ? "CONTROL_INITIALIZED" as const
      : "EXPLICIT_HANDOFF_TO_AI" as const,
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    fromMode: input.revision === 1 ? null : "HUMAN_ACTIVE" as const,
    toMode: input.revision === 1 ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    fromControllerId: input.revision === 1 ? null : "human-0",
    toControllerId: input.revision === 1 ? "human-0" : "ai-0",
    fromControlEpoch: Math.max(0, input.revision - 1),
    toControlEpoch: input.revision,
    frozenPolicyHash: policy.policyHash,
    authorizationProofHash: digest(`${input.runId}:proof:${input.revision}`),
    previousEventHash: input.previous?.timelineHeadHash ?? digest(`${input.runId}:previous`),
  };
  const committedEvent = {
    ...event,
    eventHash: sha256Canonical(event),
  };
  const receiptBase = {
    schemaVersion: "pressure_seat_control_command_receipt_v1" as const,
    operation: input.operation,
    runId: input.runId,
    seatId: input.operation === "INITIALIZE" ? null : PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    idempotencyKey: `${input.runId}:op:${input.revision}`,
    requestFingerprint: digest(`${input.runId}:fingerprint:${input.revision}`),
    resultingStateRevision: snapshot.stateRevision,
    resultingStateHash: snapshot.stateHash,
    authorityEventHashes: [committedEvent.eventHash],
  };
  return {
    snapshot,
    events: [committedEvent],
    receipt: {
      ...receiptBase,
      receiptHash: sha256Canonical(receiptBase),
    },
  };
}

function frozenPolicy(runId: string) {
  const base = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "seat-policy-v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline-policy",
    takeoverDeadlinePolicyHash: digest(`${runId}:deadline`),
    deterministicDefaultPolicyRef: "default-policy",
    deterministicDefaultPolicyHash: digest(`${runId}:default`),
    humanReclaimAllowed: true,
  };
  return {
    ...base,
    policyHash: sha256Canonical(base),
  };
}

async function storedRoute(runId: string): Promise<StoredRunRouteRecordV1> {
  let stored: StoredRunRouteRecordV1 | null = null;
  const registration = {
    routeKey: "sangtian_pressure_chapter_v1",
    worldId: "sangtian" as const,
    status: "PUBLISHED" as const,
    createEnabled: true,
    participantModes: ["SOLO", "MULTIPLAYER"] as const,
    route: {
      engineVersion: "pressure_chapter_v1",
      strategyVersion: "sangtian_pressure_chapter_v1_0",
      runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
      endgamePolicyVersion: "sangtian_content_finale_v1",
      resultSchemaVersion: "sangtian_pressure_result_v1",
    },
    contentPackageVersion: "1.0.0",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "tests-v1",
    testMatrixSha256: digest("tests"),
    narrativeProfileVersion: "narrative-v1",
    featureSetVersion: "features-v1",
    resultContractRegistryVersion: "results-v1",
    controlTopologyVersion: "six-seat-control-1.0.0",
    handlerKey: "pressure_chapter_v1" as const,
    resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
  };
  const router = new PressureChapterRunRouterService({
    findByRunId: async () => stored,
    insertIfAbsent: async (record) => {
      stored = structuredClone(record);
      return { status: "INSERTED" as const, record: structuredClone(record) };
    },
  }, {
    registryVersion: "registry-v1",
    registryHash: digest("registry"),
    defaultRouteKey: registration.routeKey,
    resolveCreate: () => structuredClone(registration) as any,
    resolveStored: () => structuredClone(registration) as any,
  });
  return (await router.create({
    runId,
    participantMode: "SOLO",
    humanSeatIdsAtStart: [PRESSURE_CHAPTER_SEAT_IDS_V1[0]],
    runSeed: "seed-policy-bootstrap",
  })).route;
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
