import assert from "node:assert/strict";
import test from "node:test";
import { PressurePostCommitTurnUpdateCoordinatorV1 } from "./coordinator";

test("action receipt returns before the background projection and later publishes one ready update", async () => {
  const scheduled: Array<() => void> = [];
  const coordinator = new PressurePostCommitTurnUpdateCoordinatorV1({
    nowMs: () => 1_000,
    schedule: (task) => scheduled.push(task),
  });
  const projection = {
    schemaVersion: "pressure_chapter_game_projection_v1",
    runId: "run-1",
    viewer: { seatId: "zhejiang_governor" },
  } as never;
  const receipt = coordinator.start({
    runId: "run-1",
    subjectId: "user-1",
    idempotencyKey: "decision-1",
    chapterRuntimeId: "chapter-1",
    chapterId: "N1",
    viewerSeatId: "zhejiang_governor",
    savedActionId: "action-1",
    nextBeatId: "N1.B02",
    nextDecisionPointId: "N1.dispatch_route",
    async load() { return projection; },
  });
  assert.equal(receipt.status, "ACTION_SAVED");
  assert.equal(scheduled.length, 1);
  assert.equal(coordinator.read({
    runId: "run-1",
    subjectId: "user-1",
    updateKey: receipt.updateKey,
    chapterRuntimeId: "chapter-1",
  }).status, "PENDING");

  scheduled[0]!();
  await Promise.resolve();
  await Promise.resolve();
  const ready = coordinator.read({
    runId: "run-1",
    subjectId: "user-1",
    updateKey: receipt.updateKey,
    chapterRuntimeId: "chapter-1",
  });
  assert.equal(ready.status, "READY");
  assert.deepEqual(ready.projection, projection);
  assert.equal(coordinator.start({
    runId: "run-1",
    subjectId: "user-1",
    idempotencyKey: "decision-1",
    chapterRuntimeId: "chapter-1",
    chapterId: "N1",
    viewerSeatId: "zhejiang_governor",
    savedActionId: "action-1",
    nextBeatId: "N1.B02",
    nextDecisionPointId: "N1.dispatch_route",
    async load() { throw new Error("must not rerun"); },
  }).updateKey, receipt.updateKey);
});

test("turn update is viewer scoped and background failure is sanitized", async () => {
  const scheduled: Array<() => void> = [];
  const coordinator = new PressurePostCommitTurnUpdateCoordinatorV1({
    schedule: (task) => scheduled.push(task),
  });
  const receipt = coordinator.start({
    runId: "run-2",
    subjectId: "user-2",
    idempotencyKey: "decision-2",
    chapterRuntimeId: "chapter-2",
    chapterId: "N1",
    viewerSeatId: "zhejiang_governor",
    savedActionId: "action-2",
    nextBeatId: "N1.B02",
    nextDecisionPointId: "N1.dispatch_route",
    async load() { throw new Error("private provider detail"); },
  });
  assert.equal(coordinator.read({
    runId: "run-2",
    subjectId: "another-user",
    updateKey: receipt.updateKey,
    chapterRuntimeId: "chapter-2",
  }).status, "EXPIRED");
  scheduled[0]!();
  await Promise.resolve();
  await Promise.resolve();
  const failed = coordinator.read({
    runId: "run-2",
    subjectId: "user-2",
    updateKey: receipt.updateKey,
    chapterRuntimeId: "chapter-2",
  });
  assert.deepEqual(failed, {
    schemaVersion: "pressure_post_commit_turn_update_v1",
    updateKey: receipt.updateKey,
    runId: "run-2",
    chapterRuntimeId: "chapter-2",
    status: "FAILED",
    sceneText: null,
    projection: null,
  });
});

test("scene text is published incrementally before the completed projection", async () => {
  const scheduled: Array<() => void> = [];
  let releaseProjection!: () => void;
  const projectionGate = new Promise<void>((resolve) => { releaseProjection = resolve; });
  const coordinator = new PressurePostCommitTurnUpdateCoordinatorV1({
    schedule: (task) => scheduled.push(task),
  });
  const projection = {
    schemaVersion: "pressure_chapter_game_projection_v1",
    runId: "run-stream",
    viewer: { seatId: "zhejiang_governor" },
  } as never;
  const receipt = coordinator.start({
    runId: "run-stream",
    subjectId: "user-stream",
    idempotencyKey: "decision-stream",
    chapterRuntimeId: "chapter-stream",
    chapterId: "N1",
    viewerSeatId: "zhejiang_governor",
    savedActionId: "action-stream",
    nextBeatId: "N1.B02",
    nextDecisionPointId: "N1.dispatch_route",
    async load(publishSceneText) {
      publishSceneText("第一句真正的AI剧情。\n\n第二段正在继续生成。");
      await projectionGate;
      return projection;
    },
  });
  scheduled[0]!();
  await Promise.resolve();
  const streaming = coordinator.read({
    runId: "run-stream",
    subjectId: "user-stream",
    updateKey: receipt.updateKey,
    chapterRuntimeId: "chapter-stream",
  });
  assert.equal(streaming.status, "STREAMING");
  assert.match(streaming.sceneText ?? "", /真正的AI剧情/u);
  assert.equal(streaming.projection, null);

  releaseProjection();
  await Promise.resolve();
  await Promise.resolve();
  const ready = coordinator.read({
    runId: "run-stream",
    subjectId: "user-stream",
    updateKey: receipt.updateKey,
    chapterRuntimeId: "chapter-stream",
  });
  assert.equal(ready.status, "READY");
  assert.equal(ready.sceneText, null);
  assert.deepEqual(ready.projection, projection);
});
