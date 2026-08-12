import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical } from "@ai-story/shared";
import {
  buildAuthorityDownstreamManifestV1,
  validateAuthorityDownstreamManifestV1,
} from "./authority-downstream";

const HASH = sha256Canonical({ authority: "test" });

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
