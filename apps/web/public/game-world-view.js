export function gameWorldFromProjection(projection = {}) {
  const world = projection.world || projection.room?.world || null;
  if (!world || world.schemaVersion !== "game_page_world_v1") return null;
  return world;
}

export function gameRoleFromProjection(world, role = {}) {
  const definition = world?.roles?.find((item) => item.roleKey === role.roleKey) || {};
  return { ...definition, ...role, gameplayProfile: role.gameplayProfile || definition.gameplayProfile };
}

export function gamePresentationFromProjection(world) {
  return {
    locale: world?.locale || "zh-CN",
    title: world?.title || "",
    totalStages: Number(world?.totalStages || 7),
    locationLabel: world?.presentation?.locationLabel || "",
    roundLabel: world?.presentation?.roundLabel || "",
    finaleLabel: world?.presentation?.finaleLabel || "",
    sceneBackground: world?.presentation?.sceneBackground || "",
    accent: world?.presentation?.accent || "#6545f5",
    accentSoft: world?.presentation?.accentSoft || "#f3f0ff",
    statusMetrics: Array.isArray(world?.presentation?.statusMetrics) ? world.presentation.statusMetrics : []
  };
}
