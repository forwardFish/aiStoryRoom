import {
  CONTINUOUS_V1_MAIN_CARDS_PER_ROLE_STAGE,
  CONTINUOUS_V1_STAGE_COUNT,
  type AgentPoliciesFile,
  type AssetMutation,
  type ContinuousStrategyPackage,
  type EndingRulesFile,
  type MainCard,
  type ManeuverStrategiesFile,
  type ReactionScenariosFile,
  type ResultRulesFile,
  type RoleStageContentFile,
  type StageDefinition,
  type StagesFile,
  type StrategyManifest,
  type StrategyRegistry,
  type SystemActionsFile
} from "./types";

type JsonRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`CONTINUOUS_STRATEGY_CONTENT_INVALID: ${message}`);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function exactKeys(value: JsonRecord, label: string, keys: readonly string[]) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown property ${key}`);
  for (const key of keys) if (!(key in value)) fail(`${label} is missing ${key}`);
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value as number;
}

function stringArray(value: unknown, label: string, minimum = 0): string[] {
  const values = array(value, label).map((item, index) => string(item, `${label}[${index}]`));
  if (values.length < minimum) fail(`${label} must contain at least ${minimum} items`);
  return values;
}

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicate keys`);
}

function validateAssetMutation(value: unknown, label: string): AssetMutation {
  const item = record(value, label);
  exactKeys(item, label, ["assetKey", "mutationType", "delta", "toRoleKey"]);
  string(item.assetKey, `${label}.assetKey`);
  string(item.mutationType, `${label}.mutationType`);
  integer(item.delta, `${label}.delta`);
  if (item.toRoleKey !== null) string(item.toRoleKey, `${label}.toRoleKey`);
  return item as AssetMutation;
}

function validateMainCard(value: unknown, label: string): MainCard {
  const card = record(value, label);
  exactKeys(card, label, ["actionKey", "title", "objective", "visibility", "risk", "fallbackActionKey", "targetRoleKey", "receipt", "effect", "assetMutations"]);
  for (const key of ["actionKey", "title", "objective", "fallbackActionKey", "targetRoleKey"] as const) string(card[key], `${label}.${key}`);
  if (!["PUBLIC", "OBSERVABLE", "LIMITED", "PRIVATE"].includes(String(card.visibility))) fail(`${label}.visibility is invalid`);
  if (!["LOW", "NORMAL", "HIGH"].includes(String(card.risk))) fail(`${label}.risk is invalid`);
  const receipt = record(card.receipt, `${label}.receipt`);
  exactKeys(receipt, `${label}.receipt`, ["receiptKey", "text"]);
  string(receipt.receiptKey, `${label}.receipt.receiptKey`);
  string(receipt.text, `${label}.receipt.text`);
  const effect = record(card.effect, `${label}.effect`);
  exactKeys(effect, `${label}.effect`, ["effectKey", "factKeys", "influenceEdges", "observableTraceKeys", "interactionRequestKeys", "nextStateKey"]);
  string(effect.effectKey, `${label}.effect.effectKey`);
  stringArray(effect.factKeys, `${label}.effect.factKeys`, 1);
  stringArray(effect.observableTraceKeys, `${label}.effect.observableTraceKeys`, 1);
  stringArray(effect.interactionRequestKeys, `${label}.effect.interactionRequestKeys`);
  string(effect.nextStateKey, `${label}.effect.nextStateKey`);
  const edges = array(effect.influenceEdges, `${label}.effect.influenceEdges`);
  if (edges.length < 1) fail(`${label} must define an influence edge`);
  edges.forEach((edgeValue, index) => {
    const edge = record(edgeValue, `${label}.effect.influenceEdges[${index}]`);
    exactKeys(edge, `${label}.effect.influenceEdges[${index}]`, ["affectedRoleKey", "effectKey", "visibility"]);
    string(edge.affectedRoleKey, `${label}.effect.influenceEdges[${index}].affectedRoleKey`);
    string(edge.effectKey, `${label}.effect.influenceEdges[${index}].effectKey`);
    if (!["PUBLIC", "OBSERVABLE", "LIMITED", "PRIVATE"].includes(String(edge.visibility))) fail(`${label}.effect.influenceEdges[${index}].visibility is invalid`);
  });
  const mutations = array(card.assetMutations, `${label}.assetMutations`);
  if (mutations.length < 1) fail(`${label} must define an asset mutation`);
  mutations.forEach((mutation, index) => validateAssetMutation(mutation, `${label}.assetMutations[${index}]`));
  return card as MainCard;
}

export function validateStrategyRegistry(value: unknown): StrategyRegistry {
  const registry = record(value, "strategy-registry.json");
  exactKeys(registry, "strategy-registry.json", ["schemaVersion", "defaultStrategyVersion", "strategies"]);
  if (registry.schemaVersion !== "strategy_registry_v1") fail("strategy registry schemaVersion is invalid");
  string(registry.defaultStrategyVersion, "strategy-registry.defaultStrategyVersion");
  const strategies = record(registry.strategies, "strategy-registry.strategies");
  if (!Object.keys(strategies).length) fail("strategy registry is empty");
  for (const [version, entryValue] of Object.entries(strategies)) {
    const entry = record(entryValue, `strategy-registry.strategies.${version}`);
    exactKeys(entry, `strategy-registry.strategies.${version}`, ["artifactDirectory", "manifestSha256", "status"]);
    string(entry.artifactDirectory, `strategy-registry.strategies.${version}.artifactDirectory`);
    if (!/^[a-f0-9]{64}$/.test(String(entry.manifestSha256))) fail(`strategy ${version} has invalid manifestSha256`);
    if (!["development", "published"].includes(String(entry.status))) fail(`strategy ${version} has invalid status`);
  }
  if (!(String(registry.defaultStrategyVersion) in strategies)) fail("defaultStrategyVersion is not registered");
  return registry as StrategyRegistry;
}

export function validateStrategyManifest(value: unknown): StrategyManifest {
  const manifest = record(value, "manifest.json");
  exactKeys(manifest, "manifest.json", ["schemaVersion", "contentVersion", "templateKey", "releaseStatus", "stageCoverage", "files"]);
  if (manifest.schemaVersion !== "continuous_strategy_manifest_v1") fail("manifest schemaVersion is invalid");
  string(manifest.contentVersion, "manifest.contentVersion");
  string(manifest.templateKey, "manifest.templateKey");
  if (!["development_vertical_slice", "published"].includes(String(manifest.releaseStatus))) fail("manifest releaseStatus is invalid");
  const coverage = array(manifest.stageCoverage, "manifest.stageCoverage").map((item, index) => integer(item, `manifest.stageCoverage[${index}]`));
  if (!coverage.length || coverage.some((item) => item < 1 || item > CONTINUOUS_V1_STAGE_COUNT)) fail("manifest stageCoverage is invalid");
  const files = array(manifest.files, "manifest.files");
  if (!files.length) fail("manifest files are empty");
  const paths: string[] = [];
  files.forEach((fileValue, index) => {
    const file = record(fileValue, `manifest.files[${index}]`);
    exactKeys(file, `manifest.files[${index}]`, ["path", "sha256"]);
    paths.push(string(file.path, `manifest.files[${index}].path`));
    if (!/^[a-f0-9]{64}$/.test(String(file.sha256))) fail(`manifest.files[${index}].sha256 is invalid`);
  });
  unique(paths, "manifest file paths");
  return manifest as StrategyManifest;
}

export function validateStages(value: unknown): StagesFile {
  const root = record(value, "stages.json");
  exactKeys(root, "stages.json", ["schemaVersion", "contentVersion", "stages"]);
  if (root.schemaVersion !== "continuous_strategy_stages_v1") fail("stages schemaVersion is invalid");
  string(root.contentVersion, "stages.contentVersion");
  const stages = array(root.stages, "stages");
  if (!stages.length || stages.length > CONTINUOUS_V1_STAGE_COUNT) fail("stages count is invalid");
  stages.forEach((stageValue, stageIndex) => {
    const label = `stages[${stageIndex}]`;
    const stage = record(stageValue, label);
    exactKeys(stage, label, ["stageKey", "stageNumber", "title", "playableRoleKeys", "systemRoleKey", "commonContest", "stateCatalog", "factCatalog", "assetCatalog", "traceCatalog", "interactionRequestCatalog", "carriedFactKeys", "systemActionKey", "nextStateKey", "minimumDistinctPlayableInfluenceSources"]);
    string(stage.stageKey, `${label}.stageKey`);
    const stageNumber = integer(stage.stageNumber, `${label}.stageNumber`);
    if (stageNumber < 1 || stageNumber > CONTINUOUS_V1_STAGE_COUNT) fail(`${label}.stageNumber is invalid`);
    string(stage.title, `${label}.title`);
    const roles = stringArray(stage.playableRoleKeys, `${label}.playableRoleKeys`, 1);
    unique(roles, `${label}.playableRoleKeys`);
    string(stage.systemRoleKey, `${label}.systemRoleKey`);
    const contest = record(stage.commonContest, `${label}.commonContest`);
    exactKeys(contest, `${label}.commonContest`, ["contestKey", "title", "assetKey", "description"]);
    for (const key of ["contestKey", "title", "assetKey", "description"] as const) string(contest[key], `${label}.commonContest.${key}`);
    const stateCatalog = array(stage.stateCatalog, `${label}.stateCatalog`);
    stateCatalog.forEach((entryValue, index) => {
      const entry = record(entryValue, `${label}.stateCatalog[${index}]`);
      exactKeys(entry, `${label}.stateCatalog[${index}]`, ["stateKey", "description"]);
      string(entry.stateKey, `${label}.stateCatalog[${index}].stateKey`);
      string(entry.description, `${label}.stateCatalog[${index}].description`);
    });
    const factCatalog = array(stage.factCatalog, `${label}.factCatalog`);
    factCatalog.forEach((entryValue, index) => {
      const entry = record(entryValue, `${label}.factCatalog[${index}]`);
      exactKeys(entry, `${label}.factCatalog[${index}]`, ["factKey", "visibility"]);
      string(entry.factKey, `${label}.factCatalog[${index}].factKey`);
      if (!["PUBLIC", "OBSERVABLE", "LIMITED", "PRIVATE"].includes(String(entry.visibility))) fail(`${label}.factCatalog[${index}].visibility is invalid`);
    });
    const assetCatalog = array(stage.assetCatalog, `${label}.assetCatalog`);
    assetCatalog.forEach((entryValue, index) => {
      const entry = record(entryValue, `${label}.assetCatalog[${index}]`);
      exactKeys(entry, `${label}.assetCatalog[${index}]`, ["assetKey", "kind", "initialOwnerRoleKey"]);
      string(entry.assetKey, `${label}.assetCatalog[${index}].assetKey`);
      string(entry.kind, `${label}.assetCatalog[${index}].kind`);
      if (entry.initialOwnerRoleKey !== null) string(entry.initialOwnerRoleKey, `${label}.assetCatalog[${index}].initialOwnerRoleKey`);
    });
    const traceCatalog = array(stage.traceCatalog, `${label}.traceCatalog`);
    traceCatalog.forEach((entryValue, index) => {
      const entry = record(entryValue, `${label}.traceCatalog[${index}]`);
      exactKeys(entry, `${label}.traceCatalog[${index}]`, ["traceKey", "description"]);
      string(entry.traceKey, `${label}.traceCatalog[${index}].traceKey`);
      string(entry.description, `${label}.traceCatalog[${index}].description`);
    });
    const requestCatalog = array(stage.interactionRequestCatalog, `${label}.interactionRequestCatalog`);
    requestCatalog.forEach((entryValue, index) => {
      const entry = record(entryValue, `${label}.interactionRequestCatalog[${index}]`);
      exactKeys(entry, `${label}.interactionRequestCatalog[${index}]`, ["requestKey", "sourceRoleKey", "targetRoleKey", "eventType", "defaultOutcomeKey"]);
      for (const key of ["requestKey", "sourceRoleKey", "targetRoleKey", "eventType", "defaultOutcomeKey"] as const) string(entry[key], `${label}.interactionRequestCatalog[${index}].${key}`);
    });
    stringArray(stage.carriedFactKeys, `${label}.carriedFactKeys`);
    string(stage.systemActionKey, `${label}.systemActionKey`);
    string(stage.nextStateKey, `${label}.nextStateKey`);
    if (integer(stage.minimumDistinctPlayableInfluenceSources, `${label}.minimumDistinctPlayableInfluenceSources`) < 2) fail(`${label} must require two influence sources`);
  });
  return root as StagesFile;
}

export function validateRoleStageContent(value: unknown): RoleStageContentFile {
  const root = record(value, "role-stage-content.json");
  exactKeys(root, "role-stage-content.json", ["schemaVersion", "contentVersion", "roleStages"]);
  if (root.schemaVersion !== "continuous_strategy_role_stage_content_v1") fail("role stage content schemaVersion is invalid");
  string(root.contentVersion, "role-stage-content.contentVersion");
  const roleStages = array(root.roleStages, "roleStages");
  roleStages.forEach((roleStageValue, roleStageIndex) => {
    const label = `roleStages[${roleStageIndex}]`;
    const roleStage = record(roleStageValue, label);
    exactKeys(roleStage, label, ["stageKey", "roleKey", "privateBrief", "personalPressure", "mainCards"]);
    string(roleStage.stageKey, `${label}.stageKey`);
    string(roleStage.roleKey, `${label}.roleKey`);
    string(roleStage.privateBrief, `${label}.privateBrief`);
    string(roleStage.personalPressure, `${label}.personalPressure`);
    const cards = array(roleStage.mainCards, `${label}.mainCards`);
    if (cards.length !== CONTINUOUS_V1_MAIN_CARDS_PER_ROLE_STAGE) fail(`${label} must contain exactly three MAIN cards`);
    cards.forEach((card, cardIndex) => validateMainCard(card, `${label}.mainCards[${cardIndex}]`));
  });
  return root as RoleStageContentFile;
}

export function validateSystemActions(value: unknown): SystemActionsFile {
  const root = record(value, "system-actions.json");
  exactKeys(root, "system-actions.json", ["schemaVersion", "contentVersion", "systemActions"]);
  if (root.schemaVersion !== "continuous_strategy_system_actions_v1") fail("system actions schemaVersion is invalid");
  string(root.contentVersion, "system-actions.contentVersion");
  const actions = array(root.systemActions, "systemActions");
  if (!actions.length) fail("systemActions must not be empty");
  actions.forEach((actionValue, actionIndex) => {
    const label = `systemActions[${actionIndex}]`;
    const action = record(actionValue, label);
    exactKeys(action, label, ["systemActionKey", "stageKey", "roleKey", "inputStateKeys", "factKeys", "observableTraceKeys", "visiblePressure", "claimable", "controllerMode", "assetMutations", "nextStateKey"]);
    for (const key of ["systemActionKey", "stageKey", "roleKey", "visiblePressure", "nextStateKey"] as const) string(action[key], `${label}.${key}`);
    stringArray(action.inputStateKeys, `${label}.inputStateKeys`, 1);
    stringArray(action.factKeys, `${label}.factKeys`, 1);
    stringArray(action.observableTraceKeys, `${label}.observableTraceKeys`, 1);
    if (action.claimable !== false || action.controllerMode !== "SYSTEM") fail(`${label} must be an unclaimable SYSTEM controller`);
    const mutations = array(action.assetMutations, `${label}.assetMutations`);
    if (!mutations.length) fail(`${label} must define asset mutations`);
    mutations.forEach((mutation, index) => validateAssetMutation(mutation, `${label}.assetMutations[${index}]`));
  });
  return root as SystemActionsFile;
}

export function validateAgentPolicies(value: unknown): AgentPoliciesFile {
  const root = record(value, "agent-policies.json");
  exactKeys(root, "agent-policies.json", ["schemaVersion", "contentVersion", "policies", "fallbackActions"]);
  if (root.schemaVersion !== "continuous_strategy_agent_policies_v1") fail("agent policies schemaVersion is invalid");
  string(root.contentVersion, "agent-policies.contentVersion");
  const policies = array(root.policies, "policies");
  policies.forEach((policyValue, policyIndex) => {
    const label = `policies[${policyIndex}]`;
    const policy = record(policyValue, label);
    exactKeys(policy, label, ["stageKey", "roleKey", "policyVersion", "goals", "riskProfile", "assetPriority", "actionWeights", "fallbackBySlot"]);
    for (const key of ["stageKey", "roleKey", "policyVersion"] as const) string(policy[key], `${label}.${key}`);
    if (!["CAUTIOUS", "BALANCED", "ASSERTIVE"].includes(String(policy.riskProfile))) fail(`${label}.riskProfile is invalid`);
    stringArray(policy.assetPriority, `${label}.assetPriority`, 1);
    const goals = array(policy.goals, `${label}.goals`);
    if (!goals.length) fail(`${label}.goals must not be empty`);
    goals.forEach((goalValue, index) => {
      const goal = record(goalValue, `${label}.goals[${index}]`);
      exactKeys(goal, `${label}.goals[${index}]`, ["goalKey", "weight"]);
      string(goal.goalKey, `${label}.goals[${index}].goalKey`);
      const weight = integer(goal.weight, `${label}.goals[${index}].weight`);
      if (weight < 0 || weight > 100) fail(`${label}.goals[${index}].weight is invalid`);
    });
    const weights = array(policy.actionWeights, `${label}.actionWeights`);
    if (weights.length !== CONTINUOUS_V1_MAIN_CARDS_PER_ROLE_STAGE) fail(`${label} must contain three action weights`);
    weights.forEach((weightValue, index) => {
      const weight = record(weightValue, `${label}.actionWeights[${index}]`);
      exactKeys(weight, `${label}.actionWeights[${index}]`, ["actionKey", "weight"]);
      string(weight.actionKey, `${label}.actionWeights[${index}].actionKey`);
      const score = integer(weight.weight, `${label}.actionWeights[${index}].weight`);
      if (score < 0 || score > 100) fail(`${label}.actionWeights[${index}].weight is invalid`);
    });
    const fallback = record(policy.fallbackBySlot, `${label}.fallbackBySlot`);
    exactKeys(fallback, `${label}.fallbackBySlot`, ["MAIN", "MANEUVER"]);
    string(fallback.MAIN, `${label}.fallbackBySlot.MAIN`);
    if (fallback.MANEUVER !== "PASS") fail(`${label}.fallbackBySlot.MANEUVER must be PASS`);
  });
  const fallbacks = array(root.fallbackActions, "fallbackActions");
  fallbacks.forEach((fallbackValue, fallbackIndex) => {
    const label = `fallbackActions[${fallbackIndex}]`;
    const fallback = record(fallbackValue, label);
    exactKeys(fallback, label, ["actionKey", "stageKey", "roleKey", "actionSlot", "objective", "factKeys", "nextStateKey", "assetMutations"]);
    for (const key of ["actionKey", "stageKey", "roleKey", "objective", "nextStateKey"] as const) string(fallback[key], `${label}.${key}`);
    if (fallback.actionSlot !== "MAIN") fail(`${label}.actionSlot must be MAIN`);
    stringArray(fallback.factKeys, `${label}.factKeys`, 1);
    const mutations = array(fallback.assetMutations, `${label}.assetMutations`);
    if (!mutations.length) fail(`${label} must define asset mutations`);
    mutations.forEach((mutation, index) => validateAssetMutation(mutation, `${label}.assetMutations[${index}]`));
  });
  return root as AgentPoliciesFile;
}

export function validateManeuverStrategies(value: unknown): ManeuverStrategiesFile {
  const root = record(value, "maneuver-strategies.json");
  exactKeys(root, "maneuver-strategies.json", ["schemaVersion", "contentVersion", "maneuverStrategies"]);
  if (root.schemaVersion !== "continuous_strategy_maneuvers_v1") fail("maneuver strategies schemaVersion is invalid");
  string(root.contentVersion, "maneuver-strategies.contentVersion");
  const strategies = array(root.maneuverStrategies, "maneuverStrategies");
  if (!strategies.length) fail("maneuverStrategies must not be empty");
  strategies.forEach((strategyValue, strategyIndex) => {
    const label = `maneuverStrategies[${strategyIndex}]`;
    const strategy = record(strategyValue, label);
    exactKeys(strategy, label, ["maneuverStrategyKey", "stageKey", "roleKey", "title", "objective", "allowedTargetRoleKeys", "leverageAssetKeys", "allowedTypes", "fallbackActionKey"]);
    for (const key of ["maneuverStrategyKey", "stageKey", "roleKey", "title", "objective", "fallbackActionKey"] as const) string(strategy[key], `${label}.${key}`);
    unique(stringArray(strategy.allowedTargetRoleKeys, `${label}.allowedTargetRoleKeys`, 1), `${label}.allowedTargetRoleKeys`);
    unique(stringArray(strategy.leverageAssetKeys, `${label}.leverageAssetKeys`, 1), `${label}.leverageAssetKeys`);
    unique(stringArray(strategy.allowedTypes, `${label}.allowedTypes`, 1), `${label}.allowedTypes`);
  });
  return root as ManeuverStrategiesFile;
}

export function validateReactionScenarios(value: unknown): ReactionScenariosFile {
  const root = record(value, "reaction-scenarios.json");
  exactKeys(root, "reaction-scenarios.json", ["schemaVersion", "contentVersion", "reactionScenarios"]);
  if (root.schemaVersion !== "continuous_strategy_reactions_v1") fail("reaction scenarios schemaVersion is invalid");
  string(root.contentVersion, "reaction-scenarios.contentVersion");
  const scenarios = array(root.reactionScenarios, "reactionScenarios");
  scenarios.forEach((scenarioValue, scenarioIndex) => {
    const label = `reactionScenarios[${scenarioIndex}]`;
    const scenario = record(scenarioValue, label);
    exactKeys(scenario, label, ["reactionKey", "stageKey", "sourceRoleKey", "targetRoleKey", "triggerActionKey", "interactionRequestKey", "responseOptions", "fallbackResponseActionKey", "passAllowed"]);
    for (const key of ["reactionKey", "stageKey", "sourceRoleKey", "targetRoleKey", "triggerActionKey", "interactionRequestKey", "fallbackResponseActionKey"] as const) string(scenario[key], `${label}.${key}`);
    if (scenario.passAllowed !== false) fail(`${label}.passAllowed must be false`);
    const options = array(scenario.responseOptions, `${label}.responseOptions`);
    if (options.length < 2) fail(`${label} must contain at least two response options`);
    options.forEach((optionValue, optionIndex) => {
      const optionLabel = `${label}.responseOptions[${optionIndex}]`;
      const option = record(optionValue, optionLabel);
      exactKeys(option, optionLabel, ["actionKey", "title", "factKey", "nextStateKey"]);
      for (const key of ["actionKey", "title", "factKey", "nextStateKey"] as const) string(option[key], `${optionLabel}.${key}`);
    });
  });
  return root as ReactionScenariosFile;
}

export function validateResultRules(value: unknown): ResultRulesFile {
  const root = record(value, "result-rules.json");
  exactKeys(root, "result-rules.json", ["schemaVersion", "contentVersion", "publicStageRules", "personalStageRules"]);
  if (root.schemaVersion !== "continuous_strategy_result_rules_v1") fail("result rules schemaVersion is invalid");
  string(root.contentVersion, "result-rules.contentVersion");
  array(root.publicStageRules, "publicStageRules").forEach((ruleValue, ruleIndex) => {
    const label = `publicStageRules[${ruleIndex}]`;
    const rule = record(ruleValue, label);
    exactKeys(rule, label, ["ruleKey", "stageKey", "candidateFactKeys", "outcomeStateKey", "summary"]);
    for (const key of ["ruleKey", "stageKey", "outcomeStateKey", "summary"] as const) string(rule[key], `${label}.${key}`);
    unique(stringArray(rule.candidateFactKeys, `${label}.candidateFactKeys`, 1), `${label}.candidateFactKeys`);
  });
  array(root.personalStageRules, "personalStageRules").forEach((ruleValue, ruleIndex) => {
    const label = `personalStageRules[${ruleIndex}]`;
    const rule = record(ruleValue, label);
    exactKeys(rule, label, ["ruleKey", "stageKey", "roleKey", "candidateFactKeys", "summary"]);
    for (const key of ["ruleKey", "stageKey", "roleKey", "summary"] as const) string(rule[key], `${label}.${key}`);
    unique(stringArray(rule.candidateFactKeys, `${label}.candidateFactKeys`, 1), `${label}.candidateFactKeys`);
  });
  return root as ResultRulesFile;
}

function validateEndingRule(value: unknown, label: string, personal: boolean) {
  const rule = record(value, label);
  exactKeys(rule, label, personal ? ["ruleKey", "roleKey", "metric", "evidenceStageRange", "classifications"] : ["ruleKey", "metric", "evidenceStageRange", "classifications"]);
  string(rule.ruleKey, `${label}.ruleKey`);
  if (personal) string(rule.roleKey, `${label}.roleKey`);
  string(rule.metric, `${label}.metric`);
  const range = array(rule.evidenceStageRange, `${label}.evidenceStageRange`);
  if (range.length !== 2 || integer(range[0], `${label}.evidenceStageRange[0]`) < 1 || integer(range[1], `${label}.evidenceStageRange[1]`) > 7 || Number(range[0]) > Number(range[1])) fail(`${label}.evidenceStageRange is invalid`);
  const classifications = array(rule.classifications, `${label}.classifications`);
  if (!classifications.length) fail(`${label}.classifications must not be empty`);
  classifications.forEach((classificationValue, classificationIndex) => {
    const classificationLabel = `${label}.classifications[${classificationIndex}]`;
    const classification = record(classificationValue, classificationLabel);
    exactKeys(classification, classificationLabel, ["endingKey", "title", "minimumScore"]);
    string(classification.endingKey, `${classificationLabel}.endingKey`);
    string(classification.title, `${classificationLabel}.title`);
    integer(classification.minimumScore, `${classificationLabel}.minimumScore`);
  });
}

export function validateEndingRules(value: unknown): EndingRulesFile {
  const root = record(value, "ending-rules.json");
  exactKeys(root, "ending-rules.json", ["schemaVersion", "contentVersion", "globalEndingRule", "personalEndingRules"]);
  if (root.schemaVersion !== "continuous_strategy_ending_rules_v1") fail("ending rules schemaVersion is invalid");
  string(root.contentVersion, "ending-rules.contentVersion");
  validateEndingRule(root.globalEndingRule, "globalEndingRule", false);
  array(root.personalEndingRules, "personalEndingRules").forEach((ruleValue, ruleIndex) => validateEndingRule(ruleValue, `personalEndingRules[${ruleIndex}]`, true));
  return root as EndingRulesFile;
}

function assertContains(keys: Set<string>, value: string, label: string) {
  if (!keys.has(value)) fail(`${label} references unknown key ${value}`);
}

function keysFrom<T>(items: T[], selector: (item: T) => string, label: string): Set<string> {
  const keys = items.map(selector);
  unique(keys, label);
  return new Set(keys);
}

export function validateContentGraph(content: Pick<ContinuousStrategyPackage, "contract" | "manifest" | "stages" | "roleStageContent" | "systemActions" | "agentPolicies" | "maneuverStrategies" | "reactionScenarios" | "resultRules" | "endingRules">) {
  const { manifest, stages, roleStageContent, systemActions, agentPolicies, maneuverStrategies, reactionScenarios, resultRules, endingRules } = content;
  const contentVersions = [stages, roleStageContent, systemActions, agentPolicies, maneuverStrategies, reactionScenarios, resultRules, endingRules].map((artifact) => artifact.contentVersion);
  if (contentVersions.some((version) => version !== manifest.contentVersion)) fail("contentVersion differs across artifacts");
  const stageKeys = keysFrom(stages.stages, (stage) => stage.stageKey, "stage keys");
  const stageNumbers = keysFrom(stages.stages, (stage) => String(stage.stageNumber), "stage numbers");
  const actionKeys = keysFrom(roleStageContent.roleStages.flatMap((entry) => entry.mainCards), (card) => card.actionKey, "MAIN action keys");
  const fallbackKeys = keysFrom(agentPolicies.fallbackActions, (fallback) => fallback.actionKey, "fallback action keys");
  const systemActionKeys = keysFrom(systemActions.systemActions, (action) => action.systemActionKey, "system action keys");
  const policyKeys = keysFrom(agentPolicies.policies, (policy) => `${policy.stageKey}:${policy.roleKey}`, "agent policy stage/role keys");
  const roleStageKeys = keysFrom(roleStageContent.roleStages, (entry) => `${entry.stageKey}:${entry.roleKey}`, "role-stage keys");
  keysFrom(maneuverStrategies.maneuverStrategies, (strategy) => strategy.maneuverStrategyKey, "maneuver strategy keys");
  keysFrom(reactionScenarios.reactionScenarios, (scenario) => scenario.reactionKey, "reaction scenario keys");
  keysFrom(resultRules.publicStageRules, (rule) => rule.ruleKey, "public result rule keys");
  keysFrom(resultRules.personalStageRules, (rule) => rule.ruleKey, "personal result rule keys");
  const expectedPlayableRoles = new Set<string>(content.contract.playableRoleKeys);
  const worldActorKey = content.contract.worldActorKey;
  const globalFactOrigins = new Map<string, number>();
  for (const stage of stages.stages) {
    for (const fact of stage.factCatalog) {
      if (globalFactOrigins.has(fact.factKey)) fail(`fact key ${fact.factKey} is duplicated across stages`);
      globalFactOrigins.set(fact.factKey, stage.stageNumber);
    }
  }
  if (manifest.releaseStatus === "published") {
    if (stageNumbers.size !== CONTINUOUS_V1_STAGE_COUNT || manifest.stageCoverage.join(",") !== "1,2,3,4,5,6,7") fail("published content must cover stages 1-7 in order");
  }

  for (const stage of stages.stages) {
    const roles = new Set(stage.playableRoleKeys);
    if (roles.size !== expectedPlayableRoles.size || [...expectedPlayableRoles].some((role) => !roles.has(role as never))) fail(`${stage.stageKey} player roles differ from the game contract`);
    if (stage.systemRoleKey !== worldActorKey) fail(`${stage.stageKey} world actor differs from the game contract`);
    const stateKeys = keysFrom(stage.stateCatalog, (entry) => entry.stateKey, `${stage.stageKey} state keys`);
    const factKeys = keysFrom(stage.factCatalog, (entry) => entry.factKey, `${stage.stageKey} fact keys`);
    const assetKeys = keysFrom(stage.assetCatalog, (entry) => entry.assetKey, `${stage.stageKey} asset keys`);
    const traceKeys = keysFrom(stage.traceCatalog, (entry) => entry.traceKey, `${stage.stageKey} trace keys`);
    const requestKeys = keysFrom(stage.interactionRequestCatalog, (entry) => entry.requestKey, `${stage.stageKey} request keys`);
    assertContains(assetKeys, stage.commonContest.assetKey, `${stage.stageKey}.commonContest.assetKey`);
    assertContains(stateKeys, stage.nextStateKey, `${stage.stageKey}.nextStateKey`);
    assertContains(systemActionKeys, stage.systemActionKey, `${stage.stageKey}.systemActionKey`);
    for (const carriedFactKey of stage.carriedFactKeys) {
      const originStage = globalFactOrigins.get(carriedFactKey);
      if (originStage === undefined) fail(`${stage.stageKey}.carriedFactKeys references unknown key ${carriedFactKey}`);
      if (originStage >= stage.stageNumber) fail(`${stage.stageKey}.carriedFactKeys must originate in an earlier stage: ${carriedFactKey}`);
    }
    if (!stage.interactionRequestCatalog.length) fail(`${stage.stageKey} must define a directed request`);
    stage.interactionRequestCatalog.forEach((request) => {
      if (!expectedPlayableRoles.has(request.sourceRoleKey) || !expectedPlayableRoles.has(request.targetRoleKey) || request.sourceRoleKey === request.targetRoleKey) fail(`${request.requestKey} has invalid source/target roles`);
    });

    const roleEntries = roleStageContent.roleStages.filter((entry) => entry.stageKey === stage.stageKey);
    if (roleEntries.length !== expectedPlayableRoles.size) fail(`${stage.stageKey} must contain one role-stage entry per configured role`);
    const influenceSources = new Set<string>();
    for (const roleEntry of roleEntries) {
      if (!expectedPlayableRoles.has(roleEntry.roleKey)) fail(`${stage.stageKey} has unknown role ${roleEntry.roleKey}`);
      if (!policyKeys.has(`${stage.stageKey}:${roleEntry.roleKey}`)) fail(`${stage.stageKey}:${roleEntry.roleKey} has no agent policy`);
      for (const card of roleEntry.mainCards) {
        if (card.targetRoleKey === roleEntry.roleKey || !expectedPlayableRoles.has(card.targetRoleKey)) fail(`${card.actionKey} has invalid targetRoleKey`);
        assertContains(fallbackKeys, card.fallbackActionKey, `${card.actionKey}.fallbackActionKey`);
        if (actionKeys.has(card.fallbackActionKey)) fail(`${card.actionKey} fallback cannot point to a visible MAIN card`);
        card.effect.factKeys.forEach((key) => assertContains(factKeys, key, `${card.actionKey}.factKeys`));
        card.effect.observableTraceKeys.forEach((key) => assertContains(traceKeys, key, `${card.actionKey}.observableTraceKeys`));
        card.effect.interactionRequestKeys.forEach((key) => {
          assertContains(requestKeys, key, `${card.actionKey}.interactionRequestKeys`);
          const request = stage.interactionRequestCatalog.find((candidate) => candidate.requestKey === key)!;
          if (request.sourceRoleKey !== roleEntry.roleKey || request.targetRoleKey !== card.targetRoleKey) fail(`${card.actionKey} request source/target does not match the card`);
        });
        assertContains(stateKeys, card.effect.nextStateKey, `${card.actionKey}.nextStateKey`);
        card.assetMutations.forEach((mutation) => {
          assertContains(assetKeys, mutation.assetKey, `${card.actionKey}.assetMutations`);
          if (mutation.toRoleKey !== null && !expectedPlayableRoles.has(mutation.toRoleKey) && mutation.toRoleKey !== worldActorKey) fail(`${card.actionKey} mutation has invalid role`);
        });
        card.effect.influenceEdges.forEach((edge) => {
          if (edge.affectedRoleKey === roleEntry.roleKey || !expectedPlayableRoles.has(edge.affectedRoleKey)) fail(`${card.actionKey} has invalid influence edge target`);
          influenceSources.add(roleEntry.roleKey);
        });
      }
    }
    if (influenceSources.size < stage.minimumDistinctPlayableInfluenceSources) fail(`${stage.stageKey} lacks influence edges from distinct playable roles`);

    const stageManeuvers = maneuverStrategies.maneuverStrategies.filter((strategy) => strategy.stageKey === stage.stageKey);
    if (stageManeuvers.length !== expectedPlayableRoles.size || new Set(stageManeuvers.map((strategy) => strategy.roleKey)).size !== expectedPlayableRoles.size) fail(`${stage.stageKey} must contain one maneuver strategy per configured role`);
    for (const strategy of stageManeuvers) {
      if (!expectedPlayableRoles.has(strategy.roleKey)) fail(`${strategy.maneuverStrategyKey} has an invalid role`);
      if (strategy.allowedTargetRoleKeys.some((targetRoleKey) => targetRoleKey === strategy.roleKey || !expectedPlayableRoles.has(targetRoleKey))) fail(`${strategy.maneuverStrategyKey} has an invalid target role`);
      strategy.leverageAssetKeys.forEach((assetKey) => assertContains(assetKeys, assetKey, `${strategy.maneuverStrategyKey}.leverageAssetKeys`));
      assertContains(fallbackKeys, strategy.fallbackActionKey, `${strategy.maneuverStrategyKey}.fallbackActionKey`);
    }

    const publicRules = resultRules.publicStageRules.filter((rule) => rule.stageKey === stage.stageKey);
    if (publicRules.length !== 1) fail(`${stage.stageKey} must contain exactly one public stage result rule`);
    publicRules[0].candidateFactKeys.forEach((factKey) => assertContains(factKeys, factKey, `${publicRules[0].ruleKey}.candidateFactKeys`));
    assertContains(stateKeys, publicRules[0].outcomeStateKey, `${publicRules[0].ruleKey}.outcomeStateKey`);
    const personalRules = resultRules.personalStageRules.filter((rule) => rule.stageKey === stage.stageKey);
    if (personalRules.length !== expectedPlayableRoles.size || new Set(personalRules.map((rule) => rule.roleKey)).size !== expectedPlayableRoles.size) fail(`${stage.stageKey} must contain one personal result rule per configured role`);
    for (const rule of personalRules) {
      if (!expectedPlayableRoles.has(rule.roleKey)) fail(`${rule.ruleKey} has an invalid role`);
      rule.candidateFactKeys.forEach((factKey) => assertContains(factKeys, factKey, `${rule.ruleKey}.candidateFactKeys`));
    }

    for (const scenario of reactionScenarios.reactionScenarios.filter((candidate) => candidate.stageKey === stage.stageKey)) {
      if (!expectedPlayableRoles.has(scenario.sourceRoleKey) || !expectedPlayableRoles.has(scenario.targetRoleKey) || scenario.sourceRoleKey === scenario.targetRoleKey) fail(`${scenario.reactionKey} has invalid source/target roles`);
      const triggerRoleStage = roleEntries.find((entry) => entry.roleKey === scenario.sourceRoleKey);
      if (!triggerRoleStage?.mainCards.some((card) => card.actionKey === scenario.triggerActionKey)) fail(`${scenario.reactionKey} triggerActionKey does not belong to its source role`);
      assertContains(requestKeys, scenario.interactionRequestKey, `${scenario.reactionKey}.interactionRequestKey`);
      const request = stage.interactionRequestCatalog.find((candidate) => candidate.requestKey === scenario.interactionRequestKey)!;
      if (request.sourceRoleKey !== scenario.sourceRoleKey || request.targetRoleKey !== scenario.targetRoleKey) fail(`${scenario.reactionKey} request source/target mismatch`);
      const responseActionKeys = new Set(scenario.responseOptions.map((option) => option.actionKey));
      assertContains(responseActionKeys, scenario.fallbackResponseActionKey, `${scenario.reactionKey}.fallbackResponseActionKey`);
      for (const option of scenario.responseOptions) {
        assertContains(factKeys, option.factKey, `${scenario.reactionKey}:${option.actionKey}.factKey`);
        assertContains(stateKeys, option.nextStateKey, `${scenario.reactionKey}:${option.actionKey}.nextStateKey`);
      }
    }

    const systemAction = systemActions.systemActions.find((action) => action.systemActionKey === stage.systemActionKey)!;
    if (systemAction.stageKey !== stage.stageKey || systemAction.roleKey !== worldActorKey) fail(`${stage.systemActionKey} has invalid stage/world actor`);
    if (systemAction.claimable !== false || systemAction.controllerMode !== "SYSTEM") fail(`${stage.systemActionKey} must remain unclaimable and SYSTEM-controlled`);
    systemAction.inputStateKeys.forEach((key) => assertContains(stateKeys, key, `${systemAction.systemActionKey}.inputStateKeys`));
    systemAction.factKeys.forEach((key) => assertContains(factKeys, key, `${systemAction.systemActionKey}.factKeys`));
    systemAction.observableTraceKeys.forEach((key) => assertContains(traceKeys, key, `${systemAction.systemActionKey}.observableTraceKeys`));
    systemAction.assetMutations.forEach((mutation) => assertContains(assetKeys, mutation.assetKey, `${systemAction.systemActionKey}.assetMutations`));
    assertContains(stateKeys, systemAction.nextStateKey, `${systemAction.systemActionKey}.nextStateKey`);

    for (const fallback of agentPolicies.fallbackActions.filter((candidate) => candidate.stageKey === stage.stageKey)) {
      fallback.factKeys.forEach((key) => assertContains(factKeys, key, `${fallback.actionKey}.factKeys`));
      fallback.assetMutations.forEach((mutation) => assertContains(assetKeys, mutation.assetKey, `${fallback.actionKey}.assetMutations`));
      assertContains(stateKeys, fallback.nextStateKey, `${fallback.actionKey}.nextStateKey`);
    }
    for (const policy of agentPolicies.policies.filter((candidate) => candidate.stageKey === stage.stageKey)) {
      const roleEntry = roleStageContent.roleStages.find((entry) => entry.stageKey === stage.stageKey && entry.roleKey === policy.roleKey)!;
      const roleActionKeys = new Set(roleEntry.mainCards.map((card) => card.actionKey));
      if (policy.actionWeights.length !== roleActionKeys.size || policy.actionWeights.some((weight) => !roleActionKeys.has(weight.actionKey))) fail(`${policy.policyVersion} action weights do not cover the role cards`);
      assertContains(fallbackKeys, policy.fallbackBySlot.MAIN, `${policy.policyVersion}.fallbackBySlot.MAIN`);
      policy.assetPriority.forEach((key) => assertContains(assetKeys, key, `${policy.policyVersion}.assetPriority`));
    }
  }

  roleStageContent.roleStages.forEach((entry) => assertContains(stageKeys, entry.stageKey, `${entry.stageKey}:${entry.roleKey}`));
  systemActions.systemActions.forEach((action) => assertContains(stageKeys, action.stageKey, action.systemActionKey));
  agentPolicies.policies.forEach((policy) => assertContains(roleStageKeys, `${policy.stageKey}:${policy.roleKey}`, policy.policyVersion));
  maneuverStrategies.maneuverStrategies.forEach((strategy) => assertContains(roleStageKeys, `${strategy.stageKey}:${strategy.roleKey}`, strategy.maneuverStrategyKey));
  reactionScenarios.reactionScenarios.forEach((scenario) => assertContains(stageKeys, scenario.stageKey, scenario.reactionKey));
  resultRules.publicStageRules.forEach((rule) => assertContains(stageKeys, rule.stageKey, rule.ruleKey));
  resultRules.personalStageRules.forEach((rule) => assertContains(roleStageKeys, `${rule.stageKey}:${rule.roleKey}`, rule.ruleKey));

  const validateEndingClassifications = (label: string, classifications: Array<{ endingKey: string; minimumScore: number }>) => {
    unique(classifications.map((classification) => classification.endingKey), `${label} ending keys`);
    for (let index = 1; index < classifications.length; index += 1) {
      if (classifications[index - 1].minimumScore <= classifications[index].minimumScore) fail(`${label} classifications must use strictly descending minimumScore thresholds`);
    }
  };
  if (endingRules.globalEndingRule.evidenceStageRange.join(",") !== "1,6") fail("global ending must be classified from stage 1-6 evidence");
  validateEndingClassifications(endingRules.globalEndingRule.ruleKey, endingRules.globalEndingRule.classifications);
  if (endingRules.personalEndingRules.length !== expectedPlayableRoles.size || new Set(endingRules.personalEndingRules.map((rule) => rule.roleKey)).size !== expectedPlayableRoles.size) fail("ending rules must contain one personal rule per configured role");
  for (const rule of endingRules.personalEndingRules) {
    if (!expectedPlayableRoles.has(rule.roleKey)) fail(`${rule.ruleKey} has an invalid role`);
    if (rule.evidenceStageRange.join(",") !== "1,6") fail(`${rule.ruleKey} must classify from stage 1-6 evidence`);
    validateEndingClassifications(rule.ruleKey, rule.classifications);
  }
}

export function validateContinuousStrategyPackage(content: ContinuousStrategyPackage): ContinuousStrategyPackage {
  if (content.contract.worldId !== content.manifest.templateKey) fail("manifest templateKey differs from the game contract");
  if (content.contract.strategyVersion !== content.manifest.contentVersion) fail("manifest contentVersion differs from the game contract");
  if (!content.contract.playableRoleKeys.length || new Set(content.contract.playableRoleKeys).size !== content.contract.playableRoleKeys.length) fail("game contract must define unique player roles");
  if (!content.contract.worldActorKey || content.contract.playableRoleKeys.includes(content.contract.worldActorKey)) fail("game contract world actor is invalid");
  validateStrategyRegistry(content.registry);
  validateStrategyManifest(content.manifest);
  validateStages(content.stages);
  validateRoleStageContent(content.roleStageContent);
  validateSystemActions(content.systemActions);
  validateAgentPolicies(content.agentPolicies);
  validateManeuverStrategies(content.maneuverStrategies);
  validateReactionScenarios(content.reactionScenarios);
  validateResultRules(content.resultRules);
  validateEndingRules(content.endingRules);
  validateContentGraph(content);
  return content;
}
