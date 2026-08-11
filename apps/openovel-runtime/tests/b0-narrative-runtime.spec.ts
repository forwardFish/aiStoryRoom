import assert from "node:assert/strict";
import test from "node:test";
import type { B0PublicationPlanV1 } from "@ai-story/templates";
import {
  B0NarrativeRuntimeErrorV1,
  beginB0NarrativeValidationV1,
  buildB0NarrativeInputV1,
  buildB0NarrativeJobKeyV1,
  canAdvanceAfterStructuredResultsV1,
  claimB0NarrativeJobV1,
  createB0NarrativeJobV1,
  failB0NarrativeJobV1,
  heartbeatB0NarrativeJobV1,
  publishB0NarrativeJobV1,
  recoverB0NarrativeJobV1,
  upsertB0NarrativeJobV1,
  validateB0NarrativeOutputV1,
  type B0NarrativeCommitManifestV1,
  type B0NarrativeGuidanceV1,
  type B0NarrativeInputV1,
  type B0NarrativeJobV1,
  type B0NarrativeOutputV1,
} from "../src/b0-narrative-runtime.js";

const H = {
  ruleset: "1".repeat(64),
  input: "2".repeat(64),
  resolution: "3".repeat(64),
  commit: "4".repeat(64),
  plan: "5".repeat(64),
};

function manifest(overrides: Partial<B0NarrativeCommitManifestV1> = {}): B0NarrativeCommitManifestV1 {
  return {
    schemaVersion: "b0-batch-commit-manifest-v1",
    batchId: "batch.one",
    snapshotId: "snapshot.one",
    windowId: "window.one",
    roomId: "run.one",
    runId: "run.one",
    baseWorldSequence: 7,
    committedWorldSequence: 8,
    rulesetHash: H.ruleset,
    inputHash: H.input,
    resolutionHash: H.resolution,
    resourceMutationKeys: ["resource.batch.one.0"],
    stateMutationKeys: ["state.batch.one.0"],
    publicationOutboxKeys: ["publication.batch.one"],
    committedAt: "2026-08-07T00:00:00.000Z",
    authoritative: true,
    commitHash: H.commit,
    ...overrides,
  };
}

function plan(overrides: Partial<B0PublicationPlanV1> = {}): B0PublicationPlanV1 {
  return {
    schemaVersion: "b0-publication-plan-v1",
    batchId: "batch.one",
    roomId: "run.one",
    runId: "run.one",
    windowId: "window.one",
    baseWorldSequence: 7,
    resolutionHash: H.resolution,
    deliveries: [
      {
        schemaVersion: "b0-publication-delivery-v1",
        idempotencyKey: "intent.intent.a.outcome.actor.a",
        batchId: "batch.one",
        runId: "run.one",
        windowId: "window.one",
        resultId: "result.personal.a",
        resultKind: "PERSONAL_OUTCOME",
        recipientActorId: "actor.a",
        visibility: "PRIVATE",
        sourceDisclosure: "FULL",
        originActorIds: ["actor.a"],
        targetActorIds: ["actor.a"],
        summary: "Your plan partially succeeded without forcing the target to agree.",
        outcomeStatus: "PARTIAL_SUCCESS",
        changes: [{ kind: "RESOURCE", operation: "INCREMENT", numericDelta: -1 }],
        explanation: {
          schemaVersion: "b0-causal-explanation-card-v1",
          resultId: "result.personal.a",
          reasons: [{ kind: "OWN_PLAN", summary: "Your committed plan caused this result." }],
        },
      },
      {
        schemaVersion: "b0-publication-delivery-v1",
        idempotencyKey: "trace.trace.one.actor.a",
        batchId: "batch.one",
        runId: "run.one",
        windowId: "window.one",
        resultId: "result.trace.a",
        resultKind: "OBSERVABLE_TRACE",
        recipientActorId: "actor.a",
        visibility: "TRACE",
        sourceDisclosure: "TRACE_ONLY",
        originActorIds: ["actor.b"],
        targetActorIds: ["actor.a"],
        summary: "A guarded meeting changed the atmosphere, but its source remains unknown.",
        outcomeStatus: null,
        changes: [],
        explanation: {
          schemaVersion: "b0-causal-explanation-card-v1",
          resultId: "result.trace.a",
          reasons: [{ kind: "TRACE", summary: "You observed only a limited trace." }],
        },
      },
      {
        schemaVersion: "b0-publication-delivery-v1",
        idempotencyKey: "intent.intent.b.outcome.actor.b",
        batchId: "batch.one",
        runId: "run.one",
        windowId: "window.one",
        resultId: "result.personal.b",
        resultKind: "PERSONAL_OUTCOME",
        recipientActorId: "actor.b",
        visibility: "PRIVATE",
        sourceDisclosure: "FULL",
        originActorIds: ["actor.b"],
        targetActorIds: ["actor.b"],
        summary: "The other actor receives a separate private result.",
        outcomeStatus: "SUCCESS",
        changes: [],
        explanation: {
          schemaVersion: "b0-causal-explanation-card-v1",
          resultId: "result.personal.b",
          reasons: [{ kind: "OWN_PLAN", summary: "Their own plan caused their result." }],
        },
      },
    ],
    planHash: H.plan,
    ...overrides,
  };
}

function guidance(version = 1): B0NarrativeGuidanceV1 {
  return {
    schemaVersion: "b0-narrative-guidance-v1",
    version,
    locale: "en-US",
    narrativeKind: "SETTLEMENT_ROLE_VIEW",
    styleDirectives: ["Use a concise character viewpoint.", "Do not invent new facts."],
    allowedActorLabels: ["Actor A"],
    forbiddenPhrases: ["internal resolution"],
  };
}

function narrativeInput(): B0NarrativeInputV1 {
  return buildB0NarrativeInputV1({
    manifest: manifest(),
    publicationPlan: plan(),
    recipientActorId: "actor.a",
    appliedWorldSequence: 8,
    guidance: guidance(),
    actorLabels: {
      "actor.a": ["Actor A"],
      "actor.b": ["Actor B", "Hidden Envoy"],
    },
  });
}

function output(input: B0NarrativeInputV1, overrides: Partial<B0NarrativeOutputV1> = {}): B0NarrativeOutputV1 {
  return {
    schemaVersion: "b0-narrative-output-v1",
    inputHash: input.inputHash,
    guidanceVersion: input.guidanceVersion,
    prose: "Your request was heard but did not compel agreement. Elsewhere, a guarded meeting left only a faint and uncertain trace.",
    sourceResultIds: input.deliveries.map((delivery) => delivery.resultId),
    claims: input.deliveries.map((delivery) => ({
      sourceResultId: delivery.resultId,
      statement: delivery.summary,
    })),
    outcomeAssertions: input.deliveries
      .filter((delivery) => delivery.outcomeStatus !== null)
      .map((delivery) => ({
        sourceResultId: delivery.resultId,
        outcomeStatus: delivery.outcomeStatus!,
      })),
    changeAssertions: input.deliveries.flatMap((delivery) => delivery.changes.map((change, changeIndex) => ({
      sourceResultId: delivery.resultId,
      changeIndex,
      kind: change.kind,
      operation: change.operation,
      numericDelta: change.numericDelta,
    }))),
    revealedOriginActorIds: ["actor.a"],
    authoritativeFacts: [],
    stateMutations: [],
    relationshipMutations: [],
    capabilityMutations: [],
    knowledgeGrants: [],
    ...overrides,
  };
}

function validatingJob(input: B0NarrativeInputV1): { job: B0NarrativeJobV1; epoch: number } {
  const created = createB0NarrativeJobV1(input, "2026-08-07T00:00:01.000Z");
  const claimed = claimB0NarrativeJobV1({
    job: created,
    workerId: "worker.one",
    now: "2026-08-07T00:00:02.000Z",
    leaseDurationMs: 30_000,
  }).job;
  const epoch = claimed.lease!.epoch;
  return {
    epoch,
    job: beginB0NarrativeValidationV1({
      job: claimed,
      workerId: "worker.one",
      leaseEpoch: epoch,
      now: "2026-08-07T00:00:03.000Z",
    }),
  };
}

function errorCode(operation: () => unknown): string {
  try {
    operation();
    return "NO_ERROR";
  } catch (error) {
    assert.ok(error instanceof B0NarrativeRuntimeErrorV1);
    return error.code;
  }
}

test("C6 narrative input requires an authoritative commit and filters deliveries per recipient", () => {
  const input = narrativeInput();
  assert.equal(input.deliveries.length, 2);
  assert.deepEqual(input.deliveries.map((delivery) => delivery.resultId), ["result.personal.a", "result.trace.a"]);
  assert.deepEqual(input.deliveries[1].disclosedOriginActorIds, []);
  assert.ok(input.forbiddenPhrases.includes("Actor B"));
  assert.ok(input.forbiddenPhrases.includes("actor.b"));
  assert.match(input.inputHash, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(input), true);
});

test("C6 missing commit authority or unapplied world sequence fails closed", () => {
  assert.equal(errorCode(() => buildB0NarrativeInputV1({
    manifest: { ...manifest(), authoritative: false as true },
    publicationPlan: plan(),
    recipientActorId: "actor.a",
    appliedWorldSequence: 8,
    guidance: guidance(),
  })), "NARRATIVE_COMMIT_MANIFEST_MISSING");
  assert.equal(errorCode(() => buildB0NarrativeInputV1({
    manifest: manifest(),
    publicationPlan: plan(),
    recipientActorId: "actor.a",
    appliedWorldSequence: 7,
    guidance: guidance(),
  })), "NARRATIVE_WORLD_SEQUENCE_NOT_APPLIED");
});

test("C6 cross-run or resolution-drifted publication plans are rejected", () => {
  assert.equal(errorCode(() => buildB0NarrativeInputV1({
    manifest: manifest(),
    publicationPlan: plan({ runId: "run.other" }),
    recipientActorId: "actor.a",
    appliedWorldSequence: 8,
    guidance: guidance(),
  })), "NARRATIVE_PUBLICATION_PLAN_MISMATCH");
  assert.equal(errorCode(() => buildB0NarrativeInputV1({
    manifest: manifest(),
    publicationPlan: plan({ resolutionHash: "6".repeat(64) }),
    recipientActorId: "actor.a",
    appliedWorldSequence: 8,
    guidance: guidance(),
  })), "NARRATIVE_PUBLICATION_PLAN_MISMATCH");
});

test("C6 one run/batch/recipient/kind has one immutable narrative job key", () => {
  const input = narrativeInput();
  const key = buildB0NarrativeJobKeyV1({
    runId: input.runId,
    batchId: input.batchId,
    recipientActorId: input.recipientActorId,
  });
  assert.equal(key, input.jobKey);
  const first = createB0NarrativeJobV1(input, "2026-08-07T00:00:01.000Z");
  assert.equal(upsertB0NarrativeJobV1(null, first).created, true);
  assert.equal(upsertB0NarrativeJobV1(first, first).created, false);
  const conflicting = { ...first, inputHash: "7".repeat(64) };
  assert.equal(errorCode(() => upsertB0NarrativeJobV1(first, conflicting)), "NARRATIVE_JOB_KEY_CONFLICT");
});

test("C6 lease ownership, heartbeat and epoch fencing prevent stale workers from publishing", () => {
  const input = narrativeInput();
  const created = createB0NarrativeJobV1(input, "2026-08-07T00:00:01.000Z");
  const claimed = claimB0NarrativeJobV1({
    job: created,
    workerId: "worker.one",
    now: "2026-08-07T00:00:02.000Z",
    leaseDurationMs: 10_000,
  }).job;
  const renewed = heartbeatB0NarrativeJobV1({
    job: claimed,
    workerId: "worker.one",
    leaseEpoch: claimed.lease!.epoch,
    now: "2026-08-07T00:00:03.000Z",
    leaseDurationMs: 20_000,
  });
  assert.equal(renewed.lease?.expiresAt, "2026-08-07T00:00:23.000Z");
  assert.equal(errorCode(() => beginB0NarrativeValidationV1({
    job: renewed,
    workerId: "worker.two",
    leaseEpoch: renewed.lease!.epoch,
    now: "2026-08-07T00:00:04.000Z",
  })), "NARRATIVE_LEASE_LOST");
  assert.equal(errorCode(() => beginB0NarrativeValidationV1({
    job: renewed,
    workerId: "worker.one",
    leaseEpoch: renewed.lease!.epoch + 1,
    now: "2026-08-07T00:00:04.000Z",
  })), "NARRATIVE_LEASE_LOST");
});

test("C6 Narrator cannot add canonical facts or modify resources, relations, capabilities or knowledge", () => {
  const input = narrativeInput();
  const invalid = output(input, {
    authoritativeFacts: [{ fact: "invented" }],
    stateMutations: [{ entity: "world" }],
    relationshipMutations: [{ actor: "actor.a" }],
    capabilityMutations: [{ capability: "new" }],
    knowledgeGrants: [{ recipient: "actor.a" }],
  });
  const validation = validateB0NarrativeOutputV1(input, invalid);
  assert.equal(validation.ok, false);
  assert.match(JSON.stringify(validation), /cannot produce authoritative/u);
});

test("C6 structured outcome and mutation assertions cannot be changed by prose generation", () => {
  const input = narrativeInput();
  const changedOutcome = output(input, {
    outcomeAssertions: [{ sourceResultId: "result.personal.a", outcomeStatus: "SUCCESS" }],
  });
  const changedMutation = output(input, {
    changeAssertions: [{
      sourceResultId: "result.personal.a",
      changeIndex: 0,
      kind: "RESOURCE",
      operation: "INCREMENT",
      numericDelta: 100,
    }],
  });
  assert.equal(validateB0NarrativeOutputV1(input, changedOutcome).ok, false);
  assert.equal(validateB0NarrativeOutputV1(input, changedMutation).ok, false);
});

test("C6 TRACE_ONLY material cannot become a full fact and hidden source labels cannot leak", () => {
  const input = narrativeInput();
  const promotedTrace = output(input, {
    claims: input.deliveries.map((delivery) => ({
      sourceResultId: delivery.resultId,
      statement: delivery.resultId === "result.trace.a"
        ? "Actor B secretly caused the guarded meeting."
        : delivery.summary,
    })),
    prose: "Actor B secretly caused the guarded meeting, while your request remained only partly effective.",
    revealedOriginActorIds: ["actor.a", "actor.b"],
  });
  const validation = validateB0NarrativeOutputV1(input, promotedTrace);
  assert.equal(validation.ok, false);
  assert.match(JSON.stringify(validation), /recipient-safe|not allowed|forbidden/u);
});

test("C6 older generated output cannot overwrite newer narrative guidance", () => {
  const input = narrativeInput();
  const { job, epoch } = validatingJob(input);
  assert.equal(errorCode(() => publishB0NarrativeJobV1({
    job,
    narrativeInput: input,
    output: output(input),
    workerId: "worker.one",
    leaseEpoch: epoch,
    currentGuidanceVersion: 2,
    now: "2026-08-07T00:00:04.000Z",
  })), "NARRATIVE_GUIDANCE_STALE");
});

test("C6 publication is idempotent and a different retry cannot replace published prose", () => {
  const input = narrativeInput();
  const { job, epoch } = validatingJob(input);
  const generated = output(input);
  const first = publishB0NarrativeJobV1({
    job,
    narrativeInput: input,
    output: generated,
    workerId: "worker.one",
    leaseEpoch: epoch,
    currentGuidanceVersion: 1,
    now: "2026-08-07T00:00:04.000Z",
  });
  assert.equal(first.replayed, false);
  assert.equal(first.job.status, "PUBLISHED");
  assert.equal(first.publication.idempotencyKey, input.jobKey);
  const replay = publishB0NarrativeJobV1({
    job: first.job,
    narrativeInput: input,
    output: generated,
    workerId: "worker.one",
    leaseEpoch: epoch,
    currentGuidanceVersion: 1,
    now: "2026-08-07T00:00:05.000Z",
  });
  assert.equal(replay.replayed, true);
  assert.equal(errorCode(() => publishB0NarrativeJobV1({
    job: first.job,
    narrativeInput: input,
    output: output(input, { prose: `${generated.prose} Different ending.` }),
    workerId: "worker.one",
    leaseEpoch: epoch,
    currentGuidanceVersion: 1,
    now: "2026-08-07T00:00:05.000Z",
  })), "NARRATIVE_PUBLICATION_HASH_MISMATCH");
});

test("C6 recovery uses commit manifest and appliedWorldSequence rather than workspace revision", () => {
  const input = narrativeInput();
  const created = createB0NarrativeJobV1(input, "2026-08-07T00:00:01.000Z");
  const claimed = claimB0NarrativeJobV1({
    job: created,
    workerId: "worker.one",
    now: "2026-08-07T00:00:02.000Z",
    leaseDurationMs: 1_000,
  }).job;
  const recovered = recoverB0NarrativeJobV1({
    job: claimed,
    manifest: manifest(),
    appliedWorldSequence: 8,
    now: "2026-08-07T00:00:04.000Z",
  });
  assert.equal(recovered.status, "FAILED_RETRYABLE");
  assert.equal(recovered.failureCode, "LEASE_EXPIRED");
  assert.equal(errorCode(() => recoverB0NarrativeJobV1({
    job: claimed,
    manifest: manifest(),
    appliedWorldSequence: 7,
    now: "2026-08-07T00:00:04.000Z",
  })), "NARRATIVE_WORLD_SEQUENCE_NOT_APPLIED");
});

test("C6 generation failure preserves committed structured results and does not block the next window", () => {
  const input = narrativeInput();
  const created = createB0NarrativeJobV1(input, "2026-08-07T00:00:01.000Z");
  const claimed = claimB0NarrativeJobV1({
    job: created,
    workerId: "worker.one",
    now: "2026-08-07T00:00:02.000Z",
    leaseDurationMs: 30_000,
  }).job;
  const failed = failB0NarrativeJobV1({
    job: claimed,
    workerId: "worker.one",
    leaseEpoch: claimed.lease!.epoch,
    now: "2026-08-07T00:00:03.000Z",
    failureCode: "PROVIDER_UNAVAILABLE",
  });
  assert.equal(failed.status, "FAILED_RETRYABLE");
  assert.equal(failed.requiredAppliedWorldSequence, 8);
  assert.equal(canAdvanceAfterStructuredResultsV1({
    manifest: manifest(),
    appliedWorldSequence: 8,
    structuredPublicationComplete: true,
    narrativeJobs: [failed],
  }), true);
  assert.equal(canAdvanceAfterStructuredResultsV1({
    manifest: manifest(),
    appliedWorldSequence: 8,
    structuredPublicationComplete: false,
    narrativeJobs: [failed],
  }), false);
});
