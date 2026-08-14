import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeNarrativeProjectionFingerprint,
  sha256Canonical,
  validateOpenNovelNarrativeProjectionJobV1,
  type NarrativeAudienceV1,
  type NarrativeProjectionKindV1,
  type NarrativeSourceAuthorityV1,
  type OpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";
import {
  computeNarrativeLogicalProjectionKey,
} from "@apps/openovel-runtime/pressure-narrative/contracts";
import type { AEmotionAuthorityEmissionV1 } from "../a-emotion-production/content-source";
import { createSangtianAEmotionContentSourceCompilerV1 } from "../a-emotion-production/content-source";
import type { WorkingLedgerEventV1, WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { planInteractiveNarrativeAudiencesV1 } from "./interactive-audience";
import {
  SANGTIAN_NARRATIVE_AUTHORITY_TARGET_V1 as TARGET,
} from "../narrative-authority/catalog";
import type {
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
} from "../narrative-authority/contracts";
import { SangtianAuthoritativeNarrativeSnapshotCompilerV1 } from "../narrative-authority/compiler";
import {
  PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1,
} from "../narrative-production/published-profile-resolver";
import { createNarrativeProjectionMetaV1 } from "../persistence/narrative.prisma-adapter";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";

export const AUTHORITY_DOWNSTREAM_MANIFEST_SCHEMA_V1 =
  "pressure_authority_downstream_manifest_v1" as const;

export type AuthorityDownstreamKindV1 = "GENESIS" | "BEAT" | "CHAPTER" | "FINALE";

export interface AuthorityDownstreamManifestV1 {
  schemaVersion: typeof AUTHORITY_DOWNSTREAM_MANIFEST_SCHEMA_V1;
  authorityKind: AuthorityDownstreamKindV1;
  sourceId: string;
  sourceCommitHash: string;
  dedupeKeys: string[];
  manifestHash: string;
}

export interface NarrativeProjectionPlanInputV1 {
  runId: string;
  projectionKind: NarrativeProjectionKindV1;
  sourceAuthority: NarrativeSourceAuthorityV1;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  audiences?: readonly NarrativeAudienceV1[];
}

export function buildNarrativeProjectionIdentityV1(
  job: OpenNovelNarrativeProjectionJobV1,
  projectorVersion: string,
): Readonly<{ logicalProjectionKey: string; requestFingerprint: string }> {
  return {
    logicalProjectionKey: computeNarrativeLogicalProjectionKey(job),
    requestFingerprint: computeNarrativeProjectionFingerprint(job, projectorVersion),
  };
}

export interface DownstreamInsertTransactionV1 {
  pressureNarrativeProjection: {
    create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
    createMany?(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
  pressureOutboxTask: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
    createMany?(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
}

export function planBeatAuthorityDownstreamV1(input: Readonly<{
  projection: WorkingLedgerProjectionV1;
  beatEvent: WorkingLedgerEventV1;
  contentPackageSha256: string;
  committedAt: string;
  humanSeatIds: readonly string[];
}>): Readonly<{
  narrativeJobs: OpenNovelNarrativeProjectionJobV1[];
  aEmotionEmissions: AEmotionAuthorityEmissionV1[];
  manifest: AuthorityDownstreamManifestV1;
}> {
  if (input.beatEvent.payload.eventType !== "BEAT_APPLIED") {
    throw invalid("Beat downstream plan requires BEAT_APPLIED");
  }
  const event = input.beatEvent;
  const payload = input.beatEvent.payload;
  if (payload.eventType !== "BEAT_APPLIED") {
    throw invalid("Beat downstream payload changed after validation");
  }
  const beat = payload.beatResolution;
  const sealedActions = beat.sealedActionIds.map((actionId) => {
    const accepted = input.projection.acceptedActions.get(actionId);
    if (!accepted) throw invalid("Beat downstream plan is missing a sealed action");
    return accepted.action;
  });
  const sealedActionAudiences = beat.sealedActionIds.map((actionId) => {
    const accepted = input.projection.acceptedActions.get(actionId);
    if (!accepted) {
      throw invalid("Beat downstream plan is missing a sealed action audience");
    }
    return {
      actionId,
      audienceSeatIds: [...accepted.audienceSeatIds].sort(),
    };
  });
  const workingDeltaHash = sha256Canonical(beat.workingDelta);
  const rawAuthority = {
    schemaVersion: "pressure_committed_beat_narrative_authority_v1" as const,
    runId: event.runId,
    chapterRuntimeId: event.chapterRuntimeId,
    chapterId: event.chapterId,
    decisionPointId: beat.decisionPointId,
    decisionPointKey: beat.decisionPointId,
    baseWorkingRevision: beat.baseWorkingRevision,
    committedWorkingRevision: beat.committedWorkingRevision,
    inputWorkingStateHash: beat.inputWorkingStateHash,
    sealedActionIds: [...beat.sealedActionIds],
    sealedActionsHash: beat.sealedActionsHash,
    sealedActions,
    sealedActionAudiences,
    resolverVersion: beat.resolverVersion,
    workingDelta: beat.workingDelta,
    workingDeltaHash,
    stateAfter: payload.stateAfter,
    stateAfterHash: payload.stateAfterHash,
    reservationMutations: beat.reservationMutations,
    reactionContextRef: beat.reactionContextRef,
    nextDecisionContextRef: beat.nextDecisionContextRef,
    nextDecisionPin: payload.nextDecisionPin,
    resolutionHash: beat.resolutionHash,
    contentPackageSha256: input.contentPackageSha256,
  };
  const narrativeJobs = planNarrativeProjectionJobsV1({
    runId: event.runId,
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: beat.resolutionHash,
    sourceCommitHash: beat.resolutionHash,
    sourceContentHash: workingDeltaHash,
    audiences: planInteractiveNarrativeAudiencesV1({
      humanSeatIds: input.humanSeatIds,
    }),
  }, rawAuthority);
  const aEmotionEmissions = createSangtianAEmotionContentSourceCompilerV1()
    .compileBeatProjection({
      sourceKind: "BEAT_COMMITTED",
      roomId: event.runId,
      committedAt: input.committedAt,
      projection: input.projection,
      beatEvent: event,
    });
  return {
    narrativeJobs,
    aEmotionEmissions,
    manifest: buildAuthorityDownstreamManifestV1({
      authorityKind: "BEAT",
      sourceId: beat.resolutionHash,
      sourceCommitHash: beat.resolutionHash,
      dedupeKeys: downstreamDedupeKeysV1({ narrativeJobs, aEmotionEmissions }),
    }),
  };
}

export function planNarrativeProjectionJobsV1(
  input: Readonly<NarrativeProjectionPlanInputV1>,
  rawAuthority: Readonly<unknown>,
  compiler: ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1 =
    new SangtianAuthoritativeNarrativeSnapshotCompilerV1(),
): OpenNovelNarrativeProjectionJobV1[] {
  const audiences = input.audiences
    ? validateNarrativeAudiencesV1(input.audiences)
    : allNarrativeAudiencesV1();
  return Object.freeze(audiences.map((audience) => {
    const audienceKey = audience.kind === "PUBLIC" ? "public" : audience.seatId!;
    const skeleton = validateOpenNovelNarrativeProjectionJobV1({
      schemaVersion: "openovel_narrative_projection_job_v1",
      jobId: `${input.projectionKind}:${input.runId}:${audienceKey}:${input.sourceCommitHash}`,
      runId: input.runId,
      audience,
      sourceRuntimeProfile: TARGET.runtimeProfile,
      projectionKind: input.projectionKind,
      sourceAuthority: input.sourceAuthority,
      sourceId: input.sourceId,
      sourceCommitHash: input.sourceCommitHash,
      sourceContentHash: input.sourceContentHash,
      allowedFactIds: [],
      allowedObjectVersionIds: [],
      allowedKnowledgeIds: [],
      narrativeProfileVersion: TARGET.narrativeProfileVersion,
      idempotencyKey: [
        input.projectionKind,
        input.runId,
        audienceKey,
        input.sourceCommitHash,
      ].join(":"),
    });
    const allowlist = compiler.deriveAudienceAllowlist(skeleton, rawAuthority);
    const job = validateOpenNovelNarrativeProjectionJobV1({
      ...skeleton,
      allowedFactIds: allowlist.allowedFactIds,
      allowedObjectVersionIds: allowlist.allowedObjectVersionIds,
      allowedKnowledgeIds: allowlist.allowedKnowledgeIds,
    });
    // Compilation is deterministic and Provider-free. Running it here makes
    // the authority transaction fail closed before an invalid task is durable.
    compiler.compile(job, rawAuthority);
    return job;
  })) as unknown as OpenNovelNarrativeProjectionJobV1[];
}

export async function insertNarrativeProjectionPlanV1(
  tx: DownstreamInsertTransactionV1,
  taskType: "PROJECT_GENESIS_NARRATIVE" | "PROJECT_BEAT_NARRATIVE"
    | "PROJECT_CHAPTER_NARRATIVE" | "PROJECT_FINALE_NARRATIVE",
  jobs: readonly OpenNovelNarrativeProjectionJobV1[],
  projectorVersion: string = PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1.projectorVersion,
): Promise<void> {
  assertNarrativeJobs(jobs);
  const projectionRows: Record<string, unknown>[] = [];
  const outboxRows: Record<string, unknown>[] = [];
  for (const jobValue of jobs) {
    const job = validateOpenNovelNarrativeProjectionJobV1(jobValue);
    const audienceKey = job.audience.kind === "PUBLIC" ? "public" : job.audience.seatId!;
    const identity = buildNarrativeProjectionIdentityV1(job, projectorVersion);
    projectionRows.push({
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
        audienceKey,
        status: "PENDING",
        checkpoint: "PERSISTED",
        requestFingerprint: identity.requestFingerprint,
        lastError: createNarrativeProjectionMetaV1({
          logicalProjectionKey: identity.logicalProjectionKey,
          jobId: job.jobId,
        }),
    });
    outboxRows.push({
      runId: job.runId,
      taskType,
      status: "PENDING",
      checkpoint: "PERSISTED",
      dedupeKey: job.idempotencyKey,
      sourceAuthority: job.sourceAuthority,
      sourceId: job.sourceId,
      sourceCommitHash: job.sourceCommitHash,
      payloadJson: json(job),
      payloadHash: sha256Canonical(job),
    });
  }
  if (tx.pressureNarrativeProjection.createMany && tx.pressureOutboxTask.createMany) {
    const [projections, outbox] = await Promise.all([
      tx.pressureNarrativeProjection.createMany({ data: projectionRows }),
      tx.pressureOutboxTask.createMany({ data: outboxRows }),
    ]);
    if (projections.count !== projectionRows.length || outbox.count !== outboxRows.length) {
      throw invalid("Narrative projection batch insert count mismatch");
    }
    return;
  }
  for (const data of projectionRows) {
    await tx.pressureNarrativeProjection.create({ data });
  }
  for (const data of outboxRows) {
    await tx.pressureOutboxTask.create({ data });
  }
}

export async function insertAEmotionAuthorityEmissionsV1(
  tx: Pick<DownstreamInsertTransactionV1, "pressureOutboxTask">,
  sourceAuthority: NarrativeSourceAuthorityV1,
  emissions: readonly AEmotionAuthorityEmissionV1[],
): Promise<void> {
  const ordered = [...emissions].sort((left, right) => compare(left.dedupeKey, right.dedupeKey));
  const rows: Record<string, unknown>[] = [];
  for (const emission of ordered) {
    if (emission.dedupeKey !== `aemotion:${emission.job.jobHash}`) {
      throw invalid("A-Emotion emission dedupe key is not bound to jobHash");
    }
    rows.push({
        runId: emission.job.runId,
        taskType: "INTERACTION_COMPILE_REQUESTED",
        status: "PENDING",
        checkpoint: "PERSISTED",
        dedupeKey: emission.dedupeKey,
        sourceAuthority,
        sourceId: emission.job.sourceId,
        sourceCommitHash: emission.job.sourceCommitHash,
        payloadJson: json(emission.job),
        payloadHash: sha256Canonical(emission.job),
    });
  }
  if (tx.pressureOutboxTask.createMany) {
    const inserted = await tx.pressureOutboxTask.createMany({ data: rows });
    if (inserted.count !== rows.length) {
      throw invalid("A-Emotion outbox batch insert count mismatch");
    }
    return;
  }
  for (const data of rows) {
    await tx.pressureOutboxTask.create({ data });
  }
}

export function buildAuthorityDownstreamManifestV1(input: Readonly<{
  authorityKind: AuthorityDownstreamKindV1;
  sourceId: string;
  sourceCommitHash: string;
  dedupeKeys: readonly string[];
}>): AuthorityDownstreamManifestV1 {
  const withoutHash = {
    schemaVersion: AUTHORITY_DOWNSTREAM_MANIFEST_SCHEMA_V1,
    authorityKind: input.authorityKind,
    sourceId: input.sourceId,
    sourceCommitHash: input.sourceCommitHash,
    dedupeKeys: [...input.dedupeKeys].sort(compare),
  };
  return validateAuthorityDownstreamManifestV1({
    ...withoutHash,
    manifestHash: sha256Canonical(withoutHash),
  });
}

export function validateAuthorityDownstreamManifestV1(
  value: unknown,
  expected?: Readonly<Partial<Pick<
    AuthorityDownstreamManifestV1,
    "authorityKind" | "sourceId" | "sourceCommitHash"
  >>>,
): AuthorityDownstreamManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("Downstream manifest must be an object");
  }
  const row = value as Record<string, unknown>;
  const keys = [
    "schemaVersion", "authorityKind", "sourceId", "sourceCommitHash",
    "dedupeKeys", "manifestHash",
  ];
  if (Object.keys(row).sort(compare).join("\u0000") !== [...keys].sort(compare).join("\u0000")) {
    throw invalid("Downstream manifest fields drifted");
  }
  if (
    row.schemaVersion !== AUTHORITY_DOWNSTREAM_MANIFEST_SCHEMA_V1
    || !["GENESIS", "BEAT", "CHAPTER", "FINALE"].includes(String(row.authorityKind))
    || typeof row.sourceId !== "string" || !row.sourceId
    || !isHash(row.sourceCommitHash) || !isHash(row.manifestHash)
    || !Array.isArray(row.dedupeKeys)
    || row.dedupeKeys.some((key) => typeof key !== "string" || !key)
  ) throw invalid("Downstream manifest contains invalid values");
  const dedupeKeys = row.dedupeKeys as string[];
  if (
    new Set(dedupeKeys).size !== dedupeKeys.length
    || dedupeKeys.some((key, index) => index > 0 && compare(dedupeKeys[index - 1]!, key) >= 0)
  ) throw invalid("Downstream manifest dedupe keys are not sorted and unique");
  const { manifestHash, ...withoutHash } = row;
  if (sha256Canonical(withoutHash) !== manifestHash) {
    throw invalid("Downstream manifest hash does not match its body");
  }
  for (const field of ["authorityKind", "sourceId", "sourceCommitHash"] as const) {
    if (expected?.[field] !== undefined && row[field] !== expected[field]) {
      throw invalid(`Downstream manifest ${field} binding mismatch`);
    }
  }
  return structuredClone(row) as unknown as AuthorityDownstreamManifestV1;
}

export function downstreamDedupeKeysV1(input: Readonly<{
  existing?: readonly string[];
  narrativeJobs: readonly OpenNovelNarrativeProjectionJobV1[];
  aEmotionEmissions: readonly AEmotionAuthorityEmissionV1[];
}>): string[] {
  return [
    ...(input.existing ?? []),
    ...input.narrativeJobs.map((job) => job.idempotencyKey),
    ...input.aEmotionEmissions.map((emission) => emission.dedupeKey),
  ].sort(compare);
}

function allNarrativeAudiencesV1(): NarrativeAudienceV1[] {
  return [
    { kind: "PUBLIC", seatId: null },
    ...PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({ kind: "SEAT" as const, seatId })),
  ];
}

function validateNarrativeAudiencesV1(
  audiences: readonly NarrativeAudienceV1[],
): NarrativeAudienceV1[] {
  if (audiences.length === 0 || audiences.length > PRESSURE_CHAPTER_SEAT_IDS_V1.length + 1) {
    throw invalid("Narrative plan must contain between one and seven audiences");
  }
  const cloned = audiences.map((audience) => structuredClone(audience));
  const keys = cloned.map((audience) => {
    if (audience.kind === "PUBLIC" && audience.seatId === null) return "public";
    if (
      audience.kind === "SEAT"
      && PRESSURE_CHAPTER_SEAT_IDS_V1.includes(audience.seatId as (typeof PRESSURE_CHAPTER_SEAT_IDS_V1)[number])
    ) return audience.seatId!;
    throw invalid("Narrative plan contains an invalid audience");
  });
  if (new Set(keys).size !== keys.length) {
    throw invalid("Narrative plan contains duplicate audiences");
  }
  return cloned;
}

function assertNarrativeJobs(jobs: readonly OpenNovelNarrativeProjectionJobV1[]): void {
  validateNarrativeAudiencesV1(jobs.map((job) => job.audience));
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(message: string): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message);
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
