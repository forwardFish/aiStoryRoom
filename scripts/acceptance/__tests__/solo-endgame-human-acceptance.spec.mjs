import assert from "node:assert/strict";
import test from "node:test";
import {
  HUMAN_ACCEPTANCE_SCHEMA,
  validateSoloEndgameHumanAcceptance,
} from "../solo-endgame-human-acceptance.mjs";

function participant(index, overrides = {}) {
  return {
    participantId: `human-${index}`,
    attestationId: `attestation-${index}`,
    browserSessionId: `browser-session-${index}`,
    runId: `solo-run-${index}`,
    participantKind: "HUMAN",
    independent: true,
    involvedInDevelopment: false,
    realPersonAttested: true,
    resultType: "SOLO_PART_END",
    recognizedPartEnd: true,
    explainedGainLoss: true,
    identifiedAuthoritativeCause: true,
    resultConsistent: true,
    replaySucceeded: true,
    privacyLeakDetected: false,
    wantsReplay: index !== 5,
    ...overrides,
  };
}

function evidence(participants) {
  return {
    schemaVersion: HUMAN_ACCEPTANCE_SCHEMA,
    candidateSha: "a".repeat(40),
    remoteBranch: "codex/chatgpt-pro-main-game-final-v1",
    participants,
  };
}

test("five independent human sessions meeting all thresholds pass", () => {
  const validation = validateSoloEndgameHumanAcceptance(evidence([
    participant(1), participant(2), participant(3), participant(4), participant(5),
  ]));
  assert.equal(validation.ok, true);
  assert.equal(validation.participantCount, 5);
  assert.equal(validation.metrics.recognizedPartEnd, 1);
  assert.equal(validation.metrics.wantsReplay, 0.8);
});

test("a model, developer or non-attested record cannot count as a human player", () => {
  const validation = validateSoloEndgameHumanAcceptance(evidence([
    participant(1), participant(2), participant(3), participant(4),
    participant(5, {
      participantKind: "AUTOMATED",
      involvedInDevelopment: true,
      realPersonAttested: false,
    }),
  ]));
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /participantKind|involvedInDevelopment|realPersonAttested/);
});

test("duplicate identities, sessions or runs cannot be counted twice", () => {
  const validation = validateSoloEndgameHumanAcceptance(evidence([
    participant(1), participant(2), participant(3), participant(4),
    participant(5, {
      participantId: "human-1",
      attestationId: "attestation-1",
      browserSessionId: "browser-session-1",
      runId: "solo-run-1",
    }),
  ]));
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /duplicates|independent player run/);
});

test("engineering success cannot override failed player comprehension or privacy", () => {
  const validation = validateSoloEndgameHumanAcceptance(evidence([
    participant(1, { recognizedPartEnd: false, privacyLeakDetected: true }),
    participant(2, { explainedGainLoss: false, identifiedAuthoritativeCause: false }),
    participant(3, { resultConsistent: false, replaySucceeded: false, wantsReplay: false }),
    participant(4, { wantsReplay: false }),
    participant(5, { wantsReplay: false }),
  ]));
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /PART_END|gain\/loss|authoritative-cause|consistency|replay completion|leak|replay intent/);
});
