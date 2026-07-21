import type { StoryPackageContextInput, StoryPackageRoleView } from "./types";
import { loadStoryPackage } from "./loader";

export function buildStoryPackageRoleView(worldId: string, input: StoryPackageContextInput): StoryPackageRoleView {
  const loaded = loadStoryPackage(worldId);
  const node = loaded.storyPackage.nodes.find((candidate) => candidate.nodeId === input.currentNodeId);
  if (!node) throw new Error(`STORY_PACKAGE_NODE_UNKNOWN:${input.currentNodeId}`);
  const roleAcl = loaded.storyPackage.roles.find((role) => role.roleKey === input.roleKey);
  if (!roleAcl) throw new Error(`STORY_PACKAGE_ROLE_UNKNOWN:${input.roleKey}`);
  const droppedCardIds = new Set(roleAcl.hiddenCardIds);
  const visibleCardIds = new Set([...roleAcl.visibleCardIds, ...node.relevantCardIds]);
  const cards = loaded.storyPackage.cards.filter((card) => {
    if (!visibleCardIds.has(card.cardId)) return false;
    if (roleAcl.hiddenCardIds.includes(card.cardId)) {
      droppedCardIds.add(card.cardId);
      return false;
    }
    if (card.visibility === "role_scoped" && card.visibleToRoleKeys?.length && !card.visibleToRoleKeys.includes(input.roleKey)) {
      droppedCardIds.add(card.cardId);
      return false;
    }
    if (card.visibility === "hidden_until_revealed") {
      droppedCardIds.add(card.cardId);
      return false;
    }
    return true;
  });
  const visibleLatentTruthIds = new Set([...roleAcl.visibleLatentTruthIds, ...node.latentTruthIds]);
  const visibleLatentTruths = loaded.storyPackage.latentTruths.filter((truth) => {
    if (!visibleLatentTruthIds.has(truth.truthId)) return false;
    if (roleAcl.blockedLatentTruthIds.includes(truth.truthId)) return false;
    if (truth.visibility === "role_scoped" && truth.visibleToRoleKeys?.length && !truth.visibleToRoleKeys.includes(input.roleKey)) return false;
    return truth.visibility !== "hidden_until_revealed";
  });
  const mainlineQuestions = loaded.storyPackage.mainlineQuestions.filter((question) => node.mainlineQuestionIds.includes(question.questionId));
  const pressures = loaded.storyPackage.pressures.filter((pressure) => node.activePressureIds.includes(pressure.pressureId));
  return {
    roleKey: input.roleKey,
    currentNodeId: node.nodeId,
    currentSceneLabel: input.recentCanon?.sceneLabel ?? node.sceneLabel,
    currentSituationText: input.recentCanon?.situationText ?? node.situationBoundary,
    mainlineQuestions,
    cards,
    visibleLatentTruths,
    pressures,
    pendingConsequences: input.pendingConsequences ?? [],
    recentCanonIds: input.recentCanon?.sourceCanonIds ?? [],
    droppedCardIds: [...droppedCardIds]
  };
}
