import { readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type { GameDefinition, LoadedGameRegistry } from "./types";
import { validateGameDefinition, validateGameRegistryIndex } from "./validation";

export const defaultGameConfigRoot = resolve(__dirname, "../../config");
const registryCache = new Map<string, LoadedGameRegistry>();

function parseJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`GAME_CONFIG_JSON_INVALID:${path}:${error instanceof Error ? error.message : String(error)}`); }
}

export function resolveGameConfigPath(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error(`GAME_CONFIG_PATH_INVALID:${relativePath}`);
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) throw new Error(`GAME_CONFIG_PATH_INVALID:${relativePath}`);
  return absolutePath;
}

export function loadGameRegistry(configRoot = defaultGameConfigRoot): LoadedGameRegistry {
  const cacheKey = resolve(configRoot);
  const cached = registryCache.get(cacheKey);
  if (cached) return cached;
  const index = validateGameRegistryIndex(parseJson(resolveGameConfigPath(cacheKey, "game-registry.json")));
  const games = index.games.map((entry) => {
    const game = validateGameDefinition(parseJson(resolveGameConfigPath(cacheKey, entry.definitionPath)));
    if (game.worldId !== entry.worldId) throw new Error(`GAME_REGISTRY_WORLD_ID_MISMATCH:${entry.worldId}:${game.worldId}`);
    return game;
  });
  const byWorldId = new Map<string, GameDefinition>();
  const byTemplateId = new Map<string, GameDefinition>();
  for (const game of games) {
    for (const key of new Set([game.worldId, game.publicId, ...game.aliases])) {
      if (byWorldId.has(key)) throw new Error(`GAME_REGISTRY_ALIAS_COLLISION:${key}`);
      byWorldId.set(key, game);
    }
    if (byTemplateId.has(game.templateId)) throw new Error(`GAME_REGISTRY_TEMPLATE_ID_COLLISION:${game.templateId}`);
    byTemplateId.set(game.templateId, game);
  }
  const loaded = { index, games, byWorldId, byTemplateId };
  registryCache.set(cacheKey, loaded);
  return loaded;
}

export function clearGameRegistryCache() { registryCache.clear(); }

export function listGameDefinitions(configRoot = defaultGameConfigRoot): GameDefinition[] {
  return loadGameRegistry(configRoot).games;
}

export function findGameDefinition(worldId: string, configRoot = defaultGameConfigRoot): GameDefinition | undefined {
  return loadGameRegistry(configRoot).byWorldId.get(worldId);
}

export function findGameDefinitionByTemplateId(templateId: string, configRoot = defaultGameConfigRoot): GameDefinition | undefined {
  return loadGameRegistry(configRoot).byTemplateId.get(templateId);
}

export function getGameDefinition(worldId: string, configRoot = defaultGameConfigRoot): GameDefinition {
  const game = findGameDefinition(worldId, configRoot);
  if (!game) throw new Error(`GAME_NOT_REGISTERED:${worldId}`);
  return game;
}
