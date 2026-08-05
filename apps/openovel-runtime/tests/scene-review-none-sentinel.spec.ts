import assert from "node:assert/strict";
import test from "node:test";
import { normalizeP0NoneSentinels } from "../src/scene-review-modules.js";

const categories = [
  "causalIntroduction",
  "keyEntityState",
  "secretLeak",
  "playerAction",
] as const;

function envelope(candidates: Record<string, unknown>) {
  return {
    schemaVersion: "omw.scene-p0-review.v1",
    draftHash: "d".repeat(64),
    catalogHash: "c".repeat(64),
    candidates,
  };
}

function emptyCandidate() {
  return {
    presence: "NONE",
    slot: null,
    start: null,
    end: null,
    claimMode: null,
    explicitness: null,
    predicate: null,
    unknownEntity: null,
    confidence: null,
  };
}

test("Reviewer string NONE contract normalizes all absent P0 candidates", () => {
  const raw = JSON.stringify(envelope(Object.fromEntries(
    categories.map((category) => [category, "NONE"]),
  )));

  const parsed = JSON.parse(normalizeP0NoneSentinels(raw));
  for (const category of categories) {
    assert.deepEqual(parsed.candidates[category], emptyCandidate());
  }
});

test("string NONE may coexist with one structured FOUND candidate", () => {
  const found = {
    presence: "FOUND",
    slot: "PLAYER_RESULT",
    start: 0,
    end: 4,
    claimMode: "ASSERTED",
    explicitness: "EXPLICIT",
    predicate: {
      type: "ACTOR.ORDERED",
      actorId: "actor.governor",
      capabilityId: "capability.seal",
    },
    unknownEntity: null,
    confidence: 0.99,
  };
  const raw = JSON.stringify(envelope({
    causalIntroduction: "NONE",
    keyEntityState: "NONE",
    secretLeak: "NONE",
    playerAction: found,
  }));

  const parsed = JSON.parse(normalizeP0NoneSentinels(raw));
  assert.deepEqual(parsed.candidates.playerAction, found);
  assert.deepEqual(parsed.candidates.causalIntroduction, emptyCandidate());
  assert.deepEqual(parsed.candidates.keyEntityState, emptyCandidate());
  assert.deepEqual(parsed.candidates.secretLeak, emptyCandidate());
});

test("mixed legacy-object NONE and string NONE remains invalid instead of being guessed", () => {
  const raw = JSON.stringify(envelope({
    causalIntroduction: "NONE",
    keyEntityState: emptyCandidate(),
    secretLeak: emptyCandidate(),
    playerAction: emptyCandidate(),
  }));

  assert.equal(normalizeP0NoneSentinels(raw), raw);
});

test("only the exact unique uppercase NONE sentinel is accepted", () => {
  for (const invalid of ["none", "NONE ", " None ", null]) {
    const raw = JSON.stringify(envelope({
      causalIntroduction: invalid,
      keyEntityState: invalid,
      secretLeak: invalid,
      playerAction: invalid,
    }));
    assert.equal(normalizeP0NoneSentinels(raw), raw);
  }
});

test("JSON fences are removed only when a valid sentinel envelope is normalized", () => {
  const fenced = [
    "```json",
    JSON.stringify(envelope(Object.fromEntries(
      categories.map((category) => [category, "NONE"]),
    ))),
    "```",
  ].join("\n");

  const parsed = JSON.parse(normalizeP0NoneSentinels(fenced));
  assert.deepEqual(parsed.candidates.playerAction, emptyCandidate());
});
