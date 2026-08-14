import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNarrativeProjectionFingerprint,
  sha256Canonical,
  type OpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";
import {
  computeNarrativeLogicalProjectionKey,
} from "@apps/openovel-runtime/pressure-narrative/contracts";
import {
  buildNarrativeProjectionIdentityV1,
  buildAuthorityDownstreamManifestV1,
  validateAuthorityDownstreamManifestV1,
} from "./authority-downstream";

const HASH = sha256Canonical({ authority: "test" });

test("narrative projection identity keeps logical key distinct from request fingerprint", () => {
  const job = {
    projectionKind: "CHAPTER_NARRATIVE",
    sourceCommitHash: HASH,
    sourceContentHash: sha256Canonical({ content: "test" }),
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    audience: { kind: "SEAT", seatId: "zhejiang_governor" },
  } as OpenNovelNarrativeProjectionJobV1;
  const projectorVersion = "openovel-pressure-projector-1.0.0";
  const identity = buildNarrativeProjectionIdentityV1(job, projectorVersion);

  assert.equal(identity.logicalProjectionKey, computeNarrativeLogicalProjectionKey(job));
  assert.equal(
    identity.requestFingerprint,
    computeNarrativeProjectionFingerprint(job, projectorVersion),
  );
  assert.notEqual(identity.logicalProjectionKey, identity.requestFingerprint);
});

test("downstream manifest is deterministic, exact-keyed, and hash-bound", () => {
  const manifest = buildAuthorityDownstreamManifestV1({
    authorityKind: "BEAT",
    sourceId: HASH,
    sourceCommitHash: HASH,
    dedupeKeys: ["z", "a"],
  });
  assert.deepEqual(manifest.dedupeKeys, ["a", "z"]);
  assert.deepEqual(validateAuthorityDownstreamManifestV1(manifest, {
    authorityKind: "BEAT",
    sourceId: HASH,
    sourceCommitHash: HASH,
  }), manifest);
  assert.throws(() => validateAuthorityDownstreamManifestV1(["legacy-array"]));
  assert.throws(() => validateAuthorityDownstreamManifestV1({ ...manifest, extra: true }));
  assert.throws(() => validateAuthorityDownstreamManifestV1({
    ...manifest,
    dedupeKeys: ["a", "drift"],
  }));
});
