export type NarrativeSourceRef = {
  sourceId: string;
  sourceSha256: string;
  chapterId: string;
  paragraphStartId: string;
  paragraphEndId: string;
  lineStart: number;
  lineEnd: number;
  textSpanSha256: string;
};

export type NarrativeSceneBeat = {
  ordinal: number;
  actorRole: string;
  observableMove: string;
  sceneFunction: string;
  reactionCue: string;
};

export type NarrativeDialogueTactic = {
  actorRole: string;
  surfaceMove: string;
  hiddenRisk: string;
  cadenceRule: string;
};

export type NarrativeScenePattern = {
  schemaVersion: "narrative-scene-pattern-v1";
  patternId: string;
  sourceSceneId: string;
  sourceRefs: NarrativeSourceRef[];
  sectionIds: string[];
  requirementIds: string[];
  decisionKernelIds: string[];
  actorRefs: string[];
  sourceClaimIds: string[];
  dramaticFunction: string;
  openingPressure: string;
  orderedBeats: NarrativeSceneBeat[];
  dialogueTactics: NarrativeDialogueTactic[];
  blockingPrinciples: string[];
  objectPowerMoves: Array<{
    objectLabel: string;
    observableUse: string;
    powerMeaning: string;
  }>;
  transferableTechniques: string[];
  forbiddenFlattening: string[];
  verbatimPolicy: "MECHANISM_ONLY_NO_VERBATIM_REUSE";
  reviewStatus: "APPROVED";
  reviewerId: string;
  approvedAt: string;
};

/**
 * Selects reusable scene grammar without knowing anything about a specific
 * story world. Story-specific compilers only provide structural bindings.
 */
export function selectNarrativeScenePatterns<T extends {
  assetType: string;
  sectionIds: string[];
  requirementIds: string[];
  decisionKernelIds: string[];
  payload: Record<string, unknown>;
}>(
  assets: T[],
  input: { sectionId: string; decisionKernelId: string; requirementIds: string[] },
  limit = 3
): T[] {
  const requirementIds = new Set(input.requirementIds);
  return assets
    .filter((asset) => asset.assetType === "NARRATIVE_SCENE_PATTERN")
    .filter((asset) => asset.sectionIds.includes(input.sectionId))
    .filter((asset) =>
      asset.decisionKernelIds.includes(input.decisionKernelId)
      || asset.requirementIds.some((requirementId) => requirementIds.has(requirementId))
    )
    .sort((left, right) => {
      const leftKernel = Number(left.decisionKernelIds.includes(input.decisionKernelId));
      const rightKernel = Number(right.decisionKernelIds.includes(input.decisionKernelId));
      if (leftKernel !== rightKernel) return rightKernel - leftKernel;
      const leftOverlap = left.requirementIds.filter((id) => requirementIds.has(id)).length;
      const rightOverlap = right.requirementIds.filter((id) => requirementIds.has(id)).length;
      return rightOverlap - leftOverlap;
    })
    .slice(0, limit);
}
