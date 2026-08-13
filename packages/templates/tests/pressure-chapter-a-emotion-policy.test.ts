import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { CHAPTER_IDS_V1, hashWithoutField, sha256Canonical } from "@ai-story/shared";
import {
  loadPublishedSangtianAEmotionPolicyV1,
  validateSangtianAEmotionPolicyV1,
} from "../src/pressure-chapter/release/a-emotion-policy";
const RELEASE_ROOT = resolve(
  __dirname,
  "../config/sangtian/pressure-chapter-v1/release",
);

test("published A-Emotion policy is hash-pinned and covers N1-N7 plus finale verdicts", () => {
  const published = loadPublishedSangtianAEmotionPolicyV1({ releaseRoot: RELEASE_ROOT });
  assert.equal(published.artifactSha256, sha256Canonical(published.policy));
  assert.equal(
    published.policy.policySha256,
    hashWithoutField(published.policy as unknown as Record<string, unknown>, "policySha256"),
  );
  assert.deepEqual(published.policy.coverage.chapterIds, CHAPTER_IDS_V1);
  assert.deepEqual(published.policy.coverage.chapterOutcomeBands, ["HIGH", "LOW", "MID"]);
  assert.deepEqual(published.policy.coverage.finaleVerdicts, ["COSTLY_WIN", "LOSS", "WIN"]);
  assert.equal(published.policy.authorityBoundary.mayInferSecrets, false);
  assert.equal(published.policy.authorityBoundary.mayInventEvidence, false);
  assert.equal(published.policy.authorityBoundary.mayInventPromise, false);
  assert.equal(published.policy.authorityBoundary.missingActionBindingPolicy, "EMIT_ZERO_EVENTS");
});

test("template compiler is deterministic and DEFAULT_PASS emits no event", () => {
  const published = loadPublishedSangtianAEmotionPolicyV1({ releaseRoot: RELEASE_ROOT });
  assert.equal(published.compileTemplate({
    sourceKind: "BEAT_COMMITTED",
    chapterId: "N1",
    actionType: "DEFAULT_PASS",
  }), null);
  assert.equal(published.compileTemplate({
    sourceKind: "BEAT_COMMITTED",
    chapterId: "N1",
    actionType: "INVESTIGATE",
  })?.eventCode, "SANGTIAN_BEAT_ACTION_COMMITTED");
  assert.equal(published.compileTemplate({
    sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
    chapterId: "N7",
    outcomeBand: "LOW",
  })?.presentation.modalType, "CRISIS");
  assert.equal(published.compileTemplate({
    sourceKind: "FINALE_COMMITTED",
    verdict: "WIN",
  })?.presentation.modalType, "STAGE_VICTORY");
});

test("policy validation rejects unknown fields and release loader rejects tampering", () => {
  const published = loadPublishedSangtianAEmotionPolicyV1({ releaseRoot: RELEASE_ROOT });
  assert.throws(
    () => validateSangtianAEmotionPolicyV1({ ...published.policy, providerOutput: "forbidden" }),
    /UNKNOWN_FIELD/u,
  );

  const tempRoot = mkdtempSync(resolve(tmpdir(), "sangtian-a-emotion-policy-"));
  try {
    cpSync(RELEASE_ROOT, tempRoot, { recursive: true });
    const path = resolve(tempRoot, "a-emotion-policy.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    raw.policyVersion = "sangtian-a-emotion-9.9.9";
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    assert.throws(
      () => loadPublishedSangtianAEmotionPolicyV1({ releaseRoot: tempRoot }),
      /ARTIFACT_HASH_MISMATCH/u,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
