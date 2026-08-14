import { sha256Canonical } from "@ai-story/shared";
import { compileStoryPackAuthorialMaterialsV1 } from "./story-pack-authorial";
import { compileStoryPackAuthorityV1 } from "./story-pack-authority";
import { compileStoryPackDecisionV1 } from "./story-pack-decision";
import { storyFreeze } from "./story-pack-freeze";
import { compileStoryPackIdentityV1 } from "./story-pack-identity";
import { compileStoryPackPriorV1 } from "./story-pack-prior";
import type { CompilePressureViewerStoryPackInputV1 } from "./viewer-story-pack-input";
import type { PressureViewerStoryPackV1 } from "./viewer-story-pack-output";

/** Pure M2 compiler: database, Settlement, progression, Provider and cache are unreachable. */
export function compilePressureViewerStoryPackV1(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
): Readonly<PressureViewerStoryPackV1> {
  const identity = compileStoryPackIdentityV1(input);
  const prior = compileStoryPackPriorV1(input, identity);
  const providerInput = {
    ordinal: input.ordinal,
    previousNarrative: structuredClone(input.previousNarrative),
    previousAction: prior.previousAction,
    authorialMaterials: compileStoryPackAuthorialMaterialsV1(input, identity.viewerSeatId),
    visibleSeatResults: prior.visibleSeatResults,
    authority: compileStoryPackAuthorityV1(input, identity.viewerSeatId),
    nextDecision: compileStoryPackDecisionV1(input),
    authorityBoundary: {
      settlementAndCatalogAreAuthoritative: true as const,
      providerCannotCreateFactsMetricsResultsOrActions: true as const,
    },
  };
  const cacheIdentity = {
    runId: identity.runId,
    chapterRuntimeId: identity.chapterRuntimeId,
    beatId: identity.beatId,
    viewerSeatId: identity.viewerSeatId,
    authorityRevision: identity.authorityRevision,
  };
  const body = {
    schemaVersion: "pressure_viewer_story_pack_v1" as const,
    identity,
    cacheKey: sha256Canonical(cacheIdentity),
    providerInput,
  };
  return storyFreeze({
    ...body,
    storyPackHash: sha256Canonical(body),
  });
}
