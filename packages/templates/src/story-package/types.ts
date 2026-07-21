export type StoryPackageVisibility = "public" | "role_scoped" | "hidden_until_revealed";

export type StoryPackageManifest = {
  schemaVersion: "story_package_manifest_v1";
  worldId: string;
  packageId: string;
  packageVersion: string;
  storyPackagePath: string;
  sourceMapPath: string;
  storyPackageSha256: string;
  sourceMapSha256: string;
};

export type StoryPackageSourceMapEntry = {
  sourceId: string;
  kind: "t0" | "t1" | "t2" | "t3";
  origin: "original_fact" | "derived_constraint" | "adapted" | "invented_for_game";
  chapterLabel: string;
  excerptLabel: string;
  sourceRefs: Array<{
    sourcePath: string;
    sourceSha256: string;
    lineStart: number;
    lineEnd: number;
  }>;
  adaptationDecisionId: string | null;
  adaptationNote: string;
};

export type StoryPackageAdaptationDecision = {
  adaptationDecisionId: string;
  title: string;
  decision: string;
  rationale: string;
  basedOnSourceIds: string[];
};

export type StoryPackageSourceMap = {
  schemaVersion: "story_source_map_v2";
  worldId: string;
  packageId: string;
  packageVersion: string;
  adaptationDecisions: StoryPackageAdaptationDecision[];
  entries: StoryPackageSourceMapEntry[];
};

export type StoryPackageCard = {
  cardId: string;
  kind: "role" | "location" | "institution" | "evidence" | "pressure" | "material" | "latent_truth";
  title: string;
  summary: string;
  sourceIds: string[];
  visibility: StoryPackageVisibility;
  visibleToRoleKeys?: string[];
  relatedNodeIds?: string[];
  tags?: string[];
};

export type StoryPackageRoleAcl = {
  roleKey: string;
  visibleCardIds: string[];
  hiddenCardIds: string[];
  visibleLatentTruthIds: string[];
  blockedLatentTruthIds: string[];
};

export type StoryPackageMainlineQuestion = {
  questionId: string;
  prompt: string;
  resolutionSignals: string[];
  sourceIds: string[];
};

export type StoryPackageLatentTruth = {
  truthId: string;
  title: string;
  statement: string;
  sourceIds: string[];
  revealWhen: string[];
  visibility: StoryPackageVisibility;
  visibleToRoleKeys?: string[];
};

export type StoryPackagePressure = {
  pressureId: string;
  label: string;
  summary: string;
  urgency: "low" | "medium" | "high";
  sourceIds: string[];
  relatedNodeIds: string[];
};

export type StoryPackageFloorObligation = {
  obligationId: string;
  dramaticPurpose: string;
  floorKind: "terminal" | "player_consequence" | "mainline" | "setup_payoff" | "actor_agency" | "stagnation";
  earliestAtTurn?: number;
  floorAtTurn: number;
  sourceIds: string[];
  preconditions: string[];
  satisfiedByAnyFactKeys: string[];
  directedBeatTemplate?: {
    beatId: string;
    externalWorldMove: string;
    physicalPreconditions: string[];
    allowedSourceIds: string[];
    targetNodeId: string;
  };
};

export type StoryPackageNode = {
  nodeId: string;
  title: string;
  stageKey: string;
  perspectiveRoleKey: string;
  sceneLabel: string;
  situationBoundary: string;
  allowedAdjacentNodeIds: string[];
  publicEntryBeat: string;
  relevantCardIds: string[];
  mainlineQuestionIds: string[];
  activePressureIds: string[];
  latentTruthIds: string[];
  floorObligationIds: string[];
};

export type StoryPackageDirectedBeatPolicy = {
  maxBeatsPerTurn: 1;
  mayNotDecideForPlayer: true;
  mayNotInventKeyEvidence: true;
  mayOnlyMoveNpcOrWorld: true;
};

export type StoryPackageFloorPolicy = {
  recentCanonOverridesDefaults: true;
  satisfiedFloorClosesPermanently: true;
  preconditionFailureRequiresRetargetOrSilence: true;
  maxDirectedBeatsPerTurn: 1;
};

export type RuntimeStoryPackage = {
  schemaVersion: "runtime_story_package_v1";
  worldId: string;
  packageId: string;
  packageVersion: string;
  sourceMapSha256: string;
  roles: StoryPackageRoleAcl[];
  cards: StoryPackageCard[];
  mainlineQuestions: StoryPackageMainlineQuestion[];
  latentTruths: StoryPackageLatentTruth[];
  pressures: StoryPackagePressure[];
  floorPolicy: StoryPackageFloorPolicy;
  directedBeatPolicy: StoryPackageDirectedBeatPolicy;
  floorObligations: StoryPackageFloorObligation[];
  nodes: StoryPackageNode[];
  openingNodeId: string;
};

export type LoadedRuntimeStoryPackage = {
  manifest: StoryPackageManifest;
  storyPackage: RuntimeStoryPackage;
  sourceMap: StoryPackageSourceMap;
  storyPackageSha256: string;
  sourceMapSha256: string;
};

export type StoryPackageContextInput = {
  roleKey: string;
  currentNodeId: string;
  currentTurn: number;
  recentCanon?: {
    sceneLabel: string;
    situationText: string;
    sourceCanonIds: string[];
  } | null;
  canonFactKeys?: string[];
  pendingConsequences?: string[];
};

export type StoryPackageRoleView = {
  roleKey: string;
  currentNodeId: string;
  currentSceneLabel: string;
  currentSituationText: string;
  mainlineQuestions: StoryPackageMainlineQuestion[];
  cards: StoryPackageCard[];
  visibleLatentTruths: StoryPackageLatentTruth[];
  pressures: StoryPackagePressure[];
  pendingConsequences: string[];
  recentCanonIds: string[];
  droppedCardIds: string[];
};

export type StoryPackageDirectorInput = {
  currentNodeId: string;
  currentTurn: number;
  canonFactKeys: string[];
  recentCanonIds?: string[];
};

export type StoryPackageDirectorEvaluation = {
  currentNodeId: string;
  allowedAdjacentNodeIds: string[];
  evaluatedObligations: Array<{
    obligationId: string;
    status: "OPEN" | "SATISFIED" | "NOT_DUE" | "BLOCKED";
  }>;
  directedBeat: null | {
    beatId: string;
    obligationId: string;
    externalWorldMove: string;
    targetNodeId: string;
    sourceIds: string[];
  };
};
