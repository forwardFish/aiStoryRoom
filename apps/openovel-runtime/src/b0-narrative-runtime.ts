import { createHash } from "node:crypto";
import type {
  B0PublicationDeliveryV1,
  B0PublicationPlanV1,
} from "@ai-story/templates";

export type B0NarrativeKindV1 = "SETTLEMENT_ROLE_VIEW";
export type B0NarrativeJobStatusV1 =
  | "PENDING"
  | "GENERATING"
  | "VALIDATING"
  | "PUBLISHED"
  | "FAILED_RETRYABLE";

export type B0NarrativeCommitManifestV1 = {
  schemaVersion: "b0-batch-commit-manifest-v1";
  batchId: string;
  snapshotId: string;
  windowId: string;
  roomId: string;
  runId: string;
  baseWorldSequence: number;
  committedWorldSequence: number;
  rulesetHash: string;
  inputHash: string;
  resolutionHash: string;
  resourceMutationKeys: string[];
  stateMutationKeys?: string[];
  publicationOutboxKeys: string[];
  committedAt: string;
  authoritative: true;
  commitHash: string;
};

export type B0NarrativeGuidanceV1 = {
  schemaVersion: "b0-narrative-guidance-v1";
  version: number;
  locale: string;
  narrativeKind: B0NarrativeKindV1;
  styleDirectives: string[];
  allowedActorLabels: string[];
  forbiddenPhrases: string[];
};

export type B0NarrativeSafeDeliveryV1 = {
  resultId: string;
  resultKind: B0PublicationDeliveryV1["resultKind"];
  visibility: B0PublicationDeliveryV1["visibility"];
  sourceDisclosure: B0PublicationDeliveryV1["sourceDisclosure"];
  disclosedOriginActorIds: string[];
  summary: string;
  outcomeStatus: B0PublicationDeliveryV1["outcomeStatus"];
  changes: B0PublicationDeliveryV1["changes"];
  explanation: B0PublicationDeliveryV1["explanation"];
};

export type B0NarrativeInputV1 = {
  schemaVersion: "b0-narrative-input-v1";
  jobKey: string;
  narrativeKind: B0NarrativeKindV1;
  runId: string;
  batchId: string;
  windowId: string;
  recipientActorId: string;
  committedWorldSequence: number;
  commitHash: string;
  resolutionHash: string;
  publicationPlanHash: string;
  guidanceVersion: number;
  locale: string;
  styleDirectives: string[];
  allowedActorLabels: string[];
  forbiddenPhrases: string[];
  deliveries: B0NarrativeSafeDeliveryV1[];
  inputHash: string;
};

export type B0NarrativeLeaseV1 = {
  ownerId: string;
  epoch: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

export type B0NarrativeJobV1 = {
  schemaVersion: "b0-narrative-job-v1";
  jobKey: string;
  narrativeKind: B0NarrativeKindV1;
  runId: string;
  batchId: string;
  windowId: string;
  recipientActorId: string;
  requiredAppliedWorldSequence: number;
  commitHash: string;
  resolutionHash: string;
  publicationPlanHash: string;
  inputHash: string;
  guidanceVersion: number;
  status: B0NarrativeJobStatusV1;
  attempt: number;
  lease: B0NarrativeLeaseV1 | null;
  failureCode: string | null;
  outputHash: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type B0NarrativeOutputV1 = {
  schemaVersion: "b0-narrative-output-v1";
  inputHash: string;
  guidanceVersion: number;
  prose: string;
  sourceResultIds: string[];
  claims: Array<{ sourceResultId: string; statement: string }>;
  outcomeAssertions: Array<{
    sourceResultId: string;
    outcomeStatus: Exclude<B0PublicationDeliveryV1["outcomeStatus"], null>;
  }>;
  changeAssertions: Array<{
    sourceResultId: string;
    changeIndex: number;
    kind: B0PublicationDeliveryV1["changes"][number]["kind"];
    operation: B0PublicationDeliveryV1["changes"][number]["operation"];
    numericDelta: number | null;
  }>;
  revealedOriginActorIds: string[];
  authoritativeFacts: unknown[];
  stateMutations: unknown[];
  relationshipMutations: unknown[];
  capabilityMutations: unknown[];
  knowledgeGrants: unknown[];
};

export type B0NarrativePublicationV1 = {
  schemaVersion: "b0-narrative-publication-v1";
  idempotencyKey: string;
  jobKey: string;
  narrativeKind: B0NarrativeKindV1;
  runId: string;
  batchId: string;
  windowId: string;
  recipientActorId: string;
  committedWorldSequence: number;
  prose: string;
  sourceResultIds: string[];
  contentHash: string;
  publishedAt: string;
};

export type B0NarrativeValidationResultV1 =
  | { ok: true; value: B0NarrativeOutputV1 }
  | { ok: false; errors: string[] };

export class B0NarrativeRuntimeErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "B0NarrativeRuntimeErrorV1";
  }
}

export function buildB0NarrativeJobKeyV1(input: {
  runId: string;
  batchId: string;
  recipientActorId: string;
  narrativeKind?: B0NarrativeKindV1;
}): string {
  const narrativeKind = input.narrativeKind ?? "SETTLEMENT_ROLE_VIEW";
  return `narrative:${requiredId(input.runId, "runId")}:${requiredId(input.batchId, "batchId")}:${requiredId(input.recipientActorId, "recipientActorId")}:${narrativeKind}`;
}

export function buildB0NarrativeInputV1(input: {
  manifest: B0NarrativeCommitManifestV1;
  publicationPlan: B0PublicationPlanV1;
  recipientActorId: string;
  appliedWorldSequence: number;
  guidance: B0NarrativeGuidanceV1;
  actorLabels?: Readonly<Record<string, readonly string[]>>;
}): B0NarrativeInputV1 {
  assertCommitReady(input.manifest, input.appliedWorldSequence);
  validatePublicationPlanBinding(input.manifest, input.publicationPlan);
  validateGuidance(input.guidance);
  const recipientActorId = requiredId(input.recipientActorId, "recipientActorId");
  const deliveries = input.publicationPlan.deliveries
    .filter((delivery) => delivery.recipientActorId === recipientActorId)
    .map(projectSafeDelivery)
    .sort((left, right) => left.resultId.localeCompare(right.resultId));
  if (!deliveries.length) {
    throw runtimeError("NARRATIVE_RECIPIENT_HAS_NO_DELIVERIES", `No committed structured result is available for ${recipientActorId}.`);
  }
  for (const delivery of input.publicationPlan.deliveries) {
    if (delivery.runId !== input.manifest.runId
      || delivery.batchId !== input.manifest.batchId
      || delivery.windowId !== input.manifest.windowId) {
      throw runtimeError("NARRATIVE_DELIVERY_CONTEXT_MISMATCH", `Delivery ${delivery.resultId} is outside the committed run, batch or window.`);
    }
  }
  const hiddenSourceLabels = input.publicationPlan.deliveries
    .filter((delivery) => delivery.recipientActorId === recipientActorId)
    .filter((delivery) => delivery.sourceDisclosure !== "FULL")
    .flatMap((delivery) => delivery.originActorIds.flatMap((actorId) => [
      actorId,
      ...(input.actorLabels?.[actorId] ?? []),
    ]));
  const forbiddenPhrases = uniqueSorted([
    ...input.guidance.forbiddenPhrases,
    ...hiddenSourceLabels,
    input.manifest.commitHash,
    input.manifest.resolutionHash,
  ]);
  const jobKey = buildB0NarrativeJobKeyV1({
    runId: input.manifest.runId,
    batchId: input.manifest.batchId,
    recipientActorId,
    narrativeKind: input.guidance.narrativeKind,
  });
  const withoutHash: Omit<B0NarrativeInputV1, "inputHash"> = {
    schemaVersion: "b0-narrative-input-v1",
    jobKey,
    narrativeKind: input.guidance.narrativeKind,
    runId: input.manifest.runId,
    batchId: input.manifest.batchId,
    windowId: input.manifest.windowId,
    recipientActorId,
    committedWorldSequence: input.manifest.committedWorldSequence,
    commitHash: input.manifest.commitHash,
    resolutionHash: input.manifest.resolutionHash,
    publicationPlanHash: input.publicationPlan.planHash,
    guidanceVersion: input.guidance.version,
    locale: input.guidance.locale,
    styleDirectives: uniqueSorted(input.guidance.styleDirectives),
    allowedActorLabels: uniqueSorted(input.guidance.allowedActorLabels),
    forbiddenPhrases,
    deliveries,
  };
  return deepFreeze({ ...withoutHash, inputHash: hashCanonical(withoutHash) });
}

export function createB0NarrativeJobV1(input: B0NarrativeInputV1, now: string): B0NarrativeJobV1 {
  validateInputHash(input);
  const timestamp = iso(now, "createdAt");
  return deepFreeze({
    schemaVersion: "b0-narrative-job-v1",
    jobKey: input.jobKey,
    narrativeKind: input.narrativeKind,
    runId: input.runId,
    batchId: input.batchId,
    windowId: input.windowId,
    recipientActorId: input.recipientActorId,
    requiredAppliedWorldSequence: input.committedWorldSequence,
    commitHash: input.commitHash,
    resolutionHash: input.resolutionHash,
    publicationPlanHash: input.publicationPlanHash,
    inputHash: input.inputHash,
    guidanceVersion: input.guidanceVersion,
    status: "PENDING",
    attempt: 0,
    lease: null,
    failureCode: null,
    outputHash: null,
    publishedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function upsertB0NarrativeJobV1(existing: B0NarrativeJobV1 | null, candidate: B0NarrativeJobV1): {
  job: B0NarrativeJobV1;
  created: boolean;
} {
  if (!existing) return { job: deepFreeze(structuredClone(candidate)), created: true };
  const immutableKeys: Array<keyof B0NarrativeJobV1> = [
    "schemaVersion", "jobKey", "narrativeKind", "runId", "batchId", "windowId",
    "recipientActorId", "requiredAppliedWorldSequence", "commitHash", "resolutionHash",
    "publicationPlanHash", "inputHash", "guidanceVersion",
  ];
  for (const key of immutableKeys) {
    if (canonical(existing[key]) !== canonical(candidate[key])) {
      throw runtimeError("NARRATIVE_JOB_KEY_CONFLICT", `Existing narrative job ${candidate.jobKey} has different immutable input at ${String(key)}.`);
    }
  }
  return { job: deepFreeze(structuredClone(existing)), created: false };
}

export function claimB0NarrativeJobV1(input: {
  job: B0NarrativeJobV1;
  workerId: string;
  now: string;
  leaseDurationMs: number;
}): { job: B0NarrativeJobV1; replayed: boolean } {
  const now = iso(input.now, "claim time");
  const nowMs = Date.parse(now);
  const workerId = requiredId(input.workerId, "workerId");
  if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 1_000 || input.leaseDurationMs > 120_000) {
    throw runtimeError("NARRATIVE_LEASE_DURATION_INVALID", "Narrative lease duration must be between 1,000 and 120,000 milliseconds.");
  }
  if (input.job.status === "PUBLISHED") return { job: input.job, replayed: true };
  if (input.job.lease && Date.parse(input.job.lease.expiresAt) > nowMs) {
    if (input.job.lease.ownerId === workerId) return { job: input.job, replayed: true };
    throw runtimeError("NARRATIVE_JOB_BUSY", `Narrative job ${input.job.jobKey} has an active lease.`);
  }
  const epoch = (input.job.lease?.epoch ?? 0) + 1;
  const lease: B0NarrativeLeaseV1 = {
    ownerId: workerId,
    epoch,
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: new Date(nowMs + input.leaseDurationMs).toISOString(),
  };
  return {
    replayed: false,
    job: deepFreeze({
      ...structuredClone(input.job),
      status: "GENERATING",
      attempt: input.job.attempt + 1,
      lease,
      failureCode: null,
      updatedAt: now,
    }),
  };
}

export function heartbeatB0NarrativeJobV1(input: {
  job: B0NarrativeJobV1;
  workerId: string;
  leaseEpoch: number;
  now: string;
  leaseDurationMs: number;
}): B0NarrativeJobV1 {
  const now = iso(input.now, "heartbeat time");
  assertLease(input.job, input.workerId, input.leaseEpoch, now);
  if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 1_000 || input.leaseDurationMs > 120_000) {
    throw runtimeError("NARRATIVE_LEASE_DURATION_INVALID", "Narrative lease duration must be between 1,000 and 120,000 milliseconds.");
  }
  const lease = {
    ...input.job.lease!,
    heartbeatAt: now,
    expiresAt: new Date(Date.parse(now) + input.leaseDurationMs).toISOString(),
  };
  return deepFreeze({ ...structuredClone(input.job), lease, updatedAt: now });
}

export function beginB0NarrativeValidationV1(input: {
  job: B0NarrativeJobV1;
  workerId: string;
  leaseEpoch: number;
  now: string;
}): B0NarrativeJobV1 {
  const now = iso(input.now, "validation time");
  assertLease(input.job, input.workerId, input.leaseEpoch, now);
  if (input.job.status !== "GENERATING") {
    throw runtimeError("NARRATIVE_JOB_STATE_INVALID", `Narrative job ${input.job.jobKey} is not generating.`);
  }
  return deepFreeze({ ...structuredClone(input.job), status: "VALIDATING", updatedAt: now });
}

export function failB0NarrativeJobV1(input: {
  job: B0NarrativeJobV1;
  workerId: string;
  leaseEpoch: number;
  now: string;
  failureCode: string;
}): B0NarrativeJobV1 {
  const now = iso(input.now, "failure time");
  assertLease(input.job, input.workerId, input.leaseEpoch, now);
  if (input.job.status !== "GENERATING" && input.job.status !== "VALIDATING") {
    throw runtimeError("NARRATIVE_JOB_STATE_INVALID", `Narrative job ${input.job.jobKey} cannot fail from ${input.job.status}.`);
  }
  return deepFreeze({
    ...structuredClone(input.job),
    status: "FAILED_RETRYABLE",
    lease: null,
    failureCode: requiredId(input.failureCode, "failureCode"),
    updatedAt: now,
  });
}

export function validateB0NarrativeOutputV1(
  input: B0NarrativeInputV1,
  output: unknown,
): B0NarrativeValidationResultV1 {
  const errors: string[] = [];
  const value = record(output);
  const fields = [
    "schemaVersion", "inputHash", "guidanceVersion", "prose", "sourceResultIds", "claims",
    "outcomeAssertions", "changeAssertions", "revealedOriginActorIds", "authoritativeFacts",
    "stateMutations", "relationshipMutations", "capabilityMutations", "knowledgeGrants",
  ];
  if (!value) return { ok: false, errors: ["Narrative output must be an object."] };
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) errors.push(`Narrative output contains unknown fields: ${unknown.sort().join(", ")}.`);
  if (value.schemaVersion !== "b0-narrative-output-v1") errors.push("Narrative output schemaVersion is invalid.");
  if (value.inputHash !== input.inputHash) errors.push("Narrative output is bound to a different immutable input.");
  if (value.guidanceVersion !== input.guidanceVersion) errors.push("Narrative output guidanceVersion is stale.");
  if (typeof value.prose !== "string" || value.prose.trim().length < 20 || value.prose.length > 6_000) {
    errors.push("Narrative prose must contain 20 to 6,000 characters.");
  }
  const expectedResultIds = input.deliveries.map((delivery) => delivery.resultId).sort();
  const sourceResultIds = stringList(value.sourceResultIds, "sourceResultIds", errors);
  if (!sameStrings(sourceResultIds, expectedResultIds)) errors.push("Narrative output must cite every and only the recipient's structured results.");
  validateClaims(input, value.claims, errors);
  validateOutcomeAssertions(input, value.outcomeAssertions, errors);
  validateChangeAssertions(input, value.changeAssertions, errors);
  const revealed = stringList(value.revealedOriginActorIds, "revealedOriginActorIds", errors);
  const allowedOrigins = uniqueSorted(input.deliveries
    .filter((delivery) => delivery.sourceDisclosure === "FULL")
    .flatMap((delivery) => delivery.disclosedOriginActorIds));
  if (revealed.some((actorId) => !allowedOrigins.includes(actorId))) {
    errors.push("Narrative output reveals a source actor that the recipient is not allowed to know.");
  }
  for (const key of [
    "authoritativeFacts", "stateMutations", "relationshipMutations", "capabilityMutations", "knowledgeGrants",
  ] as const) {
    if (!Array.isArray(value[key])) errors.push(`Narrative output ${key} must be an array.`);
    else if ((value[key] as unknown[]).length > 0) errors.push(`Narrator cannot produce authoritative ${key}.`);
  }
  if (typeof value.prose === "string") {
    const prose = normalize(value.prose);
    for (const phrase of input.forbiddenPhrases) {
      if (phrase.length > 1 && prose.includes(normalize(phrase))) {
        errors.push(`Narrative prose contains forbidden or hidden material: ${phrase}.`);
      }
    }
  }
  return errors.length
    ? { ok: false, errors: uniqueSorted(errors) }
    : { ok: true, value: output as B0NarrativeOutputV1 };
}

export function publishB0NarrativeJobV1(input: {
  job: B0NarrativeJobV1;
  narrativeInput: B0NarrativeInputV1;
  output: B0NarrativeOutputV1;
  workerId: string;
  leaseEpoch: number;
  currentGuidanceVersion: number;
  now: string;
}): {
  job: B0NarrativeJobV1;
  publication: B0NarrativePublicationV1;
  replayed: boolean;
} {
  const now = iso(input.now, "publication time");
  const outputHash = hashCanonical(input.output);
  if (input.job.status === "PUBLISHED") {
    if (input.job.outputHash !== outputHash) {
      throw runtimeError("NARRATIVE_PUBLICATION_HASH_MISMATCH", `Narrative job ${input.job.jobKey} was already published with different content.`);
    }
    return {
      job: input.job,
      publication: publicationFrom(input.job, input.narrativeInput, input.output, input.job.publishedAt ?? now, outputHash),
      replayed: true,
    };
  }
  assertLease(input.job, input.workerId, input.leaseEpoch, now);
  if (input.job.status !== "VALIDATING") {
    throw runtimeError("NARRATIVE_JOB_STATE_INVALID", `Narrative job ${input.job.jobKey} is not validating.`);
  }
  if (input.currentGuidanceVersion !== input.job.guidanceVersion
    || input.currentGuidanceVersion !== input.narrativeInput.guidanceVersion) {
    throw runtimeError("NARRATIVE_GUIDANCE_STALE", "An older narrative output cannot overwrite newer guidance.");
  }
  if (input.job.inputHash !== input.narrativeInput.inputHash
    || input.job.commitHash !== input.narrativeInput.commitHash
    || input.job.requiredAppliedWorldSequence !== input.narrativeInput.committedWorldSequence) {
    throw runtimeError("NARRATIVE_JOB_INPUT_MISMATCH", "Narrative job and immutable narrative input do not match.");
  }
  const validation = validateB0NarrativeOutputV1(input.narrativeInput, input.output);
  if (!validation.ok) {
    throw runtimeError("NARRATIVE_VALIDATION_FAILED", validation.errors.join(" "));
  }
  const publication = publicationFrom(input.job, input.narrativeInput, input.output, now, outputHash);
  return {
    replayed: false,
    publication,
    job: deepFreeze({
      ...structuredClone(input.job),
      status: "PUBLISHED",
      lease: null,
      failureCode: null,
      outputHash,
      publishedAt: now,
      updatedAt: now,
    }),
  };
}

export function recoverB0NarrativeJobV1(input: {
  job: B0NarrativeJobV1;
  manifest: B0NarrativeCommitManifestV1;
  appliedWorldSequence: number;
  now: string;
}): B0NarrativeJobV1 {
  const now = iso(input.now, "recovery time");
  assertCommitReady(input.manifest, input.appliedWorldSequence);
  if (input.job.runId !== input.manifest.runId
    || input.job.batchId !== input.manifest.batchId
    || input.job.windowId !== input.manifest.windowId
    || input.job.commitHash !== input.manifest.commitHash
    || input.job.requiredAppliedWorldSequence !== input.manifest.committedWorldSequence) {
    throw runtimeError("NARRATIVE_RECOVERY_MANIFEST_MISMATCH", "Narrative recovery is not bound to the authoritative commit manifest.");
  }
  if (input.job.status === "PUBLISHED" || !input.job.lease) return input.job;
  if (Date.parse(input.job.lease.expiresAt) > Date.parse(now)) return input.job;
  return deepFreeze({
    ...structuredClone(input.job),
    status: "FAILED_RETRYABLE",
    lease: null,
    failureCode: "LEASE_EXPIRED",
    updatedAt: now,
  });
}

export function canAdvanceAfterStructuredResultsV1(input: {
  manifest: B0NarrativeCommitManifestV1;
  appliedWorldSequence: number;
  structuredPublicationComplete: boolean;
  narrativeJobs?: readonly B0NarrativeJobV1[];
}): boolean {
  try {
    assertCommitReady(input.manifest, input.appliedWorldSequence);
  } catch {
    return false;
  }
  return input.structuredPublicationComplete;
}

function projectSafeDelivery(delivery: B0PublicationDeliveryV1): B0NarrativeSafeDeliveryV1 {
  return {
    resultId: delivery.resultId,
    resultKind: delivery.resultKind,
    visibility: delivery.visibility,
    sourceDisclosure: delivery.sourceDisclosure,
    disclosedOriginActorIds: delivery.sourceDisclosure === "FULL" ? uniqueSorted(delivery.originActorIds) : [],
    summary: delivery.summary,
    outcomeStatus: delivery.outcomeStatus,
    changes: structuredClone(delivery.changes),
    explanation: structuredClone(delivery.explanation),
  };
}

function validatePublicationPlanBinding(
  manifest: B0NarrativeCommitManifestV1,
  plan: B0PublicationPlanV1,
): void {
  if (plan.schemaVersion !== "b0-publication-plan-v1") {
    throw runtimeError("NARRATIVE_PUBLICATION_PLAN_INVALID", "Publication plan schemaVersion is invalid.");
  }
  if (plan.runId !== manifest.runId
    || plan.batchId !== manifest.batchId
    || plan.windowId !== manifest.windowId
    || plan.roomId !== manifest.roomId
    || plan.baseWorldSequence !== manifest.baseWorldSequence
    || plan.resolutionHash !== manifest.resolutionHash) {
    throw runtimeError("NARRATIVE_PUBLICATION_PLAN_MISMATCH", "Publication plan does not match the authoritative commit manifest.");
  }
  if (!digest(plan.planHash)) throw runtimeError("NARRATIVE_PUBLICATION_PLAN_INVALID", "Publication plan hash is invalid.");
}

function validateGuidance(guidance: B0NarrativeGuidanceV1): void {
  if (guidance.schemaVersion !== "b0-narrative-guidance-v1"
    || guidance.narrativeKind !== "SETTLEMENT_ROLE_VIEW"
    || !Number.isInteger(guidance.version)
    || guidance.version < 1
    || typeof guidance.locale !== "string"
    || guidance.locale.trim().length < 2
    || !stringArray(guidance.styleDirectives)
    || !stringArray(guidance.allowedActorLabels)
    || !stringArray(guidance.forbiddenPhrases)) {
    throw runtimeError("NARRATIVE_GUIDANCE_INVALID", "Narrative guidance is invalid.");
  }
}

function assertCommitReady(manifest: B0NarrativeCommitManifestV1, appliedWorldSequence: number): void {
  if (manifest.schemaVersion !== "b0-batch-commit-manifest-v1" || manifest.authoritative !== true) {
    throw runtimeError("NARRATIVE_COMMIT_MANIFEST_MISSING", "Narrative generation requires an authoritative B0 commit manifest.");
  }
  for (const key of ["batchId", "snapshotId", "windowId", "roomId", "runId"] as const) requiredId(manifest[key], key);
  if (!digest(manifest.rulesetHash)
    || !digest(manifest.inputHash)
    || !digest(manifest.resolutionHash)
    || !digest(manifest.commitHash)) {
    throw runtimeError("NARRATIVE_COMMIT_MANIFEST_INVALID", "Commit manifest hashes are invalid.");
  }
  if (!Number.isInteger(manifest.baseWorldSequence)
    || manifest.baseWorldSequence < 0
    || manifest.committedWorldSequence !== manifest.baseWorldSequence + 1) {
    throw runtimeError("NARRATIVE_COMMIT_MANIFEST_INVALID", "Commit manifest must advance worldSequence exactly once.");
  }
  if (!Number.isInteger(appliedWorldSequence) || appliedWorldSequence < manifest.committedWorldSequence) {
    throw runtimeError("NARRATIVE_WORLD_SEQUENCE_NOT_APPLIED", "The authoritative world sequence has not reached this commit.");
  }
  if (!Array.isArray(manifest.publicationOutboxKeys) || manifest.publicationOutboxKeys.length === 0) {
    throw runtimeError("NARRATIVE_COMMIT_MANIFEST_INVALID", "Commit manifest has no publication outbox evidence.");
  }
}

function validateInputHash(input: B0NarrativeInputV1): void {
  const { inputHash, ...payload } = input;
  if (!digest(inputHash) || hashCanonical(payload) !== inputHash) {
    throw runtimeError("NARRATIVE_INPUT_HASH_MISMATCH", "Narrative input hash is invalid.");
  }
}

function validateClaims(input: B0NarrativeInputV1, value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("Narrative claims must be an array.");
    return;
  }
  const expected = input.deliveries.map((delivery) => `${delivery.resultId}\u0000${delivery.summary}`).sort();
  const actual: string[] = [];
  for (const [index, raw] of value.entries()) {
    const claim = record(raw);
    if (!claim || Object.keys(claim).some((key) => !["sourceResultId", "statement"].includes(key))) {
      errors.push(`Narrative claim ${index} is invalid.`);
      continue;
    }
    if (typeof claim.sourceResultId !== "string" || typeof claim.statement !== "string") {
      errors.push(`Narrative claim ${index} must contain strings.`);
      continue;
    }
    actual.push(`${claim.sourceResultId}\u0000${claim.statement}`);
  }
  if (!sameStrings(actual, expected)) errors.push("Narrative claims must exactly match the recipient-safe structured summaries.");
}

function validateOutcomeAssertions(input: B0NarrativeInputV1, value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("Narrative outcomeAssertions must be an array.");
    return;
  }
  const expected = input.deliveries
    .filter((delivery) => delivery.outcomeStatus !== null)
    .map((delivery) => `${delivery.resultId}\u0000${delivery.outcomeStatus}`)
    .sort();
  const actual: string[] = [];
  for (const [index, raw] of value.entries()) {
    const assertion = record(raw);
    if (!assertion || Object.keys(assertion).some((key) => !["sourceResultId", "outcomeStatus"].includes(key))) {
      errors.push(`Narrative outcome assertion ${index} is invalid.`);
      continue;
    }
    if (typeof assertion.sourceResultId !== "string" || typeof assertion.outcomeStatus !== "string") {
      errors.push(`Narrative outcome assertion ${index} must contain strings.`);
      continue;
    }
    actual.push(`${assertion.sourceResultId}\u0000${assertion.outcomeStatus}`);
  }
  if (!sameStrings(actual, expected)) errors.push("Narrative outcome assertions cannot change structured outcome status.");
}

function validateChangeAssertions(input: B0NarrativeInputV1, value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("Narrative changeAssertions must be an array.");
    return;
  }
  const expected = input.deliveries.flatMap((delivery) => delivery.changes.map((change, index) => canonical({
    sourceResultId: delivery.resultId,
    changeIndex: index,
    kind: change.kind,
    operation: change.operation,
    numericDelta: change.numericDelta,
  }))).sort();
  const actual: string[] = [];
  for (const [index, raw] of value.entries()) {
    const assertion = record(raw);
    if (!assertion || Object.keys(assertion).some((key) => ![
      "sourceResultId", "changeIndex", "kind", "operation", "numericDelta",
    ].includes(key))) {
      errors.push(`Narrative change assertion ${index} is invalid.`);
      continue;
    }
    actual.push(canonical(assertion));
  }
  if (!sameStrings(actual, expected)) errors.push("Narrative change assertions cannot add, remove or alter authoritative mutations.");
}

function publicationFrom(
  job: B0NarrativeJobV1,
  narrativeInput: B0NarrativeInputV1,
  output: B0NarrativeOutputV1,
  publishedAt: string,
  outputHash: string,
): B0NarrativePublicationV1 {
  return deepFreeze({
    schemaVersion: "b0-narrative-publication-v1",
    idempotencyKey: job.jobKey,
    jobKey: job.jobKey,
    narrativeKind: job.narrativeKind,
    runId: job.runId,
    batchId: job.batchId,
    windowId: job.windowId,
    recipientActorId: job.recipientActorId,
    committedWorldSequence: narrativeInput.committedWorldSequence,
    prose: output.prose,
    sourceResultIds: [...output.sourceResultIds].sort(),
    contentHash: outputHash,
    publishedAt,
  });
}

function assertLease(job: B0NarrativeJobV1, workerId: string, leaseEpoch: number, now: string): void {
  if (!job.lease
    || job.lease.ownerId !== requiredId(workerId, "workerId")
    || job.lease.epoch !== leaseEpoch) {
    throw runtimeError("NARRATIVE_LEASE_LOST", `Narrative job ${job.jobKey} lease is not owned by this worker epoch.`);
  }
  if (Date.parse(job.lease.expiresAt) <= Date.parse(now)) {
    throw runtimeError("NARRATIVE_LEASE_EXPIRED", `Narrative job ${job.jobKey} lease expired.`);
  }
}

function requiredId(value: string, label: string): string {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,239}$/u.test(id)) {
    throw runtimeError("NARRATIVE_IDENTIFIER_INVALID", `${label} is invalid.`);
  }
  return id;
}

function iso(value: string, label: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw runtimeError("NARRATIVE_TIME_INVALID", `${label} is invalid.`);
  return new Date(time).toISOString();
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function stringList(value: unknown, label: string, errors: string[]): string[] {
  if (!stringArray(value)) {
    errors.push(`Narrative output ${label} must be a string array.`);
    return [];
  }
  return uniqueSorted(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return uniqueSorted(left).join("\u0001") === uniqueSorted(right).join("\u0001");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((entry) => typeof entry === "string" && entry.length > 0))].sort();
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sortValue(nested)]));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

function runtimeError(code: string, message: string): B0NarrativeRuntimeErrorV1 {
  return new B0NarrativeRuntimeErrorV1(code, message);
}
