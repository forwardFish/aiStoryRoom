import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { sha256Canonical } from "@ai-story/shared";
import type { SubmitPageAuthoritySnapshotV1 } from "../decision-automation/contracts";
import {
  compilePostCommitPageAuthorityReceiptV1,
  compilePostCommitResolvedSourcesV1,
  type PostCommitProjectionAuthorityV1,
} from "./index";

const hash = (value: string) => sha256Canonical(value);

test("M2 receipt and M3 resolved sources are deterministic, PENDING and pure", () => {
  const before = beforeSnapshot();
  const committed = committedAuthority();
  const firstReceipt = compilePostCommitPageAuthorityReceiptV1({ batchId: hash("batch"), before, committed });
  const secondReceipt = compilePostCommitPageAuthorityReceiptV1({ batchId: hash("batch"), before, committed });
  assert.deepEqual(secondReceipt, firstReceipt);
  assert.equal(firstReceipt.narrative.status, "PENDING");
  assert.equal(firstReceipt.narrative.chapterRuntimeId, "chapter-runtime-1");
  assert.equal(firstReceipt.narrative.workingRevision, 2);

  const first = compilePostCommitResolvedSourcesV1({ before, committed: firstReceipt });
  const second = compilePostCommitResolvedSourcesV1({ before, committed: secondReceipt });
  assert.deepEqual(second, first);
  assert.equal(first.presentationAlreadyResolved, true);
  assert.equal(first.narrativeSource.status, "PENDING");
  assert.equal(first.narrativeSource.identityHash, firstReceipt.narrative.identityHash);
  assert.equal(first.worldSource.metrics[0]?.value, 15);
});

test("M3 warm compiler p95 stays below 100ms", () => {
  const before = beforeSnapshot();
  const committed = committedAuthority();
  const receipt = compilePostCommitPageAuthorityReceiptV1({ batchId: hash("perf-batch"), before, committed });
  compilePostCommitResolvedSourcesV1({ before, committed: receipt });
  const samples = [];
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    compilePostCommitResolvedSourcesV1({ before, committed: receipt });
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  assert.ok(p95 <= 100, `M3 p95 ${p95}ms exceeded 100ms`);
});

function beforeSnapshot(): SubmitPageAuthoritySnapshotV1 {
  const chapter = {
    chapterRuntimeId: "chapter-runtime-1",
    currentChapterId: "N1",
    descriptorHash: hash("descriptor"),
    orchestratorHash: hash("orchestrator-before"),
    activeDecision: { decisionPointId: "N1.D1" },
  };
  const workingProjection = {
    key: { runId: "run-1", chapterRuntimeId: "chapter-runtime-1" },
    routeHash: hash("route"),
    chapterId: "N1",
    state: { revision: 1 },
    stateHash: hash("working-before"),
    headHash: hash("head-before"),
  };
  const page = {
    request: { roomId: "run-1", runId: "run-1", subjectId: "user-1", feedCursor: null },
    sources: {
      roomId: "run-1",
      runId: "run-1",
      subjectId: "user-1",
      viewerSeatId: "zhejiang_governor",
      routeSnapshot: { runId: "run-1", routeHash: hash("route") },
      chapter,
      workingProjection,
      chapterDescriptor: { chapterId: "N1", descriptorHash: hash("descriptor") },
      viewerSource: {
        roomId: "run-1", runId: "run-1", routeHash: hash("route"), subjectId: "user-1",
        viewer: { seatId: "zhejiang_governor" }, situation: {}, resources: [], tokens: [],
      },
      worldSource: {
        runId: "run-1", routeHash: hash("route"), worldSequence: 1, worldStateHash: hash("world-1"),
        metrics: [{ trackId: "civilian_land", label: "民心", value: 10, displayValue: "10", tone: "DEFAULT" }],
      },
      narrativeSource: {},
      feedPage: {
        schemaVersion: "a_emotion_feed_page_v1", roomId: "run-1", runId: "run-1",
        viewerSeatId: "zhejiang_governor", items: [], unreadCount: 0, nextCursor: null, serverSequence: 0,
      },
    },
    resolvedChapterSummary: null,
    snapshotHash: hash("page"),
  };
  return {
    schemaVersion: "pressure_submit_page_authority_snapshot_v1",
    authority: {
      routeSnapshot: page.sources.routeSnapshot,
      chapter,
      projection: workingProjection,
      snapshotHash: hash("authority"),
    },
    viewer: {
      roomId: "run-1", runId: "run-1", subjectId: "user-1",
      seatId: "zhejiang_governor", humanControllerId: "user-1",
    },
    page,
    submitSnapshotHash: hash("submit"),
  } as unknown as SubmitPageAuthoritySnapshotV1;
}

function committedAuthority(): PostCommitProjectionAuthorityV1 {
  return {
    chapter: {
      chapterRuntimeId: "chapter-runtime-1", currentChapterId: "N1",
      descriptorHash: hash("descriptor"), orchestratorHash: hash("orchestrator-after"),
      activeDecision: { decisionPointId: "N1.D2" },
    },
    workingProjection: {
      key: { runId: "run-1", chapterRuntimeId: "chapter-runtime-1" },
      routeHash: hash("route"), chapterId: "N1", state: { revision: 2 },
      stateHash: hash("working-after"), headHash: hash("head-after"),
    },
    chapterDescriptor: { chapterId: "N1", descriptorHash: hash("descriptor") },
    frozenWorldState: {
      worldSequence: 2, stateHash: hash("world-2"), tracks: { values: { civilian_land: 15 } },
    },
    narrativeJobs: [{
      jobId: "job-1", runId: "run-1", audience: { kind: "SEAT", seatId: "zhejiang_governor" },
      projectionKind: "BEAT_NARRATIVE", sourceAuthority: "CHAPTER_WORKING",
      sourceId: hash("source"), sourceCommitHash: hash("commit"), sourceContentHash: hash("content"),
      narrativeProfileVersion: "v1", idempotencyKey: "BEAT_NARRATIVE:run-1:zhejiang_governor:commit",
    }],
    aEmotionEmissions: [],
  } as unknown as PostCommitProjectionAuthorityV1;
}
