import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical } from "@ai-story/shared";
import {
  CanonicalAEmotionAuthorityEventCompilerV1,
  sealAEmotionAuthorityOutboxJobV1,
  sealAEmotionCommittedAuthoritySourceV1,
} from "./compiler";
import type { AEmotionAuthorityEmissionV1 } from "./content-source";
import {
  createPrismaAEmotionAuthorityBundleV1,
  PrismaAEmotionAuthorityOutboxRepositoryV1,
  type AEmotionAuthorityPrismaClientV1,
} from "./prisma-adapters";
import { PressurePersistenceError } from "../persistence/errors";
import { encodeAggregateEnvelope } from "../a-emotion-persistence/codec";
import { aEmotionAggregationKey, aEmotionProjectionIdempotencyKey } from "../a-emotion/identity";

const NOW = Date.parse("2026-08-12T06:00:00.000Z");

test("Prisma A-Emotion outbox claims only INTERACTION_COMPILE_REQUESTED and fences ack", async () => {
  const emission = finaleEmission();
  const fake = new AEmotionPrismaFake([
    outboxRow("narrative-row", "PROJECT_FINALE_NARRATIVE", emission.job),
    outboxRow("aemotion-row", "INTERACTION_COMPILE_REQUESTED", emission.job),
  ]);
  const repository = new PrismaAEmotionAuthorityOutboxRepositoryV1(fake.client);

  const claim = await repository.claimNext({ workerId: "worker-a", nowMs: NOW, leaseMs: 30_000 });

  assert.equal(claim.kind, "CLAIMED");
  if (claim.kind !== "CLAIMED") return;
  assert.equal(claim.outboxId, "aemotion-row");
  assert.deepEqual(claim.job, emission.job);
  assert(fake.claimQueries.every((query) => query.where?.taskType === "INTERACTION_COMPILE_REQUESTED"));
  assert.equal(fake.rows.get("narrative-row")?.status, "PENDING");
  await assert.rejects(
    repository.acknowledge({ outboxId: claim.outboxId, fence: 0 }),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_OUTBOX_LEASE_LOST",
  );
  await repository.acknowledge({ outboxId: claim.outboxId, fence: claim.fence });
  assert.equal(fake.rows.get("aemotion-row")?.status, "COMPLETED");
});

test("Prisma A-Emotion outbox dead-letters a payload hash drift without leasing it", async () => {
  const emission = finaleEmission();
  const row = outboxRow("aemotion-corrupt", "INTERACTION_COMPILE_REQUESTED", emission.job);
  row.payloadHash = sha256Canonical({ corrupt: true });
  const fake = new AEmotionPrismaFake([row]);
  const repository = new PrismaAEmotionAuthorityOutboxRepositoryV1(fake.client);

  const result = await repository.claimNext({ workerId: "worker-a", nowMs: NOW, leaseMs: 30_000 });

  assert.deepEqual(result, { kind: "EMPTY" });
  assert.equal(fake.rows.get(row.id)?.status, "DEAD_LETTER");
  assert.match(String(fake.rows.get(row.id)?.lastError), /^INVALID_A_EMOTION_JOB:/u);
});

test("Prisma A-Emotion bundle re-derives authority and source-bound active-human context", async () => {
  const emission = finaleEmission();
  const fake = new AEmotionPrismaFake([], emission);
  const bundle = createPrismaAEmotionAuthorityBundleV1(fake.client, {
    contentCompiler: {
      compileFinale: () => [structuredClone(emission)],
    } as never,
  });

  assert.deepEqual(await bundle.authority.readCommitted(emission.job), emission.source);
  const event = new CanonicalAEmotionAuthorityEventCompilerV1().compile(
    emission.job,
    emission.source,
  );
  const contexts = await bundle.viewers.readForCommittedSource({
    sourceKind: emission.source.sourceKind,
    sourceId: emission.source.sourceId,
    sourceCommitHash: emission.source.sourceCommitHash,
    roomId: emission.source.roomId,
    runId: emission.source.runId,
    stageId: emission.source.stageId,
    eventId: event.eventId,
    eventFamily: event.eventFamily,
    sharedObjectId: event.sharedObjectId,
    revealOfEventId: null,
    audienceSpec: event.audienceSpec,
  }) as Array<Record<string, any>>;

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.viewer.subjectId, "human-user-1");
  assert.deepEqual(contexts[0]?.viewer.authorizedEvidenceRefs, ["evidence.authorized"]);
  assert.equal(contexts[0]?.priorProjection, null);
  assert.equal(contexts[0]?.priorAggregationKey, null);
  assert.equal(contexts[0]?.contextHash, sha256Canonical({
    sourceCommitHash: emission.source.sourceCommitHash,
    viewer: contexts[0]?.viewer,
    priorProjectionHash: null,
    priorAggregationKey: null,
  }));
  assert.equal(fake.authorityWriteCalls, 0);
});

test("Prisma A-Emotion viewer reader returns an empty successful context set for AI-only seats", async () => {
  const emission = finaleEmission();
  const fake = new AEmotionPrismaFake([], emission);
  fake.humanActive = false;
  const bundle = createPrismaAEmotionAuthorityBundleV1(fake.client, {
    contentCompiler: { compileFinale: () => [structuredClone(emission)] } as never,
  });
  const event = new CanonicalAEmotionAuthorityEventCompilerV1().compile(emission.job, emission.source);

  const contexts = await bundle.viewers.readForCommittedSource({
    sourceKind: emission.source.sourceKind,
    sourceId: emission.source.sourceId,
    sourceCommitHash: emission.source.sourceCommitHash,
    roomId: emission.source.roomId,
    runId: emission.source.runId,
    stageId: emission.source.stageId,
    eventId: event.eventId,
    eventFamily: event.eventFamily,
    sharedObjectId: event.sharedObjectId,
    revealOfEventId: null,
    audienceSpec: event.audienceSpec,
  });

  assert.deepEqual(contexts, []);
  assert.equal(fake.authorityWriteCalls, 0);
});

test("Prisma viewer reader resolves a reveal to the same prior aggregate and authorizes its committed basis", async () => {
  const emission = revealEmission();
  const prior = priorAggregateRow(emission.job.runId);
  const fake = new AEmotionPrismaFake([], emission, [prior]);
  const bundle = createPrismaAEmotionAuthorityBundleV1(fake.client, {
    contentCompiler: { compileFinale: () => [structuredClone(emission)] } as never,
  });
  const event = new CanonicalAEmotionAuthorityEventCompilerV1().compile(emission.job, emission.source);
  const contexts = await bundle.viewers.readForCommittedSource({
    sourceKind: emission.source.sourceKind,
    sourceId: emission.source.sourceId,
    sourceCommitHash: emission.source.sourceCommitHash,
    roomId: emission.source.roomId,
    runId: emission.source.runId,
    stageId: emission.source.stageId,
    eventId: event.eventId,
    eventFamily: event.eventFamily,
    sharedObjectId: event.sharedObjectId,
    revealOfEventId: "prior-root-event",
    audienceSpec: event.audienceSpec,
  }) as Array<Record<string, any>>;
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.priorProjection.eventId, "prior-root-event");
  assert.equal(contexts[0]?.priorAggregationKey, prior.payloadJson.aggregate.aggregationKey);
  assert.deepEqual(contexts[0]?.viewer.knownFactRefs, ["fact.investigation.suspected"]);
});

class AEmotionPrismaFake {
  readonly rows = new Map<string, Record<string, any>>();
  readonly claimQueries: any[] = [];
  authorityWriteCalls = 0;
  humanActive = true;

  constructor(
    rows: Array<Record<string, any>>,
    private readonly emission: AEmotionAuthorityEmissionV1 = finaleEmission(),
    private readonly aggregateRows: Array<Record<string, any>> = [],
  ) {
    for (const row of rows) this.rows.set(row.id, row);
  }

  readonly client: AEmotionAuthorityPrismaClientV1 = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => operation({
      pressureOutboxTask: {
        findFirst: async (input: any) => {
          this.claimQueries.push(structuredClone(input));
          const taskType = input.where?.taskType;
          const candidates = [...this.rows.values()].filter((row) => (
            row.taskType === taskType
            && ["PENDING", "RETRYABLE", "LEASED"].includes(row.status)
          ));
          return candidates[0] ? structuredClone(candidates[0]) : null;
        },
        updateMany: async ({ where, data }: any) => {
          const row = this.rows.get(where.id);
          if (
            !row
            || (where.taskType !== undefined && row.taskType !== where.taskType)
            || (where.status !== undefined && row.status !== where.status)
            || (where.leaseVersion !== undefined && row.leaseVersion !== where.leaseVersion)
            || (where.attempt !== undefined && row.attempt !== where.attempt)
          ) return { count: 0 };
          Object.assign(row, structuredClone(data));
          return { count: 1 };
        },
      },
      storyEvent: {
        findMany: async (input: any) => input.where?.type === "PRESSURE_A_EMOTION_AGGREGATE_V1"
          ? structuredClone(this.aggregateRows)
          : [],
      },
      pressureChapterSettlement: {
        findUnique: async () => null,
        findMany: async () => [],
      },
      pressureFinaleDecision: {
        findFirst: async () => ({
          runId: this.emission.job.runId,
          commitHash: this.emission.job.sourceCommitHash,
          commitManifestJson: {},
        }),
      },
      storyRole: {
        findUnique: async (input: any) => ({
          id: "role-1",
          runId: this.emission.job.runId,
          roleKey: input.where?.runId_roleKey?.roleKey,
        }),
      },
      storyPlayer: {
        findUnique: async () => ({
          runId: this.emission.job.runId,
          roleId: "role-1",
          userId: this.humanActive ? "human-user-1" : null,
          playerType: this.humanActive ? "human" : "ai",
          status: "active",
        }),
      },
    }),
  };
}

function outboxRow(
  id: string,
  taskType: string,
  job: AEmotionAuthorityEmissionV1["job"],
): Record<string, any> {
  return {
    id,
    taskType,
    status: "PENDING",
    payloadJson: structuredClone(job),
    payloadHash: sha256Canonical(job),
    attempt: 0,
    maxAttempts: 3,
    availableAt: new Date(NOW),
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    lastError: null,
  };
}

function finaleEmission(): AEmotionAuthorityEmissionV1 {
  const sourceCommitHash = sha256Canonical({ finale: "committed" });
  const job = sealAEmotionAuthorityOutboxJobV1({
    schemaVersion: "a_emotion_authority_outbox_job_v1",
    sourceKind: "FINALE_COMMITTED",
    runId: "run-aemotion-prisma-1",
    sourceId: sourceCommitHash,
    sourceCommitHash,
    signalId: "finale:confirmed:source-seat",
  });
  const source = sealAEmotionCommittedAuthoritySourceV1({
    schemaVersion: "a_emotion_committed_authority_source_v1",
    sourceKind: job.sourceKind,
    sourceId: job.sourceId,
    sourceCommitHash,
    roomId: job.runId,
    runId: job.runId,
    stageId: "FINALE",
    sourceActionId: "action-final",
    sourceSeatId: "zhejiang_governor",
    committedAt: "2026-08-12T06:00:00.000Z",
    eventSequence: 80_000_001,
    stateVersion: 8,
    storyDay: 8,
    signal: {
      signalId: job.signalId,
      kind: "DIRECT_IMPACT",
      eventCode: "SANGTIAN_FINALE_WIN",
      eventFamily: "finale-verdict",
      severity: "MAJOR",
      sharedObjectId: "finale:seat:zhejiang_governor",
      factRefs: ["fact.final.public"],
      publicFactRefs: ["fact.final.public"],
      impacts: [{
        targetSeatId: "zhejiang_governor",
        visibility: "TARGET_ONLY",
        type: "GOAL_PROGRESS",
        key: "finaleVerdict",
        before: null,
        after: "WIN",
        delta: null,
        effectCode: "SANGTIAN_FINALE_VERDICT_WIN",
      }],
      audienceSpec: { type: "EXPLICIT", seatIds: ["zhejiang_governor"] },
      disclosure: "CONFIRMED",
      suspectedSeatIds: [],
      suspicionBasisRefs: [],
      evidenceRefs: ["evidence.authorized"],
      revealOfEventId: null,
      promiseId: null,
      milestoneId: "finale:win",
      metricTransitionId: null,
      presentation: {
        recommendedPresentation: "FEED_ONLY",
        centerCardType: null,
        responseOptions: [],
        modalTrigger: null,
      },
    },
  }, job);
  return { dedupeKey: `aemotion:${job.jobHash}`, job, source };
}

function revealEmission(): AEmotionAuthorityEmissionV1 {
  const sourceCommitHash = sha256Canonical({ investigation: "suspected" });
  const job = sealAEmotionAuthorityOutboxJobV1({
    schemaVersion: "a_emotion_authority_outbox_job_v1",
    sourceKind: "FINALE_COMMITTED",
    runId: "run-aemotion-prisma-reveal",
    sourceId: sourceCommitHash,
    sourceCommitHash,
    signalId: "investigation:suspected",
  });
  const source = sealAEmotionCommittedAuthoritySourceV1({
    schemaVersion: "a_emotion_committed_authority_source_v1",
    sourceKind: job.sourceKind,
    sourceId: job.sourceId,
    sourceCommitHash,
    roomId: job.runId,
    runId: job.runId,
    stageId: "FINALE",
    sourceActionId: "action-investigate-source",
    sourceSeatId: "zhejiang_administration",
    committedAt: "2026-08-12T06:01:00.000Z",
    eventSequence: 60_000_002,
    stateVersion: 2,
    storyDay: 6,
    signal: {
      signalId: job.signalId,
      kind: "REVEAL",
      eventCode: "LEDGER_SOURCE_SUSPECTED",
      eventFamily: "LEDGER_FLOW",
      severity: "MAJOR",
      sharedObjectId: "original-grain-ledger",
      factRefs: ["fact.investigation.suspected"],
      publicFactRefs: [],
      impacts: [],
      audienceSpec: { type: "EXPLICIT", seatIds: ["zhejiang_governor"] },
      disclosure: "SUSPECTED",
      suspectedSeatIds: ["zhejiang_administration"],
      suspicionBasisRefs: ["fact.investigation.suspected"],
      evidenceRefs: [],
      revealOfEventId: "prior-root-event",
      promiseId: null,
      milestoneId: null,
      metricTransitionId: null,
      presentation: {
        recommendedPresentation: "CENTER_CARD",
        centerCardType: "CROSS_IMPACT",
        responseOptions: [
          { code: "INVESTIGATE_SOURCE", preferredEntry: "INVESTIGATE", consumesManeuverOnSubmit: false },
          { code: "PUBLIC_QUESTION", preferredEntry: "TALK", consumesManeuverOnSubmit: false },
          { code: "DEFER", preferredEntry: "DEFER", consumesManeuverOnSubmit: false },
        ],
        modalTrigger: null,
      },
    },
  }, job);
  return { dedupeKey: `aemotion:${job.jobHash}`, job, source };
}

function priorAggregateRow(runId: string): Record<string, any> {
  const projectionBody = {
    schemaVersion: "a_emotion_viewer_projection_v1" as const,
    eventId: "prior-root-event",
    projectionVersion: 1,
    roomId: runId,
    runId,
    viewerSeatId: "zhejiang_governor" as const,
    category: "RELATED" as const,
    disclosure: "HIDDEN" as const,
    severity: "MAJOR" as const,
    title: "ledger anomaly",
    safeSummary: "source unknown",
    statusLabel: "source unknown",
    visibleImpacts: [],
    knownFactRefs: [],
    responseOptions: [],
    recommendedPresentation: "FEED_ONLY" as const,
    centerCard: null,
    keyModal: null,
    eventSequence: 60_000_001,
    occurredAt: "2026-08-12T06:00:00.000Z",
  };
  const projection = { ...projectionBody, projectionHash: sha256Canonical(projectionBody) };
  const aggregationKey = aEmotionAggregationKey({
    roomId: runId,
    runId,
    viewerSeatId: "zhejiang_governor",
    eventId: projection.eventId,
  });
  const aggregate = {
    aggregationKey,
    roomId: runId,
    runId,
    viewerSeatId: "zhejiang_governor" as const,
    stageId: "N6",
    sharedObjectId: "original-grain-ledger",
    eventFamily: "LEDGER_FLOW",
    latestEventId: projection.eventId,
    projectionVersion: 1,
    projection,
    createdAt: projection.occurredAt,
    updatedAt: projection.occurredAt,
  };
  const idempotencyKey = aEmotionProjectionIdempotencyKey({
    eventId: projection.eventId,
    viewerSeatId: projection.viewerSeatId,
  });
  const commit = {
    idempotencyKey,
    inputFingerprint: sha256Canonical({ prior: true }),
    expectedAggregateVersion: 0,
    aggregate,
    delivery: {
      eventId: projection.eventId,
      projectionVersion: 1,
      roomId: runId,
      runId,
      viewerSeatId: projection.viewerSeatId,
      deliveredAt: projection.occurredAt,
      seenAt: null,
      acknowledgedAt: null,
      resolvedAt: null,
      keyModalShownAt: null,
    },
  };
  return {
    payloadJson: encodeAggregateEnvelope({
      idempotencyKey,
      inputFingerprint: commit.inputFingerprint,
      expectedAggregateVersion: 0,
      commit,
      storyDay: 6,
    }),
    createdAt: new Date(projection.occurredAt),
  };
}
