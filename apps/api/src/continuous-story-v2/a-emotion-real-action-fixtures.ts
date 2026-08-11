import type { DecisionCandidateV2 } from "@ai-story/shared";
import { ContinuousStrategyContentService } from "../continuous-strategy/content.service";
import {
  boundaryAccepted,
  candidateIntentDraft,
  guardPlayerIntentV2,
  planIntentAction,
  type IntentAssetContext,
  type PlannedIntentAction
} from "./player-intent";
import type { StoryRoleContext } from "./story-content";

export type RealActionRole = StoryRoleContext;

export function plannedSangtianCatalogAction(input: {
  stageIndex: number;
  actorRoleKey: string;
  actionKey: string;
  roles: RealActionRole[];
}): PlannedIntentAction {
  const content = new ContinuousStrategyContentService().forGame("sangtian", "sangtian_v1_2");
  const stage = content.stage(input.stageIndex);
  const actor = input.roles.find((role) => role.roleKey === input.actorRoleKey);
  if (!actor) throw new Error(`REAL_ACTION_ACTOR_NOT_FOUND:${input.actorRoleKey}`);
  const roleStage = content.roleStage(input.stageIndex, input.actorRoleKey);
  const card = roleStage.mainCards.find((candidate) => candidate.actionKey === input.actionKey);
  if (!card) throw new Error(`REAL_ACTION_CARD_NOT_FOUND:${input.actionKey}`);
  const target = card.targetRoleKey
    ? input.roles.find((role) => role.roleKey === card.targetRoleKey) || null
    : null;
  const intentDraft = candidateIntentDraft({
    card,
    fallbackCard: null,
    targetRoleId: target?.id || null,
    targetRoleName: target?.roleName || null,
    publicFrameId: stage.commonContest.contestKey,
    publicFrameLabel: stage.commonContest.title
  });
  const assets: IntentAssetContext[] = stage.assetCatalog.map((asset) => {
    const owner = asset.initialOwnerRoleKey
      ? input.roles.find((role) => role.roleKey === asset.initialOwnerRoleKey) || null
      : null;
    return {
      assetKey: asset.assetKey,
      kind: asset.kind,
      ownerRoleId: owner?.id || null,
      quantity: 1,
      status: "ACTIVE",
      stateJson: { stageKey: stage.stageKey }
    };
  });
  const guard = guardPlayerIntentV2(intentDraft, {
    role: actor,
    allRoles: input.roles.map(({ id, roleKey, roleName }) => ({ id, roleKey, roleName })),
    visibleFacts: [],
    allFacts: [],
    assets,
    stage
  });
  if (!boundaryAccepted(guard.decision)) throw new Error(`REAL_ACTION_GUARD_REJECTED:${input.actionKey}:${guard.decision}`);
  const candidate: DecisionCandidateV2 = {
    id: `candidate:${card.actionKey}`,
    actionKey: card.actionKey,
    label: card.title,
    description: card.objective,
    intent: card.objective,
    targetRoleId: target?.id || null,
    targetRoleName: target?.roleName || null,
    risk: card.risk,
    basisFactKeys: [],
    requiredAssetKeys: intentDraft.leverageKeys,
    authorityBasis: actor.abilityText || actor.identity,
    intendedOutcome: card.objective,
    concreteCost: card.risk,
    expectedCountermove: "The authoritative settlement decides the countermove.",
    visibility: card.visibility,
    effectHooks: card.effect.factKeys.map((factKey) => `WORLD_FACT:${factKey}`),
    intentDraft
  };
  const action = planIntentAction({
    intent: intentDraft,
    guard,
    role: actor,
    visibleFacts: [],
    stage,
    allRoles: input.roles.map(({ id, roleKey, roleName }) => ({ id, roleKey, roleName })),
    candidate,
    card
  });
  if (action.actionKey !== card.actionKey) throw new Error(`REAL_ACTION_KEY_LOST:${input.actionKey}`);
  if (!card.effect.factKeys.every((factKey) => action.effectFactKeys.includes(factKey))) {
    throw new Error(`REAL_ACTION_FACTS_LOST:${input.actionKey}`);
  }
  return action;
}

export function realActionRole(id: string, roleKey: string, roleName = roleKey): RealActionRole {
  return {
    id,
    roleKey,
    roleName,
    identity: roleName,
    publicInfo: "test",
    hiddenSecret: null,
    personalGoal: "test",
    currentState: "test",
    abilityText: "test authority",
    cannotDo: []
  };
}
