import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pressureSpine from "../src/pressure-spine/index.ts";

const {
  buildPressureSpineManifestLock,
  buildPressureSpineRuntimeIndex,
  canonicalJson,
  PRESSURE_SPINE_SOURCE_DIRECTORY,
  readPressureSpineDirectory,
  sha256Bytes,
} = pressureSpine;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORLD_ID = "sangtian";
const RUNTIME_PROFILE = "SANGTIAN_PRESSURE_SPINE_V1";
const STRATEGY_VERSION = "sangtian_pressure_v1_0";
const ARTIFACT_DIRECTORY = "pressure-spine-v1.0";
const PACKAGE_ID = "sangtian_complete_story_content_package_v1_1";
const PACKAGE_VERSION = "1.1.0-repair-final";
const EXPECTED_NODE_IDS = ["P0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"];
const EXPECTED_SEAT_COUNT = 6;
const ZIP_SHA256 = "38AC19ABFBB89288F80C5E128141B705535D2A9E11D370B293402DC106760317";
const ZIP_BYTE_SIZE = 277041;
const T0_SHA256 = "04D5E8D4533D86890A79058C25252D33E001668921A2BBD8FFDE401CDD2B6238";
const T0_LINE_COUNT = 30547;
const LEGACY_STRATEGY_LOCKS = {
  sangtian_v1_1: "E4047A888450E589A0E3AD2C9F702218BAAE54737C713A217ABAAF3CAC17D8BD",
  sangtian_v1_2: "D21757ACD32D29BE647E9A3796E85886138A3C7AEACAD1541CEDE947198242B2",
};
const ARCHIVE_RELATIVE_PATH = "source-package/sangtian_complete_story_content_package_v1_1.zip";
const DEFAULT_OUTPUT_ROOT = path.resolve(
  ROOT,
  `packages/templates/config/sangtian/${ARTIFACT_DIRECTORY}`,
);
const DEFAULT_REGISTRY_PATH = path.resolve(
  ROOT,
  "packages/templates/config/sangtian/strategy-registry.json",
);
const DEFAULT_T0_PATH = path.resolve(
  ROOT,
  "docs/剧本/嘉靖财政危局/大明王朝1566 (刘和平).txt",
);

function parseArguments(argv) {
  const result = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--check") {
      result.check = true;
      continue;
    }
    if (!value.startsWith("--")) throw new Error(`ARGUMENT_UNKNOWN:${value}`);
    const key = value.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`ARGUMENT_VALUE_REQUIRED:${value}`);
    result[key] = next;
    index += 1;
  }
  return result;
}

function writeExact(root, relativePath, bytes) {
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`CONTENT_PATH_INVALID:${relativePath}`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function readRegistry(registryPath) {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  if (
    registry.schemaVersion !== "strategy_registry_v1"
    || registry.defaultStrategyVersion !== "sangtian_v1_2"
    || !registry.strategies
  ) {
    throw new Error("STRATEGY_REGISTRY_IDENTITY_MISMATCH");
  }
  for (const [version, expectedHash] of Object.entries(LEGACY_STRATEGY_LOCKS)) {
    if (String(registry.strategies[version]?.manifestSha256 || "").toUpperCase() !== expectedHash) {
      throw new Error(`LEGACY_STRATEGY_REGISTRY_DRIFT:${version}`);
    }
  }
  return registry;
}

function readSourceText(sourcePath) {
  if (!sourcePath || !existsSync(sourcePath)) return undefined;
  const bytes = readFileSync(sourcePath);
  if (sha256Bytes(bytes) !== T0_SHA256) throw new Error(`T0_SHA256_MISMATCH:${sourcePath}`);
  return bytes.toString("utf8");
}

function assertSame(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(
      `GENERATED_ARTIFACT_DRIFT:${label}:expected=${sha256Bytes(expected)}:actual=${sha256Bytes(actual)}`,
    );
  }
}

const options = parseArguments(process.argv.slice(2));
const outputRoot = options.outputRoot ? path.resolve(ROOT, options.outputRoot) : DEFAULT_OUTPUT_ROOT;
const registryPath = options.registryPath ? path.resolve(ROOT, options.registryPath) : DEFAULT_REGISTRY_PATH;
const inputRoot = options.inputDir
  ? path.resolve(ROOT, options.inputDir)
  : options.check
    ? path.resolve(outputRoot, PRESSURE_SPINE_SOURCE_DIRECTORY)
    : null;
if (!inputRoot || !existsSync(inputRoot)) throw new Error("CONTENT_INPUT_DIRECTORY_REQUIRED");

const archivePath = options.sourcePackageZip
  ? path.resolve(ROOT, options.sourcePackageZip)
  : path.resolve(outputRoot, ARCHIVE_RELATIVE_PATH);
if (!existsSync(archivePath)) throw new Error(`ACCEPTED_PACKAGE_BINARY_REQUIRED:${archivePath}`);
const archiveBytes = readFileSync(archivePath);
if (archiveBytes.byteLength !== ZIP_BYTE_SIZE || sha256Bytes(archiveBytes) !== ZIP_SHA256) {
  throw new Error(`ACCEPTED_PACKAGE_BINARY_MISMATCH:${archiveBytes.byteLength}:${sha256Bytes(archiveBytes)}`);
}

const files = readPressureSpineDirectory(inputRoot);
const acceptedManifest = JSON.parse(readFileSync(path.resolve(inputRoot, "manifest.json"), "utf8"));
if (
  acceptedManifest.packageId !== PACKAGE_ID
  || acceptedManifest.packageVersion !== PACKAGE_VERSION
  || String(acceptedManifest.sourceSha256).toUpperCase() !== T0_SHA256
  || Number(acceptedManifest.sourceLineCount) !== T0_LINE_COUNT
  || JSON.stringify(acceptedManifest.nodes) !== JSON.stringify(EXPECTED_NODE_IDS)
  || !Array.isArray(acceptedManifest.seatIds)
  || acceptedManifest.seatIds.length !== EXPECTED_SEAT_COUNT
) {
  throw new Error("CONTENT_PACKAGE_IDENTITY_MISMATCH");
}

const currentRegistry = readRegistry(registryPath);
const sourceText = readSourceText(options.t0 ? path.resolve(ROOT, options.t0) : DEFAULT_T0_PATH);
const buildInput = {
  files,
  worldId: WORLD_ID,
  runtimeProfile: RUNTIME_PROFILE,
  registeredPackageVersion: STRATEGY_VERSION,
  sourcePackageSha256: ZIP_SHA256,
  sourcePackageByteSize: ZIP_BYTE_SIZE,
  sourcePackageArchivePath: ARCHIVE_RELATIVE_PATH,
  expectedSourceSha256: T0_SHA256,
  expectedSourceLineCount: T0_LINE_COUNT,
  sourceText,
  legacyStrategyLocks: LEGACY_STRATEGY_LOCKS,
  validation: {
    expectedNodeIds: EXPECTED_NODE_IDS,
    expectedSeatCount: EXPECTED_SEAT_COUNT,
  },
};
const runtimeIndex = buildPressureSpineRuntimeIndex(buildInput);
const manifestLock = buildPressureSpineManifestLock(buildInput, runtimeIndex);
const runtimeIndexText = canonicalJson(runtimeIndex);
const manifestLockText = canonicalJson(manifestLock);
const registration = {
  schemaVersion: "pressure_spine_registration_manifest_v1",
  contentVersion: STRATEGY_VERSION,
  templateKey: WORLD_ID,
  runtimeProfile: RUNTIME_PROFILE,
  packageId: PACKAGE_ID,
  packageVersion: PACKAGE_VERSION,
  sourceDirectory: PRESSURE_SPINE_SOURCE_DIRECTORY,
  sourceFileCount: files.size,
  sourcePackageSha256: ZIP_SHA256,
  sourcePackageByteSize: ZIP_BYTE_SIZE,
  sourcePackageArchivePath: ARCHIVE_RELATIVE_PATH,
  sourceSha256: T0_SHA256,
  sourceLineCount: T0_LINE_COUNT,
  runtimeIndexPath: "runtime-index.json",
  runtimeIndexSha256: sha256Bytes(runtimeIndexText),
  manifestLockPath: "manifest.lock.json",
  manifestLockSha256: sha256Bytes(manifestLockText),
};
const registrationText = canonicalJson(registration);

const artifactDirectory = path.relative(path.dirname(registryPath), outputRoot).split(path.sep).join("/");
if (!artifactDirectory || artifactDirectory.startsWith("../") || path.isAbsolute(artifactDirectory)) {
  throw new Error(`CONTENT_PATH_INVALID:${artifactDirectory}`);
}
const nextRegistry = JSON.parse(JSON.stringify(currentRegistry));
nextRegistry.strategies[STRATEGY_VERSION] = {
  artifactDirectory,
  manifestSha256: sha256Bytes(registrationText).toLowerCase(),
  status: "published",
};
const registryText = `${JSON.stringify(nextRegistry, null, 2)}\n`;

if (options.check) {
  assertSame("runtime-index.json", readFileSync(path.resolve(outputRoot, "runtime-index.json"), "utf8"), runtimeIndexText);
  assertSame("manifest.lock.json", readFileSync(path.resolve(outputRoot, "manifest.lock.json"), "utf8"), manifestLockText);
  assertSame("manifest.json", readFileSync(path.resolve(outputRoot, "manifest.json"), "utf8"), registrationText);
  assertSame("strategy-registry.json", readFileSync(registryPath, "utf8"), registryText);
} else {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(path.resolve(outputRoot, PRESSURE_SPINE_SOURCE_DIRECTORY), { recursive: true });
  writeExact(outputRoot, ARCHIVE_RELATIVE_PATH, archiveBytes);
  for (const [relativePath, bytes] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    writeExact(path.resolve(outputRoot, PRESSURE_SPINE_SOURCE_DIRECTORY), relativePath, bytes);
  }
  writeFileSync(path.resolve(outputRoot, "runtime-index.json"), runtimeIndexText);
  writeFileSync(path.resolve(outputRoot, "manifest.lock.json"), manifestLockText);
  writeFileSync(path.resolve(outputRoot, "manifest.json"), registrationText);
  writeFileSync(registryPath, registryText);
}

console.log(JSON.stringify({
  verdict: "PASS",
  mode: options.check ? "CHECK" : "IMPORT",
  registeredPackageVersion: STRATEGY_VERSION,
  sourcePackageSha256: ZIP_SHA256,
  sourceSha256: T0_SHA256,
  contentTreeSha256: manifestLock.contentTreeSha256,
  runtimeIndexSha256: manifestLock.runtimeIndexSha256,
  manifestLockSha256: sha256Bytes(manifestLockText),
  registrationManifestSha256: sha256Bytes(registrationText),
  fileCount: files.size,
  counts: runtimeIndex.counts,
  sourceTextVerified: Boolean(sourceText),
  legacyStrategyLocks: LEGACY_STRATEGY_LOCKS,
}, null, 2));
