import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { findGameDefinition, listGameDefinitions, type GameDefinition } from "@ai-story/templates";
import { readContinuousStrategyConfig, selectRunVersions } from "./config/continuous-strategy.config";

function runtimeWorld(game: GameDefinition) {
  const lobby = game.catalog.lobby;
  const maxPlayers = Math.min(game.modes.maxHumanPlayers, game.roles.length);
  const versions = selectRunVersions({
    templateKey: game.worldId,
    mode: "room",
    maxPlayers,
    enabledForNewRooms: readContinuousStrategyConfig().enabledForNewRooms
  });
  return {
    id: game.publicId,
    runtimeId: game.worldId,
    worldId: game.worldId,
    publicId: game.publicId,
    detailPath: `/worlds/${game.worldId}`,
    status: game.status,
    cardTitle: lobby?.title || game.catalog.title,
    cardDescription: lobby?.description || game.catalog.description,
    categoryLabel: lobby?.categoryLabel || game.catalog.genre,
    cardCover: game.catalog.cardCover,
    title: game.catalog.title,
    description: game.catalog.description,
    heroCover: game.catalog.heroCover,
    durationLabel: game.catalog.durationLabel,
    totalDays: game.engine.fixedRules?.stageCount || 7,
    roleCount: game.roles.length,
    minHumanPlayers: game.modes.minHumanPlayers,
    maxHumanPlayers: game.modes.maxHumanPlayers,
    minPlayers: game.modes.minHumanPlayers,
    maxPlayers,
    playable: game.status === "playable",
    modes: [game.modes.solo ? "solo" : null, game.modes.multiplayer ? "multiplayer" : null].filter(Boolean),
    engineVersion: versions.engineVersion,
    strategyVersion: versions.strategyVersion
  };
}

function worldDetail(game: GameDefinition) {
  return {
    ...runtimeWorld(game),
    subtitle: game.catalog.subtitle,
    genre: game.catalog.genre,
    tags: game.catalog.tags,
    durationLabel: game.catalog.durationLabel,
    presentation: game.presentation,
    worldActor: game.worldActor,
    roles: game.roles.map((role) => ({
      key: role.roleKey,
      name: role.roleName,
      identity: role.identity,
      publicInfo: role.publicInfo,
      personalGoal: role.personalGoal,
      portrait: role.portrait,
      playableSolo: game.modes.solo,
      playableMultiplayer: game.modes.multiplayer,
      canBeAiControlled: role.canBeAiControlled
    }))
  };
}

/** Public projection of the canonical registry used by both the lobby and world detail template. */
@Controller("v4/worlds")
export class WorldsController {
  @Get()
  list() {
    return { worlds: listGameDefinitions().filter((game) => game.status !== "hidden").map(runtimeWorld) };
  }

  @Get(":worldId")
  detail(@Param("worldId") worldId: string) {
    const game = findGameDefinition(worldId);
    if (!game || game.status === "hidden") throw new NotFoundException({ code: "WORLD_NOT_FOUND", message: "World not found" });
    return worldDetail(game);
  }
}
