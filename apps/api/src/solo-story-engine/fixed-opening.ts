import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getStoryPackageManifestPath, type LoadedRuntimeStoryPackage } from "@ai-story/templates";
import type { StoryDecision, StoryTurnPublishedOutput } from "./types";
import { inspectPlayerFacingNarrative } from "./player-facing-narrative-guard";

export type FixedStoryOpening = {
  schemaVersion: "fixed_story_opening_v1";
  worldId: string;
  packageVersion: string;
  nodeId: string;
  perspectiveRoleKey: string;
  prologueNarrative: string;
  story: StoryTurnPublishedOutput["story"];
  endingState: StoryTurnPublishedOutput["endingState"];
  decisions: StoryDecision[];
};

export function loadFixedStoryOpening(
  worldId: string,
  loadedPackage: LoadedRuntimeStoryPackage
): { opening: FixedStoryOpening; contentHash: string } {
  const path = resolve(dirname(getStoryPackageManifestPath(worldId)), "opening.json");
  const raw = readFileSync(path, "utf8");
  const value = JSON.parse(raw) as FixedStoryOpening;
  validate(value, loadedPackage);
  return {
    opening: value,
    contentHash: createHash("sha256").update(raw).digest("hex")
  };
}

export function fixedOpeningOutput(opening: FixedStoryOpening): StoryTurnPublishedOutput {
  return {
    schemaVersion: "solo-story-turn-v1",
    resultType: "PUBLISHED_TURN",
    story: opening.story,
    resolution: {
      confirmedResolutionId: `authored-opening:${opening.nodeId}`,
      outcome: "APPLIED",
      observableOutcome: "The authored opening has been loaded from the versioned story package."
    },
    endingState: opening.endingState,
    decisions: opening.decisions,
    grounding: {
      usedScriptSourceIds: [],
      usedStoryCardIds: [],
      usedCanonFactIds: [],
      advancedMainlineQuestionIds: [],
      paidPendingConsequenceIds: [],
      stagedDirectedBeatId: null,
      deferredConsequences: []
    }
  };
}

function validate(value: FixedStoryOpening, loaded: LoadedRuntimeStoryPackage) {
  if (!value || value.schemaVersion !== "fixed_story_opening_v1") fail("schemaVersion");
  if (value.worldId !== loaded.storyPackage.worldId) fail("worldId");
  if (value.packageVersion !== loaded.storyPackage.packageVersion) fail("packageVersion");
  if (value.nodeId !== loaded.storyPackage.openingNodeId) fail("nodeId");
  if (value.perspectiveRoleKey !== "zhejiang_governor") fail("perspectiveRoleKey");
  requireText(value.prologueNarrative, "prologueNarrative");
  requireText(value.story?.title, "story.title");
  requireText(value.story?.resultNarrative, "story.resultNarrative");
  requireText(value.story?.nextSituationNarrative, "story.nextSituationNarrative");
  const proseIssues = inspectPlayerFacingNarrative({
    text: `${value.story.resultNarrative}\n\n${value.story.nextSituationNarrative}`,
    forbiddenFlattening: ["执行边界", "复核权争夺", "证据链状态"],
    requireSceneMotion: true
  });
  if (proseIssues.length) fail(`story.playerFacingProse:${proseIssues.map((issue) => issue.code).join(",")}`);
  requireText(value.endingState?.timeLabel, "endingState.timeLabel");
  requireText(value.endingState?.locationLabel, "endingState.locationLabel");
  requireText(value.endingState?.tension, "endingState.tension");
  if (!Array.isArray(value.endingState?.presentEntityRefs)) fail("endingState.presentEntityRefs");
  if (!Array.isArray(value.endingState?.visibleChanges)) fail("endingState.visibleChanges");
  if (!Array.isArray(value.endingState?.surfacedConsequenceIds)) fail("endingState.surfacedConsequenceIds");
  if (!Array.isArray(value.decisions) || value.decisions.length < 2 || value.decisions.length > 4) fail("decisions");
  for (const [index, decision] of value.decisions.entries()) {
    requireText(decision?.decisionId, `decisions[${index}].decisionId`);
    requireText(decision?.label, `decisions[${index}].label`);
    requireText(decision?.description, `decisions[${index}].description`);
    requireText(decision?.intent, `decisions[${index}].intent`);
    requireText(decision?.method, `decisions[${index}].method`);
    requireText(decision?.targetRef?.id, `decisions[${index}].targetRef.id`);
    requireText(decision?.targetRef?.label, `decisions[${index}].targetRef.label`);
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) fail(label);
}

function fail(field: string): never {
  throw new Error(`FIXED_STORY_OPENING_INVALID:${field}`);
}
