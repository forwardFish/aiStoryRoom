import type { AEmotionFeedPageV1 } from "../a-emotion/contracts";
import type { ParticipantModeV1 } from "../contracts/route";
import type { SeatIdV1, TrackIdV1 } from "../contracts/domain";
import type {
  NarrativeProjectionKindV1,
  NarrativeSourceAuthorityV1,
  NarrativeStatusV1,
} from "../contracts/narrative";

export const PRESSURE_CHAPTER_GAME_PROJECTION_SCHEMA_V1 =
  "pressure_chapter_game_projection_v1" as const;
export const PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1 =
  "pressure_chapter_game_command_v1" as const;

export type PressureGameChapterIdV1 =
  | "P0"
  | "N1"
  | "N2"
  | "N3"
  | "N4"
  | "N5"
  | "N6"
  | "N7";
export type PressureGameChapterPhaseV1 =
  | "ACTIVE"
  | "RESOLVING_BEAT"
  | "SETTLING"
  | "FROZEN"
  | "FINALE_REQUESTED";
export type PressureGameWorkbenchV1 = "TALK" | "INVESTIGATE" | "TOKEN" | "PLAN" | "DEFER";

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

export interface PressureGameViewerProjectionV1 {
  seatId: SeatIdV1;
  roleName: string;
  control: {
    mode: "HUMAN_ACTIVE" | "AI_ACTIVE";
    controlEpoch: number;
    canSubmit: boolean;
    canReclaim: boolean;
    submissionFenceToken: string | null;
    reclaimFenceToken: string | null;
  };
}

export interface PressureGameMetricProjectionV1 {
  trackId: TrackIdV1;
  label: string;
  value: number;
  displayValue: string;
  tone: "DEFAULT" | "GOOD" | "WARN" | "DANGER";
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

export interface PressureGameDecisionProjectionV1 {
  decisionPointId: string;
  mode: "SOLO_BEAT" | "TARGETED_INTERACTION" | "SYNC_CONTEST";
  requirement: "REQUIRED" | "NOT_REQUIRED";
  title: string;
  summary: string;
  expectedWorkingRevision: number;
  options: Array<{
    code: string;
    label: string;
    description: string;
    actionType: string;
    preferredEntry: PressureGameWorkbenchV1;
  }>;
  submitLabel: string;
  customActionAllowed: boolean;
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

export interface PressureChapterGameProjectionV1 {
  schemaVersion: typeof PRESSURE_CHAPTER_GAME_PROJECTION_SCHEMA_V1;
  projectionVersion: number;
  roomId: string;
  runId: string;
  route: PressureGameRouteProjectionV1;
  chapter: PressureGameChapterProjectionV1;
  viewer: PressureGameViewerProjectionV1;
  metrics: PressureGameMetricProjectionV1[];
  situation: {
    goal: string;
    risk: string;
    judgment: string;
  };
  resources: PressureGameResourceProjectionV1[];
  tokens: PressureGameTokenProjectionV1[];
  decision: PressureGameDecisionProjectionV1 | null;
  capabilities: {
    canSubmitDecision: boolean;
    canTalk: boolean;
    canInvestigate: boolean;
    canUseToken: boolean;
    canPlan: boolean;
    canReclaimControl: boolean;
    allowedActionTypes: string[];
  };
  narrative: PressureGameNarrativeProjectionV1;
  feedPage: AEmotionFeedPageV1;
  projectionHash: string;
}

interface PressureChapterGameCommandBaseV1 {
  schemaVersion: typeof PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1;
  runId: string;
  routeHash: string;
  chapterRuntimeId: string;
  chapterId: PressureGameChapterIdV1;
  seatId: SeatIdV1;
  controlEpoch: number;
  expectedWorkingRevision: number;
}

export interface PressureChapterSubmitDecisionCommandV1
  extends PressureChapterGameCommandBaseV1 {
  commandType: "SUBMIT_DECISION";
  decisionPointId: string;
  submissionFenceToken: string;
  idempotencyKey: string;
  optionCode: string | null;
  customText: string | null;
  /**
   * Viewer-visible A-Emotion event selected from the current feed. The server
   * accepts it only for the two frozen N6 investigation actions and compiles
   * the canonical responseToEventId payload itself. Every other action must
   * submit null.
   */
  sourceEventId: string | null;
}

export interface PressureChapterOpenWorkbenchCommandV1
  extends PressureChapterGameCommandBaseV1 {
  commandType: "OPEN_WORKBENCH";
  workbench: PressureGameWorkbenchV1;
  actionCode: string;
  sourceEventId: string | null;
}

export type PressureChapterGameCommandV1 =
  | PressureChapterSubmitDecisionCommandV1
  | PressureChapterOpenWorkbenchCommandV1;
