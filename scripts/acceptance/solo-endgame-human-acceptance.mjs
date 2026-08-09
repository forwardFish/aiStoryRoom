import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HUMAN_ACCEPTANCE_SCHEMA = "solo_endgame_human_acceptance_v1";

export const HUMAN_ACCEPTANCE_THRESHOLDS = Object.freeze({
  minimumParticipants: 5,
  recognizedPartEnd: 1,
  explainedGainLoss: 0.8,
  identifiedAuthoritativeCause: 0.8,
  resultConsistent: 0.8,
  replaySucceeded: 1,
  privacyLeakFree: 1,
  wantsReplay: 0.6,
});

/**
 * This validator is deliberately evidence-only. It cannot manufacture player
 * acceptance, cannot turn a model run into a human run, and cannot count the
 * same tester/session more than once.
 */
export function validateSoloEndgameHumanAcceptance(value) {
  const root = record(value);
  const errors = [];
  if (root.schemaVersion !== HUMAN_ACCEPTANCE_SCHEMA) {
    errors.push(`schemaVersion must be ${HUMAN_ACCEPTANCE_SCHEMA}`);
  }
  if (!/^[a-f0-9]{40}$/i.test(String(root.candidateSha || ""))) {
    errors.push("candidateSha must be an exact 40-character Git SHA");
  }
  if (String(root.remoteBranch || "") !== "codex/chatgpt-pro-main-game-final-v1") {
    errors.push("remoteBranch must be the approved Solo Endgame branch");
  }
  if (!Array.isArray(root.participants)) {
    errors.push("participants must be an array");
    return result(errors, [], {});
  }

  const participants = [];
  const participantIds = new Set();
  const attestationIds = new Set();
  const browserSessionIds = new Set();
  const runIds = new Set();

  for (const [index, candidate] of root.participants.entries()) {
    const participant = record(candidate);
    const prefix = `participants[${index}]`;
    const participantId = nonEmpty(participant.participantId);
    const attestationId = nonEmpty(participant.attestationId);
    const browserSessionId = nonEmpty(participant.browserSessionId);
    const runId = nonEmpty(participant.runId);
    if (!participantId) errors.push(`${prefix}.participantId is required`);
    if (!attestationId) errors.push(`${prefix}.attestationId is required`);
    if (!browserSessionId) errors.push(`${prefix}.browserSessionId is required`);
    if (!runId) errors.push(`${prefix}.runId is required`);
    if (participant.participantKind !== "HUMAN") {
      errors.push(`${prefix}.participantKind must be HUMAN`);
    }
    if (participant.independent !== true) {
      errors.push(`${prefix}.independent must be true`);
    }
    if (participant.involvedInDevelopment !== false) {
      errors.push(`${prefix}.involvedInDevelopment must be false`);
    }
    if (participant.realPersonAttested !== true) {
      errors.push(`${prefix}.realPersonAttested must be true`);
    }
    if (participant.resultType !== "SOLO_PART_END") {
      errors.push(`${prefix}.resultType must be SOLO_PART_END`);
    }
    for (const field of [
      "recognizedPartEnd",
      "explainedGainLoss",
      "identifiedAuthoritativeCause",
      "resultConsistent",
      "replaySucceeded",
      "privacyLeakDetected",
      "wantsReplay",
    ]) {
      if (typeof participant[field] !== "boolean") {
        errors.push(`${prefix}.${field} must be boolean`);
      }
    }
    if (participantId && participantIds.has(participantId)) {
      errors.push(`${prefix}.participantId duplicates another tester`);
    }
    if (attestationId && attestationIds.has(attestationId)) {
      errors.push(`${prefix}.attestationId duplicates another tester`);
    }
    if (browserSessionId && browserSessionIds.has(browserSessionId)) {
      errors.push(`${prefix}.browserSessionId duplicates another tester session`);
    }
    if (runId && runIds.has(runId)) {
      errors.push(`${prefix}.runId must identify an independent player run`);
    }
    if (participantId) participantIds.add(participantId);
    if (attestationId) attestationIds.add(attestationId);
    if (browserSessionId) browserSessionIds.add(browserSessionId);
    if (runId) runIds.add(runId);
    participants.push(participant);
  }

  if (participants.length < HUMAN_ACCEPTANCE_THRESHOLDS.minimumParticipants) {
    errors.push(`at least ${HUMAN_ACCEPTANCE_THRESHOLDS.minimumParticipants} independent human participants are required`);
  }

  const metrics = computeMetrics(participants);
  if (metrics.recognizedPartEnd < HUMAN_ACCEPTANCE_THRESHOLDS.recognizedPartEnd) {
    errors.push("PART_END recognition did not reach 100%");
  }
  if (metrics.explainedGainLoss < HUMAN_ACCEPTANCE_THRESHOLDS.explainedGainLoss) {
    errors.push("gain/loss comprehension did not reach 80%");
  }
  if (metrics.identifiedAuthoritativeCause < HUMAN_ACCEPTANCE_THRESHOLDS.identifiedAuthoritativeCause) {
    errors.push("authoritative-cause comprehension did not reach 80%");
  }
  if (metrics.resultConsistent < HUMAN_ACCEPTANCE_THRESHOLDS.resultConsistent) {
    errors.push("result consistency/fairness did not reach 80%");
  }
  if (metrics.replaySucceeded < HUMAN_ACCEPTANCE_THRESHOLDS.replaySucceeded) {
    errors.push("replay completion did not reach 100%");
  }
  if (metrics.privacyLeakFree < HUMAN_ACCEPTANCE_THRESHOLDS.privacyLeakFree) {
    errors.push("one or more players observed an internal/private-data leak");
  }
  if (metrics.wantsReplay < HUMAN_ACCEPTANCE_THRESHOLDS.wantsReplay) {
    errors.push("replay intent did not reach 60%");
  }

  return result(errors, participants, metrics);
}

function computeMetrics(participants) {
  const count = participants.length || 1;
  const ratio = (field, expected = true) => participants.filter((item) => item[field] === expected).length / count;
  return {
    participantCount: participants.length,
    recognizedPartEnd: ratio("recognizedPartEnd"),
    explainedGainLoss: ratio("explainedGainLoss"),
    identifiedAuthoritativeCause: ratio("identifiedAuthoritativeCause"),
    resultConsistent: ratio("resultConsistent"),
    replaySucceeded: ratio("replaySucceeded"),
    privacyLeakFree: ratio("privacyLeakDetected", false),
    wantsReplay: ratio("wantsReplay"),
  };
}

function result(errors, participants, metrics) {
  return {
    ok: errors.length === 0,
    status: errors.length === 0
      ? "HUMAN_ACCEPTANCE_PASSED"
      : "HUMAN_ACCEPTANCE_NOT_READY",
    errors,
    metrics,
    participantCount: participants.length,
  };
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonEmpty(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "";
}

async function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  const output = argv[1];
  assert.ok(input, "usage: node solo-endgame-human-acceptance.mjs <evidence.json> [report.json]");
  const evidence = JSON.parse(await readFile(path.resolve(input), "utf8"));
  const validation = validateSoloEndgameHumanAcceptance(evidence);
  const report = {
    schemaVersion: "solo_endgame_human_acceptance_report_v1",
    candidateSha: evidence.candidateSha || null,
    remoteBranch: evidence.remoteBranch || null,
    ...validation,
    validatedAt: new Date().toISOString(),
  };
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!validation.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
