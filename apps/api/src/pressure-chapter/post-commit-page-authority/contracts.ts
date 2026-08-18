import type {
  ChapterIdV1,
  NarrativeProjectionKindV1,
  NarrativeSourceAuthorityV1,
  SeatIdV1,
  WorldStateV1,
} from "@ai-story/shared";
import type { AuthoredChapterRuntimeV1, ChapterOrchestratorStateV1 } from "../orchestrator/contracts";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import type {
  AEmotionFeedPagePortV1,
  PressureGameViewerSourceV1,
  PressureGameWorldSourceV1,
} from "../game-projection/contracts";

export interface PostCommitNarrativeIdentityV1 {
  schemaVersion: "pressure_post_commit_narrative_identity_v1";
  runId: string;
  routeHash: string;
  viewerSeatId: SeatIdV1;
  chapterRuntimeId: string;
  decisionPointId: string;
  workingRevision: number;
  jobId: string;
  projectionKind: Exclude<NarrativeProjectionKindV1, "FINALE_NARRATIVE">;
  sourceAuthority: Exclude<NarrativeSourceAuthorityV1, "FINALE_FROZEN" | "LEGACY_TERMINAL_COMMITTED">;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  narrativeProfileVersion: string;
  outboxDedupeKey: string;
  audienceKey: string;
  status: "PENDING";
  identityHash: string;
}

export interface PostCommitPageAuthorityReceiptV1 {
  schemaVersion: "pressure_post_commit_page_authority_receipt_v1";
  batchId: string;
  runId: string;
  routeHash: string;
  viewerSeatId: SeatIdV1;
  sourceChapterRuntimeId: string;
  sourceChapterId: ChapterIdV1;
  sourceDecisionPointId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  decisionPointId: string | null;
  workingRevision: number;
  chapter: ChapterOrchestratorStateV1;
  workingProjection: WorkingLedgerProjectionV1;
  chapterDescriptor: AuthoredChapterRuntimeV1;
  frozenWorldState: WorldStateV1 | null;
  beforeViewerSource: PressureGameViewerSourceV1;
  beforeWorldSource: PressureGameWorldSourceV1;
  beforeFeedPage: AEmotionFeedPagePortV1;
  narrative: PostCommitNarrativeIdentityV1;
  receiptHash: string;
}

export interface PostCommitProjectionAuthorityV1 {
  chapter: ChapterOrchestratorStateV1;
  workingProjection: WorkingLedgerProjectionV1;
  chapterDescriptor: AuthoredChapterRuntimeV1;
  frozenWorldState: WorldStateV1 | null;
  narrativeJobs: import("@ai-story/shared").OpenNovelNarrativeProjectionJobV1[];
  aEmotionEmissions: import("../a-emotion-production/content-source").AEmotionAuthorityEmissionV1[];
}
