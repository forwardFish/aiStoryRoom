import { resolve } from "node:path";
import { readJson, repoRoot, validateWithSchema, writeJson } from "./lib/contract-utils.mjs";

const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const requirementSet = await readJson(resolve(authoringRoot, "requirements/part-01.requirements.json"));
const resolutionSet = await readJson(resolve(authoringRoot, "source-resolution/part-01.coverage.json"));
const resolutionByRequirement = new Map(resolutionSet.resolutions.map((entry) => [entry.requirementId, entry]));
const rows = [];
const errors = [];

for (const requirement of requirementSet.requirements) {
  const schema = await validateWithSchema("story-capability-requirement-v1", requirement);
  if (!schema.valid) errors.push(`${requirement.requirementId}: requirement schema invalid`);
  const resolution = resolutionByRequirement.get(requirement.requirementId);
  if (!resolution) {
    errors.push(`${requirement.requirementId}: no SourceRequirementResolution`);
    continue;
  }
  const resolutionSchema = await validateWithSchema("source-requirement-resolution-v1", resolution);
  if (!resolutionSchema.valid) errors.push(`${requirement.requirementId}: resolution schema invalid`);
  const selectedCandidates = resolution.candidateScenes.filter((candidate) => candidate.selection === "SELECTED");
  const rowErrors = [];
  if (resolution.reviewerStatus !== "PASS") rowErrors.push("source resolution not independently approved");
  if (selectedCandidates.length === 0) rowErrors.push("no selected source scene");
  if (requirement.coverageStatus === "BLOCKED_MISSING_EVIDENCE") rowErrors.push("coverage remains blocked");
  if (!["SATISFIED_BY_SOURCE", "SATISFIED_BY_ADAPTATION"].includes(requirement.coverageStatus)) rowErrors.push(`non-releasable coverage status ${requirement.coverageStatus}`);
  if (requirement.sourceSceneIds.length === 0) rowErrors.push("no sourceSceneIds");
  if (requirement.sourceClaimIds.length === 0) rowErrors.push("no sourceClaimIds");
  if (requirement.runtimeAssetIds.length === 0) rowErrors.push("no runtimeAssetIds");
  if (requirement.coverageStatus === "SATISFIED_BY_ADAPTATION" && requirement.adaptationDecisionIds.length === 0) rowErrors.push("adaptation coverage lacks approved decision IDs");
  rows.push({
    requirementId: requirement.requirementId,
    sectionIds: requirement.sectionIds,
    candidateCount: resolution.candidateScenes.length,
    selectedCandidateCount: selectedCandidates.length,
    reviewerStatus: resolution.reviewerStatus,
    evidenceStrength: requirement.evidenceStrength,
    coverageStatus: requirement.coverageStatus,
    sourceSceneCount: requirement.sourceSceneIds.length,
    sourceClaimCount: requirement.sourceClaimIds.length,
    mechanismCandidateCount: requirement.mechanismCandidateIds.length,
    adaptationDecisionCount: requirement.adaptationDecisionIds.length,
    runtimeAssetCount: requirement.runtimeAssetIds.length,
    blockers: rowErrors,
    verdict: rowErrors.length === 0 ? "PASS" : "FAIL",
  });
}

const extraResolutions = resolutionSet.resolutions
  .filter((entry) => !requirementSet.requirements.some((requirement) => requirement.requirementId === entry.requirementId))
  .map((entry) => entry.requirementId);
if (extraResolutions.length > 0) errors.push(`extra resolutions: ${extraResolutions.join(", ")}`);

const report = {
  schemaVersion: "sangtian-part-one-requirement-coverage-report-v1",
  requirementCount: requirementSet.requirements.length,
  expectedRequirementCount: 12,
  rows,
  globalErrors: errors,
  passCount: rows.filter((row) => row.verdict === "PASS").length,
  failCount: rows.filter((row) => row.verdict === "FAIL").length,
  verdict: requirementSet.requirements.length === 12 && rows.length === 12 && rows.every((row) => row.verdict === "PASS") && errors.length === 0 ? "PASS" : "FAIL",
};
const outPath = resolve(authoringRoot, "tests/part-01.requirement-coverage-report.json");
await writeJson(outPath, report);
console.log(JSON.stringify({ output: outPath, ...report }, null, 2));
if (report.verdict !== "PASS") process.exitCode = 1;
