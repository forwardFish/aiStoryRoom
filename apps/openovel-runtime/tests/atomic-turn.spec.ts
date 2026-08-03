import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FileAtomicTurnRepository } from "../src/atomic-turn.js";
import { workspacePaths } from "../src/paths.js";
import type { TurnResult } from "../src/types.js";

test("P07 Head atomically owns prose, state and idempotent submission replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-atomic-turn-"));
  const paths = workspacePaths(root, "atomic_run_01");
  const repository = new FileAtomicTurnRepository(paths);
  const result = turnResult();
  try {
    const first = await repository.commit({
      runId: paths.runId,
      submissionId: "submission_0001",
      turnId: "T01",
      turnNumber: 1,
      action: "Hold the order and inspect the register.",
      selectedOption: null,
      result,
      protectedBlocks: [{ blockId: "p0", text: "The order remains unsigned." }],
      narrative: {
        originalText: result.narration,
        disposition: { kind: "USE_ORIGINAL", draftId: "T01.draft.original" },
      },
      projection: {
        stateRevision: { revision: 1, order: "WITHHELD" },
        causalEvents: [{ eventId: "event_t01" }],
        delayedEvents: [],
        projectionSummary: { changed: ["order"] },
        materializedViews: [
          { relativePath: "story/canon/chapters.md", format: "text", value: "canon-v1\n" },
          { relativePath: "story/state/world.json", format: "json", value: { revision: 1 } },
        ],
      },
      modelLedger: [{ stage: "narrator", callId: "call_1" }],
      previousCanon: "",
    });
    assert.equal(first.alreadyCommitted, false);
    assert.equal((await repository.loadHead())?.turnNumber, 1);

    await assert.rejects(() => repository.commit({
      runId: paths.runId,
      submissionId: "submission_0001",
      turnId: "T01",
      turnNumber: 1,
      action: "This different payload must not be recommitted.",
      selectedOption: null,
      result: { ...result, narration: "different" },
      protectedBlocks: [],
      narrative: { originalText: "different", disposition: { kind: "USE_ORIGINAL" } },
      projection: {
        stateRevision: { revision: 999 },
        causalEvents: [],
        delayedEvents: [],
        projectionSummary: {},
      },
      modelLedger: [],
      previousCanon: "",
    }), /IDEMPOTENCY_KEY_REUSED/);
    const replay = await repository.resultBySubmission(
      "submission_0001",
      "Hold the order and inspect the register.",
    );
    assert.equal(replay?.narration, result.narration);
    assert.equal((await repository.loadHead())?.headHash, first.head.headHash);

    await repository.restoreMaterializedViews();
    assert.equal(await readFile(paths.chapters, "utf8"), "canon-v1\n");
    assert.deepEqual(
      JSON.parse(await readFile(path.join(paths.stateDir, "world.json"), "utf8")),
      { revision: 1 },
    );
    await writeFile(paths.chapters, "corrupt materialized view", "utf8");
    await writeFile(path.join(paths.stateDir, "world.json"), "{}", "utf8");
    await repository.restoreMaterializedViews();
    assert.equal(await readFile(paths.chapters, "utf8"), "canon-v1\n");
    assert.deepEqual(
      JSON.parse(await readFile(path.join(paths.stateDir, "world.json"), "utf8")),
      { revision: 1 },
    );
    const secondResult = { ...result, turnId: "T02", turnNumber: 2 };
    const second = await repository.commit({
      runId: paths.runId,
      submissionId: "submission_0003",
      turnId: "T02",
      turnNumber: 2,
      action: "Continue from the committed state.",
      selectedOption: null,
      result: secondResult,
      protectedBlocks: [],
      narrative: { originalText: secondResult.narration, disposition: { kind: "USE_ORIGINAL" } },
      projection: {
        stateRevision: { revision: 2 },
        causalEvents: [{ eventId: "event_t02" }],
        delayedEvents: [],
        projectionSummary: { changed: ["revision"] },
      },
      modelLedger: [],
      previousCanon: "canon-v1\n",
    });
    assert.equal(second.head.previousHeadHash, first.head.headHash);
    assert.equal((await readdir(paths.headsDir)).length, 2);
    assert.equal((await repository.loadHead())?.turnNumber, 2);
    assert.equal(
      (await repository.resultBySubmission(
        "submission_0001",
        "Hold the order and inspect the register.",
      ))?.turnId,
      "T01",
    );
    await assert.rejects(
      () => repository.resultBySubmission("submission_0001", "A different action."),
      /IDEMPOTENCY_KEY_REUSED/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("P07 rejects a corrupt committed artifact instead of accepting split truth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-atomic-corrupt-"));
  const paths = workspacePaths(root, "atomic_run_02");
  const repository = new FileAtomicTurnRepository(paths);
  try {
    const committed = await repository.commit({
      runId: paths.runId,
      submissionId: "submission_0002",
      turnId: "T01",
      turnNumber: 1,
      action: "Wait.",
      selectedOption: null,
      result: turnResult(),
      protectedBlocks: [],
      narrative: { originalText: "The room stays quiet.", disposition: { kind: "USE_ORIGINAL" } },
      projection: {
        stateRevision: { revision: 1 },
        causalEvents: [],
        delayedEvents: [],
        projectionSummary: {},
      },
      modelLedger: [],
      previousCanon: "",
    });
    await writeFile(
      path.join(paths.root, ...committed.head.artifactDirectory.split("/"), "proposed-state.json"),
      "{}\n",
      "utf8",
    );
    await assert.rejects(() => repository.loadHead(), /ATOMIC_HEAD_CORRUPT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function turnResult(): TurnResult {
  return {
    runId: "atomic_run_01",
    turnId: "T01",
    turnNumber: 1,
    narration: "The clerk waits beside the unsigned order.",
    options: [],
    framing: "",
    tension: "reader-directed",
    storyComplete: false,
    causalDelta: {
      turnId: "T01",
      source: "free-text",
      readerAction: "Wait.",
      immediateIntent: "Wait.",
      protagonistScope: "bounded-action",
      stopCondition: "The clerk asks for a decision.",
      allowedKnowledge: [],
      forbiddenKnowledge: [],
      evidenceSubjects: [],
      beatContract: null,
      scenePacket: null,
      durableHints: [],
      requiredNarrativeFacts: [],
    },
    warnings: [],
    narrator: {
      text: "The clerk waits beside the unsigned order.",
      model: "test-model",
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
    },
    committedAt: "2026-08-03T00:00:00.000Z",
  };
}
