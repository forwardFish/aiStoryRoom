import {
  type AssetMutation,
  type ContinuousStrategyPackage,
  type EndingClassification,
  type InfluenceEdge,
  type PlayableRoleKey,
  type ReactionScenario
} from "./types";

export type StageChoiceMap = Record<PlayableRoleKey, string>;
export type StageOneChoiceMap = StageChoiceMap;
export type StageOneEvaluation = {
  stageKey: string;
  commonContestKey: string;
  nextStateKey: string;
  receipts: Array<{ roleKey: PlayableRoleKey; actionKey: string; receiptKey: string; text: string }>;
  facts: Array<{ sourceActionKey: string; factKey: string }>;
  influenceEdges: Array<InfluenceEdge & { sourceRoleKey: PlayableRoleKey; originActionKey: string }>;
  observableTraceKeys: string[];
  interactionRequestKeys: string[];
  assetMutations: Array<AssetMutation & { sourceActionKey: string }>;
  systemAction: {
    systemActionKey: string;
    factKeys: string[];
    observableTraceKeys: string[];
    visiblePressure: string;
    claimable: false;
    controllerMode: "SYSTEM";
    assetMutations: AssetMutation[];
  };
};

export type StageEvaluation = StageOneEvaluation & {
  stageNumber: number;
  carriedFactKeys: string[];
  maneuvers: Array<{
    roleKey: PlayableRoleKey;
    maneuverStrategyKey: string;
    targetRoleKey: string;
    leverageAssetKey: string;
  }>;
  reaction: null | {
    reactionKey: string;
    sourceRoleKey: PlayableRoleKey;
    targetRoleKey: PlayableRoleKey;
    responseActionKey: string;
    factKey: string;
  };
  publicResult: { ruleKey: string; selectedFactKey: string; outcomeStateKey: string; summary: string };
  personalResults: Array<{ ruleKey: string; roleKey: PlayableRoleKey; selectedFactKey: string; summary: string }>;
  resolutionOrder: string[];
  published: true;
};

export type SevenStageEvaluation = {
  contentVersion: string;
  stages: StageEvaluation[];
  receipts: StageEvaluation["receipts"];
  maneuvers: StageEvaluation["maneuvers"];
  reactions: Array<NonNullable<StageEvaluation["reaction"]>>;
  systemActions: StageEvaluation["systemAction"][];
  publicResults: StageEvaluation["publicResult"][];
  personalResults: StageEvaluation["personalResults"];
  ending: {
    global: { ruleKey: string; endingKey: string; title: string; score: number; evidenceStageRange: [number, number] };
    personal: Array<{ ruleKey: string; roleKey: PlayableRoleKey; endingKey: string; title: string; score: number; evidenceStageRange: [number, number] }>;
  };
};

function evaluateSelectedMainCards(content: ContinuousStrategyPackage, stageNumber: number, choices: StageChoiceMap): StageOneEvaluation {
  const stage = content.stages.stages.find((candidate) => candidate.stageNumber === stageNumber);
  if (!stage) throw new Error(`STAGE_NOT_FOUND:${stageNumber}`);
  const receipts: StageOneEvaluation["receipts"] = [];
  const facts: StageOneEvaluation["facts"] = [];
  const influenceEdges: StageOneEvaluation["influenceEdges"] = [];
  const observableTraceKeys: string[] = [];
  const interactionRequestKeys: string[] = [];
  const assetMutations: StageOneEvaluation["assetMutations"] = [];

  for (const roleKey of content.contract.playableRoleKeys) {
    const roleStage = content.roleStageContent.roleStages.find((candidate) => candidate.stageKey === stage.stageKey && candidate.roleKey === roleKey);
    if (!roleStage) throw new Error(`ROLE_STAGE_NOT_FOUND:${stage.stageKey}:${roleKey}`);
    const actionKey = choices[roleKey];
    const card = roleStage.mainCards.find((candidate) => candidate.actionKey === actionKey);
    if (!card) throw new Error(`ACTION_NOT_AVAILABLE_FOR_ROLE:${stage.stageKey}:${roleKey}:${actionKey}`);
    receipts.push({ roleKey, actionKey, receiptKey: card.receipt.receiptKey, text: card.receipt.text });
    card.effect.factKeys.forEach((factKey) => facts.push({ sourceActionKey: actionKey, factKey }));
    card.effect.influenceEdges.forEach((edge) => influenceEdges.push({ ...edge, sourceRoleKey: roleKey, originActionKey: actionKey }));
    observableTraceKeys.push(...card.effect.observableTraceKeys);
    interactionRequestKeys.push(...card.effect.interactionRequestKeys);
    card.assetMutations.forEach((mutation) => assetMutations.push({ ...mutation, sourceActionKey: actionKey }));
  }

  const influenceSources = new Set(influenceEdges.map((edge) => edge.sourceRoleKey));
  if (influenceSources.size < stage.minimumDistinctPlayableInfluenceSources) throw new Error(`INSUFFICIENT_DISTINCT_INFLUENCE_SOURCES:${stage.stageKey}:${influenceSources.size}`);
  const systemAction = content.systemActions.systemActions.find((candidate) => candidate.systemActionKey === stage.systemActionKey);
  if (!systemAction) throw new Error(`SYSTEM_ACTION_NOT_FOUND:${stage.systemActionKey}`);

  return {
    stageKey: stage.stageKey,
    commonContestKey: stage.commonContest.contestKey,
    nextStateKey: stage.nextStateKey,
    receipts,
    facts,
    influenceEdges,
    observableTraceKeys: [...new Set(observableTraceKeys)],
    interactionRequestKeys: [...new Set(interactionRequestKeys)],
    assetMutations,
    systemAction: {
      systemActionKey: systemAction.systemActionKey,
      factKeys: systemAction.factKeys,
      observableTraceKeys: systemAction.observableTraceKeys,
      visiblePressure: systemAction.visiblePressure,
      claimable: systemAction.claimable,
      controllerMode: systemAction.controllerMode,
      assetMutations: systemAction.assetMutations
    }
  };
}

export function evaluateStageOne(content: ContinuousStrategyPackage, choices: StageOneChoiceMap): StageOneEvaluation {
  return evaluateSelectedMainCards(content, 1, choices);
}

function reactionForStage(content: ContinuousStrategyPackage, stageKey: string): ReactionScenario | undefined {
  return content.reactionScenarios.reactionScenarios.find((candidate) => candidate.stageKey === stageKey);
}

export function createDeterministicSevenStageChoices(content: ContinuousStrategyPackage): Record<string, StageChoiceMap> {
  const choices: Record<string, StageChoiceMap> = {};
  for (const stage of [...content.stages.stages].sort((left, right) => left.stageNumber - right.stageNumber)) {
    const stageChoices = {} as StageChoiceMap;
    const reaction = reactionForStage(content, stage.stageKey);
    content.contract.playableRoleKeys.forEach((roleKey, roleIndex) => {
      const roleStage = content.roleStageContent.roleStages.find((candidate) => candidate.stageKey === stage.stageKey && candidate.roleKey === roleKey);
      if (!roleStage) throw new Error(`ROLE_STAGE_NOT_FOUND:${stage.stageKey}:${roleKey}`);
      const trigger = reaction?.sourceRoleKey === roleKey ? roleStage.mainCards.find((card) => card.actionKey === reaction.triggerActionKey) : undefined;
      stageChoices[roleKey] = (trigger ?? roleStage.mainCards[(stage.stageNumber + roleIndex) % roleStage.mainCards.length]).actionKey;
    });
    choices[stage.stageKey] = stageChoices;
  }
  return choices;
}

export function evaluateStage(content: ContinuousStrategyPackage, stageNumber: number, choices: StageChoiceMap): StageEvaluation {
  const main = evaluateSelectedMainCards(content, stageNumber, choices);
  const stage = content.stages.stages.find((candidate) => candidate.stageNumber === stageNumber)!;
  const maneuvers = content.contract.playableRoleKeys.map((roleKey) => {
    const strategy = content.maneuverStrategies.maneuverStrategies.find((candidate) => candidate.stageKey === stage.stageKey && candidate.roleKey === roleKey);
    if (!strategy) throw new Error(`MANEUVER_STRATEGY_NOT_FOUND:${stage.stageKey}:${roleKey}`);
    return {
      roleKey,
      maneuverStrategyKey: strategy.maneuverStrategyKey,
      targetRoleKey: strategy.allowedTargetRoleKeys[0],
      leverageAssetKey: strategy.leverageAssetKeys[0]
    };
  });
  const scenario = reactionForStage(content, stage.stageKey);
  let reaction: StageEvaluation["reaction"] = null;
  if (scenario) {
    if (!main.receipts.some((receipt) => receipt.actionKey === scenario.triggerActionKey)) throw new Error(`MANDATORY_REACTION_NOT_TRIGGERED:${scenario.reactionKey}`);
    const response = scenario.responseOptions[0];
    reaction = {
      reactionKey: scenario.reactionKey,
      sourceRoleKey: scenario.sourceRoleKey,
      targetRoleKey: scenario.targetRoleKey,
      responseActionKey: response.actionKey,
      factKey: response.factKey
    };
  }
  const producedFacts = new Set([
    ...main.facts.map((fact) => fact.factKey),
    ...main.systemAction.factKeys,
    ...(reaction ? [reaction.factKey] : [])
  ]);
  const publicRule = content.resultRules.publicStageRules.find((rule) => rule.stageKey === stage.stageKey);
  if (!publicRule) throw new Error(`PUBLIC_RESULT_RULE_NOT_FOUND:${stage.stageKey}`);
  const publicFact = publicRule.candidateFactKeys.find((factKey) => producedFacts.has(factKey));
  if (!publicFact) throw new Error(`PUBLIC_RESULT_HAS_NO_PRODUCED_FACT:${stage.stageKey}`);
  const publicResult = { ruleKey: publicRule.ruleKey, selectedFactKey: publicFact, outcomeStateKey: publicRule.outcomeStateKey, summary: publicRule.summary };
  const personalResults = content.contract.playableRoleKeys.map((roleKey) => {
    const rule = content.resultRules.personalStageRules.find((candidate) => candidate.stageKey === stage.stageKey && candidate.roleKey === roleKey);
    if (!rule) throw new Error(`PERSONAL_RESULT_RULE_NOT_FOUND:${stage.stageKey}:${roleKey}`);
    const selectedFactKey = rule.candidateFactKeys.find((factKey) => producedFacts.has(factKey));
    if (!selectedFactKey) throw new Error(`PERSONAL_RESULT_HAS_NO_PRODUCED_FACT:${stage.stageKey}:${roleKey}`);
    return { ruleKey: rule.ruleKey, roleKey, selectedFactKey, summary: rule.summary };
  });
  const resolutionOrder = [
    ...main.receipts.map((receipt) => receipt.actionKey),
    ...maneuvers.map((maneuver) => maneuver.maneuverStrategyKey),
    ...(reaction ? [reaction.responseActionKey] : []),
    main.systemAction.systemActionKey,
    publicResult.ruleKey,
    ...personalResults.map((result) => result.ruleKey),
    "PUBLISHED"
  ];
  return { ...main, stageNumber, carriedFactKeys: stage.carriedFactKeys, maneuvers, reaction, publicResult, personalResults, resolutionOrder, published: true };
}

function classify(score: number, classifications: EndingClassification[]): EndingClassification {
  const classification = classifications.find((candidate) => score >= candidate.minimumScore);
  if (!classification) throw new Error(`ENDING_CLASSIFICATION_NOT_FOUND:${score}`);
  return classification;
}

export function evaluateSevenStages(content: ContinuousStrategyPackage): SevenStageEvaluation {
  const fixture = createDeterministicSevenStageChoices(content);
  const stages = [...content.stages.stages]
    .sort((left, right) => left.stageNumber - right.stageNumber)
    .map((stage) => evaluateStage(content, stage.stageNumber, fixture[stage.stageKey]));
  const evidenceStages = stages.filter((stage) => stage.stageNumber <= 6);
  const globalScore = evidenceStages.reduce((score, stage) => score + stage.receipts.length + stage.influenceEdges.length + stage.systemAction.factKeys.length, 0);
  const globalRule = content.endingRules.globalEndingRule;
  const globalClassification = classify(globalScore, globalRule.classifications);
  const personal = content.endingRules.personalEndingRules.map((rule) => {
    const score = evidenceStages.reduce((total, stage) => total
      + stage.receipts.filter((receipt) => receipt.roleKey === rule.roleKey).length
      + stage.maneuvers.filter((maneuver) => maneuver.roleKey === rule.roleKey).length
      + stage.influenceEdges.filter((edge) => edge.sourceRoleKey === rule.roleKey).length, 0);
    const classification = classify(score, rule.classifications);
    return { ruleKey: rule.ruleKey, roleKey: rule.roleKey, endingKey: classification.endingKey, title: classification.title, score, evidenceStageRange: rule.evidenceStageRange };
  });
  return {
    contentVersion: content.manifest.contentVersion,
    stages,
    receipts: stages.flatMap((stage) => stage.receipts),
    maneuvers: stages.flatMap((stage) => stage.maneuvers),
    reactions: stages.flatMap((stage) => stage.reaction ? [stage.reaction] : []),
    systemActions: stages.map((stage) => stage.systemAction),
    publicResults: stages.map((stage) => stage.publicResult),
    personalResults: stages.flatMap((stage) => stage.personalResults),
    ending: {
      global: { ruleKey: globalRule.ruleKey, endingKey: globalClassification.endingKey, title: globalClassification.title, score: globalScore, evidenceStageRange: globalRule.evidenceStageRange },
      personal
    }
  };
}

export const D01_STAGE_ONE_FIXTURE: StageOneChoiceMap = {
  zhejiang_governor: "main_s1_governor_joint_review",
  xunfu: "main_s1_xunfu_publish_progress",
  county_magistrate: "main_s1_magistrate_retain_original_register"
};
