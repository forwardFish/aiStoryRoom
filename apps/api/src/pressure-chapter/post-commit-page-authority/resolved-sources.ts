import { isSha256 } from "@ai-story/shared";
import type { SubmitPageAuthoritySnapshotV1 } from "../decision-automation/contracts";
import type { ProjectPressureChapterGameProjectionFromSourcesV1 } from "../game-projection/contracts";
import type { PostCommitPageAuthorityReceiptV1 } from "./contracts";

export interface PostCommitResolvedSourcesV1
extends ProjectPressureChapterGameProjectionFromSourcesV1 {
  presentationAlreadyResolved: true;
  resolvedChapterSummary: ProjectPressureChapterGameProjectionFromSourcesV1["resolvedChapterSummary"];
}

/** Pure M1 + M2 merge. It has no port, clock, transaction, reader or Provider. */
export function compilePostCommitResolvedSourcesV1(input: Readonly<{
  before: SubmitPageAuthoritySnapshotV1;
  committed: PostCommitPageAuthorityReceiptV1;
}>): PostCommitResolvedSourcesV1 {
  const before = structuredClone(input.before);
  const committed = structuredClone(input.committed);
  const oldSources = before.page.sources;
  if ("chapterSource" in oldSources) fail("before.page.sources", "DYNAMIC_CHAPTER_REQUIRED");
  if (
    !isSha256(before.submitSnapshotHash)
    || !isSha256(before.page.snapshotHash)
    || !isSha256(committed.receiptHash)
    || !isSha256(committed.narrative.identityHash)
    || committed.runId !== before.viewer.runId
    || committed.routeHash !== before.authority.routeSnapshot.routeHash
    || committed.viewerSeatId !== before.viewer.seatId
    || committed.sourceChapterRuntimeId !== before.authority.chapter.chapterRuntimeId
    || committed.sourceDecisionPointId !== before.authority.chapter.activeDecision?.decisionPointId
    || committed.chapterRuntimeId !== committed.chapter.chapterRuntimeId
    || committed.chapterId !== committed.chapter.currentChapterId
    || committed.workingRevision !== committed.workingProjection.state.revision
    || committed.workingProjection.key.chapterRuntimeId !== committed.chapterRuntimeId
    || committed.workingProjection.routeHash !== committed.routeHash
    || committed.chapterDescriptor.descriptorHash !== committed.chapter.descriptorHash
    || committed.narrative.runId !== committed.runId
    || committed.narrative.routeHash !== committed.routeHash
    || committed.narrative.viewerSeatId !== committed.viewerSeatId
    || committed.narrative.chapterRuntimeId !== committed.chapterRuntimeId
    || committed.narrative.workingRevision !== committed.workingRevision
  ) fail("authority", "IDENTITY_OR_HASH_MISMATCH");

  const worldSource = committed.frozenWorldState
    ? {
        runId: committed.runId,
        routeHash: committed.routeHash,
        worldSequence: committed.frozenWorldState.worldSequence,
        worldStateHash: committed.frozenWorldState.stateHash,
        metrics: committed.beforeWorldSource.metrics.map((metric) => {
          const value = committed.frozenWorldState!.tracks.values[metric.trackId];
          if (!Number.isFinite(value)) fail("frozenWorldState.tracks", metric.trackId);
          return { ...metric, value, displayValue: String(value) };
        }),
      }
    : structuredClone(committed.beforeWorldSource);
  const narrativeSource = {
    runId: committed.runId,
    routeHash: committed.routeHash,
    viewerSeatId: committed.viewerSeatId,
    chapterRuntimeId: committed.chapterRuntimeId,
    status: "PENDING" as const,
    projectionKind: committed.narrative.projectionKind,
    sourceAuthority: committed.narrative.sourceAuthority,
    sourceId: committed.narrative.sourceId,
    sourceCommitHash: committed.narrative.sourceCommitHash,
    text: null,
    contentHash: null,
    renderMode: null,
    identityHash: committed.narrative.identityHash,
  };
  return deepFreeze({
    runId: committed.runId,
    subjectId: before.viewer.subjectId,
    roomId: before.viewer.roomId,
    routeSnapshot: structuredClone(before.authority.routeSnapshot),
    viewerSeatId: committed.viewerSeatId,
    chapter: structuredClone(committed.chapter),
    workingProjection: structuredClone(committed.workingProjection),
    chapterDescriptor: structuredClone(committed.chapterDescriptor),
    viewerSource: structuredClone(committed.beforeViewerSource),
    worldSource,
    narrativeSource,
    feedPage: structuredClone(committed.beforeFeedPage),
    presentationAlreadyResolved: true,
    resolvedChapterSummary: structuredClone(before.page.resolvedChapterSummary),
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function fail(path: string, detail: string): never {
  throw new Error(`PRESSURE_POST_COMMIT_RESOLVED_SOURCES_INVALID:${path}:${detail}`);
}
