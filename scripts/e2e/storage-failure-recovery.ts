import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MvpStoryEngine } from "../../apps/api/src/mvp-causal-runtime";
import { FileMvpStoryStorage, type MvpStoryStorage } from "../../apps/api/src/mvp-storage";
import type { MvpView } from "../../apps/api/src/mvp-types";

class FailOnceStorage implements MvpStoryStorage {
  constructor(private readonly inner: MvpStoryStorage) {}
  failNextSave = true;
  create(view: MvpView) { return this.inner.create(view); }
  load(runId: string) { return this.inner.load(runId); }
  async save(view: MvpView, expectedVersion: number) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("injected storage outage");
    }
    return this.inner.save(view, expectedVersion);
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "ai-story-storage-recovery-"));
  try {
  const durable = new FileMvpStoryStorage(root);
  const storage = new FailOnceStorage(durable);
  const engine = new MvpStoryEngine(storage);
  let view = await engine.create({ storyId: "sangtian" });
  const runId = view.run.id;
  const messageId = view.activeDecision!.messageId;
  const request = { version: view.run.version, optionKey: "A", idempotencyKey: "storage-recovery-1" };

  await assert.rejects(() => engine.submitDecision(runId, messageId, request), /injected storage outage/);
  const afterFailure = await durable.load(runId);
  assert.equal(afterFailure.run.version, 1, "failed save must preserve the previous version");
  assert.equal(afterFailure.events.length, 1, "failed save must not append a partial event");

  view = await engine.submitDecision(runId, messageId, request);
  assert.equal(view.run.version, 2);

  const restartedStorage = new FileMvpStoryStorage(root);
  const recovered = await restartedStorage.load(runId);
  assert.equal(recovered.run.version, 2, "a fresh storage instance must read the recovered state");
  assert.equal(recovered.events.some((event) => event.type === "decision_submitted"), true);
  const files = await readdir(root);
  assert.equal(files.some((file) => file.endsWith(".tmp")), false, "failed atomic writes must not leave temp files");

  const result = {
    schemaVersion: "storage-failure-recovery-v1",
    status: "PASS",
    injectedFailurePreservedPreviousVersion: true,
    retrySucceeded: true,
    restartReadbackSucceeded: true,
    atomicTempFilesCleaned: true,
    finalVersion: recovered.run.version,
    eventCount: recovered.events.length
  };
  const evidenceDir = join(process.cwd(), "docs/auto-execute/results");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "storage-failure-recovery.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
