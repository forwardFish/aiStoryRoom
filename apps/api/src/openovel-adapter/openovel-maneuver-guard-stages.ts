import {
  getGameDefinition,
  type GameDefinition,
  type StageDefinition,
} from "@ai-story/templates";
import type { OpenNovelManeuverPackage } from "./openovel-maneuver-package";

export function installOpenNovelManeuverGuardStages(
  maneuverPackage: OpenNovelManeuverPackage,
) {
  const game = getGameDefinition(maneuverPackage.worldId) as GameDefinition & {
    stages?: StageDefinition[];
  };
  if (Array.isArray(game.stages) && game.stages.length) return game;
  if (!Object.isExtensible(game)) {
    throw new Error(`OPENOVEL_MANEUVER_GAME_NOT_EXTENSIBLE:${maneuverPackage.worldId}`);
  }
  const stages = compileGuardStages(game, maneuverPackage);
  Object.defineProperty(game, "stages", {
    value: stages,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return game;
}

export function compileGuardStages(
  game: GameDefinition,
  maneuverPackage: OpenNovelManeuverPackage,
): StageDefinition[] {
  const sceneKeys = unique(maneuverPackage.calendar.turns.map((entry) => entry.sceneKey));
  const scenes = sceneKeys
    .map((sceneKey) => maneuverPackage.scene(sceneKey))
    .filter((scene): scene is NonNullable<typeof scene> => Boolean(scene));
  const playableRoleKeys = unique(game.roles.map((role) => role.roleKey));
  const stateKeys = unique([
    ...Object.keys(maneuverPackage.customPlan.statePatch),
    ...scenes.flatMap((scene) => scene.contacts.flatMap((contact) => Object.keys(contact.statePatch))),
    ...scenes.flatMap((scene) => scene.investigations.flatMap((item) => Object.keys(item.statePatch))),
    ...maneuverPackage.initialLeverageKeys.flatMap((key) =>
      Object.keys(maneuverPackage.leverage(key)?.statePatch || {})),
  ]);
  const factKeys = unique([
    ...maneuverPackage.customPlan.factKeys,
    ...scenes.flatMap((scene) => scene.contacts.flatMap((contact) => contact.allowedFactKeys)),
    ...scenes.flatMap((scene) => scene.investigations.flatMap((item) => item.factKeys)),
    ...maneuverPackage.initialLeverageKeys.flatMap((key) =>
      maneuverPackage.leverage(key)?.factKeys || []),
  ]);
  const traceKeys = unique([
    ...maneuverPackage.customPlan.traces,
    ...scenes.flatMap((scene) => scene.investigations.flatMap((item) => item.traces)),
    ...scenes.flatMap((scene) => scene.contacts.map((contact) =>
      maneuverPackage.surfaces.contactTrace(contact))),
    ...maneuverPackage.initialLeverageKeys.map((key) => maneuverPackage.leverage(key))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => maneuverPackage.surfaces.leverageTrace(item)),
  ]);
  const ownerRoleKey = game.roles.find((role) => role.canBeHumanControlled)?.roleKey
    || game.roles[0]?.roleKey
    || null;
  const assetCatalog = [
    {
      assetKey: "openovel_public_frame",
      kind: "PUBLIC_FRAME",
      initialOwnerRoleKey: null,
    },
    ...maneuverPackage.initialLeverageKeys.map((assetKey) => ({
      assetKey,
      kind: "LEVERAGE",
      initialOwnerRoleKey: ownerRoleKey,
    })),
  ];
  const maxUsageDay = Math.max(...maneuverPackage.calendar.turns.map((entry) => entry.usageDay));
  return Array.from({ length: maxUsageDay }, (_, index): StageDefinition => {
    const usageDay = index + 1;
    const dayEntries = maneuverPackage.calendar.turns.filter((entry) => entry.usageDay === usageDay);
    const sceneKey = dayEntries[0]?.sceneKey || maneuverPackage.calendar.turns[0].sceneKey;
    const nextSceneKey = maneuverPackage.calendar.turns.find((entry) => entry.usageDay > usageDay)?.sceneKey
      || sceneKey;
    return {
      stageKey: sceneKey,
      stageNumber: usageDay,
      title: sceneKey,
      playableRoleKeys,
      systemRoleKey: game.worldActor?.actorKey || "openovel_system",
      commonContest: {
        contestKey: `openovel:${maneuverPackage.worldId}:${sceneKey}`,
        title: sceneKey,
        assetKey: "openovel_public_frame",
        description: "当前 OpenNovel 主线局势",
      },
      stateCatalog: stateKeys.map((stateKey) => ({ stateKey, description: stateKey })),
      factCatalog: factKeys.map((factKey) => ({ factKey, visibility: "PRIVATE" })),
      assetCatalog,
      traceCatalog: traceKeys.map((traceKey) => ({ traceKey, description: traceKey })),
      interactionRequestCatalog: [],
      carriedFactKeys: factKeys,
      systemActionKey: `openovel_system:${sceneKey}`,
      nextStateKey: nextSceneKey,
      minimumDistinctPlayableInfluenceSources: 1,
    };
  });
}

function unique<T>(items: readonly T[]) {
  return [...new Set(items)];
}
