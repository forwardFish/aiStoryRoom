import type { PressureViewerStoryPackV1 } from "../production-config/viewer-story-pack";

export type PressureOneCallStoryModeV1 = "TURN" | "CHAPTER_SUMMARY";

export interface PressureSummaryMetricAuthorityV1 {
  metricRef: string;
  label: string;
  before: number;
  delta: number;
  after: number;
  displayBefore: string;
  displayDelta: string;
  displayAfter: string;
}

export interface PressureChapterSummaryAuthorityV1 {
  chapterId: string;
  title: string;
  sourceCommitHash: string;
  closingNarrativeFallback: string;
  playerActions: Array<{ actionId: string; text: string }>;
  actualResults: Array<{ resultRef: string; text: string }>;
  completedObjectives: Array<{ objectiveRef: string; text: string }>;
  incompleteObjectives: Array<{ objectiveRef: string; text: string }>;
  metricChanges: PressureSummaryMetricAuthorityV1[];
  remainingPressures: Array<{ pressureRef: string; text: string }>;
  nextChapterId: string | null;
  nextChapterHookFallback: string;
}

export interface GeneratePressureOneCallStoryInputV1 {
  mode: PressureOneCallStoryModeV1;
  storyPack: PressureViewerStoryPackV1;
  turnFallback?: {
    sceneText: string;
    question: string;
  };
  summaryAuthority?: PressureChapterSummaryAuthorityV1;
}

export interface PressureGeneratedTurnV1 {
  mode: "TURN";
  sceneText: string;
  question: string;
  options: Array<{
    actionRef: string;
    actionType: string;
    label: string;
    description: string;
  }>;
  renderMode: "PROVIDER" | "DETERMINISTIC_FALLBACK";
  generationHash: string;
}

export interface PressureGeneratedChapterSummaryV1 {
  mode: "CHAPTER_SUMMARY";
  chapterId: string;
  title: string;
  closingNarrative: string;
  playerActions: string[];
  actualResults: string[];
  completedObjectives: string[];
  incompleteObjectives: string[];
  metricChanges: Array<{
    label: string;
    before: number;
    delta: number;
    after: number;
    displayBefore: string;
    displayDelta: string;
    displayAfter: string;
  }>;
  remainingPressures: string[];
  nextChapterHook: string;
  sourceCommitHash: string;
  renderMode: "PROVIDER" | "DETERMINISTIC_FALLBACK";
  generationHash: string;
}

export type PressureOneCallStoryOutputV1 =
  | PressureGeneratedTurnV1
  | PressureGeneratedChapterSummaryV1;

export interface PressureOneCallStoryProviderPortV1 {
  renderOneCallStory(
    context: Readonly<Record<string, unknown>>,
    onPrimaryText?: (text: string) => void,
  ): Promise<unknown>;
}
