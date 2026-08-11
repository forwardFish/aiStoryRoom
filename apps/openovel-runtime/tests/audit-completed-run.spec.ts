import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditOpenNovelRun, type PlayerCheckpointReview } from "../src/audit.js";
import { workspacePaths } from "../src/paths.js";

test("acceptance audit treats a committed PART_END run as a stable completed Canon", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-audit-completed-"));
  const paths = workspacePaths(root, "completed_run");
  try {
    await Promise.all([
      mkdir(paths.canonDir, { recursive: true }),
      mkdir(paths.callsDir, { recursive: true }),
    ]);
    await writeFile(paths.metadata, JSON.stringify({
      runId: "completed_run",
      worldId: "sangtian",
      roleId: "zhejiang_governor",
      runtimeMode: "OPENOVEL_V1",
      storyPackageVersion: "candidate",
      openingVersion: "candidate",
      upstreamCommit: "test",
      packageVersion: "test",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:01:00.000Z",
      turnNumber: 1,
      status: "COMPLETED",
    }, null, 2) + "\n");
    await writeFile(paths.chapters, [
      "**读者选择**：收束本部分。",
      "",
      "人物在同一场景内完成交锋，第一部分在可见后果中结束。",
      "",
    ].join("\n"));
    await writeFile(paths.sceneLog, [
      { type: "reader_action", turnId: "T01" },
      { type: "foreground_narrative_disposition", turnId: "T01", narrativeOwner: "NARRATOR" },
      { type: "foreground_options", turnId: "T01" },
      { type: "turn_committed", turnId: "T01" },
    ].map((value) => JSON.stringify(value)).join("\n") + "\n");

    const report = await auditOpenNovelRun(paths, {
      targetTurns: 1,
      reviews: [review("G00", true), review("T01", false)],
    });

    assert.equal(report.status, "COMPLETED");
    assert.equal(report.technical.checks.canonReady, true);
    assert.equal(report.technical.passed, true);
    assert.equal(report.player.passed, true);
    assert.equal(report.verdict, "PASS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function review(checkpoint: "G00" | "T01", opening: boolean): PlayerCheckpointReview {
  return {
    checkpoint,
    actionResponded: opening ? null : true,
    choiceImpactVisible: opening ? null : true,
    novelLike: true,
    worldToneFit: true,
    npcAgency: true,
    playerAgencyPreserved: true,
    causalGrounded: true,
    coherent: true,
    optionsUnderstandable: true,
    optionsDistinct: true,
    optionsExecutable: true,
    freeInputAvailable: true,
    wantsToContinue: true,
    reportLike: false,
    majorContinuityError: false,
    blockingProblems: [],
  };
}
