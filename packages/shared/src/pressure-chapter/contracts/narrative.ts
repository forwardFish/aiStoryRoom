import { sha256Canonical } from "./canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "./errors";
import { validateSeatIdV1, type SeatIdV1 } from "./domain";
import {
  assertHashEqual,
  contractEnum,
  contractLiteral,
  contractObject,
  contractSha256,
  contractString,
  contractStringArray,
  contractVersion,
  exactContractKeys,
  type RawContract,
} from "./validation";

export const NARRATIVE_STATUSES_V1 = Object.freeze([
  "PENDING",
  "GENERATING",
  "VALIDATING",
  "PUBLISHED",
  "FALLBACK_PUBLISHED",
  "FAILED_RETRYABLE",
] as const);

export type NarrativeStatusV1 = (typeof NARRATIVE_STATUSES_V1)[number];
export type NarrativeProjectionKindV1 =
  | "GENESIS_NARRATIVE"
  | "BEAT_NARRATIVE"
  | "CHAPTER_NARRATIVE"
  | "FINALE_NARRATIVE";
export type NarrativeSourceAuthorityV1 =
  | "GENESIS_FROZEN"
  | "CHAPTER_WORKING"
  | "CHAPTER_FROZEN"
  | "FINALE_FROZEN"
  | "LEGACY_TERMINAL_COMMITTED";

export interface NarrativeAudienceV1 {
  kind: "PUBLIC" | "SEAT";
  seatId: SeatIdV1 | null;
}

export interface OpenNovelNarrativeProjectionJobV1 {
  schemaVersion: "openovel_narrative_projection_job_v1";
  jobId: string;
  runId: string;
  audience: NarrativeAudienceV1;
  sourceRuntimeProfile: string;
  projectionKind: NarrativeProjectionKindV1;
  sourceAuthority: NarrativeSourceAuthorityV1;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  allowedFactIds: string[];
  allowedObjectVersionIds: string[];
  allowedKnowledgeIds: string[];
  narrativeProfileVersion: string;
  idempotencyKey: string;
}

export interface OpenNovelNarrativeArtifactV1 {
  schemaVersion: "openovel_narrative_artifact_v1";
  jobId: string;
  runId: string;
  projectionKind: NarrativeProjectionKindV1;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  audience: NarrativeAudienceV1;
  narrativeProfileVersion: string;
  projectorVersion: string;
  text: string;
  usedFactRefs: string[];
  validationReportHash: string;
  contentHash: string;
  renderMode: "PROVIDER" | "AUTHORED_FALLBACK";
  status: "PUBLISHED" | "FALLBACK_PUBLISHED";
}

export function validateOpenNovelNarrativeProjectionJobV1(
  value: unknown,
): OpenNovelNarrativeProjectionJobV1 {
  const job = contractObject(value, "narrativeJob");
  exactContractKeys(job, [
    "schemaVersion",
    "jobId",
    "runId",
    "audience",
    "sourceRuntimeProfile",
    "projectionKind",
    "sourceAuthority",
    "sourceId",
    "sourceCommitHash",
    "sourceContentHash",
    "allowedFactIds",
    "allowedObjectVersionIds",
    "allowedKnowledgeIds",
    "narrativeProfileVersion",
    "idempotencyKey",
  ], "narrativeJob");
  contractLiteral(
    job.schemaVersion,
    "openovel_narrative_projection_job_v1",
    "narrativeJob.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  for (const field of [
    "jobId",
    "runId",
    "sourceRuntimeProfile",
    "sourceId",
    "idempotencyKey",
  ] as const) {
    contractString(job[field], `narrativeJob.${field}`);
  }
  contractVersion(job.narrativeProfileVersion, "narrativeJob.narrativeProfileVersion");
  validateNarrativeAudienceV1(job.audience, "narrativeJob.audience");
  const projectionKind = contractEnum(
    job.projectionKind,
    ["GENESIS_NARRATIVE", "BEAT_NARRATIVE", "CHAPTER_NARRATIVE", "FINALE_NARRATIVE"] as const,
    "narrativeJob.projectionKind",
  );
  const authority = contractEnum(
    job.sourceAuthority,
    [
      "GENESIS_FROZEN",
      "CHAPTER_WORKING",
      "CHAPTER_FROZEN",
      "FINALE_FROZEN",
      "LEGACY_TERMINAL_COMMITTED",
    ] as const,
    "narrativeJob.sourceAuthority",
  );
  assertProjectionAuthority(projectionKind, authority);
  contractSha256(job.sourceCommitHash, "narrativeJob.sourceCommitHash");
  contractSha256(job.sourceContentHash, "narrativeJob.sourceContentHash");
  for (const field of ["allowedFactIds", "allowedObjectVersionIds", "allowedKnowledgeIds"] as const) {
    contractStringArray(job[field], `narrativeJob.${field}`, { sorted: true });
  }
  return job as unknown as OpenNovelNarrativeProjectionJobV1;
}

export function computeNarrativeProjectionFingerprint(
  job: Pick<
    OpenNovelNarrativeProjectionJobV1,
    | "projectionKind"
    | "sourceCommitHash"
    | "sourceContentHash"
    | "narrativeProfileVersion"
    | "audience"
  >,
  projectorVersion: string,
): string {
  return sha256Canonical({
    projectionKind: job.projectionKind,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion,
    audience: job.audience,
  });
}

export function computeNarrativeArtifactContentHash(
  artifact: Pick<OpenNovelNarrativeArtifactV1, "text" | "usedFactRefs">,
): string {
  return sha256Canonical({ text: artifact.text, usedFactRefs: artifact.usedFactRefs });
}

export function validateOpenNovelNarrativeArtifactV1(
  value: unknown,
  job?: OpenNovelNarrativeProjectionJobV1,
): OpenNovelNarrativeArtifactV1 {
  const artifact = contractObject(value, "narrativeArtifact");
  exactContractKeys(artifact, [
    "schemaVersion",
    "jobId",
    "runId",
    "projectionKind",
    "sourceId",
    "sourceCommitHash",
    "sourceContentHash",
    "audience",
    "narrativeProfileVersion",
    "projectorVersion",
    "text",
    "usedFactRefs",
    "validationReportHash",
    "contentHash",
    "renderMode",
    "status",
  ], "narrativeArtifact");
  contractLiteral(
    artifact.schemaVersion,
    "openovel_narrative_artifact_v1",
    "narrativeArtifact.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  for (const field of ["jobId", "runId", "sourceId", "text"] as const) {
    contractString(artifact[field], `narrativeArtifact.${field}`);
  }
  contractVersion(artifact.narrativeProfileVersion, "narrativeArtifact.narrativeProfileVersion");
  contractVersion(artifact.projectorVersion, "narrativeArtifact.projectorVersion");
  contractEnum(
    artifact.projectionKind,
    ["GENESIS_NARRATIVE", "BEAT_NARRATIVE", "CHAPTER_NARRATIVE", "FINALE_NARRATIVE"] as const,
    "narrativeArtifact.projectionKind",
  );
  validateNarrativeAudienceV1(artifact.audience, "narrativeArtifact.audience");
  for (const field of [
    "sourceCommitHash",
    "sourceContentHash",
    "validationReportHash",
  ] as const) {
    contractSha256(artifact[field], `narrativeArtifact.${field}`);
  }
  contractStringArray(artifact.usedFactRefs, "narrativeArtifact.usedFactRefs", { sorted: true });
  const mode = contractEnum(
    artifact.renderMode,
    ["PROVIDER", "AUTHORED_FALLBACK"] as const,
    "narrativeArtifact.renderMode",
  );
  const status = contractEnum(
    artifact.status,
    ["PUBLISHED", "FALLBACK_PUBLISHED"] as const,
    "narrativeArtifact.status",
  );
  if (
    (mode === "PROVIDER" && status !== "PUBLISHED") ||
    (mode === "AUTHORED_FALLBACK" && status !== "FALLBACK_PUBLISHED")
  ) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "narrativeArtifact.status",
      "RENDER_MODE_STATUS_MISMATCH",
    );
  }
  const typed = artifact as unknown as OpenNovelNarrativeArtifactV1;
  assertHashEqual(
    artifact.contentHash,
    computeNarrativeArtifactContentHash(typed),
    "narrativeArtifact.contentHash",
    ERROR.CONTRACT_HASH_MISMATCH,
  );
  if (job) assertArtifactJob(job, artifact, typed.usedFactRefs);
  return typed;
}

export function validateNarrativeAudienceV1(
  value: unknown,
  path = "audience",
): NarrativeAudienceV1 {
  const audience = contractObject(value, path);
  exactContractKeys(audience, ["kind", "seatId"], path);
  const kind = contractEnum(audience.kind, ["PUBLIC", "SEAT"] as const, `${path}.kind`);
  if (kind === "PUBLIC") {
    if (audience.seatId !== null) {
      failPressureContract(ERROR.CONTRACT_FIELD_INVALID, `${path}.seatId`, "PUBLIC_REQUIRES_NULL");
    }
  } else {
    validateSeatIdV1(audience.seatId, `${path}.seatId`);
  }
  return audience as unknown as NarrativeAudienceV1;
}

function assertProjectionAuthority(
  projection: NarrativeProjectionKindV1,
  authority: NarrativeSourceAuthorityV1,
): void {
  const allowed: Record<NarrativeProjectionKindV1, readonly NarrativeSourceAuthorityV1[]> = {
    GENESIS_NARRATIVE: ["GENESIS_FROZEN"],
    BEAT_NARRATIVE: ["CHAPTER_WORKING"],
    CHAPTER_NARRATIVE: ["CHAPTER_FROZEN"],
    FINALE_NARRATIVE: ["FINALE_FROZEN", "LEGACY_TERMINAL_COMMITTED"],
  };
  if (!allowed[projection].includes(authority)) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "narrativeJob.sourceAuthority",
      `INVALID_FOR_${projection}`,
    );
  }
}

function assertArtifactJob(
  job: OpenNovelNarrativeProjectionJobV1,
  artifact: RawContract,
  usedFactRefs: string[],
): void {
  for (const field of [
    "jobId",
    "runId",
    "projectionKind",
    "sourceId",
    "sourceCommitHash",
    "sourceContentHash",
    "narrativeProfileVersion",
  ] as const) {
    if (artifact[field] !== job[field]) {
      failPressureContract(
        ERROR.CONTRACT_REFERENCE_MISMATCH,
        `narrativeArtifact.${field}`,
        `EXPECTED_${job[field]}`,
      );
    }
  }
  if (JSON.stringify(artifact.audience) !== JSON.stringify(job.audience)) {
    failPressureContract(ERROR.CONTRACT_REFERENCE_MISMATCH, "narrativeArtifact.audience");
  }
  const allowed = new Set(job.allowedFactIds);
  if (usedFactRefs.some((ref) => !allowed.has(ref))) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "narrativeArtifact.usedFactRefs",
      "FACT_NOT_AUDIENCE_ALLOWED",
    );
  }
}
