import { getGameDefinition, type GameRoleDefinition } from "@ai-story/templates";

function gameplayProfile(role: GameRoleDefinition, locale: "en" | "zh-CN") {
  if (role.gameplayProfile) return role.gameplayProfile;
  const known = role.knownInfo.slice(0, 5);
  return {
    characterName: role.roleName,
    rank: role.identity,
    office: role.currentState,
    fateQuestion: role.personalGoal,
    goals: [role.personalGoal, role.abilityText, role.arcText].filter(Boolean).slice(0, 3),
    resources: known.map((label) => ({ label, value: locale === "zh-CN" ? "已知" : "Known" })),
    leverage: [role.abilityText, ...known].filter(Boolean).slice(0, 4)
  };
}

export function gamePageProjection(worldId: string) {
  const game = getGameDefinition(worldId);
  const locale = game.presentation.locale || "en";
  return {
    schemaVersion: "game_page_world_v1" as const,
    worldId: game.worldId,
    title: game.catalog.title,
    locale,
    totalStages: game.engine.fixedRules?.stageCount || 7,
    presentation: {
      locationLabel: game.presentation.locationLabel,
      roundLabel: game.presentation.roundLabel,
      finaleLabel: game.presentation.finaleLabel,
      sceneBackground: game.presentation.sceneBackground,
      accent: game.presentation.accent,
      accentSoft: game.presentation.accentSoft,
      statusMetrics: game.presentation.statusMetrics || []
    },
    roles: game.roles.map((role) => ({
      roleKey: role.roleKey,
      roleName: role.roleName,
      identity: role.identity,
      publicInfo: role.publicInfo,
      personalGoal: role.personalGoal,
      currentState: role.currentState,
      abilityText: role.abilityText,
      arcText: role.arcText,
      knownInfo: role.knownInfo,
      cannotDo: role.cannotDo,
      portrait: role.portrait,
      gameplayProfile: gameplayProfile(role, locale)
    }))
  };
}

export type GamePageProjection = ReturnType<typeof gamePageProjection>;
