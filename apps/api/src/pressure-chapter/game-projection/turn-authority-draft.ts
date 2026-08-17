import { sha256Canonical } from "@ai-story/shared";
import type {
  PressureGameChapterProjectionV1,
  PressureGameMetricProjectionV1,
  PressureGameNarrativeProjectionV1,
  PressureGameResourceProjectionV1,
  PressureGameSituationProjectionV1,
  PressureGameViewerProjectionV1,
} from "./contracts";

export interface PressureTurnAuthorityFactV1 {
  factId: string;
  text: string;
  source: "AUDIENCE_SAFE_GAME_PROJECTION";
}

/**
 * Internal, viewer-scoped grounding material for one presentation call.
 * It is never returned by `/game` and never becomes a second settlement authority.
 */
export interface PressureTurnAuthorityDraftV1 {
  schemaVersion: "pressure_turn_authority_draft_v1";
  chapter: Pick<
    PressureGameChapterProjectionV1,
    "chapterId" | "chapterRuntimeId" | "title" | "phase" | "workingRevision"
  >;
  viewer: Pick<PressureGameViewerProjectionV1, "seatId" | "roleName">;
  narrativeSource: Pick<
    PressureGameNarrativeProjectionV1,
    "status" | "projectionKind" | "sourceAuthority" | "sourceId" | "sourceCommitHash"
  >;
  currentAuthorityState: PressureTurnAuthorityFactV1[];
  allowedClaims: readonly [];
  authorityHash: string;
}

export interface CompilePressureTurnAuthorityDraftInputV1 {
  chapter: PressureGameChapterProjectionV1;
  viewer: PressureGameViewerProjectionV1;
  situation: PressureGameSituationProjectionV1;
  metrics: PressureGameMetricProjectionV1[];
  resources: PressureGameResourceProjectionV1[];
  narrative: PressureGameNarrativeProjectionV1;
  previousPlayerAction?: Readonly<{
    decisionPointId: string;
    actionType: string;
    displayText: string;
  }> | null;
}

/**
 * Pure compiler over the already sanitized, audience-safe game projection.
 * Narrative prose remains continuity material; durable facts come only from
 * the current situation, metric and resource projections.
 */
export function compilePressureTurnAuthorityDraftV1(
  input: Readonly<CompilePressureTurnAuthorityDraftInputV1>,
): PressureTurnAuthorityDraftV1 {
  const facts: PressureTurnAuthorityFactV1[] = [
    fact("situation.goal", input.situation.goal),
    fact("situation.risk", input.situation.risk),
    fact("situation.judgment", input.situation.judgment),
    ...(input.previousPlayerAction
      ? [fact("player.previousAction", input.previousPlayerAction.displayText)]
      : []),
    ...input.metrics.map((metric) => fact(
      `metric.${metric.trackId}`,
      `${metric.label}：${metric.displayValue}`,
    )),
    ...input.resources.map((resource) => fact(
      `resource.${resource.resourceId}`,
      `${resource.label}：${resource.displayValue}`,
    )),
  ];
  const base = {
    schemaVersion: "pressure_turn_authority_draft_v1" as const,
    chapter: {
      chapterId: input.chapter.chapterId,
      chapterRuntimeId: input.chapter.chapterRuntimeId,
      title: input.chapter.title,
      phase: input.chapter.phase,
      workingRevision: input.chapter.workingRevision,
    },
    viewer: {
      seatId: input.viewer.seatId,
      roleName: input.viewer.roleName,
    },
    narrativeSource: {
      status: input.narrative.status,
      projectionKind: input.narrative.projectionKind,
      sourceAuthority: input.narrative.sourceAuthority,
      sourceId: input.narrative.sourceId,
      sourceCommitHash: input.narrative.sourceCommitHash,
    },
    currentAuthorityState: facts,
    allowedClaims: [] as const,
  };
  return {
    ...base,
    authorityHash: sha256Canonical(base),
  };
}

function fact(factId: string, text: string): PressureTurnAuthorityFactV1 {
  const normalized = text.trim();
  if (!normalized) throw new Error(`PRESSURE_TURN_AUTHORITY_FACT_EMPTY:${factId}`);
  return {
    factId,
    text: normalized,
    source: "AUDIENCE_SAFE_GAME_PROJECTION",
  };
}
