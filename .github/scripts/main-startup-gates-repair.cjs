const { createHash } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const KNOWN_TARGET_TEST =
  "apps/api/src/pressure-chapter/seat-control-persistence/seat-control-persistence.spec.ts";
const EXPECTED_KNOWN_TARGET_SHA256 =
  "eb8c8a8496d5b2a12df815831cf3b3a2f0cb02c9fe7ea8853283708eb12bb5da";
const OLD_KNOWN_TARGET_SHA256 =
  "cbf471ed910510731987b8046919d44e281da2a3648de7761076014fe303db7a";
const STALE_B0_TARGET = "packages/shared/tests/pressure-chapter-b0.spec.ts";
const OLD_STALE_B0_SHA256 =
  "816e1bb4f7a69b707ebc31eae16bab4bd76320b0c6dc9fd6ff8d6e690611fa67";
const CURRENT_B0_TARGET =
  "apps/api/src/pressure-chapter/chapter-settlement/chapter-settlement.orchestrator.spec.ts";
const OLD_SOURCE_MANIFEST_SHA256 =
  "d3764c96d04ca2938b34d1413c04a04b19e2afb9ce2241a002d06da1a89980c1";
const SOURCE_MANIFEST =
  "packages/templates/config/sangtian/pressure-chapter-v1/release/source-regression-manifest.json";
const RELEASE_MANIFEST =
  "packages/templates/config/sangtian/pressure-chapter-v1/release/release-manifest.json";
const REPO_ROOT = process.cwd();

function rawSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_NUMBER");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") {
    throw new Error(`UNSUPPORTED:${typeof value}`);
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
  return `{${entries.join(",")}}`;
}

function canonicalSha256(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

const knownActual = rawSha256(KNOWN_TARGET_TEST);
if (knownActual !== EXPECTED_KNOWN_TARGET_SHA256) {
  throw new Error(`KNOWN_TARGET_SHA_DRIFT:${knownActual}`);
}
if (existsSync(STALE_B0_TARGET)) {
  throw new Error(`EXPECTED_STALE_B0_TARGET_TO_BE_ABSENT:${STALE_B0_TARGET}`);
}
if (!existsSync(CURRENT_B0_TARGET)) {
  throw new Error(`CURRENT_B0_TARGET_MISSING:${CURRENT_B0_TARGET}`);
}
const currentB0Source = readFileSync(CURRENT_B0_TARGET, "utf8");
for (const evidence of [
  "ChapterSettlementOrchestrator",
  "PC-W6 commits canonical settlement authority once",
  "same key/fingerprint replays durable commit",
  "serializable failure leaves zero half-write",
  "crash after commit recovers receipt",
]) {
  if (!currentB0Source.includes(evidence)) {
    throw new Error(`CURRENT_B0_TARGET_SEMANTIC_DRIFT:${evidence}`);
  }
}
const currentB0Actual = rawSha256(CURRENT_B0_TARGET);

const source = JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8"));
if (!Array.isArray(source.entries) || source.entries.length === 0) {
  throw new Error("SOURCE_REGRESSION_ENTRIES_REQUIRED");
}
const targetRefs = source.entries.flatMap((entry) => {
  if (!Array.isArray(entry.targetTests) || entry.targetTests.length === 0) {
    throw new Error(`TARGET_TESTS_REQUIRED:${entry.sourceCommitSha ?? "unknown"}`);
  }
  return entry.targetTests;
});

const knownRefs = targetRefs.filter((entry) => entry.path === KNOWN_TARGET_TEST);
if (knownRefs.length !== 1) {
  throw new Error(`KNOWN_TARGET_REFERENCE_COUNT:${knownRefs.length}`);
}
if (knownRefs[0].sha256RawBytes !== OLD_KNOWN_TARGET_SHA256) {
  throw new Error(`UNEXPECTED_OLD_KNOWN_TARGET_SHA:${knownRefs[0].sha256RawBytes}`);
}
knownRefs[0].sha256RawBytes = knownActual;

const staleB0Refs = targetRefs.filter((entry) => entry.path === STALE_B0_TARGET);
if (staleB0Refs.length !== 1) {
  throw new Error(`STALE_B0_REFERENCE_COUNT:${staleB0Refs.length}`);
}
if (staleB0Refs[0].sha256RawBytes !== OLD_STALE_B0_SHA256) {
  throw new Error(`UNEXPECTED_OLD_STALE_B0_SHA:${staleB0Refs[0].sha256RawBytes}`);
}
if (targetRefs.some((entry) => entry.path === CURRENT_B0_TARGET)) {
  throw new Error(`CURRENT_B0_TARGET_ALREADY_BOUND:${CURRENT_B0_TARGET}`);
}
staleB0Refs[0].path = CURRENT_B0_TARGET;
staleB0Refs[0].sha256RawBytes = currentB0Actual;

const remainingErrors = [];
for (const target of targetRefs) {
  if (typeof target.path !== "string" || !target.path.trim()) {
    remainingErrors.push("TARGET_PATH_REQUIRED");
    continue;
  }
  const absolute = path.resolve(REPO_ROOT, target.path);
  const relative = path.relative(REPO_ROOT, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    remainingErrors.push(`TARGET_PATH_ESCAPE:${target.path}`);
    continue;
  }
  if (!existsSync(absolute)) {
    remainingErrors.push(`TARGET_FILE_MISSING:${target.path}`);
    continue;
  }
  const actual = rawSha256(absolute);
  if (target.sha256RawBytes !== actual) {
    remainingErrors.push(
      `TARGET_HASH_DRIFT:${target.path}:expected=${target.sha256RawBytes}:actual=${actual}`,
    );
  }
}
if (remainingErrors.length) {
  throw new Error(`UNEXPECTED_REMAINING_SOURCE_TARGET_DRIFT\n${remainingErrors.join("\n")}`);
}
writeFileSync(SOURCE_MANIFEST, `${JSON.stringify(source, null, 2)}\n`);

const sourceActual = canonicalSha256(source);
const release = JSON.parse(readFileSync(RELEASE_MANIFEST, "utf8"));
const sourceArtifacts = release.artifacts.filter(
  (artifact) => artifact.artifactId === "source_regression_manifest",
);
if (sourceArtifacts.length !== 1) {
  throw new Error(`SOURCE_ARTIFACT_COUNT:${sourceArtifacts.length}`);
}
if (sourceArtifacts[0].sha256 !== OLD_SOURCE_MANIFEST_SHA256) {
  throw new Error(`UNEXPECTED_OLD_SOURCE_SHA:${sourceArtifacts[0].sha256}`);
}
sourceArtifacts[0].sha256 = sourceActual;
writeFileSync(RELEASE_MANIFEST, `${JSON.stringify(release, null, 2)}\n`);

console.log(`KNOWN_TARGET_SHA256=${knownActual}`);
console.log(`B0_TARGET_PATH=${CURRENT_B0_TARGET}`);
console.log(`B0_TARGET_SHA256=${currentB0Actual}`);
console.log(`TARGET_REFERENCE_COUNT=${targetRefs.length}`);
console.log(`SOURCE_REGRESSION_MANIFEST_SHA256=${sourceActual}`);
