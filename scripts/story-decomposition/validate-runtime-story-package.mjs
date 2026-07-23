import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fail(errors, check, detail) {
  errors.push({ check, detail });
}

function safeRepositoryPath(repositoryRoot, relativePath) {
  const normalized = String(relativePath).replaceAll("\\", "/");
  const absolute = path.resolve(repositoryRoot, normalized);
  const root = path.resolve(repositoryRoot);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`source path escapes repository: ${relativePath}`);
  }
  return absolute;
}

export async function validateRuntimeStoryPackageEvidence({ repositoryRoot, worldId = "sangtian" }) {
  const packageRoot = path.resolve(repositoryRoot, "packages", "templates", "config", worldId, "story-package");
  const manifestBytes = await readFile(path.join(packageRoot, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const packageBytes = await readFile(path.join(packageRoot, manifest.storyPackagePath));
  const sourceMapBytes = await readFile(path.join(packageRoot, manifest.sourceMapPath));
  const storyPackage = JSON.parse(packageBytes.toString("utf8"));
  const sourceMap = JSON.parse(sourceMapBytes.toString("utf8"));
  const errors = [];

  const packageHash = sha256(packageBytes);
  const sourceMapHash = sha256(sourceMapBytes);
  if (packageHash !== manifest.storyPackageSha256) fail(errors, "manifest.storyPackageSha256", `${packageHash} != ${manifest.storyPackageSha256}`);
  if (sourceMapHash !== manifest.sourceMapSha256) fail(errors, "manifest.sourceMapSha256", `${sourceMapHash} != ${manifest.sourceMapSha256}`);
  if (storyPackage.sourceMapSha256 !== sourceMapHash) fail(errors, "storyPackage.sourceMapSha256", `${storyPackage.sourceMapSha256} != ${sourceMapHash}`);

  const sourceCache = new Map();
  let sourceReferenceCount = 0;
  for (const entry of sourceMap.entries ?? []) {
    for (const ref of entry.sourceRefs ?? []) {
      sourceReferenceCount += 1;
      let source = sourceCache.get(ref.sourcePath);
      if (!source) {
        const absolutePath = safeRepositoryPath(repositoryRoot, ref.sourcePath);
        const bytes = await readFile(absolutePath);
        const text = bytes.toString("utf8");
        source = {
          hash: sha256(bytes),
          lineCount: text.split(/\r\n|\n|\r/).length
        };
        sourceCache.set(ref.sourcePath, source);
      }
      if (source.hash !== String(ref.sourceSha256).toLowerCase()) {
        fail(errors, `${entry.sourceId}.sourceSha256`, `${source.hash} != ${ref.sourceSha256}`);
      }
      if (!Number.isInteger(ref.lineStart) || !Number.isInteger(ref.lineEnd) || ref.lineStart < 1 || ref.lineEnd < ref.lineStart || ref.lineEnd > source.lineCount) {
        fail(errors, `${entry.sourceId}.lineRange`, `${ref.lineStart}-${ref.lineEnd} outside 1-${source.lineCount}`);
      }
    }
  }

  const sourceIds = new Set((sourceMap.entries ?? []).map((entry) => entry.sourceId));
  const referencedIds = new Set();
  const collect = (ids = []) => ids.forEach((id) => referencedIds.add(id));
  (storyPackage.cards ?? []).forEach((item) => collect(item.sourceIds));
  (storyPackage.mainlineQuestions ?? []).forEach((item) => collect(item.sourceIds));
  (storyPackage.latentTruths ?? []).forEach((item) => collect(item.sourceIds));
  (storyPackage.pressures ?? []).forEach((item) => collect(item.sourceIds));
  (storyPackage.floorObligations ?? []).forEach((item) => {
    collect(item.sourceIds);
    collect(item.directedBeatTemplate?.allowedSourceIds);
  });
  for (const sourceId of referencedIds) {
    if (!sourceIds.has(sourceId)) fail(errors, "runtimeSourceBinding", `unknown sourceId ${sourceId}`);
  }

  const adaptationDecisionIds = new Set((sourceMap.adaptationDecisions ?? []).map((item) => item.adaptationDecisionId));
  for (const entry of sourceMap.entries ?? []) {
    const requiresDecision = entry.origin === "adapted" || entry.origin === "invented_for_game";
    if (requiresDecision && !adaptationDecisionIds.has(entry.adaptationDecisionId)) {
      fail(errors, `${entry.sourceId}.adaptationDecisionId`, `missing or unknown ${entry.adaptationDecisionId}`);
    }
  }

  return {
    schemaVersion: "runtime_story_package_evidence_validation_v1",
    status: errors.length ? "FAIL" : "PASS",
    worldId,
    packageVersion: manifest.packageVersion,
    packageHash,
    sourceMapHash,
    coverage: {
      runtimeNodes: storyPackage.nodes?.length ?? 0,
      runtimeCards: storyPackage.cards?.length ?? 0,
      sourceMapEntries: sourceMap.entries?.length ?? 0,
      adaptationDecisions: sourceMap.adaptationDecisions?.length ?? 0,
      sourceReferences: sourceReferenceCount,
      sourceFiles: sourceCache.size
    },
    errors
  };
}

async function runCli() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const report = await validateRuntimeStoryPackageEvidence({ repositoryRoot });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
