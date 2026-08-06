import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { B0PublicationPlanV1 } from "@ai-story/templates";
import {
  B0NarrativeRuntimeV1,
  FileB0NarrativeJobRepositoryV1,
  ProviderB0NarrativeGeneratorV1,
  type B0NarrativeGeneratorV1,
} from "../src/b0-narrative-service.js";
import {
  B0NarrativeRuntimeErrorV1,
  buildB0NarrativeInputV1,
  type B0NarrativeCommitManifestV1,
  type B0NarrativeInputV1,
  type B0NarrativeOutputV1,
} from "../src/b0-narrative-runtime.js";
import type { OpenNovelProvider, ProviderRequest } from "../src/types.js";

const H = {
  ruleset: "a".repeat(64),
  input: "b".repeat(64),
  resolution: "c".repeat(64),
  commit: "d".repeat(64),
  plan: "e".repeat(64),
};

function manifest(): B0NarrativeCommitManifestV1 {
  return {
    schemaVersion: "b0-batch-commit-manifest-v1",
    batchId: "batch.service",
    snapshotId: "snapshot.service",
    windowId: "window.service",
    roomId: "run.service",
    runId: "run.service",
    baseWorldSequence: 4,
    committedWorldSequence: 5,
    rulesetHash: H.ruleset,
    inputHash: H.input,
    resolutionHash: H.resolution,
    resourceMutationKeys: [],
    stateMutationKeys: ["mutation.service"],
    publicationOutboxKeys: ["publication.service"],
    committedAt: "2026-08-07T01:00:00.000Z",
    authoritative: true,
    commitHash: H.commit,
  };
}

function plan(): B0PublicationPlanV1 {
  return {
    schemaVersion: "b0-publication-plan-v1",
    batchId: "batch.service",
    roomId: "run.service",
    runId: "run.service",
    windowId: "window.service",
    baseWorldSequence: 4,
    resolutionHash: H.resolution,
    deliveries: [{
      schemaVersion: "b0-publication-delivery-v1",
      idempotencyKey: "intent.service.outcome.actor.service",
      batchId: "batch.service",
      runId: "run.service",
      windowId: "window.service",
      resultId: "result.service",
      resultKind: "PERSONAL_OUTCOME",
      recipientActorId: "actor.service",
      visibility: "PRIVATE",
      sourceDisclosure: "FULL",
      originActorIds: ["actor.service"],
      targetActorIds: ["actor.service"],
      summary: "The committed plan creates a limited opening without deciding the next choice.",
      outcomeStatus: "PARTIAL_SUCCESS",
      changes: [{ kind: "RELATION", operation: "INCREMENT", numericDelta: 1 }],
      explanation: {
        schemaVersion: "b0-causal-explanation-card-v1",
        resultId: "result.service",
        reasons: [{ kind: "OWN_PLAN", summary: "The actor's own plan caused this opening." }],
      },
    }],
    planHash: H.plan,
  };
}

function narrativeInput(): B0NarrativeInputV1 {
  return buildB0NarrativeInputV1({
    manifest: manifest(),
    publicationPlan: plan(),
    recipientActorId: "actor.service",
    appliedWorldSequence: 5,
    guidance: {
      schemaVersion: "b0-narrative-guidance-v1",
      version: 1,
      locale: "en-US",
      narrativeKind: "SETTLEMENT_ROLE_VIEW",
      styleDirectives: ["Use a concise point of view."],
      allowedActorLabels: ["The actor"],
      forbiddenPhrases: ["internal settlement"],
    },
  });
}

function validOutput(input: B0NarrativeInputV1, prose = "The plan opens a narrow path, but the next decision remains entirely yours."): B0NarrativeOutputV1 {
  return {
    schemaVersion: "b0-narrative-output-v1",
    inputHash: input.inputHash,
    guidanceVersion: input.guidanceVersion,
    prose,
    sourceResultIds: ["result.service"],
    claims: [{ sourceResultId: "result.service", statement: input.deliveries[0].summary }],
    outcomeAssertions: [{ sourceResultId: "result.service", outcomeStatus: "PARTIAL_SUCCESS" }],
    changeAssertions: [{
      sourceResultId: "result.service",
      changeIndex: 0,
      kind: "RELATION",
      operation: "INCREMENT",
      numericDelta: 1,
    }],
    revealedOriginActorIds: ["actor.service"],
    authoritativeFacts: [],
    stateMutations: [],
    relationshipMutations: [],
    capabilityMutations: [],
    knowledgeGrants: [],
  };
}

async function repository(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "b0-narrative-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new FileB0NarrativeJobRepositoryV1(root);
}

test("C6 durable narrative service enqueues once, publishes once and replays without a second model call", async (t) => {
  const store = await repository(t);
  const input = narrativeInput();
  let calls = 0;
  const generator: B0NarrativeGeneratorV1 = {
    generate: async (value) => {
      calls += 1;
      return validOutput(value);
    },
  };
  const runtime = new B0NarrativeRuntimeV1(store, generator);
  assert.equal((await runtime.enqueue(input, "2026-08-07T01:00:01.000Z")).created, true);
  assert.equal((await runtime.enqueue(input, "2026-08-07T01:00:02.000Z")).created, false);
  const first = await runtime.process({
    jobKey: input.jobKey,
    workerId: "worker.service",
    currentGuidanceVersion: 1,
    now: "2026-08-07T01:00:03.000Z",
  });
  assert.equal(first.replayed, false);
  assert.equal(first.job.status, "PUBLISHED");
  assert.equal((await store.getPublication(input.jobKey))?.contentHash, first.publication.contentHash);
  const replay = await runtime.process({
    jobKey: input.jobKey,
    workerId: "worker.service",
    currentGuidanceVersion: 1,
    now: "2026-08-07T01:00:04.000Z",
  });
  assert.equal(replay.replayed, true);
  assert.equal(calls, 1);
});

test("C6 invalid narrative output is parked for retry and never becomes a publication", async (t) => {
  const store = await repository(t);
  const input = narrativeInput();
  const runtime = new B0NarrativeRuntimeV1(store, {
    generate: async (value) => ({
      ...validOutput(value),
      relationshipMutations: [{ operation: "SET" }],
    }),
  });
  await runtime.enqueue(input, "2026-08-07T01:00:01.000Z");
  await assert.rejects(runtime.process({
    jobKey: input.jobKey,
    workerId: "worker.invalid",
    currentGuidanceVersion: 1,
    now: "2026-08-07T01:00:02.000Z",
  }), (error: unknown) => error instanceof B0NarrativeRuntimeErrorV1
    && error.code === "NARRATIVE_VALIDATION_FAILED");
  assert.equal((await store.getJob(input.jobKey)).status, "FAILED_RETRYABLE");
  assert.equal(await store.getPublication(input.jobKey), null);
});

test("C6 provider failure is retryable and a later worker can complete the same immutable job", async (t) => {
  const store = await repository(t);
  const input = narrativeInput();
  await new B0NarrativeRuntimeV1(store, {
    generate: async () => { throw new Error("provider unavailable"); },
  }).enqueue(input, "2026-08-07T01:00:01.000Z");
  const failingRuntime = new B0NarrativeRuntimeV1(store, {
    generate: async () => { throw new Error("provider unavailable"); },
  });
  await assert.rejects(failingRuntime.process({
    jobKey: input.jobKey,
    workerId: "worker.fail",
    currentGuidanceVersion: 1,
    now: "2026-08-07T01:00:02.000Z",
  }), /provider unavailable/u);
  const failed = await store.getJob(input.jobKey);
  assert.equal(failed.status, "FAILED_RETRYABLE");
  assert.equal(failed.failureCode, "NARRATIVE_GENERATION_FAILED");
  const recoveredRuntime = new B0NarrativeRuntimeV1(store, {
    generate: async (value) => validOutput(value),
  });
  const recovered = await recoveredRuntime.process({
    jobKey: input.jobKey,
    workerId: "worker.retry",
    currentGuidanceVersion: 1,
    now: "2026-08-07T01:00:03.000Z",
  });
  assert.equal(recovered.job.status, "PUBLISHED");
  assert.equal(recovered.job.attempt, 2);
});

test("C6 concurrent workers are fenced so only one owns generation", async (t) => {
  const store = await repository(t);
  const input = narrativeInput();
  await store.enqueue(input, "2026-08-07T01:00:01.000Z");
  const results = await Promise.allSettled([
    store.claim({
      jobKey: input.jobKey,
      workerId: "worker.alpha",
      now: "2026-08-07T01:00:02.000Z",
      leaseDurationMs: 30_000,
    }),
    store.claim({
      jobKey: input.jobKey,
      workerId: "worker.beta",
      now: "2026-08-07T01:00:02.000Z",
      leaseDurationMs: 30_000,
    }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof B0NarrativeRuntimeErrorV1);
  assert.equal(rejected.reason.code, "NARRATIVE_JOB_BUSY");
});

test("C6 provider adapter requests strict JSON and repairs a JSON response before validation", async () => {
  const input = narrativeInput();
  let request: ProviderRequest | null = null;
  const provider: OpenNovelProvider = {
    describe: () => ({ provider: "test", model: "test", configured: true }),
    generate: async (value) => {
      request = value;
      const serialized = JSON.stringify(validOutput(input));
      return {
        text: serialized.slice(0, -1) + ",}",
        model: "test",
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
      };
    },
  };
  const generated = await new ProviderB0NarrativeGeneratorV1(provider).generate(input);
  assert.equal(request?.profile, "narrator");
  assert.equal(request?.json, true);
  assert.equal(request?.jsonSchema?.name, "b0_narrative_output_v1");
  assert.equal(generated.inputHash, input.inputHash);
});
