import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_CHECKPOINT_IDS = [
  "D00", "D01", "D02", "D02A", "D03", "D04", "D05",
  "D06", "D07", "D08", "D09", "D10", "D11"
];

const CHECKPOINT_STATUSES = new Set([
  "NOT_STARTED", "IN_PROGRESS", "PASS", "FAIL",
  "SOURCE_DRIFT", "NEEDS_USER_COORDINATION", "EXTERNAL_BLOCKED"
]);
const FINAL_VERDICTS = new Set(["PASS", "FAIL", "EXTERNAL_BLOCKED"]);

class ManifestVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ManifestVerificationError";
    this.code = code;
    this.details = details;
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, message, details) => {
  throw new ManifestVerificationError(code, message, details);
};
const ensure = (condition, code, message, details) => {
  if (!condition) fail(code, message, details);
};
const unique = (values) => new Set(values).size === values.length;
const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b));
const sameSet = (left, right) =>
  left.length === right.length
  && unique(left)
  && unique(right)
  && sorted(left).every((value, index) => value === sorted(right)[index]);

function validateShape(manifest) {
  const sourceFields = [
    "branch", "headSha", "baselineSourceFingerprint", "planHash",
    "pairedTestPlanHash", "buildArtifactSha256", "configFingerprint",
    "strategyRegistryHash", "strategyArtifactHashes"
  ];
  const databaseFields = [
    "provider", "projectRefRedacted", "schema", "nonProductionAllowlistMatched",
    "schemaHash", "migrationDirectoryHash", "databaseFingerprintRedacted", "appliedMigrations"
  ];
  ensure(typeof manifest.startedAt === "string" && Number.isFinite(Date.parse(manifest.startedAt)),
    "MANIFEST_SCHEMA_INVALID", "startedAt must be ISO-8601");
  if (manifest.finishedAt != null) {
    ensure(typeof manifest.finishedAt === "string" && Number.isFinite(Date.parse(manifest.finishedAt)),
      "MANIFEST_SCHEMA_INVALID", "finishedAt must be ISO-8601 when present");
  }
  ensure(manifest.source && typeof manifest.source === "object" && !Array.isArray(manifest.source),
    "MANIFEST_SCHEMA_INVALID", "source is required");
  for (const field of sourceFields) {
    ensure(Object.prototype.hasOwnProperty.call(manifest.source, field),
      "MANIFEST_SCHEMA_INVALID", "source." + field + " is required");
  }
  ensure(manifest.database && typeof manifest.database === "object" && !Array.isArray(manifest.database),
    "MANIFEST_SCHEMA_INVALID", "database is required");
  for (const field of databaseFields) {
    ensure(Object.prototype.hasOwnProperty.call(manifest.database, field),
      "MANIFEST_SCHEMA_INVALID", "database." + field + " is required");
  }
  ensure(manifest.database.provider === "supabase",
    "DATABASE_SCOPE_INVALID", "acceptance database provider must be Supabase");
  ensure(typeof manifest.database.projectRefRedacted === "string" && manifest.database.projectRefRedacted.length > 0,
    "DATABASE_SCOPE_INVALID", "redacted Supabase project reference is required");
  ensure(typeof manifest.database.schema === "string" && manifest.database.schema.length > 0 && manifest.database.schema !== "public",
    "DATABASE_SCOPE_INVALID", "a non-public Supabase isolation schema is required");
  ensure(manifest.database.nonProductionAllowlistMatched === true,
    "DATABASE_SCOPE_INVALID", "Supabase target must match the non-production allowlist");
  ensure(Array.isArray(manifest.database.appliedMigrations),
    "MANIFEST_SCHEMA_INVALID", "database.appliedMigrations must be an array");
  for (const field of ["services", "browsers", "externalBlockers"]) {
    ensure(Array.isArray(manifest[field]), "MANIFEST_SCHEMA_INVALID", field + " must be an array");
  }
  ensure(manifest.gates && typeof manifest.gates === "object" && !Array.isArray(manifest.gates),
    "MANIFEST_SCHEMA_INVALID", "gates must be an object");
}

function validateLifecycle(manifest) {
  ensure(!Object.prototype.hasOwnProperty.call(manifest, "status"),
    "MANIFEST_LIFECYCLE_INVALID", "top-level status is forbidden");
  const finished = manifest.finishedAt != null;
  const verdict = manifest.verdict;
  ensure(
    (!finished && verdict == null) || (finished && FINAL_VERDICTS.has(verdict)),
    "MANIFEST_LIFECYCLE_INVALID",
    "finishedAt and verdict do not form a legal running/final state",
    { finishedAt: manifest.finishedAt, verdict }
  );
}

function validateCheckpoints(manifest) {
  ensure(Array.isArray(manifest.requiredCheckpointIds),
    "CHECKPOINT_SET_MISMATCH", "requiredCheckpointIds must be an array");
  ensure(sameSet(manifest.requiredCheckpointIds, REQUIRED_CHECKPOINT_IDS),
    "CHECKPOINT_SET_MISMATCH", "requiredCheckpointIds is not the fixed 13-item contract",
    { expected: REQUIRED_CHECKPOINT_IDS, actual: manifest.requiredCheckpointIds });

  ensure(Array.isArray(manifest.checkpoints),
    "CHECKPOINT_SET_MISMATCH", "checkpoints must be an array");
  const ids = manifest.checkpoints.map((entry) => entry?.checkpointId);
  ensure(sameSet(ids, REQUIRED_CHECKPOINT_IDS),
    "CHECKPOINT_SET_MISMATCH", "checkpoint rows do not exactly cover the fixed set",
    { expected: REQUIRED_CHECKPOINT_IDS, actual: ids });
  for (const checkpoint of manifest.checkpoints) {
    ensure(CHECKPOINT_STATUSES.has(checkpoint.status),
      "CHECKPOINT_STATUS_INVALID", "illegal checkpoint status",
      { checkpointId: checkpoint.checkpointId, status: checkpoint.status });
  }

  if (manifest.verdict === "PASS") {
    ensure(manifest.checkpoints.every((entry) => entry.status === "PASS"),
      "PASS_GATE_INCOMPLETE", "PASS requires all 13 checkpoints to be PASS");
    ensure((manifest.externalBlockers || []).length === 0,
      "PASS_GATE_INCOMPLETE", "PASS cannot contain external blockers");
  }

  if (manifest.verdict === "EXTERNAL_BLOCKED") {
    const forbidden = new Set(["FAIL", "SOURCE_DRIFT", "NEEDS_USER_COORDINATION"]);
    ensure(!manifest.checkpoints.some((entry) => forbidden.has(entry.status)),
      "EXTERNAL_BLOCKED_INVALID", "EXTERNAL_BLOCKED cannot coexist with code/source/coordination failure");
    ensure(Array.isArray(manifest.externalBlockers) && manifest.externalBlockers.length > 0,
      "EXTERNAL_BLOCKED_INVALID", "EXTERNAL_BLOCKED requires at least one blocker");
    const blockerIds = new Set(manifest.externalBlockers.map((entry) => entry?.blockerId).filter(Boolean));
    for (const checkpoint of manifest.checkpoints.filter((entry) =>
      entry.status === "EXTERNAL_BLOCKED" || entry.status === "NOT_STARTED")) {
      ensure(checkpoint.externalBlockerId && blockerIds.has(checkpoint.externalBlockerId),
        "EXTERNAL_BLOCKED_INVALID", "blocked/downstream checkpoint must reference a declared blocker",
        { checkpointId: checkpoint.checkpointId });
    }
  }
}

function validateRoutes(manifest) {
  ensure(Array.isArray(manifest.routes), "ROUTE_SCOPE_INVALID", "routes must be an array");
  ensure(!Object.prototype.hasOwnProperty.call(manifest, "runIds"),
    "ROUTE_SCOPE_INVALID", "runIds duplicate is forbidden; routes is the only lane binding source");
  const laneIds = manifest.routes.map((entry) => entry?.laneId);
  const runIds = manifest.routes.map((entry) => entry?.runId);
  ensure(laneIds.every(Boolean) && unique(laneIds),
    "ROUTE_SCOPE_INVALID", "laneId values must be present and unique");
  ensure(runIds.every(Boolean) && unique(runIds),
    "ROUTE_SCOPE_INVALID", "each lane must bind one unique RunId");
  return new Map(manifest.routes.map((entry) => [entry.laneId, entry]));
}

function safeArtifactPath(root, relativePath) {
  ensure(typeof relativePath === "string" && relativePath.length > 0,
    "EVIDENCE_SCOPE_MISMATCH", "artifact relativePath is required");
  ensure(!isAbsolute(relativePath),
    "EVIDENCE_SCOPE_MISMATCH", "artifact path must be relative", { relativePath });
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  ensure(rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel),
    "EVIDENCE_SCOPE_MISMATCH", "artifact escapes the attempt directory", { relativePath });
  return target;
}

function collectDirectRunIds(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return ["runId", "roomId", "storyRunId"]
    .map((key) => payload[key])
    .filter((value) => typeof value === "string" && value.length > 0);
}

async function validateArtifacts(manifestPath, manifest, routeByLane) {
  ensure(Array.isArray(manifest.artifacts), "EVIDENCE_SCOPE_MISMATCH", "artifacts must be an array");
  const paths = manifest.artifacts.map((entry) => entry?.relativePath);
  ensure(paths.every(Boolean) && unique(paths),
    "EVIDENCE_SCOPE_MISMATCH", "artifact relativePath values must be present and unique");

  const root = dirname(manifestPath);
  const results = [];
  for (const artifact of manifest.artifacts) {
    const target = safeArtifactPath(root, artifact.relativePath);
    await access(target, fsConstants.R_OK).catch(() =>
      fail("EVIDENCE_SCOPE_MISMATCH", "artifact is missing or unreadable", { relativePath: artifact.relativePath }));
    const [bytes, metadata] = await Promise.all([readFile(target), stat(target)]);
    const digest = sha256(bytes);
    ensure(metadata.isFile(), "EVIDENCE_SCOPE_MISMATCH", "artifact is not a file",
      { relativePath: artifact.relativePath });
    ensure(Number(artifact.bytes) === bytes.length,
      "EVIDENCE_SCOPE_MISMATCH", "artifact byte count changed",
      { relativePath: artifact.relativePath, expected: artifact.bytes, actual: bytes.length });
    ensure(String(artifact.sha256 || "").toLowerCase() === digest,
      "EVIDENCE_SCOPE_MISMATCH", "artifact SHA-256 changed",
      { relativePath: artifact.relativePath, expected: artifact.sha256, actual: digest });

    const ownsAttempt = artifact.attemptId === manifest.attemptId;
    const route = artifact.laneId ? routeByLane.get(artifact.laneId) : null;
    const ownsRun = Boolean(route && artifact.runId && artifact.runId === route.runId);
    ensure(ownsAttempt !== ownsRun,
      "EVIDENCE_SCOPE_MISMATCH",
      "artifact must belong to exactly one attempt-level or lane/RunId scope",
      { relativePath: artifact.relativePath, laneId: artifact.laneId, runId: artifact.runId });
    if (artifact.laneId) {
      ensure(Boolean(route), "EVIDENCE_SCOPE_MISMATCH", "artifact laneId is undeclared",
        { relativePath: artifact.relativePath, laneId: artifact.laneId });
    }

    if (artifact.relativePath.toLowerCase().endsWith(".json")) {
      let payload;
      try {
        payload = JSON.parse(bytes.toString("utf8"));
      } catch (error) {
        fail("EVIDENCE_SCOPE_MISMATCH", "JSON artifact cannot be parsed",
          { relativePath: artifact.relativePath, error: String(error) });
      }
      if (ownsRun) {
        const embeddedIds = collectDirectRunIds(payload);
        ensure(embeddedIds.every((value) => value === artifact.runId),
          "EVIDENCE_SCOPE_MISMATCH", "artifact embeds a different RunId",
          { relativePath: artifact.relativePath, declared: artifact.runId, embeddedIds });
      }
    }

    results.push({
      relativePath: artifact.relativePath,
      bytes: bytes.length,
      sha256: digest,
      laneId: artifact.laneId || null,
      runId: artifact.runId || null,
      attemptId: artifact.attemptId || null
    });
  }
  return results;
}

export async function verifyContinuousStrategyManifest(manifestPath, options = {}) {
  ensure(isAbsolute(manifestPath),
    "MANIFEST_PATH_INVALID", "manifest path must be absolute", { manifestPath });
  const raw = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    fail("MANIFEST_JSON_INVALID", "manifest JSON cannot be parsed", { error: String(error) });
  }

  ensure(manifest.schemaVersion === "continuous-strategy-acceptance-v1",
    "MANIFEST_SCHEMA_INVALID", "unexpected manifest schemaVersion");
  ensure(manifest.goalId === "continuous-strategy-v1.1",
    "MANIFEST_SCHEMA_INVALID", "unexpected goalId");
  ensure(typeof manifest.attemptId === "string" && manifest.attemptId.length > 0,
    "MANIFEST_SCHEMA_INVALID", "attemptId is required");
  validateShape(manifest);
  validateLifecycle(manifest);
  validateCheckpoints(manifest);
  const routeByLane = validateRoutes(manifest);
  const artifacts = await validateArtifacts(manifestPath, manifest, routeByLane);
  const manifestSha256 = sha256(raw);

  if (options.verifySidecar !== false && manifest.finishedAt != null) {
    const sidecarPath = resolve(dirname(manifestPath), "acceptance-manifest.sha256");
    const sidecar = await readFile(sidecarPath, "utf8").catch(() => null);
    ensure(sidecar != null, "MANIFEST_HASH_MISSING", "final manifest hash sidecar is missing");
    ensure(sidecar.trim().split(/\s+/)[0]?.toLowerCase() === manifestSha256,
      "MANIFEST_HASH_MISMATCH", "acceptance-manifest.sha256 does not match the manifest");
  }

  return {
    status: "PASS",
    schemaVersion: manifest.schemaVersion,
    attemptId: manifest.attemptId,
    verdict: manifest.verdict,
    manifestSha256,
    routeCount: manifest.routes.length,
    artifactCount: artifacts.length,
    checkpointCount: manifest.checkpoints.length,
    artifacts
  };
}

const isCli = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isCli) {
  const manifestPath = process.argv[2];
  verifyContinuousStrategyManifest(manifestPath)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      const failure = {
        status: "FAIL",
        code: error?.code || "MANIFEST_VERIFICATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        details: error?.details || {}
      };
      console.error(JSON.stringify(failure, null, 2));
      process.exitCode = 1;
    });
}