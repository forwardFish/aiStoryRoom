import { sha256Canonical, type OpenNovelNarrativeProjectionJobV1 } from "@ai-story/shared";
import type { SubmitPageAuthoritySnapshotV1 } from "../decision-automation/contracts";
import type {
  PostCommitNarrativeIdentityV1,
  PostCommitPageAuthorityReceiptV1,
  PostCommitProjectionAuthorityV1,
} from "./contracts";

export function compilePostCommitPageAuthorityReceiptV1(input: Readonly<{
  batchId: string;
  before: SubmitPageAuthoritySnapshotV1;
  committed: PostCommitProjectionAuthorityV1;
}>): PostCommitPageAuthorityReceiptV1 {
  const before = structuredClone(input.before);
  const committed = structuredClone(input.committed);
  const sources = before.page.sources;
  if ("chapterSource" in sources) fail("before.page.sources", "DYNAMIC_CHAPTER_REQUIRED");
  const job = selectNarrativeJob(committed.narrativeJobs, before.viewer.seatId);
  const decisionPointId = committed.chapter.activeDecision?.decisionPointId ?? null;
  const narrative = sealNarrativeIdentity({
    schemaVersion: "pressure_post_commit_narrative_identity_v1",
    runId: before.viewer.runId,
    routeHash: before.authority.routeSnapshot.routeHash,
    viewerSeatId: before.viewer.seatId,
    chapterRuntimeId: before.authority.chapter.chapterRuntimeId,
    decisionPointId: before.authority.chapter.activeDecision!.decisionPointId,
    workingRevision: committed.workingProjection.state.revision,
    jobId: job.jobId,
    projectionKind: job.projectionKind as PostCommitNarrativeIdentityV1["projectionKind"],
    sourceAuthority: job.sourceAuthority as PostCommitNarrativeIdentityV1["sourceAuthority"],
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    narrativeProfileVersion: job.narrativeProfileVersion,
    outboxDedupeKey: job.idempotencyKey,
    audienceKey: job.audience.kind === "PUBLIC" ? "public" : job.audience.seatId!,
    status: "PENDING",
  });
  const body = {
    schemaVersion: "pressure_post_commit_page_authority_receipt_v1" as const,
    batchId: input.batchId,
    runId: before.viewer.runId,
    routeHash: before.authority.routeSnapshot.routeHash,
    viewerSeatId: before.viewer.seatId,
    sourceChapterRuntimeId: before.authority.chapter.chapterRuntimeId,
    sourceChapterId: before.authority.chapter.currentChapterId,
    sourceDecisionPointId: before.authority.chapter.activeDecision!.decisionPointId,
    chapterRuntimeId: committed.chapter.chapterRuntimeId,
    chapterId: committed.chapter.currentChapterId,
    decisionPointId,
    workingRevision: committed.workingProjection.state.revision,
    chapter: committed.chapter,
    workingProjection: committed.workingProjection,
    chapterDescriptor: committed.chapterDescriptor,
    frozenWorldState: committed.frozenWorldState,
    beforeViewerSource: sources.viewerSource,
    beforeWorldSource: sources.worldSource,
    beforeFeedPage: sources.feedPage,
    narrative,
  };
  return Object.freeze({ ...body, receiptHash: sha256Canonical(receiptHashBody(body)) });
}

function selectNarrativeJob(
  jobs: readonly OpenNovelNarrativeProjectionJobV1[],
  viewerSeatId: string,
): OpenNovelNarrativeProjectionJobV1 {
  const eligible = jobs.filter((job) => job.audience.kind === "PUBLIC" || job.audience.seatId === viewerSeatId);
  if (eligible.length !== 1) fail("committed.narrativeJobs", "EXACT_VIEWER_JOB_REQUIRED");
  return structuredClone(eligible[0]!);
}

function sealNarrativeIdentity(
  draft: Omit<PostCommitNarrativeIdentityV1, "identityHash">,
): PostCommitNarrativeIdentityV1 {
  return Object.freeze({ ...draft, identityHash: sha256Canonical(draft) });
}

function receiptHashBody(body: Omit<PostCommitPageAuthorityReceiptV1, "receiptHash">) {
  return {
    schemaVersion: body.schemaVersion,
    batchId: body.batchId,
    runId: body.runId,
    routeHash: body.routeHash,
    viewerSeatId: body.viewerSeatId,
    sourceChapterRuntimeId: body.sourceChapterRuntimeId,
    sourceDecisionPointId: body.sourceDecisionPointId,
    chapterRuntimeId: body.chapterRuntimeId,
    decisionPointId: body.decisionPointId,
    workingRevision: body.workingRevision,
    orchestratorHash: body.chapter.orchestratorHash,
    workingStateHash: body.workingProjection.stateHash,
    workingHeadHash: body.workingProjection.headHash,
    descriptorHash: body.chapterDescriptor.descriptorHash,
    frozenWorldStateHash: body.frozenWorldState?.stateHash ?? null,
    narrativeIdentityHash: body.narrative.identityHash,
    beforeViewerSource: body.beforeViewerSource,
    beforeWorldSource: body.beforeWorldSource,
    beforeFeedPage: body.beforeFeedPage,
  };
}

function fail(path: string, detail: string): never {
  throw new Error(`PRESSURE_POST_COMMIT_RECEIPT_INVALID:${path}:${detail}`);
}
