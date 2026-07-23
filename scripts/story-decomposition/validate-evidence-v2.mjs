import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  readJson,
  repoRoot,
  sha256Bytes,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const DEFAULT_ROOT = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived/evidence-v2/candidates/sangtian-part-one-evidence-seed-v1/track-a-evidence");
const candidateRoot = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT;
const derivedRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived");
const sourceManifest = await readJson(resolve(derivedRoot, "source-manifest.json"));

async function listJsonFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonFiles(child));
    else if (entry.name.endsWith(".json")) files.push(child);
  }
  return files.sort();
}

function readJsonLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

const paragraphCache = new Map();
async function paragraphsFor(chapterId) {
  if (!paragraphCache.has(chapterId)) {
    paragraphCache.set(chapterId, readJsonLines(await readFile(resolve(derivedRoot, `paragraphs/${chapterId}.jsonl`), "utf8")));
  }
  return paragraphCache.get(chapterId);
}

async function verifySourceRef(sourceRef, label) {
  const errors = [];
  if (sourceRef.sourceSha256.toUpperCase() !== sourceManifest.sourceSha256.toUpperCase()) errors.push(`${label}: source SHA does not match T0 manifest`);
  const paragraphs = await paragraphsFor(sourceRef.chapterId);
  const startIndex = paragraphs.findIndex((entry) => entry.paragraphId === sourceRef.paragraphStartId);
  const endIndex = paragraphs.findIndex((entry) => entry.paragraphId === sourceRef.paragraphEndId);
  if (startIndex < 0 || endIndex < startIndex) return [...errors, `${label}: paragraph range cannot be resolved`];
  const span = paragraphs.slice(startIndex, endIndex + 1).filter((entry) => entry.kind === "content");
  if (span.length === 0) return [...errors, `${label}: source span has no content paragraphs`];
  if (span[0].lineStart !== sourceRef.lineStart || span.at(-1).lineEnd !== sourceRef.lineEnd) errors.push(`${label}: line range does not match paragraph range`);
  const spanHash = sha256Bytes(Buffer.from(span.map((entry) => entry.text).join("\n\n"), "utf8"));
  if (spanHash !== sourceRef.textSpanSha256.toUpperCase()) errors.push(`${label}: textSpanSha256 does not match current source paragraphs`);
  return errors;
}

const files = await listJsonFiles(candidateRoot);
const sceneFiles = files.filter((path) => path.includes(`${resolve(candidateRoot, "scenes")}`) && path.endsWith(".scene.json"));
const claimFiles = files.filter((path) => path.includes(`${resolve(candidateRoot, "claims")}`) && path.endsWith(".claims.json"));
const scenes = await Promise.all(sceneFiles.map((path) => readJson(path)));
const claimSets = await Promise.all(claimFiles.map((path) => readJson(path)));
const claims = claimSets.flatMap((set) => set.claims ?? []);
const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
const errors = [];
const ownedParagraphs = new Map();

for (const scene of scenes) {
  const schema = await validateWithSchema("scene-evidence-v2", scene);
  if (!schema.valid) errors.push(...schema.errors.map((entry) => `${scene.artifactId}: schema ${entry.instancePath || "/"} ${entry.message}`));
  for (const [index, sourceRef] of scene.sourceRefs.entries()) errors.push(...await verifySourceRef(sourceRef, `${scene.artifactId}.sourceRefs[${index}]`));
  for (const paragraph of scene.paragraphDisposition) {
    if (paragraph.disposition !== "OWNED") continue;
    const previous = ownedParagraphs.get(paragraph.paragraphId);
    if (previous) errors.push(`${paragraph.paragraphId}: duplicate OWNED disposition in ${previous} and ${scene.sceneId}`);
    else ownedParagraphs.set(paragraph.paragraphId, scene.sceneId);
  }
  for (const claimId of scene.claimIds) {
    const claim = claimById.get(claimId);
    if (!claim) errors.push(`${scene.sceneId}: unresolved claimId ${claimId}`);
    else if (claim.sceneId !== scene.sceneId) errors.push(`${scene.sceneId}: claim ${claimId} belongs to ${claim.sceneId}`);
  }
  const sourceParagraphs = await paragraphsFor(scene.chapterId);
  for (const ref of scene.sourceRefs) {
    const startIndex = sourceParagraphs.findIndex((entry) => entry.paragraphId === ref.paragraphStartId);
    const endIndex = sourceParagraphs.findIndex((entry) => entry.paragraphId === ref.paragraphEndId);
    const expectedIds = sourceParagraphs.slice(startIndex, endIndex + 1).filter((entry) => entry.kind === "content").map((entry) => entry.paragraphId);
    const actualIds = scene.paragraphDisposition.filter((entry) => entry.disposition === "OWNED").map((entry) => entry.paragraphId);
    for (const expectedId of expectedIds) if (!actualIds.includes(expectedId)) errors.push(`${scene.sceneId}: selected paragraph ${expectedId} has no OWNED disposition`);
    for (const actualId of actualIds) if (!expectedIds.includes(actualId)) errors.push(`${scene.sceneId}: OWNED paragraph ${actualId} is outside the scene source span`);
  }
}

for (const claim of claims) {
  const schema = await validateWithSchema("evidence-claim-v2", claim);
  if (!schema.valid) errors.push(...schema.errors.map((entry) => `${claim.claimId}: schema ${entry.instancePath || "/"} ${entry.message}`));
  for (const [index, sourceRef] of claim.sourceRefs.entries()) errors.push(...await verifySourceRef(sourceRef, `${claim.claimId}.sourceRefs[${index}]`));
  const subjective = !["objective_event", "objective_state"].includes(claim.claimType);
  if (subjective && claim.mustNotBeTreatedAsObjectiveFact !== true) errors.push(`${claim.claimId}: non-objective claim can be upgraded to objective fact`);
  if (["character_statement", "character_belief", "character_intention"].includes(claim.claimType) && !claim.speakerRef) errors.push(`${claim.claimId}: character claim has no speakerRef`);
  for (const knowledge of claim.knownBy) {
    if (!knowledge.viaEventOrClaimId && knowledge.acquiredAtSceneId !== claim.sceneId) errors.push(`${claim.claimId}: ${knowledge.characterRef} has no acquisition path for earlier knowledge`);
  }
}

const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
const claimIds = new Set(claims.map((claim) => claim.claimId));
if (sceneIds.size !== scenes.length) errors.push("Duplicate sceneId detected");
if (claimIds.size !== claims.length) errors.push("Duplicate claimId detected");
for (const claim of claims) if (!sceneIds.has(claim.sceneId)) errors.push(`${claim.claimId}: unresolved sceneId ${claim.sceneId}`);

const report = {
  schemaVersion: "sangtian-evidence-v2-validation-report-v1",
  candidateRoot,
  sourceSha256: sourceManifest.sourceSha256,
  sceneCount: scenes.length,
  claimCount: claims.length,
  ownedParagraphCount: ownedParagraphs.size,
  sceneFileCount: sceneFiles.length,
  claimFileCount: claimFiles.length,
  errors,
  verdict: scenes.length > 0 && claims.length > 0 && errors.length === 0 ? "PASS" : "FAIL",
};
await writeJson(resolve(dirname(candidateRoot), "validation-report.json"), report);
console.log(JSON.stringify(report, null, 2));
if (report.verdict !== "PASS") process.exitCode = 1;
