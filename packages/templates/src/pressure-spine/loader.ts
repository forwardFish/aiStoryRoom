import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalJson, contentTreeHash, sha256Bytes } from "./canonical";
import { PressureSpineValidationError } from "./errors";
import { readPressureSpineDirectory, safeResolve } from "./fs";
import type {
  LoadedPressureSpinePackage,
  PressureSpineManifestLock,
  PressureSpineRegistrationManifest,
  PressureSpineRegistry,
  PressureSpineRuntimeIndex,
} from "./types";
import { PRESSURE_SPINE_SOURCE_DIRECTORY } from "./types";
import { assertPressureSpinePackage } from "./validator";

function parseJson<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    throw new PressureSpineValidationError("CONTENT_JSON_INVALID", filePath, String(error));
  }
}

export function loadPressureSpineRegistry(filePath: string): PressureSpineRegistry {
  const registry = parseJson<PressureSpineRegistry>(filePath);
  if (registry.schemaVersion !== "strategy_registry_v1" || !registry.defaultStrategyVersion || !registry.strategies) {
    throw new PressureSpineValidationError("CONTENT_REGISTRY_INVALID", filePath, "invalid registry");
  }
  for (const [version, entry] of Object.entries(registry.strategies)) {
    if (
      !entry
      || typeof entry.artifactDirectory !== "string"
      || !/^[a-f0-9]{64}$/u.test(entry.manifestSha256)
      || !["development", "published"].includes(entry.status)
    ) {
      throw new PressureSpineValidationError(
        "CONTENT_REGISTRY_INVALID",
        `${filePath}#/strategies/${version}`,
        "invalid entry",
      );
    }
  }
  return registry;
}

export function loadPressureSpinePackage(
  registryPath: string,
  version: string,
): LoadedPressureSpinePackage {
  if (!version) {
    throw new PressureSpineValidationError("PACKAGE_VERSION_REQUIRED", registryPath, "version is required");
  }
  const registry = loadPressureSpineRegistry(registryPath);
  const entry = registry.strategies[version];
  if (!entry) {
    throw new PressureSpineValidationError("PACKAGE_VERSION_NOT_REGISTERED", registryPath, version);
  }

  const root = safeResolve(dirname(registryPath), entry.artifactDirectory);
  const manifestPath = resolve(root, "manifest.json");
  const manifestBytes = readFileSync(manifestPath);
  if (sha256Bytes(manifestBytes).toLowerCase() !== entry.manifestSha256) {
    throw new PressureSpineValidationError("PACKAGE_HASH_MISMATCH", manifestPath, "registration hash mismatch");
  }

  const registration = JSON.parse(manifestBytes.toString("utf8")) as PressureSpineRegistrationManifest;
  if (
    registration.schemaVersion !== "pressure_spine_registration_manifest_v1"
    || registration.contentVersion !== version
    || !registration.templateKey
    || !registration.runtimeProfile
    || registration.sourceDirectory !== PRESSURE_SPINE_SOURCE_DIRECTORY
  ) {
    throw new PressureSpineValidationError("CONTENT_REGISTRATION_INVALID", manifestPath, "registration identity mismatch");
  }

  const lockPath = resolve(root, registration.manifestLockPath);
  const indexPath = resolve(root, registration.runtimeIndexPath);
  const lockBytes = readFileSync(lockPath);
  if (sha256Bytes(lockBytes) !== registration.manifestLockSha256) {
    throw new PressureSpineValidationError("PACKAGE_HASH_MISMATCH", lockPath, "lock hash mismatch");
  }
  const lock = JSON.parse(lockBytes.toString("utf8")) as PressureSpineManifestLock;
  const index = parseJson<PressureSpineRuntimeIndex>(indexPath);
  const indexHash = sha256Bytes(canonicalJson(index));
  if (indexHash !== registration.runtimeIndexSha256 || indexHash !== lock.runtimeIndexSha256) {
    throw new PressureSpineValidationError("PACKAGE_HASH_MISMATCH", indexPath, "index hash mismatch");
  }
  if (
    lock.registeredPackageVersion !== version
    || lock.runtimeProfile !== registration.runtimeProfile
    || lock.worldId !== registration.templateKey
    || index.registeredPackageVersion !== version
    || index.runtimeProfile !== registration.runtimeProfile
    || index.worldId !== registration.templateKey
    || index.packageId !== registration.packageId
    || index.packageVersion !== registration.packageVersion
    || index.sourceSha256 !== registration.sourceSha256
  ) {
    throw new PressureSpineValidationError("CONTENT_REGISTRATION_INVALID", root, "lock/index identity mismatch");
  }

  const archivePath = safeResolve(root, lock.sourcePackageArchivePath);
  const archiveBytes = readFileSync(archivePath);
  if (
    archiveBytes.byteLength !== lock.sourcePackageByteSize
    || sha256Bytes(archiveBytes) !== lock.sourcePackageSha256
    || lock.sourcePackageSha256 !== registration.sourcePackageSha256
  ) {
    throw new PressureSpineValidationError("PACKAGE_HASH_MISMATCH", archivePath, "archive mismatch");
  }

  const files = readPressureSpineDirectory(resolve(root, registration.sourceDirectory));
  const report = assertPressureSpinePackage(files, {
    expectedSourceSha256: lock.sourceSha256,
    expectedSourceLineCount: lock.sourceLineCount,
    validateInventory: true,
    requireNativeAuditPass: true,
  });
  if (files.size !== registration.sourceFileCount || report.counts.fileCount !== registration.sourceFileCount) {
    throw new PressureSpineValidationError("PACKAGE_FILE_COUNT_MISMATCH", root, `${files.size}`);
  }
  if (index.counts.fileCount !== report.counts.fileCount || index.counts.nodeCount !== report.counts.nodeCount) {
    throw new PressureSpineValidationError("CONTENT_INDEX_COUNT_MISMATCH", indexPath, "index counts differ from source");
  }

  const artifacts = [...files].map(([filePath, bytes]) => ({
    path: `${PRESSURE_SPINE_SOURCE_DIRECTORY}/${filePath}`,
    byteSize: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  }));
  if (contentTreeHash(artifacts) !== lock.contentTreeSha256) {
    throw new PressureSpineValidationError("PACKAGE_HASH_MISMATCH", root, "source tree changed");
  }

  return {
    registry,
    registryEntry: entry,
    registrationManifest: registration,
    manifestLock: lock,
    runtimeIndex: index,
    artifactRoot: root,
  };
}
