import assert from "node:assert/strict";
import test from "node:test";
import {
  issueOpenNovelManeuverPreview,
  normalizePreviewCommand,
  verifyOpenNovelManeuverPreview,
} from "./openovel-maneuver-preview";

const command = normalizePreviewCommand({
  version: 7,
  idempotencyKey: "preview-test-key-001",
  maneuverType: "contact",
  targetRoleKey: "analyst",
  messageText: "What changed after the checkpoint?",
  customText: "must not survive normalization",
}, 7, "preview-test-key-001");

function issue() {
  return issueOpenNovelManeuverPreview({
    runId: "run-preview-test",
    userId: "user-preview-test",
    worldId: "neutral_fixture",
    roleKey: "operator",
    expectedVersion: 7,
    expectedTurnNumber: 2,
    sceneKey: "phase_beta",
    idempotencyKey: "preview-test-key-001",
    requestFingerprint: "fingerprint-preview-test",
    command,
  });
}

test("signed maneuver preview round-trips the normalized command", () => {
  const issued = issue();
  const verified = verifyOpenNovelManeuverPreview(issued.previewToken);
  assert.equal(verified.previewId, issued.payload.previewId);
  assert.equal(verified.expectedVersion, 7);
  assert.equal(verified.expectedTurnNumber, 2);
  assert.equal(verified.command.maneuverType, "contact");
  assert.equal(verified.command.messageText, "What changed after the checkpoint?");
  assert.equal(verified.command.customText, undefined);
});

test("tampered maneuver preview is rejected", () => {
  const issued = issue();
  const last = issued.previewToken.at(-1) === "a" ? "b" : "a";
  const tampered = `${issued.previewToken.slice(0, -1)}${last}`;
  assert.throws(
    () => verifyOpenNovelManeuverPreview(tampered),
    (error: any) => error.code === "MANEUVER_PREVIEW_TOKEN_TAMPERED",
  );
});

test("expired maneuver preview is rejected without writing state", () => {
  const originalNow = Date.now;
  const issuedAt = originalNow();
  try {
    Date.now = () => issuedAt;
    const issued = issue();
    Date.now = () => issuedAt + 11 * 60_000;
    assert.throws(
      () => verifyOpenNovelManeuverPreview(issued.previewToken),
      (error: any) => error.code === "MANEUVER_PREVIEW_EXPIRED",
    );
  } finally {
    Date.now = originalNow;
  }
});
