import {
  fail,
  integerAtLeast,
  isRecord,
  nonEmptyString,
  pass,
  stringArray,
  type ValidationResult,
} from "./schema-utils";

export type B0BatchCommitManifestV1 = {
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
  /** Legacy C2 subset retained for replay compatibility. */
  resourceMutationKeys: string[];
  /** Every non-resource authoritative mutation applied by the same transaction. */
  stateMutationKeys?: string[];
  publicationOutboxKeys: string[];
  committedAt: string;
  authoritative: true;
  commitHash: string;
};

const FIELDS = [
  "schemaVersion", "batchId", "snapshotId", "windowId", "roomId", "runId",
  "baseWorldSequence", "committedWorldSequence", "rulesetHash", "inputHash",
  "resolutionHash", "resourceMutationKeys", "stateMutationKeys", "publicationOutboxKeys", "committedAt",
  "authoritative", "commitHash",
] as const;

export function validateB0BatchCommitManifestV1(value: unknown): ValidationResult<B0BatchCommitManifestV1> {
  if (!isRecord(value)) return fail(["commit manifest must be an object"]);
  const errors = Object.keys(value)
    .filter((key) => !FIELDS.includes(key as (typeof FIELDS)[number]))
    .map((key) => `commit manifest contains unknown field: ${key}`);
  if (value.schemaVersion !== "b0-batch-commit-manifest-v1") errors.push("commit manifest.schemaVersion is invalid");
  for (const key of [
    "batchId", "snapshotId", "windowId", "roomId", "runId", "rulesetHash",
    "inputHash", "resolutionHash", "committedAt", "commitHash",
  ] as const) {
    if (!nonEmptyString(value[key])) errors.push(`commit manifest.${key} is required`);
  }
  if (!integerAtLeast(value.baseWorldSequence, 0)) errors.push("commit manifest.baseWorldSequence must be >= 0");
  if (!integerAtLeast(value.committedWorldSequence, 1)) errors.push("commit manifest.committedWorldSequence must be >= 1");
  if (Number.isInteger(value.baseWorldSequence)
    && Number.isInteger(value.committedWorldSequence)
    && value.committedWorldSequence !== Number(value.baseWorldSequence) + 1) {
    errors.push("commit manifest must advance worldSequence exactly once");
  }
  for (const key of ["rulesetHash", "inputHash", "resolutionHash", "commitHash"] as const) {
    if (typeof value[key] === "string" && !/^[a-f0-9]{64}$/.test(value[key])) {
      errors.push(`commit manifest.${key} must be a sha256 hex digest`);
    }
  }
  if (!stringArray(value.resourceMutationKeys)) errors.push("commit manifest.resourceMutationKeys must be an array");
  if (value.stateMutationKeys !== undefined && !stringArray(value.stateMutationKeys)) {
    errors.push("commit manifest.stateMutationKeys must be an array when present");
  }
  if (!stringArray(value.publicationOutboxKeys) || value.publicationOutboxKeys.length === 0) {
    errors.push("commit manifest.publicationOutboxKeys must be non-empty");
  }
  if (value.authoritative !== true) errors.push("commit manifest.authoritative must be true");
  return errors.length ? fail(errors) : pass(value as B0BatchCommitManifestV1);
}
