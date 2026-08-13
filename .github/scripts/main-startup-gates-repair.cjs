const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");

const TARGET_TEST =
  "apps/api/src/pressure-chapter/seat-control-persistence/seat-control-persistence.spec.ts";
const EXPECTED_TARGET_SHA256 =
  "eb8c8a8496d5b2a12df815831cf3b3a2f0cb02c9fe7ea8853283708eb12bb5da";
const OLD_TARGET_SHA256 =
  "cbf471ed910510731987b8046919d44e281da2a3648de7761076014fe303db7a";
const OLD_SOURCE_MANIFEST_SHA256 =
  "d3764c96d04ca2938b34d1413c04a04b19e2afb9ce2241a002d06da1a89980c1";
const SOURCE_MANIFEST =
  "packages/templates/config/sangtian/pressure-chapter-v1/release/source-regression-manifest.json";
const RELEASE_MANIFEST =
  "packages/templates/config/sangtian/pressure-chapter-v1/release/release-manifest.json";

function rawSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

const targetActual = rawSha256(TARGET_TEST);
if (targetActual !== EXPECTED_TARGET_SHA256) {
  throw new Error(`TARGET_SHA_DRIFT:${targetActual}`);
}

const source = JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8"));
const targetRefs = source.entries
  .flatMap((entry) => entry.targetTests ?? [])
  .filter((entry) => entry.path === TARGET_TEST);
if (targetRefs.length !== 1) {
  throw new Error(`TARGET_REFERENCE_COUNT:${targetRefs.length}`);
}
if (targetRefs[0].sha256RawBytes !== OLD_TARGET_SHA256) {
  throw new Error(`UNEXPECTED_OLD_TARGET_SHA:${targetRefs[0].sha256RawBytes}`);
}
targetRefs[0].sha256RawBytes = targetActual;
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

console.log(`TARGET_SHA256=${targetActual}`);
console.log(`SOURCE_REGRESSION_MANIFEST_SHA256=${sourceActual}`);
