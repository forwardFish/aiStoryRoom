import type {
  NarrativeProjectionKindV1,
  NarrativeSourceAuthorityV1,
  NarrativeStatusV1,
  ParticipantModeV1,
  SeatIdV1,
  TrackIdV1,
} from "@ai-story/shared";
import type { StoredRunRouteReaderPort } from "../run-router";
import type { AEmotionViewerProjectionPortV1 } from "../a-emotion/ports";

export const PRESSURE_CHAPTER_GAME_PROJECTION_SCHEMA_V1 =
  "pressure_chapter_game_projection_v1" as const;

export type PressureGameChapterIdV1 = "P0" | "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
export type PressureGameChapterPhaseV1 =
  | "ACTIVE"
  | "RESOLVING_BEAT"
  | "SETTLING"
  | "FROZEN"
  | "FINALE_REQUESTED";
export type PressureGameWorkbenchV1 =
  | "TALK"
  | "INVESTIGATE"
  | "TOKEN"
  | "PLAN"
  | "DEFER";

export interface PressureGameRouteProjectionV1 {
  routeHash: string;
  participantMode: ParticipantModeV1;
  runtimeProfile: string;
  contentPackageVersion: string;
  controlTopologyVersion: string;
}

export interface PressureGameChapterProjectionV1 {
  chapterRuntimeId: string;
  chapterId: PressureGameChapterIdV1;
  chapterNumber: number;
  title: string;
  phase: PressureGameChapterPhaseV1;
  workingRevision: number;
}

export interface PressureGameViewerControlProjectionV1 {
  mode: "HUMAN_ACTIVE" | "AI_ACTIVE";
  controlEpoch: number;
  canSubmit: boolean;
  canReclaim: boolean;
  submissionFenceToken: string | null;
  reclaimFenceToken: string | null;
}

export interface PressureGameViewerProjectionV1 {
  seatId: SeatIdV1;
  roleName: string;
  control: PressureGameViewerControlProjectionV1;
}

export interface PressureGameMetricProjectionV1 {
  trackId: TrackIdV1;
  label: string;
  value: number;
  displayValue: string;
  tone: "DEFAULT" | "GOOD" | "WARN" | "DANGER";
}

export interface PressureGameSituationProjectionV1 {
  goal: string;
  risk: string;
  judgment: string;
}

export interface PressureGameResourceProjectionV1 {
  resourceId: string;
  label: string;
  value: number;
  displayValue: string;
}

export interface PressureGameTokenProjectionV1 {
  tokenId: string;
  label: string;
  description: string;
  quantity: number;
  available: boolean;
}

export interface PressureGameDecisionOptionV1 {
  code: string;
  label: string;
  description: string;
  actionType: string;
  preferredEntry: PressureGameWorkbenchV1;
}

export interface PressureGameDecisionProjectionV1 {
  decisionPointId: string;
  mode: "SOLO_BEAT" | "TARGETED_INTERACTION" | "SYNC_CONTEST";
  requirement: "REQUIRED" | "NOT_REQUIRED";
  title: string;
  summary: string;
  expectedWorkingRevision: number;
  options: PressureGameDecisionOptionV1[];
  submitLabel: string;
  customActionAllowed: boolean;
}

export interface PressureGameCapabilitiesV1 {
  canSubmitDecision: boolean;
  canTalk: boolean;
  canInvestigate: boolean;
  canUseToken: boolean;
  canPlan: boolean;
  canReclaimControl: boolean;
  allowedActionTypes: string[];
}

export interface PressureGameNarrativeProjectionV1 {
  status: NarrativeStatusV1;
  projectionKind: Exclude<NarrativeProjectionKindV1, "FINALE_NARRATIVE">;
  sourceAuthority: Exclude<
    NarrativeSourceAuthorityV1,
    "FINALE_FROZEN" | "LEGACY_TERMINAL_COMMITTED"
  >;
  sourceId: string;
  sourceCommitHash: string;
  text: string | null;
  contentHash: string | null;
  renderMode: "PROVIDER" | "AUTHORED_FALLBACK" | null;
}

export interface AEmotionFeedSourceItemPortV1 extends AEmotionViewerProjectionPortV1 {
  isUnread: boolean;
  isAcknowledged: boolean;
  isResolved: boolean;
}

export type AEmotionFeedItemPortV1 = Omit<
  AEmotionFeedSourceItemPortV1,
  "knownFactRefs"
>;

export interface AEmotionFeedSourcePagePortV1 {
  schemaVersion: "a_emotion_feed_page_v1";
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  items: AEmotionFeedSourceItemPortV1[];
  unreadCount: number;
  nextCursor: string | null;
  serverSequence: number;
}

export interface AEmotionFeedPagePortV1 extends Omit<AEmotionFeedSourcePagePortV1, "items"> {
  items: AEmotionFeedItemPortV1[];
}

export interface PressureChapterGameProjectionV1 {
  schemaVersion: typeof PRESSURE_CHAPTER_GAME_PROJECTION_SCHEMA_V1;
  projectionVersion: number;
  roomId: string;
  runId: string;
  route: PressureGameRouteProjectionV1;
  chapter: PressureGameChapterProjectionV1;
  viewer: PressureGameViewerProjectionV1;
  metrics: PressureGameMetricProjectionV1[];
  situation: PressureGameSituationProjectionV1;
  resources: PressureGameResourceProjectionV1[];
  tokens: PressureGameTokenProjectionV1[];
  decision: PressureGameDecisionProjectionV1 | null;
  capabilities: PressureGameCapabilitiesV1;
  narrative: PressureGameNarrativeProjectionV1;
  feedPage: AEmotionFeedPagePortV1;
  projectionHash: string;
}

export interface PressureGameChapterSourceV1 {
  runId: string;
  routeHash: string;
  /** Echoes the trusted viewer scope used to build the decision projection. */
  viewerSeatId: SeatIdV1;
  projectionVersion: number;
  chapter: PressureGameChapterProjectionV1;
  decision: PressureGameDecisionProjectionV1 | null;
}

export interface PressureGameViewerSourceV1 {
  roomId: string;
  runId: string;
  routeHash: string;
  subjectId: string;
  viewer: PressureGameViewerProjectionV1;
  situation: PressureGameSituationProjectionV1;
  resources: PressureGameResourceProjectionV1[];
  tokens: PressureGameTokenProjectionV1[];
}

export interface PressureGameWorldSourceV1 {
  runId: string;
  routeHash: string;
  worldSequence: number;
  worldStateHash: string;
  metrics: PressureGameMetricProjectionV1[];
}

export interface PressureGameNarrativeSourceV1
  extends PressureGameNarrativeProjectionV1 {
  runId: string;
  routeHash: string;
  viewerSeatId: SeatIdV1;
  chapterRuntimeId: string;
}

export interface PressureGameChapterReaderPort {
  readCurrent(input: {
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
  }): Promise<PressureGameChapterSourceV1 | null>;
}

/** Must be backed by W7's seat-scoped Audience Projector. */
export interface PressureGameViewerReaderPort {
  readViewer(input: {
    runId: string;
    subjectId: string;
  }): Promise<PressureGameViewerSourceV1 | null>;
}

export interface PressureGameWorldReaderPort {
  readWorld(runId: string): Promise<PressureGameWorldSourceV1 | null>;
}

/** Must read an already audience-filtered W9 artifact/status, never Provider raw output. */
export interface PressureGameNarrativeReaderPort {
  readCurrent(input: {
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
    chapterRuntimeId: string;
  }): Promise<PressureGameNarrativeSourceV1 | null>;
}

/** Must delegate to the already viewer-filtered A-Emotion FeedService. */
export interface PressureGameAEmotionFeedPort {
  list(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    cursor: string | null;
    limit: number;
  }): Promise<AEmotionFeedSourcePagePortV1>;
}

/** Server policy output; Web is forbidden from inferring these booleans. */
export interface PressureGameCapabilityReaderPort {
  readCapabilities(input: {
    runId: string;
    routeHash: string;
    subjectId: string;
    viewerSeatId: SeatIdV1;
    chapterRuntimeId: string;
    decisionPointId: string | null;
  }): Promise<PressureGameCapabilitiesV1>;
}

export interface ReadPressureChapterGameProjectionQueryV1 {
  runId: string;
  subjectId: string;
  feedCursor?: string | null;
  feedLimit?: number;
}

export type PressureGameRouteReaderPort = StoredRunRouteReaderPort;
