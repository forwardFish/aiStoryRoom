import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  REQUIRED_CHECKPOINT_IDS,
  verifyContinuousStrategyManifest
} from "./verify-continuous-strategy-manifest.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "continuous-manifest-"));
  const attemptId = "attempt-test";
  const runId = "run-current";
  const evidencePath = join(root, "lane.json");
  const evidence = Buffer.from(JSON.stringify({ runId, status: "PASS" }));
  await writeFile(evidencePath, evidence);

  const manifest = {
    schemaVersion: "continuous-strategy-acceptance-v1",
    goalId: "continuous-strategy-v1.1",
    attemptId,
    startedAt: new Date(Date.now() - 1000).toISOString(),
    finishedAt: new Date().toISOString(),
    source: {
      branch: "codex/test",
      headSha: "a".repeat(40),
      baselineSourceFingerprint: "b".repeat(64),
      planHash: "c".repeat(64),
      pairedTestPlanHash: "d".repeat(64),
      buildArtifactSha256: "e".repeat(64),
      configFingerprint: "f".repeat(64),
      strategyRegistryHash: "1".repeat(64),
      strategyArtifactHashes: { sangtian_v1_1: "2".repeat(64) }
    },
    database: {
      provider: "supabase",
      projectRefRedacted: "project-test",
      schema: "cs_acceptance_test",
      nonProductionAllowlistMatched: true,
      schemaHash: "3".repeat(64),
      migrationDirectoryHash: "4".repeat(64),
      databaseFingerprintRedacted: "supabase:test:isolated",
      appliedMigrations: ["m1"]
    },
    services: [],
    browsers: [],
    requiredCheckpointIds: [...REQUIRED_CHECKPOINT_IDS],
    checkpoints: REQUIRED_CHECKPOINT_IDS.map((checkpointId) => ({
      checkpointId,
      status: "PASS",
      startedAt: new Date(Date.now() - 1000).toISOString(),
      finishedAt: new Date().toISOString(),
      evidenceArtifactPaths: ["lane.json"]
    })),
    routes: [{
      laneId: "MP-SUCCESS",
      runId,
      accountIdsRedacted: ["p1", "p2", "p3"],
      timingProfile: "automated-success",
      faultProfile: null
    }],
    artifacts: [{
      relativePath: "lane.json",
      laneId: "MP-SUCCESS",
      runId,
      sha256: digest(evidence),
      bytes: evidence.length,
      createdAt: new Date().toISOString()
    }],
    externalBlockers: [],
    gates: { allRequired: true },
    verdict: "PASS"
  };
  const manifestPath = join(root, "acceptance-manifest.json");
  const raw = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(manifestPath, raw);
  await writeFile(join(root, "acceptance-manifest.sha256"), digest(raw) + "  acceptance-manifest.json\n");
  return { root, manifestPath, manifest, evidencePath };
}

test("acceptance manifest verifies only its declared current RunId and artifact hash", async () => {
  const current = await fixture();
  try {
    const result = await verifyContinuousStrategyManifest(current.manifestPath);
    assert.equal(result.status, "PASS");
    assert.equal(result.routeCount, 1);
    assert.equal(result.artifactCount, 1);
    assert.equal(result.checkpointCount, 13);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("artifact mutation is rejected instead of reading historical evidence", async () => {
  const current = await fixture();
  try {
    await writeFile(current.evidencePath, JSON.stringify({ runId: "run-current", status: "MUTATED" }));
    await assert.rejects(
      verifyContinuousStrategyManifest(current.manifestPath),
      (error) => error?.code === "EVIDENCE_SCOPE_MISMATCH"
    );
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("finished PASS with an unfinished lifecycle is rejected", async () => {
  const current = await fixture();
  try {
    current.manifest.finishedAt = null;
    await writeFile(current.manifestPath, JSON.stringify(current.manifest, null, 2));
    await assert.rejects(
      verifyContinuousStrategyManifest(current.manifestPath, { verifySidecar: false }),
      (error) => error?.code === "MANIFEST_LIFECYCLE_INVALID"
    );
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("checkpoint set and embedded RunId mismatches are rejected", async () => {
  const current = await fixture();
  try {
    current.manifest.checkpoints.pop();
    await writeFile(current.manifestPath, JSON.stringify(current.manifest, null, 2));
    await assert.rejects(
      verifyContinuousStrategyManifest(current.manifestPath, { verifySidecar: false }),
      (error) => error?.code === "CHECKPOINT_SET_MISMATCH"
    );

    const fresh = await fixture();
    try {
      const other = Buffer.from(JSON.stringify({ runId: "run-history", status: "PASS" }));
      await writeFile(fresh.evidencePath, other);
      fresh.manifest.artifacts[0].sha256 = digest(other);
      fresh.manifest.artifacts[0].bytes = other.length;
      await writeFile(fresh.manifestPath, JSON.stringify(fresh.manifest, null, 2));
      await assert.rejects(
        verifyContinuousStrategyManifest(fresh.manifestPath, { verifySidecar: false }),
        (error) => error?.code === "EVIDENCE_SCOPE_MISMATCH"
      );
    } finally {
      await rm(fresh.root, { recursive: true, force: true });
    }
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});
test("local or public database targets are rejected", async () => {
  const current = await fixture();
  try {
    current.manifest.database.provider = "postgresql-local";
    current.manifest.database.schema = "public";
    current.manifest.database.nonProductionAllowlistMatched = false;
    await writeFile(current.manifestPath, JSON.stringify(current.manifest, null, 2));
    await assert.rejects(
      verifyContinuousStrategyManifest(current.manifestPath, { verifySidecar: false }),
      (error) => error?.code === "DATABASE_SCOPE_INVALID"
    );
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});