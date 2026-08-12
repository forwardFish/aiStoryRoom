import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sha256Canonical } from "@ai-story/shared";
import type { AssembledN7FinaleInputV1 } from "../finale/assembler";
import type { StoredRunRouteRecordV1 } from "../run-router";
import {
  PrismaProgressChapterHandoffAuthorityV1,
  type ProgressChapterHandoffAuthorityPrismaClientV1,
} from "./prisma-authority";
import {
  RuntimeProgressFinaleAdapterV1,
  RuntimeProgressOpenChapterAdapterV1,
  finaleIdempotencyKey,
  type ProgressChapterHandoffAuthorityPortV1,
} from "./runtime-adapters";
import type {
  ProgressComputeFinaleHandoffV1,
  ProgressOpenChapterHandoffV1,
} from "./ports";

const RUN_ID = "run-progress-runtime";
const ROUTE_HASH = digest("route");
const N1_BUNDLE_BODY = {
  schemaVersion: "sangtian_frozen_chapter_bundle_v1",
  runId: RUN_ID,
  chapterId: "N1",
};
const N1_BUNDLE = sha256Canonical(N1_BUNDLE_BODY);
const N7_BUNDLE = digest("n7-bundle");
const N7_COMMIT = digest("n7-commit");

test("OPEN_CHAPTER replays an already durable exact target without a second resume", async () => {
  const authority = new MemoryAuthority();
  authority.target = target("N2", N1_BUNDLE);
  let resumes = 0;
  const adapter = new RuntimeProgressOpenChapterAdapterV1(
    routes(),
    authority,
    {
      resume: async () => {
        resumes += 1;
        throw new Error("must not resume an existing target");
      },
      finalize: async () => { throw new Error("not used"); },
    },
  );
  const result = await adapter.openNextChapter({
    handoff: openHandoff(),
    workerId: "progress-a",
    nowMs: 100,
  });
  assert.deepEqual(result, {
    status: "REPLAYED",
    chapterId: "N2",
    chapterRuntimeId: "chapter-N2",
  });
  assert.equal(resumes, 0);
});

test("OPEN_CHAPTER resumes once and crash replay reuses the same target runtime", async () => {
  const authority = new MemoryAuthority();
  let resumes = 0;
  const adapter = new RuntimeProgressOpenChapterAdapterV1(
    routes(),
    authority,
    {
      resume: async () => {
        resumes += 1;
        authority.target = target("N2", N1_BUNDLE);
        return {} as never;
      },
      finalize: async () => { throw new Error("not used"); },
    },
  );
  const command = { handoff: openHandoff(), workerId: "progress-b", nowMs: 101 };
  const first = await adapter.openNextChapter(command);
  const replay = await adapter.openNextChapter(command);
  assert.equal(first.status, "OPENED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(first.chapterRuntimeId, replay.chapterRuntimeId);
  assert.equal(resumes, 1);
});

test("OPEN_CHAPTER fails closed before runtime when the committed source fence is absent", async () => {
  const authority = new MemoryAuthority();
  authority.sourceVerified = false;
  let called = false;
  const adapter = new RuntimeProgressOpenChapterAdapterV1(
    routes(),
    authority,
    {
      resume: async () => {
        called = true;
        return {} as never;
      },
      finalize: async () => { throw new Error("not used"); },
    },
  );
  await assert.rejects(
    () => adapter.openNextChapter({ handoff: openHandoff(), workerId: "p", nowMs: 1 }),
    (error: unknown) => readCode(error) === "PRESSURE_PROGRESS_OUTBOX_DEPENDENCY_RESULT_INVALID",
  );
  assert.equal(called, false);
});

test("COMPUTE_FINALE binds N7 bundle and uses one deterministic terminal command", async () => {
  const calls: unknown[] = [];
  const handoff = finaleHandoff();
  const adapter = new RuntimeProgressFinaleAdapterV1(
    routes(),
    new MemoryAuthority(),
    { assemble: async () => assembled(N7_BUNDLE) },
    {
      resume: async () => { throw new Error("not used"); },
      finalize: async (command: {
        runId: string;
        idempotencyKey: string;
        requestFingerprint: string;
      }) => {
        calls.push(command);
        return {
          status: "COMMITTED" as const,
          record: { authorityCommitHash: digest("finale-authority") },
        } as never;
      },
    },
  );
  const result = await adapter.computeFinale({
    handoff,
    workerId: "progress-final",
    nowMs: 102,
  });
  assert.deepEqual(calls, [{
    runId: RUN_ID,
    idempotencyKey: finaleIdempotencyKey(handoff),
    requestFingerprint: digest("source-fingerprint"),
  }]);
  assert.deepEqual(result, {
    status: "COMMITTED",
    runId: RUN_ID,
    authorityCommitHash: digest("finale-authority"),
  });
});

test("COMPUTE_FINALE rejects a foreign N7 bundle before the Finale writer", async () => {
  let finalized = false;
  const adapter = new RuntimeProgressFinaleAdapterV1(
    routes(),
    new MemoryAuthority(),
    { assemble: async () => assembled(digest("foreign-n7")) },
    {
      resume: async () => { throw new Error("not used"); },
      finalize: async () => {
        finalized = true;
        return {} as never;
      },
    },
  );
  await assert.rejects(
    () => adapter.computeFinale({ handoff: finaleHandoff(), workerId: "p", nowMs: 3 }),
    (error: unknown) => readCode(error) === "PRESSURE_PROGRESS_OUTBOX_DEPENDENCY_RESULT_INVALID",
  );
  assert.equal(finalized, false);
});

test("Prisma authority adapter binds bundle, chapter runtime and settlement commit", async () => {
  const prisma = progressPrisma();
  const authority = new PrismaProgressChapterHandoffAuthorityV1(prisma);
  assert.equal(await authority.verifyCommittedSource({
    runId: RUN_ID,
    chapterRuntimeId: "chapter-N1",
    sourceBundleHash: N1_BUNDLE,
    sourceCommitHash: digest("n1-commit"),
  }), true);
  assert.equal(await authority.verifyCommittedSource({
    runId: RUN_ID,
    chapterRuntimeId: "chapter-N1",
    sourceBundleHash: N1_BUNDLE,
    sourceCommitHash: digest("foreign-commit"),
  }), false);
  assert.deepEqual(await authority.readChapterRuntime({ runId: RUN_ID, chapterId: "N2" }), {
    chapterRuntimeId: "chapter-N2",
    routeHash: ROUTE_HASH,
    previousFrozenHash: N1_BUNDLE,
  });
});

test("Prisma authority adapter rejects a tampered embedded settlement manifest", async () => {
  const authority = new PrismaProgressChapterHandoffAuthorityV1(progressPrisma(true));
  assert.equal(await authority.verifyCommittedSource({
    runId: RUN_ID,
    chapterRuntimeId: "chapter-N1",
    sourceBundleHash: N1_BUNDLE,
    sourceCommitHash: digest("n1-commit"),
  }), false);
});

class MemoryAuthority implements ProgressChapterHandoffAuthorityPortV1 {
  sourceVerified = true;
  target: Awaited<ReturnType<ProgressChapterHandoffAuthorityPortV1["readChapterRuntime"]>> = null;

  async verifyCommittedSource() {
    return this.sourceVerified;
  }

  async readChapterRuntime() {
    return this.target;
  }
}

function routes() {
  return {
    readStoredRoute: async () => ({
      runId: RUN_ID,
      snapshot: { runId: RUN_ID, routeHash: ROUTE_HASH },
    } as unknown as StoredRunRouteRecordV1),
  };
}

function progressPrisma(tamperManifest = false): ProgressChapterHandoffAuthorityPrismaClientV1 {
  const tx = {
    pressureChapterSettlement: {
      findUnique: async (input: Record<string, any>) =>
        input.where?.frozenBundleHash === N1_BUNDLE
          ? {
              runId: RUN_ID,
              chapterRuntimeId: "chapter-N1",
              frozenBundleHash: N1_BUNDLE,
              commitHash: digest("n1-commit"),
              commitManifestJson: settlementManifest(tamperManifest),
            }
          : null,
    },
    pressureChapterRuntime: {
      findFirst: async (input: Record<string, any>) =>
        input.where?.runId === RUN_ID && input.where?.chapterId === "N2"
          ? {
              id: "chapter-N2",
              runId: RUN_ID,
              chapterId: "N2",
              routeHash: ROUTE_HASH,
              previousFrozenHash: N1_BUNDLE,
            }
          : null,
    },
  };
  return {
    $transaction: async (operation) => operation(tx),
  } as ProgressChapterHandoffAuthorityPrismaClientV1;
}

function settlementManifest(tampered = false) {
  const frozenChapterBundle = {
    ...N1_BUNDLE_BODY,
    bundleHash: N1_BUNDLE,
  };
  const body = {
    schemaVersion: "pressure_atomic_chapter_commit_v1",
    runId: RUN_ID,
    chapterRuntimeId: "chapter-N1",
    frozenChapterBundle,
    receipt: {
      schemaVersion: "b0_settlement_commit_result_v1",
      runId: RUN_ID,
      chapterRuntimeId: "chapter-N1",
      bundleHash: N1_BUNDLE,
      commitHash: digest("n1-commit"),
    },
  };
  return {
    ...body,
    atomicRecordHash: tampered ? digest("tampered-manifest") : sha256Canonical(body),
  };
}

function target(chapterId: "N2", previousFrozenHash: string) {
  return {
    chapterRuntimeId: `chapter-${chapterId}`,
    routeHash: ROUTE_HASH,
    previousFrozenHash,
  };
}

function openHandoff(): ProgressOpenChapterHandoffV1 {
  return {
    sourceAuthority: "CHAPTER_FROZEN",
    runId: RUN_ID,
    previousChapterRuntimeId: "chapter-N1",
    outboxDedupeKey: "outbox-open-N2",
    sourceBundleHash: N1_BUNDLE,
    sourceCommitHash: digest("n1-commit"),
    targetChapterId: "N2",
  };
}

function finaleHandoff(): ProgressComputeFinaleHandoffV1 {
  return {
    sourceAuthority: "CHAPTER_FROZEN",
    runId: RUN_ID,
    terminalChapterRuntimeId: "chapter-N7",
    outboxDedupeKey: "outbox-finale",
    sourceBundleHash: N7_BUNDLE,
    sourceCommitHash: N7_COMMIT,
  };
}

function assembled(bundleHash: string): AssembledN7FinaleInputV1 {
  return {
    source: {
      runId: RUN_ID,
      routeHash: ROUTE_HASH,
      terminalChapterId: "N7",
      terminalWorldSequence: 7,
      sourceFingerprint: digest("source-fingerprint"),
      frozenChapterBundles: [{ chapterId: "N7", bundleHash }],
    },
    input: {},
  } as unknown as AssembledN7FinaleInputV1;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return String((error as { code: unknown }).code);
}
