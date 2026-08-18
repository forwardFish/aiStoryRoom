import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDecisionActionRequestFingerprint,
  computeSealedActionsHash,
  computeNarrativeArtifactContentHash,
  computeNarrativeProjectionFingerprint,
  sha256Canonical,
  type DecisionActionV1,
  type OpenNovelNarrativeArtifactV1,
  type OpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";
import { createChapterWorkingState } from "@ai-story/templates";
import { computeWorkingActionInputFingerprintV1 } from "../working-ledger/fingerprint";
import {
  buildWorkingLedgerEvents,
  workingStateHash,
} from "../working-ledger/working-ledger";
import type { WorkingLedgerEventV1 } from "../working-ledger/contracts";
import {
  PrismaAuthoritativeNarrativeSourceReader,
  PrismaNarrativeOutboxRepository,
  PrismaNarrativeProjectionStateRepository,
  createNarrativeProjectionMetaV1,
  type NarrativeAuthorityReadPrismaClient,
  type NarrativeOutboxPrismaClient,
  type NarrativeProjectionPrismaClient,
} from "./narrative.prisma-adapter";
import { PressurePersistenceError } from "./errors";

const NOW = Date.parse("2026-08-12T00:00:00.000Z");

test("Narrative outbox lease/fence acknowledges once and stale worker fails closed", async () => {
  const job = jobFixture();
  const fake = new OutboxFake({
    id: "outbox-1",
    status: "PENDING",
    payloadJson: job,
    payloadHash: sha256Canonical(job),
    attempt: 0,
    maxAttempts: 3,
    availableAt: new Date(NOW),
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
  });
  const repository = new PrismaNarrativeOutboxRepository(fake.client);
  const claim = await repository.claimNext({
    workerId: "worker-a",
    nowMs: NOW,
    leaseMs: 30_000,
  });
  assert.equal(claim.kind, "CLAIMED");
  if (claim.kind !== "CLAIMED") return;
  assert.equal(claim.fence, 1);
  assert.deepEqual(claim.job, job);
  await assert.rejects(
    repository.acknowledge({ outboxId: claim.outboxId, fence: 0 }),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_OUTBOX_LEASE_LOST",
  );
  await repository.acknowledge({ outboxId: claim.outboxId, fence: claim.fence });
  assert.equal(fake.row.status, "COMPLETED");
  assert.equal(fake.row.checkpoint, "ACKNOWLEDGED");
  assert.equal(fake.authorityWriteCalls, 0);
});

test("Narrative outbox retry advances exactly one attempt under the active fence", async () => {
  const job = jobFixture();
  const fake = new OutboxFake({
    id: "outbox-retry",
    status: "PENDING",
    payloadJson: job,
    payloadHash: sha256Canonical(job),
    attempt: 0,
    maxAttempts: 3,
    availableAt: new Date(NOW),
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
  });
  const repository = new PrismaNarrativeOutboxRepository(fake.client);
  const claim = await repository.claimNext({
    workerId: "worker-a",
    nowMs: NOW,
    leaseMs: 30_000,
  });
  assert.equal(claim.kind, "CLAIMED");
  if (claim.kind !== "CLAIMED") return;

  await assert.rejects(
    repository.retry({
      outboxId: claim.outboxId,
      fence: claim.fence,
      attemptCount: 2,
      nextAttemptAtMs: NOW + 60_000,
      reasonCode: "PROVIDER_FAILURE",
    }),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_OUTBOX_LEASE_LOST",
  );
  assert.equal(fake.row.attempt, 0);
  assert.equal(fake.row.status, "LEASED");

  await repository.retry({
    outboxId: claim.outboxId,
    fence: claim.fence,
    attemptCount: 1,
    nextAttemptAtMs: NOW + 60_000,
    reasonCode: "PROVIDER_FAILURE",
  });
  assert.equal(fake.row.attempt, 1);
  assert.equal(fake.row.status, "RETRYABLE");
  assert.equal(fake.authorityWriteCalls, 0);
});

test("Narrative projection publishes artifact without any authority-table capability", async () => {
  const job = jobFixture();
  const logicalProjectionKey = sha256Canonical({
    sourceCommitHash: job.sourceCommitHash,
    audience: job.audience,
    projectionKind: job.projectionKind,
  });
  const projectorVersion = "openovel-projector-v1";
  const requestFingerprint = computeNarrativeProjectionFingerprint(job, projectorVersion);
  const fake = new ProjectionFake({
    id: "projection-1",
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion,
    audienceKind: job.audience.kind,
    audienceSeatId: job.audience.seatId,
    audienceKey: "public",
    status: "PENDING",
    requestFingerprint,
    attempt: 0,
    maxAttempts: 3,
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    lastError: createNarrativeProjectionMetaV1({
      logicalProjectionKey,
      jobId: job.jobId,
    }),
    artifactJson: null,
    artifactContentHash: null,
  });
  const repository = new PrismaNarrativeProjectionStateRepository(fake.client);
  const claim = await repository.claim({
    logicalProjectionKey,
    requestFingerprint,
    jobId: job.jobId,
    workerId: "worker-a",
    nowMs: NOW,
    leaseMs: 30_000,
  });
  assert.equal(claim.kind, "CLAIMED");
  if (claim.kind !== "CLAIMED") return;
  const artifact = artifactFixture(job, projectorVersion);
  const stored = await repository.publish({
    logicalProjectionKey,
    requestFingerprint,
    projectionId: claim.projectionId,
    fence: claim.fence,
    artifact,
  });
  const transactionCountAfterAtomicPublish = fake.transactionCalls;
  assert.deepEqual(stored, artifact);
  assert.equal(fake.row.status, "PUBLISHED");
  assert.equal(fake.row.checkpoint, "PUBLISHED");
  assert.deepEqual(fake.row.artifactJson, artifact);
  assert.equal(fake.row.artifactContentHash, artifact.contentHash);
  assert.ok(fake.row.publishedAt instanceof Date);
  assert.equal(fake.row.leaseOwner, null);
  assert.equal(fake.row.leaseExpiresAt, null);
  await repository.markPublished({
    projectionId: claim.projectionId,
    fence: claim.fence,
    status: "PUBLISHED",
    artifact,
  });
  assert.equal(fake.transactionCalls, transactionCountAfterAtomicPublish);
  assert.equal(fake.row.status, "PUBLISHED");
  assert.deepEqual(fake.row.artifactJson, artifact);
  assert.equal(fake.row.artifactContentHash, artifact.contentHash);
  assert.equal(fake.authorityWriteCalls, 0);

  const replay = await repository.claim({
    logicalProjectionKey,
    requestFingerprint,
    jobId: job.jobId,
    workerId: "worker-b",
    nowMs: NOW + 60_000,
    leaseMs: 30_000,
  });
  assert.equal(replay.kind, "ALREADY_PUBLISHED");
  if (replay.kind === "ALREADY_PUBLISHED") assert.deepEqual(replay.artifact, artifact);
});

test("Narrative artifact publication fails closed on projection binding or status mismatch", async () => {
  const job = jobFixture();
  const logicalProjectionKey = sha256Canonical({
    sourceCommitHash: job.sourceCommitHash,
    audience: job.audience,
    projectionKind: job.projectionKind,
  });
  const projectorVersion = "openovel-projector-v1";
  const requestFingerprint = computeNarrativeProjectionFingerprint(job, projectorVersion);
  const fake = new ProjectionFake({
    id: "projection-binding",
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion,
    audienceKind: job.audience.kind,
    audienceSeatId: job.audience.seatId,
    audienceKey: "public",
    status: "GENERATING",
    requestFingerprint,
    attempt: 0,
    maxAttempts: 3,
    leaseOwner: "worker-a",
    leaseExpiresAt: new Date(NOW + 30_000),
    leaseVersion: 1,
    lastError: createNarrativeProjectionMetaV1({ logicalProjectionKey, jobId: job.jobId }),
    artifactJson: null,
    artifactContentHash: null,
  });
  const repository = new PrismaNarrativeProjectionStateRepository(fake.client);
  const artifact = artifactFixture(job, projectorVersion);
  const wrongSource = { ...artifact, sourceId: digest("wrong-source") };

  await assert.rejects(
    repository.publish({
      logicalProjectionKey,
      requestFingerprint,
      projectionId: fake.row.id,
      fence: 1,
      artifact: wrongSource,
    }),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_PERSISTENCE_RECORD_INVALID",
  );
  assert.equal(fake.row.artifactJson, null);

  await repository.publish({
    logicalProjectionKey,
    requestFingerprint,
    projectionId: fake.row.id,
    fence: 1,
    artifact,
  });
  assert.equal(fake.row.status, "PUBLISHED");
  await assert.rejects(
    repository.markPublished({
      projectionId: fake.row.id,
      fence: 1,
      status: "FALLBACK_PUBLISHED",
      artifact,
    }),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_PERSISTENCE_RECORD_INVALID",
  );
  assert.equal(fake.row.status, "PUBLISHED");
  assert.equal(fake.authorityWriteCalls, 0);
});

test("Narrative publication atomically repairs an identical legacy staged artifact", async () => {
  const job = jobFixture();
  const logicalProjectionKey = sha256Canonical({
    sourceCommitHash: job.sourceCommitHash,
    audience: job.audience,
    projectionKind: job.projectionKind,
  });
  const projectorVersion = "openovel-projector-v1";
  const requestFingerprint = computeNarrativeProjectionFingerprint(job, projectorVersion);
  const artifact = artifactFixture(job, projectorVersion);
  const fake = new ProjectionFake({
    id: "projection-legacy-staged",
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion,
    audienceKind: job.audience.kind,
    audienceSeatId: job.audience.seatId,
    audienceKey: "public",
    status: "VALIDATING",
    checkpoint: "VALIDATED",
    publishedAt: null,
    requestFingerprint,
    attempt: 0,
    maxAttempts: 3,
    leaseOwner: "worker-a",
    leaseExpiresAt: new Date(NOW + 30_000),
    leaseVersion: 1,
    lastError: createNarrativeProjectionMetaV1({ logicalProjectionKey, jobId: job.jobId }),
    artifactJson: artifact,
    artifactContentHash: artifact.contentHash,
  });
  const repository = new PrismaNarrativeProjectionStateRepository(fake.client);

  const stored = await repository.publish({
    logicalProjectionKey,
    requestFingerprint,
    projectionId: fake.row.id,
    fence: 1,
    artifact,
  });

  assert.deepEqual(stored, artifact);
  assert.equal(fake.row.status, "PUBLISHED");
  assert.equal(fake.row.checkpoint, "PUBLISHED");
  assert.ok(fake.row.publishedAt instanceof Date);
  assert.equal(fake.row.leaseOwner, null);
  assert.equal(fake.row.leaseExpiresAt, null);
});

test("Narrative publication rejects a different artifact without changing the published row", async () => {
  const job = jobFixture();
  const logicalProjectionKey = sha256Canonical({
    sourceCommitHash: job.sourceCommitHash,
    audience: job.audience,
    projectionKind: job.projectionKind,
  });
  const projectorVersion = "openovel-projector-v1";
  const requestFingerprint = computeNarrativeProjectionFingerprint(job, projectorVersion);
  const artifact = artifactFixture(job, projectorVersion);
  const fake = new ProjectionFake({
    id: "projection-conflicting-artifact",
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion,
    audienceKind: job.audience.kind,
    audienceSeatId: job.audience.seatId,
    audienceKey: "public",
    status: "PUBLISHED",
    checkpoint: "PUBLISHED",
    publishedAt: new Date(NOW),
    requestFingerprint,
    attempt: 0,
    maxAttempts: 3,
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 1,
    lastError: createNarrativeProjectionMetaV1({ logicalProjectionKey, jobId: job.jobId }),
    artifactJson: artifact,
    artifactContentHash: artifact.contentHash,
  });
  const repository = new PrismaNarrativeProjectionStateRepository(fake.client);
  const conflicting = {
    ...artifact,
    text: `${artifact.text} conflict`,
  };
  conflicting.contentHash = computeNarrativeArtifactContentHash(conflicting);

  await assert.rejects(
    repository.publish({
      logicalProjectionKey,
      requestFingerprint,
      projectionId: fake.row.id,
      fence: 1,
      artifact: conflicting,
    }),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_PERSISTENCE_FINGERPRINT_MISMATCH",
  );
  assert.deepEqual(fake.row.artifactJson, artifact);
  assert.equal(fake.row.artifactContentHash, artifact.contentHash);
  assert.equal(fake.row.status, "PUBLISHED");
});

test("Narrative authority reader reconstructs a hash-verifiable committed Beat envelope", async () => {
  const action = beatActionFixture();
  const { events, workingDeltaHash, resolutionHash } = beatLedgerFixture(action);
  const job = beatJobFixture(resolutionHash, workingDeltaHash);
  let compiledRaw: unknown;
  const fake = new AuthorityReadFake(events);
  const reader = new PrismaAuthoritativeNarrativeSourceReader(fake.client, {
    compile: (_job, raw) => {
      compiledRaw = structuredClone(raw);
      return raw;
    },
  });

  const result = await reader.readCommitted(job) as Record<string, any>;
  assert.equal(fake.beatReadCalls, 1);
  assert.equal(result.schemaVersion, "pressure_committed_beat_narrative_authority_v1");
  assert.equal(result.decisionPointId, action.decisionPointId);
  assert.equal(result.decisionPointKey, action.decisionPointId);
  assert.equal(result.contentPackageSha256, digest("content-package"));
  assert.deepEqual(result.sealedActions, [action]);
  assert.deepEqual(result.reactionContextRef, { sourceHash: digest("reaction") });
  assert.equal(result.nextDecisionContextRef, null);
  assert.deepEqual(compiledRaw, result);
  assert.equal(fake.authorityWriteCalls, 0);
});

test("Narrative authority reader fails closed when a Beat relation omits a sealed action", async () => {
  const action = beatActionFixture();
  const fixture = beatLedgerFixture(action);
  const { resolutionHash } = fixture;
  const fake = new AuthorityReadFake(fixture.events.filter((event) => (
    event.payload.eventType !== "FORMAL_ACTION_ACCEPTED"
  )));
  const reader = new PrismaAuthoritativeNarrativeSourceReader(fake.client, {
    compile: () => assert.fail("compiler must not receive incomplete authority"),
  });

  await assert.rejects(
    reader.readCommitted(beatJobFixture(resolutionHash, fixture.workingDeltaHash)),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_PERSISTENCE_RECORD_INVALID",
  );
  assert.equal(fake.authorityWriteCalls, 0);
});

class OutboxFake {
  authorityWriteCalls = 0;
  constructor(readonly row: Record<string, any>) {}
  readonly tx = {
    pressureOutboxTask: {
      findFirst: async (_input: any): Promise<any> => null,
      findUnique: async (_input: any): Promise<any> => null,
      updateMany: async (_input: any): Promise<any> => ({ count: 0 }),
    },
  };
  readonly client: NarrativeOutboxPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.tx.pressureOutboxTask.findFirst = async (input: any) => {
        if (input.where?.status?.in && !input.where.status.in.includes(this.row.status)) {
          return null;
        }
        if (input.where?.OR) {
          const available = this.row.status !== "LEASED"
            ? this.row.availableAt.getTime() <= NOW
            : this.row.leaseExpiresAt?.getTime() <= NOW;
          if (!available) return null;
        }
        return structuredClone(this.row);
      };
      this.tx.pressureOutboxTask.findUnique = async () => structuredClone(this.row);
      this.tx.pressureOutboxTask.updateMany = async ({ where, data }: any) => {
        if (
          where.id !== this.row.id
          || (where.status !== undefined && where.status !== this.row.status)
          || (where.leaseVersion !== undefined && where.leaseVersion !== this.row.leaseVersion)
          || (where.attempt !== undefined && where.attempt !== this.row.attempt)
        ) return { count: 0 };
        Object.assign(this.row, structuredClone(data));
        return { count: 1 };
      };
      return operation(this.tx);
    },
  };
}

class ProjectionFake {
  authorityWriteCalls = 0;
  transactionCalls = 0;
  constructor(readonly row: Record<string, any>) {}
  readonly tx = {
    pressureNarrativeProjection: {
      findFirst: async (_input: any): Promise<any> => null,
      findUnique: async (_input: any): Promise<any> => null,
      updateMany: async (_input: any): Promise<any> => ({ count: 0 }),
    },
  };
  readonly client: NarrativeProjectionPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.transactionCalls += 1;
      this.install();
      return operation(this.tx);
    },
  };
  private install(): void {
    this.tx.pressureNarrativeProjection.findFirst = async ({ where }: any) => (
      where.requestFingerprint === this.row.requestFingerprint
        ? structuredClone(this.row)
        : null
    );
    this.tx.pressureNarrativeProjection.findUnique = async ({ where }: any) => (
      where.id === this.row.id ? structuredClone(this.row) : null
    );
    this.tx.pressureNarrativeProjection.updateMany = async ({ where, data }: any) => {
      if (
        where.id !== this.row.id
        || (where.requestFingerprint !== undefined
          && where.requestFingerprint !== this.row.requestFingerprint)
        || (where.leaseVersion !== undefined && where.leaseVersion !== this.row.leaseVersion)
        || (where.artifactContentHash !== undefined
          && where.artifactContentHash !== this.row.artifactContentHash)
      ) return { count: 0 };
      Object.assign(this.row, structuredClone(data));
      return { count: 1 };
    };
  }
}

class AuthorityReadFake {
  beatReadCalls = 0;
  authorityWriteCalls = 0;
  constructor(private readonly events: WorkingLedgerEventV1[]) {}
  readonly client: NarrativeAuthorityReadPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => operation({
      pressureGenesisCommit: { findUnique: async () => null },
      storyEvent: {
        findMany: async () => {
          this.beatReadCalls += 1;
          return this.events.map((event) => ({
            runId: event.runId,
            type: "PRESSURE_WORKING_LEDGER_EVENT",
            payloadJson: structuredClone(event),
            dedupeKey: `pressure-ledger:${event.runId}:${event.chapterRuntimeId}:${event.eventHash}`,
          }));
        },
      },
      pressureRunRouteSnapshot: {
        findUnique: async () => ({
          runId: "run-beat-reader",
          contentPackageSha256: digest("content-package"),
        }),
      },
      pressureChapterSettlement: { findFirst: async () => null },
      pressureFinaleDecision: { findUnique: async () => null },
      pressureLegacyTerminalCommit: { findUnique: async () => null },
    }),
  };
}

function jobFixture(): OpenNovelNarrativeProjectionJobV1 {
  return {
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: "finale_narrative_run-w9_public",
    runId: "run-w9",
    audience: { kind: "PUBLIC", seatId: null },
    sourceRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    projectionKind: "FINALE_NARRATIVE",
    sourceAuthority: "FINALE_FROZEN",
    sourceId: digest("finale-source"),
    sourceCommitHash: digest("finale-commit"),
    sourceContentHash: digest("finale-content"),
    allowedFactIds: ["fact.public"],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    narrativeProfileVersion: "openovel-pressure-v1",
    idempotencyKey: "finale-narrative:run-w9:public",
  };
}

function beatJobFixture(
  resolutionHash: string,
  workingDeltaHash: string,
): OpenNovelNarrativeProjectionJobV1 {
  return {
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: `beat_narrative_${resolutionHash.slice(0, 12)}_public`,
    runId: "run-beat-reader",
    audience: { kind: "PUBLIC", seatId: null },
    sourceRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: resolutionHash,
    sourceCommitHash: resolutionHash,
    sourceContentHash: workingDeltaHash,
    allowedFactIds: [],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    idempotencyKey: `beat-narrative:${resolutionHash}:public`,
  };
}

function beatActionFixture(): DecisionActionV1 {
  const payload = { optionId: "inspect-ledger" };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: "action-reader-1",
    runId: "run-beat-reader",
    chapterRuntimeId: "runtime-reader-n1",
    chapterId: "N1" as const,
    decisionPointId: "dp-investigate",
    seatId: "cabinet_finance" as const,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 2,
    expectedWorkingRevision: 0,
    status: "SEALED" as const,
    actionType: "INVESTIGATE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: "idem-reader-action-1",
  };
  const withRequest = {
    ...body,
    requestFingerprint: computeDecisionActionRequestFingerprint(body),
  };
  return { ...withRequest, sealedHash: sha256Canonical(withRequest) };
}

function beatLedgerFixture(
  action: DecisionActionV1,
): { events: WorkingLedgerEventV1[]; workingDeltaHash: string; resolutionHash: string } {
  const routeHash = digest("beat-route");
  const initial = createChapterWorkingState({ runId: action.runId, chapterId: action.chapterId });
  const pin = {
    schemaVersion: "pressure_decision_pin_v1" as const,
    chapterId: action.chapterId,
    stateRevision: 0,
    stateFingerprint: workingStateHash(initial),
    decisionPointId: action.decisionPointId,
    kernelId: "kernel-reader",
    optionIds: [action.actionType],
  };
  const intent = {
    visibility: "PUBLIC" as const,
    targetSeatIds: [] as typeof action.seatId[],
    evidenceRefs: [] as string[],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
  let events = buildWorkingLedgerEvents({
    key: { runId: action.runId, chapterRuntimeId: action.chapterRuntimeId },
    chapterId: action.chapterId,
    previousEvents: [],
    payloads: [{
      eventType: "WORKING_LEDGER_OPENED",
      routeHash,
      chapterDefinitionHash: digest("beat-definition"),
      initialState: initial,
      initialStateHash: workingStateHash(initial),
      nextDecisionPin: pin,
    }, {
      eventType: "FORMAL_ACTION_ACCEPTED",
      routeHash,
      inputFingerprint: computeWorkingActionInputFingerprintV1({ routeHash, action, intent }),
      action,
      intent,
      audienceSeatIds: [action.seatId],
    }],
  });
  const workingDelta = {
    workingFactMutations: [],
    commitmentMutations: [],
    knowledgeMutations: [],
    seatArcWorkingMutations: [],
  };
  const beatWithoutHash = {
    schemaVersion: "sangtian_beat_resolution_v1" as const,
    runId: action.runId,
    chapterRuntimeId: action.chapterRuntimeId,
    decisionPointId: action.decisionPointId,
    baseWorkingRevision: 0,
    committedWorkingRevision: 1,
    inputWorkingStateHash: workingStateHash(initial),
    sealedActionIds: [action.actionId],
    sealedActionsHash: computeSealedActionsHash([action]),
    resolverVersion: "beat-resolver-v1",
    workingDelta,
    reservationMutations: [],
    reactionContextRef: { sourceHash: digest("reaction") },
    nextDecisionContextRef: null,
  };
  const resolutionHash = sha256Canonical(beatWithoutHash);
  const beatResolution = { ...beatWithoutHash, resolutionHash };
  const stateAfter = {
    ...initial,
    revision: 1,
    completedDecisionPointIds: [action.decisionPointId],
    lastBeatId: "beat-reader",
  };
  const authoredWithoutHash = {
    schemaVersion: "pressure_beat_result_v1" as const,
    beatId: "beat-reader",
    chapterId: action.chapterId,
    decisionPointId: action.decisionPointId,
    optionId: action.actionType,
    baseRevision: 0,
    baseFingerprint: workingStateHash(initial),
    workingDelta: {
      schemaVersion: "pressure_working_delta_v1" as const,
      baseRevision: 0,
      completeDecisionPointId: action.decisionPointId,
      setFacts: {},
      incrementCounters: {},
      satisfyRequirementIds: [],
      appendSettledReaction: null,
    },
  };
  const [beatEvent] = buildWorkingLedgerEvents({
    key: { runId: action.runId, chapterRuntimeId: action.chapterRuntimeId },
    chapterId: action.chapterId,
    previousEvents: events,
    payloads: [{
      eventType: "BEAT_APPLIED",
      routeHash,
      commandFingerprint: digest("beat-command"),
      actionInputFingerprint: digest("beat-input"),
      beatResolution,
      authoredBeatResult: {
        ...authoredWithoutHash,
        resultHash: sha256Canonical(authoredWithoutHash),
      },
      stateAfter,
      stateAfterHash: workingStateHash(stateAfter),
      nextDecisionPin: null,
    }],
  });
  events = [...events, beatEvent!];
  return { events, workingDeltaHash: sha256Canonical(workingDelta), resolutionHash };
}

function artifactFixture(
  job: OpenNovelNarrativeProjectionJobV1,
  projectorVersion: string,
): OpenNovelNarrativeArtifactV1 {
  const body = { text: "The edict's consequence is now settled.", usedFactRefs: ["fact.public"] };
  return {
    schemaVersion: "openovel_narrative_artifact_v1",
    jobId: job.jobId,
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    audience: job.audience,
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion,
    text: body.text,
    usedFactRefs: body.usedFactRefs,
    validationReportHash: digest("truth-report"),
    contentHash: computeNarrativeArtifactContentHash(body),
    renderMode: "PROVIDER",
    status: "PUBLISHED",
  };
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
