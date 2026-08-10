import { readFile } from "node:fs/promises";
import {
  assertEndgamePackageV1,
  canonicalizeJcs,
  computeEndgamePackageHash,
  createEndgamePackageSnapshotV1,
  validateEndgamePackageV1
} from "./endgame-package-v1.contract.mjs";

export const ENDGAME_PACKAGE_SCHEMA_VERSION = "endgame_package_v1";
export const ENDGAME_PACKAGE_SNAPSHOT_SCHEMA_VERSION = "endgame_package_snapshot_v1";
export const ENDGAME_RUN_PACKAGE_BINDING_SCHEMA_VERSION = "endgame_run_package_binding_v1";
export const ENDGAME_PACKAGE_SCHEMA_ID = "https://ourmanyworlds.com/schemas/endgame-package-v1.schema.json";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const BINDING_KEYS = Object.freeze([
  "schemaVersion",
  "runId",
  "packageRef",
  "canonicalPackage"
]);
const PACKAGE_REF_KEYS = Object.freeze(["policyId", "policyVersion", "packageHash"]);

export class EndgamePackageLoadError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EndgamePackageLoadError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

export function validateEndgamePackageAgainstSchemaV1(packageDocument, schemaDocument = null) {
  if (schemaDocument !== null) assertFormalSchemaIdentityV1(schemaDocument);
  const result = validateEndgamePackageV1(packageDocument);
  if (!result.ok) {
    throw new EndgamePackageLoadError(
      "ENDGAME_PACKAGE_SCHEMA_INVALID",
      "The endgame package failed the closed V1 schema and reference contract.",
      { issues: result.issues }
    );
  }
  return packageDocument;
}

export function assertFormalSchemaIdentityV1(schemaDocument) {
  if (!isRecord(schemaDocument)) {
    throw new EndgamePackageLoadError("ENDGAME_SCHEMA_DOCUMENT_INVALID", "Schema document must be an object.");
  }
  if (schemaDocument.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new EndgamePackageLoadError("ENDGAME_SCHEMA_DRAFT_UNSUPPORTED", "Only JSON Schema Draft 2020-12 is accepted.");
  }
  if (schemaDocument.$id !== ENDGAME_PACKAGE_SCHEMA_ID) {
    throw new EndgamePackageLoadError("ENDGAME_SCHEMA_ID_MISMATCH", "The formal package schema id is not the frozen V1 id.");
  }
  if (schemaDocument.additionalProperties !== false) {
    throw new EndgamePackageLoadError("ENDGAME_SCHEMA_NOT_CLOSED", "The formal package schema must reject unknown top-level fields.");
  }
  if (schemaDocument.properties?.schemaVersion?.const !== ENDGAME_PACKAGE_SCHEMA_VERSION) {
    throw new EndgamePackageLoadError("ENDGAME_SCHEMA_VERSION_MISMATCH", "The formal schema does not freeze endgame_package_v1.");
  }
  return schemaDocument;
}

export function parseEndgamePackageJsonV1(jsonText, options = {}) {
  if (typeof jsonText !== "string" || jsonText.length === 0) {
    throw new EndgamePackageLoadError("ENDGAME_PACKAGE_JSON_REQUIRED", "Package JSON must be a non-empty UTF-8 string.");
  }
  let packageDocument;
  try {
    packageDocument = JSON.parse(jsonText);
  } catch (error) {
    throw new EndgamePackageLoadError("ENDGAME_PACKAGE_JSON_INVALID", "Package JSON could not be parsed.", {
      sourceId: options.sourceId ?? null,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  return loadEndgamePackageV1(packageDocument, options);
}

export async function loadEndgamePackageFileV1(filePath, options = {}) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new EndgamePackageLoadError("ENDGAME_PACKAGE_PATH_REQUIRED", "A package file path is required.");
  }
  const fileReader = options.readFile ?? readFile;
  let jsonText;
  try {
    jsonText = await fileReader(filePath, "utf8");
  } catch (error) {
    throw new EndgamePackageLoadError("ENDGAME_PACKAGE_READ_FAILED", "The package file could not be read.", {
      filePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  return parseEndgamePackageJsonV1(jsonText, { ...options, sourceId: options.sourceId ?? filePath });
}

export function loadEndgamePackageV1(packageDocument, options = {}) {
  validateEndgamePackageAgainstSchemaV1(packageDocument, options.schemaDocument ?? null);
  const snapshot = createEndgamePackageSnapshotV1(packageDocument);
  return deepFreeze({
    schemaVersion: "loaded_endgame_package_v1",
    sourceId: options.sourceId ?? null,
    packageRef: {
      policyId: snapshot.policyId,
      policyVersion: snapshot.policyVersion,
      packageHash: snapshot.packageHash
    },
    snapshot
  });
}

export function freezeEndgamePackageForRunV1({ runId, packageSnapshot }) {
  assertRunId(runId);
  const snapshot = assertPackageSnapshotV1(packageSnapshot);
  return deepFreeze({
    schemaVersion: ENDGAME_RUN_PACKAGE_BINDING_SCHEMA_VERSION,
    runId,
    packageRef: {
      policyId: snapshot.policyId,
      policyVersion: snapshot.policyVersion,
      packageHash: snapshot.packageHash
    },
    canonicalPackage: snapshot.canonicalPackage
  });
}

export function resolveFrozenEndgamePackageForRunV1(binding) {
  assertExactObject(binding, BINDING_KEYS, "run package binding");
  if (binding.schemaVersion !== ENDGAME_RUN_PACKAGE_BINDING_SCHEMA_VERSION) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_BINDING_VERSION_UNSUPPORTED", "Unknown run package binding version.");
  }
  assertRunId(binding.runId);
  assertExactObject(binding.packageRef, PACKAGE_REF_KEYS, "run package reference");
  const { policyId, policyVersion, packageHash } = binding.packageRef;
  if (typeof policyId !== "string" || policyId.length === 0) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_POLICY_ID_INVALID", "Frozen policyId is required.");
  }
  if (typeof policyVersion !== "string" || policyVersion.length === 0) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_POLICY_VERSION_INVALID", "Frozen policyVersion is required.");
  }
  if (typeof packageHash !== "string" || !HASH_PATTERN.test(packageHash)) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_PACKAGE_HASH_INVALID", "Frozen packageHash must be lowercase SHA-256 hex.");
  }
  if (typeof binding.canonicalPackage !== "string" || binding.canonicalPackage.length === 0) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_PACKAGE_SNAPSHOT_MISSING", "The immutable canonical package snapshot is required.");
  }

  let packageDocument;
  try {
    packageDocument = JSON.parse(binding.canonicalPackage);
  } catch (error) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_PACKAGE_SNAPSHOT_INVALID", "The canonical package snapshot is not valid JSON.", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  validateEndgamePackageAgainstSchemaV1(packageDocument);
  const canonicalPackage = canonicalizeJcs(packageDocument);
  if (canonicalPackage !== binding.canonicalPackage) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_PACKAGE_NOT_CANONICAL", "The frozen snapshot must contain exact RFC 8785 JCS bytes.");
  }
  const computedHash = computeEndgamePackageHash(packageDocument);
  if (computedHash !== packageHash) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_PACKAGE_HASH_MISMATCH", "The frozen package bytes do not match packageHash.", {
      expected: packageHash,
      actual: computedHash
    });
  }
  if (packageDocument.policyId !== policyId || packageDocument.policyVersion !== policyVersion) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_PACKAGE_REF_MISMATCH", "The frozen package reference does not match its immutable snapshot.");
  }
  return createEndgamePackageSnapshotV1(packageDocument);
}

export function assertPackageSnapshotV1(snapshot) {
  if (!isRecord(snapshot) || snapshot.schemaVersion !== ENDGAME_PACKAGE_SNAPSHOT_SCHEMA_VERSION) {
    throw new EndgamePackageLoadError("ENDGAME_PACKAGE_SNAPSHOT_VERSION_UNSUPPORTED", "Unknown or missing package snapshot version.");
  }
  if (typeof snapshot.canonicalPackage !== "string" || !isRecord(snapshot.packageDocument)) {
    throw new EndgamePackageLoadError("ENDGAME_PACKAGE_SNAPSHOT_INVALID", "Package snapshot is incomplete.");
  }
  const reconstructed = resolveFrozenEndgamePackageForRunV1({
    schemaVersion: ENDGAME_RUN_PACKAGE_BINDING_SCHEMA_VERSION,
    runId: "snapshot-validation",
    packageRef: {
      policyId: snapshot.policyId,
      policyVersion: snapshot.policyVersion,
      packageHash: snapshot.packageHash
    },
    canonicalPackage: snapshot.canonicalPackage
  });
  return reconstructed;
}

export class EndgamePackageRegistryV1 {
  #byPolicyVersion = new Map();
  #byHash = new Map();

  register(packageDocument, options = {}) {
    const loaded = loadEndgamePackageV1(packageDocument, options);
    const snapshot = loaded.snapshot;
    const key = policyVersionKey(snapshot.policyId, snapshot.policyVersion);
    const existing = this.#byPolicyVersion.get(key);
    if (existing && existing.packageHash !== snapshot.packageHash) {
      throw new EndgamePackageLoadError(
        "ENDGAME_POLICY_VERSION_HASH_CONFLICT",
        "A policyId and policyVersion pair cannot be rebound to different package bytes.",
        { policyId: snapshot.policyId, policyVersion: snapshot.policyVersion }
      );
    }
    this.#byPolicyVersion.set(key, existing ?? snapshot);
    this.#byHash.set(snapshot.packageHash, this.#byHash.get(snapshot.packageHash) ?? snapshot);
    return existing ?? snapshot;
  }

  registerJson(jsonText, options = {}) {
    const loaded = parseEndgamePackageJsonV1(jsonText, options);
    return this.register(loaded.snapshot.packageDocument, options);
  }

  get(policyId, policyVersion) {
    const snapshot = this.#byPolicyVersion.get(policyVersionKey(policyId, policyVersion));
    if (!snapshot) {
      throw new EndgamePackageLoadError("ENDGAME_PACKAGE_NOT_REGISTERED", "The requested policy version is not registered.", {
        policyId,
        policyVersion
      });
    }
    return snapshot;
  }

  bindRun({ runId, policyId, policyVersion }) {
    return freezeEndgamePackageForRunV1({
      runId,
      packageSnapshot: this.get(policyId, policyVersion)
    });
  }

  resolveRun(binding) {
    const snapshot = resolveFrozenEndgamePackageForRunV1(binding);
    const stored = this.#byHash.get(snapshot.packageHash);
    if (stored && stored.canonicalPackage !== snapshot.canonicalPackage) {
      throw new EndgamePackageLoadError("ENDGAME_CONTENT_ADDRESS_CONFLICT", "A packageHash resolved to conflicting bytes.");
    }
    return stored ?? snapshot;
  }
}

function assertFormalPackageV1(packageDocument) {
  try {
    return assertEndgamePackageV1(packageDocument);
  } catch (error) {
    throw new EndgamePackageLoadError("ENDGAME_PACKAGE_SCHEMA_INVALID", "The endgame package is invalid.", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

function assertRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new EndgamePackageLoadError("ENDGAME_RUN_ID_INVALID", "runId must be a stable identifier.");
  }
}

function assertExactObject(value, allowedKeys, label) {
  if (!isRecord(value)) {
    throw new EndgamePackageLoadError("ENDGAME_CLOSED_OBJECT_REQUIRED", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  const missing = allowedKeys.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    throw new EndgamePackageLoadError("ENDGAME_CLOSED_OBJECT_VIOLATION", `${label} has unknown or missing fields.`, {
      unknown,
      missing
    });
  }
}

function policyVersionKey(policyId, policyVersion) {
  return `${policyId}\u0000${policyVersion}`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
