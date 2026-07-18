import { evaluateSevenStages } from "./evaluator";
import { loadContinuousStrategyPackage } from "./loader";
import type { ContinuousStrategyPackage } from "./types";

function requireExact(label: string, actual: number, expected: number) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

function requireDistinct(label: string, values: string[]) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains repeated authored text`);
}

export function lintContinuousStrategy(content: ContinuousStrategyPackage = loadContinuousStrategyPackage()) {
  if (content.manifest.releaseStatus !== "published") throw new Error(`${content.manifest.contentVersion} must be published after all seven stages are complete`);
  if (content.manifest.stageCoverage.join(",") !== "1,2,3,4,5,6,7") throw new Error("published manifest must cover stages 1-7 in order");
  const stages = [...content.stages.stages].sort((left, right) => left.stageNumber - right.stageNumber);
  const roleStages = content.roleStageContent.roleStages;
  const cards = roleStages.flatMap((entry) => entry.mainCards);
  const roleCount = content.contract.playableRoleKeys.length;
  const roleStageCount = stages.length * roleCount;
  const mainCardCount = roleStageCount * 3;
  requireExact("stages", stages.length, 7);
  requireExact("role-stage briefs", roleStages.length, roleStageCount);
  requireExact("MAIN cards", cards.length, mainCardCount);
  requireExact("MAIN receipts", new Set(cards.map((card) => card.receipt.receiptKey)).size, mainCardCount);
  requireExact("MAIN effects", new Set(cards.map((card) => card.effect.effectKey)).size, mainCardCount);
  requireExact("maneuver strategies", content.maneuverStrategies.maneuverStrategies.length, roleStageCount);
  requireExact("world actions", content.systemActions.systemActions.length, 7);
  requireExact("Role Agent policies", content.agentPolicies.policies.length, roleStageCount);
  requireExact("fallback MAIN actions", content.agentPolicies.fallbackActions.length, roleStageCount);
  requireExact("public stage rules", content.resultRules.publicStageRules.length, 7);
  requireExact("personal stage rules", content.resultRules.personalStageRules.length, roleStageCount);
  requireExact("personal ending rules", content.endingRules.personalEndingRules.length, roleCount);
  if (!content.endingRules.globalEndingRule) throw new Error("global ending rule is missing");
  if (content.systemActions.systemActions.some((action) => action.roleKey !== content.contract.worldActorKey || action.claimable !== false || action.controllerMode !== "SYSTEM")) throw new Error("world actions must remain unclaimable and system-controlled");

  requireDistinct("private briefs", roleStages.map((entry) => entry.privateBrief));
  requireDistinct("personal pressures", roleStages.map((entry) => entry.personalPressure));
  requireDistinct("MAIN titles", cards.map((card) => card.title));
  requireDistinct("MAIN objectives", cards.map((card) => card.objective));
  requireDistinct("receipt texts", cards.map((card) => card.receipt.text));
  requireDistinct("maneuver titles", content.maneuverStrategies.maneuverStrategies.map((strategy) => strategy.title));
  requireDistinct("maneuver objectives", content.maneuverStrategies.maneuverStrategies.map((strategy) => strategy.objective));
  requireDistinct("system pressures", content.systemActions.systemActions.map((action) => action.visiblePressure));
  requireDistinct("public result summaries", content.resultRules.publicStageRules.map((rule) => rule.summary));
  requireDistinct("personal result summaries", content.resultRules.personalStageRules.map((rule) => rule.summary));

  const first = evaluateSevenStages(content);
  const second = evaluateSevenStages(content);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("seven-stage evaluation changed between identical runs");
  requireExact("evaluated stages", first.stages.length, 7);
  requireExact("evaluated MAIN receipts", first.receipts.length, roleStageCount);
  requireExact("evaluated maneuvers", first.maneuvers.length, roleStageCount);
  requireExact("evaluated reactions", first.reactions.length, content.reactionScenarios.reactionScenarios.length);
  requireExact("evaluated system actions", first.systemActions.length, 7);
  requireExact("evaluated public results", first.publicResults.length, 7);
  requireExact("evaluated personal results", first.personalResults.length, roleStageCount);
  requireExact("evaluated personal endings", first.ending.personal.length, roleCount);
  const roundSeven = first.stages.find((stage) => stage.stageNumber === 7)!;
  requireExact("round-seven maneuvers", roundSeven.maneuvers.length, roleCount);
  const publishIndex = roundSeven.resolutionOrder.indexOf("PUBLISHED");
  if (publishIndex < 0 || roundSeven.maneuvers.some((maneuver) => roundSeven.resolutionOrder.indexOf(maneuver.maneuverStrategyKey) >= publishIndex)) throw new Error("round seven must seal three maneuvers before publication");

  const manifestHash = content.registry.strategies[content.manifest.contentVersion].manifestSha256;
  return {
    status: "PASS",
    contentVersion: content.manifest.contentVersion,
    releaseStatus: content.manifest.releaseStatus,
    stages: stages.length,
    playableRoles: roleCount,
    roleStageBriefs: roleStages.length,
    mainCards: cards.length,
    receipts: cards.length,
    effects: cards.length,
    maneuverStrategies: content.maneuverStrategies.maneuverStrategies.length,
    mandatoryReactions: content.reactionScenarios.reactionScenarios.length,
    systemActions: content.systemActions.systemActions.length,
    agentPolicies: content.agentPolicies.policies.length,
    publicResultRules: content.resultRules.publicStageRules.length,
    personalResultRules: content.resultRules.personalStageRules.length,
    globalEndingRules: 1,
    personalEndingRules: content.endingRules.personalEndingRules.length,
    deterministicEvaluation: {
      stages: first.stages.length,
      receipts: first.receipts.length,
      maneuvers: first.maneuvers.length,
      reactions: first.reactions.length,
      publicResults: first.publicResults.length,
      personalResults: first.personalResults.length
    },
    distinctness: {
      privateBriefs: new Set(roleStages.map((entry) => entry.privateBrief)).size,
      personalPressures: new Set(roleStages.map((entry) => entry.personalPressure)).size,
      mainTitles: new Set(cards.map((card) => card.title)).size,
      mainObjectives: new Set(cards.map((card) => card.objective)).size,
      receiptTexts: new Set(cards.map((card) => card.receipt.text)).size,
      maneuverTitles: new Set(content.maneuverStrategies.maneuverStrategies.map((strategy) => strategy.title)).size,
      maneuverObjectives: new Set(content.maneuverStrategies.maneuverStrategies.map((strategy) => strategy.objective)).size
    },
    manifestArtifacts: content.manifest.files.length,
    manifestSha256: manifestHash
  };
}

export const lintD01ContinuousStrategy = lintContinuousStrategy;

if (require.main === module) console.log(JSON.stringify(lintContinuousStrategy()));
