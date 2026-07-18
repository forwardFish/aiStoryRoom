export const SANGTIAN_STRATEGY_VERSION = "sangtian_v1_1" as const;
export const SANGTIAN_TEMPLATE_KEY = "sangtian" as const;
export const SANGTIAN_PLAYABLE_ROLE_KEYS = ["zhejiang_governor", "xunfu", "county_magistrate"] as const;
export const SANGTIAN_SYSTEM_ROLE_KEY = "merchant" as const;

export const CONTINUOUS_V1_STAGE_COUNT = 7 as const;
export const CONTINUOUS_V1_MAIN_CARDS_PER_ROLE_STAGE = 3 as const;

export type Visibility = "PUBLIC" | "OBSERVABLE" | "LIMITED" | "PRIVATE";
export type Risk = "LOW" | "NORMAL" | "HIGH";
export type PlayableRoleKey = string;

export type ManifestFile = { path: string; sha256: string };
export type StrategyManifest = {
  schemaVersion: "continuous_strategy_manifest_v1";
  contentVersion: string;
  templateKey: string;
  releaseStatus: "development_vertical_slice" | "published";
  stageCoverage: number[];
  files: ManifestFile[];
};

export type StrategyRegistryEntry = {
  artifactDirectory: string;
  manifestSha256: string;
  status: "development" | "published";
};
export type StrategyRegistry = {
  schemaVersion: "strategy_registry_v1";
  defaultStrategyVersion: string;
  strategies: Record<string, StrategyRegistryEntry>;
};

export type AssetMutation = {
  assetKey: string;
  mutationType: string;
  delta: number;
  toRoleKey: string | null;
};
export type InfluenceEdge = { affectedRoleKey: string; effectKey: string; visibility: Visibility };
export type MainCard = {
  actionKey: string;
  title: string;
  objective: string;
  visibility: Visibility;
  risk: Risk;
  fallbackActionKey: string;
  targetRoleKey: string;
  receipt: { receiptKey: string; text: string };
  effect: {
    effectKey: string;
    factKeys: string[];
    influenceEdges: InfluenceEdge[];
    observableTraceKeys: string[];
    interactionRequestKeys: string[];
    nextStateKey: string;
  };
  assetMutations: AssetMutation[];
};
export type RoleStageContent = {
  stageKey: string;
  roleKey: PlayableRoleKey;
  privateBrief: string;
  personalPressure: string;
  mainCards: MainCard[];
};
export type RoleStageContentFile = {
  schemaVersion: "continuous_strategy_role_stage_content_v1";
  contentVersion: string;
  roleStages: RoleStageContent[];
};

export type StageDefinition = {
  stageKey: string;
  stageNumber: number;
  title: string;
  playableRoleKeys: PlayableRoleKey[];
  systemRoleKey: string;
  commonContest: { contestKey: string; title: string; assetKey: string; description: string };
  stateCatalog: Array<{ stateKey: string; description: string }>;
  factCatalog: Array<{ factKey: string; visibility: Visibility }>;
  assetCatalog: Array<{ assetKey: string; kind: string; initialOwnerRoleKey: string | null }>;
  traceCatalog: Array<{ traceKey: string; description: string }>;
  interactionRequestCatalog: Array<{
    requestKey: string;
    sourceRoleKey: string;
    targetRoleKey: string;
    eventType: string;
    defaultOutcomeKey: string;
  }>;
  carriedFactKeys: string[];
  systemActionKey: string;
  nextStateKey: string;
  minimumDistinctPlayableInfluenceSources: number;
};
export type StagesFile = {
  schemaVersion: "continuous_strategy_stages_v1";
  contentVersion: string;
  stages: StageDefinition[];
};

export type SystemAction = {
  systemActionKey: string;
  stageKey: string;
  roleKey: string;
  inputStateKeys: string[];
  factKeys: string[];
  observableTraceKeys: string[];
  visiblePressure: string;
  claimable: false;
  controllerMode: "SYSTEM";
  assetMutations: AssetMutation[];
  nextStateKey: string;
};
export type SystemActionsFile = {
  schemaVersion: "continuous_strategy_system_actions_v1";
  contentVersion: string;
  systemActions: SystemAction[];
};

export type AgentPolicy = {
  stageKey: string;
  roleKey: PlayableRoleKey;
  policyVersion: string;
  goals: Array<{ goalKey: string; weight: number }>;
  riskProfile: "CAUTIOUS" | "BALANCED" | "ASSERTIVE";
  assetPriority: string[];
  actionWeights: Array<{ actionKey: string; weight: number }>;
  fallbackBySlot: { MAIN: string; MANEUVER: "PASS" };
};
export type FallbackAction = {
  actionKey: string;
  stageKey: string;
  roleKey: PlayableRoleKey;
  actionSlot: "MAIN";
  objective: string;
  factKeys: string[];
  nextStateKey: string;
  assetMutations: AssetMutation[];
};
export type AgentPoliciesFile = {
  schemaVersion: "continuous_strategy_agent_policies_v1";
  contentVersion: string;
  policies: AgentPolicy[];
  fallbackActions: FallbackAction[];
};

export type ManeuverStrategy = {
  maneuverStrategyKey: string;
  stageKey: string;
  roleKey: PlayableRoleKey;
  title: string;
  objective: string;
  allowedTargetRoleKeys: string[];
  leverageAssetKeys: string[];
  allowedTypes: string[];
  fallbackActionKey: string;
};
export type ManeuverStrategiesFile = {
  schemaVersion: "continuous_strategy_maneuvers_v1";
  contentVersion: string;
  maneuverStrategies: ManeuverStrategy[];
};

export type ReactionResponseOption = {
  actionKey: string;
  title: string;
  factKey: string;
  nextStateKey: string;
};
export type ReactionScenario = {
  reactionKey: string;
  stageKey: string;
  sourceRoleKey: PlayableRoleKey;
  targetRoleKey: PlayableRoleKey;
  triggerActionKey: string;
  interactionRequestKey: string;
  responseOptions: ReactionResponseOption[];
  fallbackResponseActionKey: string;
  passAllowed: false;
};
export type ReactionScenariosFile = {
  schemaVersion: "continuous_strategy_reactions_v1";
  contentVersion: string;
  reactionScenarios: ReactionScenario[];
};

export type PublicStageResultRule = {
  ruleKey: string;
  stageKey: string;
  candidateFactKeys: string[];
  outcomeStateKey: string;
  summary: string;
};
export type PersonalStageResultRule = {
  ruleKey: string;
  stageKey: string;
  roleKey: PlayableRoleKey;
  candidateFactKeys: string[];
  summary: string;
};
export type ResultRulesFile = {
  schemaVersion: "continuous_strategy_result_rules_v1";
  contentVersion: string;
  publicStageRules: PublicStageResultRule[];
  personalStageRules: PersonalStageResultRule[];
};

export type EndingClassification = { endingKey: string; title: string; minimumScore: number };
export type GlobalEndingRule = {
  ruleKey: string;
  metric: string;
  evidenceStageRange: [number, number];
  classifications: EndingClassification[];
};
export type PersonalEndingRule = GlobalEndingRule & { roleKey: PlayableRoleKey };
export type EndingRulesFile = {
  schemaVersion: "continuous_strategy_ending_rules_v1";
  contentVersion: string;
  globalEndingRule: GlobalEndingRule;
  personalEndingRules: PersonalEndingRule[];
};

export type ContinuousStrategyPackage = {
  contract: {
    worldId: string;
    strategyVersion: string;
    playableRoleKeys: string[];
    worldActorKey: string;
  };
  registry: StrategyRegistry;
  manifest: StrategyManifest;
  stages: StagesFile;
  roleStageContent: RoleStageContentFile;
  systemActions: SystemActionsFile;
  agentPolicies: AgentPoliciesFile;
  maneuverStrategies: ManeuverStrategiesFile;
  reactionScenarios: ReactionScenariosFile;
  resultRules: ResultRulesFile;
  endingRules: EndingRulesFile;
  artifactHashes: Record<string, string>;
};
