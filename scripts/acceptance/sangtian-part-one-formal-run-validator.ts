import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeImmutableHash,
  readJson,
  sha256Bytes,
  validateWithSchema
} from "../story-decomposition/lib/contract-utils.mjs";
import { buildCheckpointPlayerGate } from "./sangtian-part-one-player-review-validator.ts";

type JsonRecord = Record<string, any>;
type Artifact = { path: string; value: JsonRecord; hash: string };

export const FORMAL_RUN_VALIDATOR_VERSION = "sangtian-formal-run-v1.0.0";
export const ACCEPTANCE_CHECKPOINTS = [
  "G00", "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10",
  "T11", "T12", "T13", "T14", "T15", "T16", "T17", "T18", "T19", "T20"
] as const;

const ROOT_ARTIFACTS = [
  ["run-manifest.json", "formal-run-manifest-v1"],
  ["blind-session-manifest.json", "blind-session-manifest-v1"],
  ["auditor-session-manifest.json", "auditor-session-manifest-v1"],
  ["formal-run-integrity.json", "formal-run-integrity-v1"],
  ["test-integrity.json", "test-integrity-v1"],
  ["context-isolation-report.json", "context-isolation-report-v1"],
  ["codex-final-player-report.json", "codex-final-player-report-v1"],
  ["final-hidden-audit.json", "final-hidden-audit-v1"],
  ["formal-use-acceptance-report.json", "formal-use-acceptance-report-v1"],
  ["artifact-hashes.json", "artifact-hash-manifest-v1"]
] as const;

const CHECKPOINT_ARTIFACTS = [
  ["player-visible-view.json", "player-visible-view-v1"],
  ["codex-player-review.json", "codex-player-review-v1"],
  ["checkpoint-player-gate.json", "checkpoint-player-gate-v1"],
  ["machine-integrity-report.json", "checkpoint-machine-integrity-report-v1"],
  ["decision-contrast-report.json", "decision-contrast-report-v1"],
  ["test-integrity-slice.json", "checkpoint-test-integrity-slice-v1"],
  ["checkpoint-acceptance-gate.json", "checkpoint-acceptance-gate-v1"]
] as const;

const CHOICE_ARTIFACTS = [
  ["choice-commit.json", "choice-commit-v1"],
  ["choice-submission-receipt.json", "choice-submission-receipt-v1"],
  ["choice-binding-proof.json", "choice-binding-proof-v1"]
] as const;

const TURN_RAW_FILES = [
  "state-before.json", "player-action.json", "deterministic-resolution.json", "selected-assets.json",
  "context-report.json",
  "narrator-prompt-record.json", "narrator-raw-output.txt",
  "decision-prompt-record.json", "decision-raw-output.json",
  "validated-output.json",
  "committed-events.jsonl", "state-after.json", "next-context-report.json", "turn-progress-report.json"
];

function checkpointDirectory(runDir: string, checkpoint: string) {
  return resolve(runDir, checkpoint === "G00" ? "G00" : `turn-${checkpoint.slice(1)}`);
}

function parseTime(value: unknown, label: string, errors: string[]) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) errors.push(`${label} is not a valid timestamp`);
  return timestamp;
}

function requireOrder(entries: Array<[string, unknown]>, errors: string[]) {
  const values = entries.map(([label, value]) => [label, parseTime(value, label, errors)] as const);
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index - 1][1] < values[index][1])) {
      errors.push(`${values[index - 1][0]} must be earlier than ${values[index][0]}`);
    }
  }
}

async function loadArtifact(path: string, schemaName: string, errors: string[]): Promise<Artifact | null> {
  if (!existsSync(path)) {
    errors.push(`missing required artifact: ${path}`);
    return null;
  }
  try {
    const value = await readJson(path) as JsonRecord;
    const schema = await validateWithSchema(schemaName, value);
    for (const issue of schema.errors) errors.push(`${path} schema ${issue.instancePath || "/"} ${issue.message}`);
    if (typeof value.immutableHash === "string" && computeImmutableHash(value) !== value.immutableHash.toUpperCase()) {
      errors.push(`${path} immutableHash does not match canonical content`);
    }
    if (typeof value.viewHash === "string" && schemaName === "player-visible-view-v1" && computeImmutableHash(value, ["viewHash"]) !== value.viewHash.toUpperCase()) {
      errors.push(`${path} viewHash does not match canonical player-visible content`);
    }
    return { path, value, hash: typeof value.immutableHash === "string" ? value.immutableHash.toUpperCase() : sha256Bytes(await readFile(path)) };
  } catch (error) {
    errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function expectEqual(actual: unknown, expected: unknown, label: string, errors: string[]) {
  if (actual !== expected) errors.push(`${label}: expected ${String(expected)}, received ${String(actual)}`);
}

function verifyScreenshotRefs(runDir: string, checkpointDir: string, view: JsonRecord, errors: string[]) {
  for (const ref of view.screenshotRefs || []) {
    const candidates = [resolve(runDir, ref), resolve(checkpointDir, ref), resolve(checkpointDir, basename(ref))];
    if (!candidates.some(existsSync)) errors.push(`${view.checkpoint} screenshot evidence does not exist: ${ref}`);
  }
}

export async function validateFormalRunDirectory(runDirectory: string) {
  const runDir = resolve(runDirectory);
  const errors: string[] = [];
  const root = new Map<string, Artifact>();
  const checkpoints = new Map<string, Map<string, Artifact>>();

  for (const [file, schema] of ROOT_ARTIFACTS) {
    const artifact = await loadArtifact(resolve(runDir, file), schema, errors);
    if (artifact) root.set(file, artifact);
  }
  if (!existsSync(resolve(runDir, "access-log.jsonl"))) errors.push("missing required artifact: access-log.jsonl");
  if (!existsSync(resolve(runDir, "initial-state.json"))) errors.push("missing required artifact: initial-state.json");

  const manifest = root.get("run-manifest.json")?.value;
  const runId = String(manifest?.runId || "");
  if (manifest) {
    expectEqual(manifest.expectedAcceptanceCheckpointCount, 21, "run manifest checkpoint count", errors);
    expectEqual(manifest.expectedPlayerChoiceCount, 20, "run manifest choice count", errors);
    expectEqual(manifest.expectedNarrationProviderCallCount, 20, "run manifest narration provider call count", errors);
    expectEqual(manifest.expectedDecisionProviderCallCount, 20, "run manifest decision provider call count", errors);
    expectEqual(manifest.expectedProviderCallCountTotal, 40, "run manifest total provider call count", errors);
    expectEqual(manifest.provider, "deepseek", "run manifest provider", errors);
    if (manifest.blindContextId === manifest.auditorContextId) errors.push("blindContextId must differ from auditorContextId");
  }

  for (const [index, checkpoint] of ACCEPTANCE_CHECKPOINTS.entries()) {
    const dir = checkpointDirectory(runDir, checkpoint);
    const artifacts = new Map<string, Artifact>();
    checkpoints.set(checkpoint, artifacts);
    if (!existsSync(dir)) {
      errors.push(`missing checkpoint directory: ${dir}`);
      continue;
    }
    for (const [file, schema] of CHECKPOINT_ARTIFACTS) {
      const artifact = await loadArtifact(resolve(dir, file), schema, errors);
      if (artifact) artifacts.set(file, artifact);
    }
    if (checkpoint !== "T20") {
      for (const [file, schema] of CHOICE_ARTIFACTS) {
        const artifact = await loadArtifact(resolve(dir, file), schema, errors);
        if (artifact) artifacts.set(file, artifact);
      }
    }
    if (checkpoint === "G00") {
      const opening = await loadArtifact(resolve(dir, "opening-technical-audit.json"), "opening-technical-audit-v1", errors);
      if (opening) artifacts.set("opening-technical-audit.json", opening);
      if (!["visible-ui-G00.png", "visible-ui.png"].some((file) => existsSync(resolve(dir, file)))) {
        errors.push("G00 must contain its actually observed visible UI screenshot");
      }
    } else {
      const hidden = await loadArtifact(resolve(dir, "hidden-adjudication.json"), "hidden-adjudication-v1", errors);
      if (hidden) artifacts.set("hidden-adjudication.json", hidden);
      const progress = await loadArtifact(resolve(dir, "turn-progress-report.json"), "turn-progress-report-v1", errors);
      if (progress) artifacts.set("turn-progress-report.json", progress);
      for (const file of TURN_RAW_FILES) {
        const path = resolve(dir, file);
        if (!existsSync(path)) errors.push(`${checkpoint} missing turn evidence: ${file}`);
      }
      if (!existsSync(resolve(dir, "visible-ui.png"))) errors.push(`${checkpoint} must contain its actually observed visible UI screenshot`);
    }

    const viewArtifact = artifacts.get("player-visible-view.json");
    const reviewArtifact = artifacts.get("codex-player-review.json");
    const playerGateArtifact = artifacts.get("checkpoint-player-gate.json");
    const machineArtifact = artifacts.get("machine-integrity-report.json");
    const contrastArtifact = artifacts.get("decision-contrast-report.json");
    const sliceArtifact = artifacts.get("test-integrity-slice.json");
    const acceptanceArtifact = artifacts.get("checkpoint-acceptance-gate.json");
    for (const artifact of artifacts.values()) {
      expectEqual(artifact.value.runId, runId, `${checkpoint} ${basename(artifact.path)} runId`, errors);
      if (artifact.value.checkpoint !== undefined) expectEqual(artifact.value.checkpoint, checkpoint, `${checkpoint} ${basename(artifact.path)} checkpoint`, errors);
    }
    if (viewArtifact) {
      verifyScreenshotRefs(runDir, dir, viewArtifact.value, errors);
      expectEqual(viewArtifact.value.displayDecisions?.length, 2, `${checkpoint} visible decision count`, errors);
    }
    if (reviewArtifact) expectEqual(reviewArtifact.value.contextId, manifest?.blindContextId, `${checkpoint} blind player context`, errors);
    if (viewArtifact && reviewArtifact && playerGateArtifact) {
      const recomputed = await buildCheckpointPlayerGate(viewArtifact.value, reviewArtifact.value);
      expectEqual(recomputed.gate.computedVerdict, "PASS", `${checkpoint} recomputed player verdict`, errors);
      expectEqual(playerGateArtifact.value.immutableHash, recomputed.gate.immutableHash, `${checkpoint} player gate reproducibility`, errors);
    }
    if (machineArtifact) expectEqual(machineArtifact.value.computedVerdict, "PASS", `${checkpoint} machine integrity`, errors);
    if (contrastArtifact) expectEqual(contrastArtifact.value.allPairsPass, true, `${checkpoint} decision contrast`, errors);
    if (sliceArtifact) {
      expectEqual(sliceArtifact.value.computedVerdict, "PASS", `${checkpoint} test integrity slice`, errors);
      expectEqual(sliceArtifact.value.providerCallCountTotal, checkpoint === "G00" ? 0 : 2, `${checkpoint} total provider call count`, errors);
      expectEqual(sliceArtifact.value.narrationProviderCallCount, checkpoint === "G00" ? 0 : 1, `${checkpoint} narration provider call count`, errors);
      expectEqual(sliceArtifact.value.decisionProviderCallCount, checkpoint === "G00" ? 0 : 1, `${checkpoint} decision provider call count`, errors);
    }
    const adjudication = checkpoint === "G00" ? artifacts.get("opening-technical-audit.json") : artifacts.get("hidden-adjudication.json");
    if (adjudication) expectEqual(adjudication.value.computedVerdict, "PASS", `${checkpoint} hidden adjudication`, errors);
    if (checkpoint !== "G00") {
      const progress = artifacts.get("turn-progress-report.json")?.value;
      expectEqual(progress?.turnNumber, index, `${checkpoint} progress turn number`, errors);
      expectEqual(progress?.hardValidationStatus, "PASS", `${checkpoint} progress hard validation`, errors);
      if (progress?.strength === "FAIL") errors.push(`${checkpoint} progress strength is FAIL`);
      if (!progress?.materialChanges?.length || !progress?.mainlineContributions?.length) errors.push(`${checkpoint} lacks material story progress`);
    }

    if (checkpoint !== "T20") {
      const commit = artifacts.get("choice-commit.json")?.value;
      const receipt = artifacts.get("choice-submission-receipt.json")?.value;
      const proof = artifacts.get("choice-binding-proof.json")?.value;
      if (commit) {
        expectEqual(commit.blindContextId, manifest?.blindContextId, `${checkpoint} choice blind context`, errors);
        expectEqual(commit.actionOrdinal, index + 1, `${checkpoint} action ordinal`, errors);
        expectEqual(commit.playerReviewHash, reviewArtifact?.value.immutableHash, `${checkpoint} choice review binding`, errors);
        expectEqual(commit.visibleViewHash, viewArtifact?.value.viewHash, `${checkpoint} choice view binding`, errors);
        const chosen = viewArtifact?.value.displayDecisions?.find((item: JsonRecord) => item.visibleOrdinal === commit.chosenVisibleOrdinal);
        if (!chosen && commit.chosenVisibleOrdinal !== null) errors.push(`${checkpoint} chosen visible ordinal does not exist`);
        if (chosen && ![chosen.title, chosen.actionText].includes(commit.chosenActionQuote)) errors.push(`${checkpoint} chosen action quote is not visible in the UI`);
      }
      if (receipt) {
        expectEqual(receipt.choiceCommitHash, artifacts.get("choice-commit.json")?.value.immutableHash, `${checkpoint} receipt commit binding`, errors);
        expectEqual(receipt.submittedThroughVisibleUi, true, `${checkpoint} visible UI submission`, errors);
      }
      if (proof) {
        expectEqual(proof.actionOrdinal, index + 1, `${checkpoint} binding action ordinal`, errors);
        expectEqual(proof.nextTurnCheckpoint, ACCEPTANCE_CHECKPOINTS[index + 1], `${checkpoint} binding next checkpoint`, errors);
        expectEqual(proof.sameIntent, true, `${checkpoint} committed/submitted intent equality`, errors);
      }
      if (reviewArtifact && commit && adjudication && receipt && proof && sliceArtifact && acceptanceArtifact) {
        requireOrder([
          [`${checkpoint}.reviewSealedAt`, reviewArtifact.value.reviewSealedAt],
          [`${checkpoint}.committedAt`, commit.committedAt],
          [`${checkpoint}.auditOpenedAt`, adjudication.value.openedAt],
          [`${checkpoint}.auditSealedAt`, adjudication.value.sealedAt],
          [`${checkpoint}.submittedAt`, receipt.submittedAt],
          [`${checkpoint}.playerActionAcceptedAt`, proof.playerActionAcceptedAt],
          [`${checkpoint}.bindingVerifiedAt`, proof.verifiedAt],
          [`${checkpoint}.sliceGeneratedAt`, sliceArtifact.value.generatedAt],
          [`${checkpoint}.acceptanceGeneratedAt`, acceptanceArtifact.value.generatedAt]
        ], errors);
      }
    }
    if (acceptanceArtifact) {
      expectEqual(acceptanceArtifact.value.computedVerdict, "PASS", `${checkpoint} checkpoint acceptance`, errors);
      expectEqual(acceptanceArtifact.value.machineIntegrity, "PASS", `${checkpoint} machine gate`, errors);
      expectEqual(acceptanceArtifact.value.codexPlayerExperience, "PASS", `${checkpoint} player gate`, errors);
      expectEqual(acceptanceArtifact.value.hiddenAdjudication, "PASS", `${checkpoint} hidden gate`, errors);
      expectEqual(acceptanceArtifact.value.testIntegrity, "PASS", `${checkpoint} test integrity gate`, errors);
      expectEqual(acceptanceArtifact.value.choiceConsistency, checkpoint === "T20" ? "NOT_APPLICABLE" : "PASS", `${checkpoint} choice consistency`, errors);
    }
  }

  const reviews = ACCEPTANCE_CHECKPOINTS.map((checkpoint) => checkpoints.get(checkpoint)?.get("codex-player-review.json")).filter(Boolean);
  const choices = ACCEPTANCE_CHECKPOINTS.slice(0, -1).map((checkpoint) => checkpoints.get(checkpoint)?.get("choice-binding-proof.json")).filter(Boolean);
  expectEqual(reviews.length, 21, "independent blind-player review count", errors);
  expectEqual(choices.length, 20, "choice binding proof count", errors);
  const integrity = root.get("test-integrity.json")?.value;
  if (integrity) {
    expectEqual(integrity.verdict, "PASS", "global test integrity", errors);
    expectEqual(Object.values(integrity.providerCallCountTotalByTurn || {}).filter((count) => count === 2).length, 20, "global total provider call count", errors);
    expectEqual(Object.values(integrity.narrationProviderCallCountByTurn || {}).filter((count) => count === 1).length, 20, "global narration provider call count", errors);
    expectEqual(Object.values(integrity.decisionProviderCallCountByTurn || {}).filter((count) => count === 1).length, 20, "global decision provider call count", errors);
  }
  const finalHidden = root.get("final-hidden-audit.json")?.value;
  if (finalHidden) expectEqual(finalHidden.verdict, "PASS", "final hidden audit", errors);
  const release = root.get("formal-use-acceptance-report.json")?.value;
  if (release) expectEqual(release.releaseVerdict, "PART_ONE_FORMAL_USE_READY", "formal release verdict", errors);

  return {
    runDir,
    runId,
    validatorVersion: FORMAL_RUN_VALIDATOR_VERSION,
    expectedCheckpointCount: 21,
    actualPlayerReviewCount: reviews.length,
    actualChoiceBindingCount: choices.length,
    errors,
    verdict: errors.length ? "FAIL" : "PART_ONE_FORMAL_USE_READY"
  } as const;
}

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const runDir = argument("run-dir");
  if (!runDir) throw new Error("Usage: --run-dir <docs/acceptance/sangtian/part-01-20-turn/run-id>");
  const result = await validateFormalRunDirectory(runDir);
  console.log(JSON.stringify(result, null, 2));
  if (result.verdict === "FAIL") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
