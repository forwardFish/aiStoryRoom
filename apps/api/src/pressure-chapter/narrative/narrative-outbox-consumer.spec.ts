import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeNarrativeArtifactContentHash,
  sha256Canonical,
  validateOpenNovelNarrativeProjectionJobV1,
  type OpenNovelNarrativeArtifactV1,
  type OpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";
import { PressureReplayPolicyEvaluatorV1 } from "../replay/replay-policy";
import { PressureResultQueryServiceV1 } from "../result/result-query.service";
import {
  pressureResultReadModelFixture,
  replayActionsFixture,
  viewerFixture,
} from "../result/result-test-fixtures";
import { NarrativeOutboxConsumerV1 } from "./narrative-outbox-consumer";
import type {
  NarrativeOutboxPortV1,
  OpenNovelNarrativeProjectorPortV1,
} from "./ports";

const COMMIT_HASH = "a".repeat(64);
const CONTENT_HASH = "b".repeat(64);

test("outbox reads committed authority, projects audience before Provider, and performs zero authority writes", async () => {
  const job = jobFixture();
  const source = authoritySourceFixture(job);
  const sourceHashBefore = sha256Canonical(source);
  const harness = consumerHarness(job, source, publishedReceipt(job));

  const result = await harness.consumer.consumeNext("worker-1");

  assert.deepEqual(result, { kind: "ACKNOWLEDGED", outboxId: "outbox-1", status: "PUBLISHED" });
  assert.equal(harness.counters.authorityReads, 1);
  assert.equal(harness.counters.authorityWrites, 0);
  assert.equal(harness.counters.projectorCalls, 1);
  assert.equal(harness.counters.acknowledges, 1);
  assert.equal(harness.counters.retries, 0);
  assert.equal(harness.counters.deadLetters, 0);
  assert.equal(sha256Canonical(source), sourceHashBefore);
  const providerBoundary = JSON.stringify(harness.projectorInputs[0]);
  assert.match(providerBoundary, /cabinet-only evidence/);
  assert.match(providerBoundary, /cabinet-private knowledge/);
  assert.doesNotMatch(providerBoundary, /SECRET_OTHER_SEAT/);
  assert.doesNotMatch(providerBoundary, /verdict-other/);
  assert.doesNotMatch(providerBoundary, /fact-other/);
});

test("malformed job and audience allowlist mismatch fail closed before Provider", async (t) => {
  await t.test("malformed canonical job", async () => {
    const job = { ...jobFixture(), sourceCommitHash: "not-a-hash" };
    const harness = consumerHarness(job, authoritySourceFixture(jobFixture()), publishedReceipt(jobFixture()));
    const result = await harness.consumer.consumeNext("worker-invalid-job");
    assert.equal(result.kind, "DEAD_LETTERED");
    assert.equal(harness.counters.projectorCalls, 0);
    assert.equal(harness.counters.authorityReads, 0);
  });

  await t.test("stored source reveals an unlisted audience fact", async () => {
    const job = jobFixture();
    const source = authoritySourceFixture(job);
    source.facts.push({
      factId: "fact-unlisted-visible",
      text: "must fail closed",
      temporalStatus: "FROZEN",
      visibility: "AUTHORIZED",
      authorizedSeatIds: ["cabinet_finance"],
    });
    source.facts.sort((left, right) => left.factId < right.factId ? -1 : 1);
    const harness = consumerHarness(job, source, publishedReceipt(job));
    const result = await harness.consumer.consumeNext("worker-invalid-source");
    assert.equal(result.kind, "DEAD_LETTERED");
    assert.equal(harness.counters.projectorCalls, 0);
  });
});

test("retry and dead-letter are fenced outbox outcomes, never authority rollback", async (t) => {
  await t.test("retryable projection schedules the same claimed event", async () => {
    const job = jobFixture();
    const harness = consumerHarness(job, authoritySourceFixture(job), {
      ...publishedReceipt(job),
      status: "FAILED_RETRYABLE",
      artifact: null,
      retryAtMs: 1_050,
      errorCode: "PROVIDER_FAILURE",
    });
    const result = await harness.consumer.consumeNext("worker-retry");
    assert.deepEqual(result, {
      kind: "RETRY_SCHEDULED",
      outboxId: "outbox-1",
      retryAtMs: 1_050,
      reasonCode: "PROVIDER_FAILURE",
    });
    assert.equal(harness.lastRetry?.fence, 7);
    assert.equal(harness.counters.authorityWrites, 0);
  });

  await t.test("exhausted event dead-letters with its fence", async () => {
    const job = jobFixture();
    const harness = consumerHarness(job, authoritySourceFixture(job), {
      ...publishedReceipt(job),
      deliveryState: "DEAD_LETTERED",
      status: "FAILED_RETRYABLE",
      artifact: null,
      retryAtMs: null,
      errorCode: "PROJECTION_DEAD_LETTERED",
    });
    const result = await harness.consumer.consumeNext("worker-dead");
    assert.equal(result.kind, "DEAD_LETTERED");
    assert.equal(harness.lastDeadLetter?.fence, 7);
    assert.equal(harness.counters.authorityWrites, 0);
  });
});

test("Result remains readable with PENDING narrative while projection is in flight", async () => {
  const job = jobFixture();
  let release!: (value: unknown) => void;
  const delayed = new Promise<unknown>((resolve) => { release = resolve; });
  const harness = consumerHarness(job, authoritySourceFixture(job), delayed);
  const inFlight = harness.consumer.consumeNext("worker-delayed");
  while (harness.counters.projectorCalls === 0) await Promise.resolve();

  const resultService = new PressureResultQueryServiceV1(
    { async readFinalized() { return pressureResultReadModelFixture(); } },
    { async readViewerContext(_runId, viewerId) { return viewerFixture("cabinet_finance", viewerId); } },
    new PressureReplayPolicyEvaluatorV1({
      async listActions(source) { return replayActionsFixture(source.participantMode); },
    }),
  );
  const result = await resultService.getResult({
    runId: "run-pressure-1",
    viewerId: "viewer-cabinet_finance",
  });
  assert.equal(result.authoritativeResultStatus, "FINALIZED");
  assert.equal(result.payload.narrative.status, "PENDING");
  assert.equal(result.payload.narrative.text, null);

  release(publishedReceipt(job));
  assert.equal((await inFlight).kind, "ACKNOWLEDGED");
});

function consumerHarness(job: unknown, source: unknown, projectorResult: unknown | Promise<unknown>) {
  const counters = {
    authorityReads: 0,
    authorityWrites: 0,
    projectorCalls: 0,
    acknowledges: 0,
    retries: 0,
    deadLetters: 0,
  };
  const projectorInputs: unknown[] = [];
  let lastRetry: Parameters<NarrativeOutboxPortV1["retry"]>[0] | null = null;
  let lastDeadLetter: Parameters<NarrativeOutboxPortV1["deadLetter"]>[0] | null = null;
  const outbox: NarrativeOutboxPortV1 = {
    async claimNext() {
      return { kind: "CLAIMED", outboxId: "outbox-1", fence: 7, attemptCount: 0, maxAttempts: 3, job: structuredClone(job) };
    },
    async acknowledge() { counters.acknowledges += 1; },
    async retry(request) { counters.retries += 1; lastRetry = structuredClone(request); },
    async deadLetter(request) { counters.deadLetters += 1; lastDeadLetter = structuredClone(request); },
  };
  const authority = {
    async readCommitted() { counters.authorityReads += 1; return structuredClone(source); },
    async writeAuthority() { counters.authorityWrites += 1; },
  };
  const projector: OpenNovelNarrativeProjectorPortV1 = {
    async project(request) {
      counters.projectorCalls += 1;
      projectorInputs.push(structuredClone(request));
      return projectorResult instanceof Promise ? projectorResult : structuredClone(projectorResult);
    },
  };
  const consumer = new NarrativeOutboxConsumerV1(
    outbox,
    authority,
    projector,
    { nowMs: () => 1_000 },
    { leaseMs: 1_000, infrastructureRetryMs: 50 },
  );
  return {
    consumer,
    counters,
    projectorInputs,
    get lastRetry() { return lastRetry; },
    get lastDeadLetter() { return lastDeadLetter; },
  };
}

function jobFixture(): OpenNovelNarrativeProjectionJobV1 {
  return validateOpenNovelNarrativeProjectionJobV1({
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: "job-finale-cabinet",
    runId: "run-pressure-1",
    audience: { kind: "SEAT", seatId: "cabinet_finance" },
    sourceRuntimeProfile: "sangtian_pressure_chapter_v1",
    projectionKind: "FINALE_NARRATIVE",
    sourceAuthority: "FINALE_FROZEN",
    sourceId: "finale-pressure-1",
    sourceCommitHash: COMMIT_HASH,
    sourceContentHash: CONTENT_HASH,
    allowedFactIds: ["fact-public", "fact-seat"],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: ["knowledge-seat"],
    narrativeProfileVersion: "sangtian_pressure_narrative_v1",
    idempotencyKey: "narrative-finale-cabinet",
  });
}

function authoritySourceFixture(job: OpenNovelNarrativeProjectionJobV1) {
  return {
    schemaVersion: "authoritative_narrative_source_snapshot_v1" as const,
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    facts: [
      visibleFact("fact-other", "SECRET_OTHER_SEAT", "AUTHORIZED", ["qingliu_law"]),
      visibleFact("fact-public", "World remains stable", "PUBLIC", []),
      visibleFact("fact-seat", "cabinet-only evidence", "AUTHORIZED", ["cabinet_finance"]),
    ],
    objects: [],
    knowledge: [
      visibleKnowledge("knowledge-other", "SECRET_OTHER_SEAT knowledge", "AUTHORIZED", ["qingliu_law"]),
      visibleKnowledge("knowledge-seat", "cabinet-private knowledge", "AUTHORIZED", ["cabinet_finance"]),
    ],
    claims: [
      visibleClaim("FACT", "fact-other", "SECRET_OTHER_SEAT", false, "AUTHORIZED", ["qingliu_law"]),
      visibleClaim("FACT", "fact-public", "World remains stable", true, "PUBLIC", []),
      visibleClaim("FACT", "fact-seat", "cabinet-only evidence", false, "AUTHORIZED", ["cabinet_finance"]),
      visibleClaim("KNOWLEDGE", "knowledge-other", "SECRET_OTHER_SEAT knowledge", false, "AUTHORIZED", ["qingliu_law"]),
      visibleClaim("KNOWLEDGE", "knowledge-seat", "cabinet-private knowledge", false, "AUTHORIZED", ["cabinet_finance"]),
      visibleClaim("OUTCOME", "world-outcome", "The common outcome is confirmed", true, "PUBLIC", []),
      visibleClaim("VERDICT", "verdict-cabinet", "Cabinet verdict is WIN", true, "AUTHORIZED", ["cabinet_finance"]),
      visibleClaim("VERDICT", "verdict-other", "SECRET_OTHER_SEAT LOSS", true, "AUTHORIZED", ["qingliu_law"]),
    ].sort((left, right) => `${left.kind}\u0000${left.refId}` < `${right.kind}\u0000${right.refId}` ? -1 : 1),
    publicVariant: {
      kind: "FINALE",
      terminalKind: "PRESSURE_FINALE",
      worldOutcomeRef: "world-outcome",
      viewerVerdictRef: null,
    },
    seatVariants: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      variant: {
        kind: "FINALE",
        terminalKind: "PRESSURE_FINALE",
        worldOutcomeRef: "world-outcome",
        viewerVerdictRef: seatId === "cabinet_finance" ? "verdict-cabinet" : `verdict-${seatId}`,
      },
    })),
  };
}

function visibleFact(factId: string, text: string, visibility: "PUBLIC" | "AUTHORIZED", authorizedSeatIds: string[]) {
  return { factId, text, temporalStatus: "FROZEN", visibility, authorizedSeatIds };
}
function visibleKnowledge(knowledgeId: string, text: string, visibility: "PUBLIC" | "AUTHORIZED", authorizedSeatIds: string[]) {
  return { knowledgeId, text, visibility, authorizedSeatIds };
}
function visibleClaim(kind: string, refId: string, statement: string, required: boolean, visibility: "PUBLIC" | "AUTHORIZED", authorizedSeatIds: string[]) {
  return { kind, refId, statement, required, visibility, authorizedSeatIds };
}

function publishedReceipt(job: OpenNovelNarrativeProjectionJobV1) {
  const base = {
    schemaVersion: "openovel_narrative_artifact_v1" as const,
    jobId: job.jobId,
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    audience: structuredClone(job.audience),
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion: "openovel_pressure_projector_v1",
    text: "World remains stable. Cabinet verdict is WIN.",
    usedFactRefs: ["fact-public"],
    validationReportHash: "c".repeat(64),
    renderMode: "PROVIDER" as const,
    status: "PUBLISHED" as const,
  };
  const artifact: OpenNovelNarrativeArtifactV1 = {
    ...base,
    contentHash: computeNarrativeArtifactContentHash(base),
  };
  return {
    logicalProjectionKey: "d".repeat(64),
    requestFingerprint: "e".repeat(64),
    projectionId: "projection-1",
    status: "PUBLISHED" as const,
    deliveryState: "ACTIVE" as const,
    artifact,
    retryAtMs: null,
    errorCode: null,
  };
}
