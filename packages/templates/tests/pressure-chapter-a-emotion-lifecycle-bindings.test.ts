import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  SangtianAEmotionLifecycleBindingsError,
  loadPublishedSangtianAEmotionLifecycleBindingsV1,
} from "../src/pressure-chapter/release";

const RELEASE = resolve(__dirname, "../config/sangtian/pressure-chapter-v1/release");

test("published A-Emotion lifecycle bindings freeze canonical roles and zero-inference authority", () => {
  const loaded = loadPublishedSangtianAEmotionLifecycleBindingsV1();
  assert.deepEqual(loaded.bindings.canonicalRoles, {
    promiseIssuerSeatId: "zhejiang_administration",
    promiseReceiverSeatId: "zhejiang_governor",
    investigatorSeatId: "qingliu_law",
  });
  assert.equal(loaded.bindings.formalPromise.sharedObjectId, "original-grain-ledger");
  assert.equal(loaded.bindings.formalPromise.genericDeliverLedgerMayInferOriginal, false);
  assert.equal(loaded.bindings.formalPromise.brokenImpliesRevealed, false);
  assert.deepEqual(
    loaded.bindings.disclosureLifecycle.transitions.map((row) => [
      row.fromDisclosure, row.toDisclosure, row.requiresAuthorizedEvidence,
    ]),
    [["HIDDEN", "SUSPECTED", false], ["SUSPECTED", "CONFIRMED", true]],
  );
  assert.equal(loaded.bindings.authorityBoundary.providerCallsAllowed, false);
  assert.equal(Object.isFrozen(loaded.bindings), true);
});

test("lifecycle binding loader rejects artifact drift before interpreting it", () => {
  const root = mkdtempSync(join(tmpdir(), "aemotion-lifecycle-"));
  try {
    for (const name of ["release-manifest.json", "a-emotion-lifecycle-bindings.json"]) {
      writeFileSync(join(root, name), readFileSync(join(RELEASE, name)));
    }
    const artifactPath = join(root, "a-emotion-lifecycle-bindings.json");
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    artifact.formalPromise.genericDeliverLedgerMayInferOriginal = true;
    writeFileSync(artifactPath, JSON.stringify(artifact));
    assert.throws(
      () => loadPublishedSangtianAEmotionLifecycleBindingsV1({ releaseRoot: root }),
      (error: unknown) => error instanceof SangtianAEmotionLifecycleBindingsError
        && error.code === "ARTIFACT_HASH_MISMATCH",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
