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

const LEGACY_V2_TARGET = "apps/web/tests/continuous-story-v2.test.mjs";
const OLD_LEGACY_V2_SHA256 =
  "5cbd68220aec6f3b10e8f49a8cd38a6c45339b42f3ba4c323c6b06866657b281";
const EXPECTED_LEGACY_V2_SHA256 =
  "d29aedd9bf8bc6af27e7f2239a6f39beef712cf742c84367b5a6dfef4a4aaf5e";

const STALE_ENDGAME_TARGET =
  "apps/web/tests/endgame-result-registry-v1.pressure-chapter.browser.test.mjs";
const OLD_STALE_ENDGAME_SHA256 =
  "9db76d774cdc9da2b4e629e8bdad329804d1c53753bbd2cf264c4b97f22b5617";
const CURRENT_ENDGAME_TARGET =
  "apps/web/tests/pressure-chapter-game-v1.pressure-chapter.browser.test.mjs";

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

function requireFileWithEvidence(filePath, evidence) {
  if (!existsSync(filePath)) throw new Error(`CURRENT_TARGET_MISSING:${filePath}`);
  const source = readFileSync(filePath, "utf8");
  for (const marker of evidence) {
    if (!source.includes(marker)) {
      throw new Error(`CURRENT_TARGET_SEMANTIC_DRIFT:${filePath}:${marker}`);
    }
  }
  return rawSha256(filePath);
}

function requireSingleTarget(targetRefs, targetPath, expectedOldSha) {
  const refs = targetRefs.filter((entry) => entry.path === targetPath);
  if (refs.length !== 1) {
    throw new Error(`TARGET_REFERENCE_COUNT:${targetPath}:${refs.length}`);
  }
  if (refs[0].sha256RawBytes !== expectedOldSha) {
    throw new Error(
      `UNEXPECTED_OLD_TARGET_SHA:${targetPath}:${refs[0].sha256RawBytes}`,
    );
  }
  return refs[0];
}

const knownActual = rawSha256(KNOWN_TARGET_TEST);
if (knownActual !== EXPECTED_KNOWN_TARGET_SHA256) {
  throw new Error(`KNOWN_TARGET_SHA_DRIFT:${knownActual}`);
}

if (existsSync(STALE_B0_TARGET)) {
  throw new Error(`EXPECTED_STALE_TARGET_TO_BE_ABSENT:${STALE_B0_TARGET}`);
}
const currentB0Actual = requireFileWithEvidence(CURRENT_B0_TARGET, [
  "ChapterSettlementOrchestrator",
  "PC-W6 commits canonical settlement authority once",
  "same key/fingerprint replays durable commit",
  "serializable failure leaves zero half-write",
  "crash after commit recovers receipt",
]);

const legacyV2Actual = requireFileWithEvidence(LEGACY_V2_TARGET, [
  "ContinuousStoryV2LegacyStorage",
  "reading a resolving Solo projection never triggers generation or retry",
  "a missing opening turn is not adapted as a completed story",
  "roomSessionForView",
  "resultUrl: null",
]);
if (legacyV2Actual !== EXPECTED_LEGACY_V2_SHA256) {
  throw new Error(`LEGACY_V2_TARGET_SHA_DRIFT:${legacyV2Actual}`);
}

if (existsSync(STALE_ENDGAME_TARGET)) {
  throw new Error(`EXPECTED_STALE_TARGET_TO_BE_ABSENT:${STALE_ENDGAME_TARGET}`);
}
const currentEndgameActual = requireFileWithEvidence(CURRENT_ENDGAME_TARGET, [
  "completed Pressure run uses the existing result route without mounting a parallel page",
  "pressure_chapter_game_terminal_v1",
  "resultUrl: `/game/result?runId=${runId}`",
  "terminal must not mount live storage",
]);

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

requireSingleTarget(
  targetRefs,
  KNOWN_TARGET_TEST,
  OLD_KNOWN_TARGET_SHA256,
).sha256RawBytes = knownActual;

const staleB0Ref = requireSingleTarget(
  targetRefs,
  STALE_B0_TARGET,
  OLD_STALE_B0_SHA256,
);
if (targetRefs.some((entry) => entry.path === CURRENT_B0_TARGET)) {
  throw new Error(`CURRENT_TARGET_ALREADY_BOUND:${CURRENT_B0_TARGET}`);
}
staleB0Ref.path = CURRENT_B0_TARGET;
staleB0Ref.sha256RawBytes = currentB0Actual;

requireSingleTarget(
  targetRefs,
  LEGACY_V2_TARGET,
  OLD_LEGACY_V2_SHA256,
).sha256RawBytes = legacyV2Actual;

const staleEndgameRef = requireSingleTarget(
  targetRefs,
  STALE_ENDGAME_TARGET,
  OLD_STALE_ENDGAME_SHA256,
);
if (targetRefs.some((entry) => entry.path === CURRENT_ENDGAME_TARGET)) {
  throw new Error(`CURRENT_TARGET_ALREADY_BOUND:${CURRENT_ENDGAME_TARGET}`);
}
staleEndgameRef.path = CURRENT_ENDGAME_TARGET;
staleEndgameRef.sha256RawBytes = currentEndgameActual;

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
console.log(`LEGACY_V2_TARGET_SHA256=${legacyV2Actual}`);
console.log(`ENDGAME_TARGET_PATH=${CURRENT_ENDGAME_TARGET}`);
console.log(`ENDGAME_TARGET_SHA256=${currentEndgameActual}`);
console.log(`TARGET_REFERENCE_COUNT=${targetRefs.length}`);
console.log(`SOURCE_REGRESSION_MANIFEST_SHA256=${sourceActual}`);
