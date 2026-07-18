import type { GameDefinition, GameRegistryIndex } from "./types";

type JsonRecord = Record<string, unknown>;

function fail(message: string): never { throw new Error(`GAME_DEFINITION_INVALID: ${message}`); }
function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as JsonRecord;
}
function exactKeys(value: JsonRecord, label: string, keys: readonly string[]) {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) fail(`${label} has unknown property ${key}`);
  for (const key of keys) if (!(key in value)) fail(`${label} is missing ${key}`);
}
function requiredAndOptionalKeys(value: JsonRecord, label: string, required: readonly string[], optional: readonly string[]) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown property ${key}`);
  for (const key of required) if (!(key in value)) fail(`${label} is missing ${key}`);
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  return value;
}
function textArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((item, index) => text(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicates`);
  return result;
}
function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value as number;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}
function safeRelativePath(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  const result = text(value, label).replace(/\\/g, "/");
  if (result.startsWith("/") || result.includes("../") || /^[a-z]+:/i.test(result)) fail(`${label} must stay inside the game config root`);
  return result;
}
function publicAssetPath(value: unknown, label: string): string {
  const result = text(value, label);
  if (!result.startsWith("/assets/")) fail(`${label} must use an /assets/ URL`);
  return result;
}

export function validateGameRegistryIndex(value: unknown): GameRegistryIndex {
  const root = record(value, "game-registry.json");
  exactKeys(root, "game-registry.json", ["schemaVersion", "games"]);
  if (root.schemaVersion !== "game_registry_v1") fail("registry schemaVersion is invalid");
  if (!Array.isArray(root.games) || !root.games.length) fail("registry games must not be empty");
  const worldIds: string[] = [];
  const paths: string[] = [];
  root.games.forEach((value, index) => {
    const entry = record(value, `games[${index}]`);
    exactKeys(entry, `games[${index}]`, ["worldId", "definitionPath"]);
    worldIds.push(text(entry.worldId, `games[${index}].worldId`));
    paths.push(safeRelativePath(entry.definitionPath, `games[${index}].definitionPath`) as string);
  });
  if (new Set(worldIds).size !== worldIds.length) fail("registry worldId values must be unique");
  if (new Set(paths).size !== paths.length) fail("registry definitionPath values must be unique");
  return root as GameRegistryIndex;
}

export function validateGameDefinition(value: unknown): GameDefinition {
  const root = record(value, "game.json");
  exactKeys(root, "game.json", ["schemaVersion", "worldId", "publicId", "aliases", "templateId", "status", "catalog", "modes", "engine", "worldActor", "presentation", "roles"]);
  if (root.schemaVersion !== "game_definition_v1") fail("game schemaVersion is invalid");
  const worldId = text(root.worldId, "worldId");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(worldId)) fail("worldId must be a stable lowercase key");
  const publicId = text(root.publicId, "publicId");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(publicId)) fail("publicId must be a stable lowercase key");
  const aliases = textArray(root.aliases, "aliases");
  if (aliases.some((alias) => !/^[a-z0-9][a-z0-9_-]*$/.test(alias))) fail("aliases must use stable lowercase keys");
  if (aliases.some((alias) => alias === worldId || alias === publicId)) fail("aliases must not repeat worldId or publicId");
  text(root.templateId, "templateId");
  if (!["coming_soon", "playable", "hidden"].includes(String(root.status))) fail("status is invalid");

  const catalog = record(root.catalog, "catalog");
  requiredAndOptionalKeys(catalog, "catalog", ["title", "subtitle", "description", "genre", "tags", "durationLabel", "cardCover", "heroCover"], ["lobby"]);
  for (const key of ["title", "subtitle", "description", "genre", "durationLabel"] as const) text(catalog[key], `catalog.${key}`);
  textArray(catalog.tags, "catalog.tags");
  publicAssetPath(catalog.cardCover, "catalog.cardCover");
  publicAssetPath(catalog.heroCover, "catalog.heroCover");
  if (catalog.lobby !== undefined) {
    const lobby = record(catalog.lobby, "catalog.lobby");
    exactKeys(lobby, "catalog.lobby", ["title", "description", "categoryLabel"]);
    for (const key of ["title", "description", "categoryLabel"] as const) text(lobby[key], `catalog.lobby.${key}`);
  }

  const modes = record(root.modes, "modes");
  exactKeys(modes, "modes", ["solo", "multiplayer", "minHumanPlayers", "maxHumanPlayers"]);
  boolean(modes.solo, "modes.solo");
  boolean(modes.multiplayer, "modes.multiplayer");
  const minHumanPlayers = integer(modes.minHumanPlayers, "modes.minHumanPlayers");
  const maxHumanPlayers = integer(modes.maxHumanPlayers, "modes.maxHumanPlayers");
  if (minHumanPlayers < 1 || maxHumanPlayers < minHumanPlayers) fail("human player limits are invalid");

  const engine = record(root.engine, "engine");
  exactKeys(engine, "engine", ["engineVersion", "strategyVersion", "strategyRegistryPath", "fixedRules"]);
  const engineVersion = text(engine.engineVersion, "engine.engineVersion");
  text(engine.strategyVersion, "engine.strategyVersion");
  safeRelativePath(engine.strategyRegistryPath, "engine.strategyRegistryPath", true);
  if (engine.fixedRules !== null) {
    const rules = record(engine.fixedRules, "engine.fixedRules");
    exactKeys(rules, "engine.fixedRules", ["stageCount", "mainCardsPerRoleStage"]);
    if (rules.stageCount !== 7 || rules.mainCardsPerRoleStage !== 3) fail("continuous v1 rules must remain 7 stages and 3 MAIN cards per role-stage");
  }
  if (engineVersion.startsWith("continuous_strategy_") && engine.fixedRules === null) fail("continuous strategy games require fixedRules");

  if (root.worldActor !== null) {
    const worldActor = record(root.worldActor, "worldActor");
    exactKeys(worldActor, "worldActor", ["actorKey", "actorName", "description", "portrait"]);
    for (const key of ["actorKey", "actorName", "description"] as const) text(worldActor[key], `worldActor.${key}`);
    publicAssetPath(worldActor.portrait, "worldActor.portrait");
  }

  const presentation = record(root.presentation, "presentation");
  exactKeys(presentation, "presentation", ["locationLabel", "roundLabel", "finaleLabel", "sceneBackground", "assetManifest", "accent", "accentSoft"]);
  for (const key of ["locationLabel", "roundLabel", "finaleLabel", "accent", "accentSoft"] as const) text(presentation[key], `presentation.${key}`);
  publicAssetPath(presentation.sceneBackground, "presentation.sceneBackground");
  if (presentation.assetManifest !== null) publicAssetPath(presentation.assetManifest, "presentation.assetManifest");

  if (!Array.isArray(root.roles)) fail("roles must be an array");
  if (root.status === "playable" && !root.roles.length) fail("playable games must configure at least one role");
  const roleKeys: string[] = [];
  root.roles.forEach((value, index) => {
    const role = record(value, `roles[${index}]`);
    exactKeys(role, `roles[${index}]`, ["roleKey", "roleName", "identity", "publicInfo", "hiddenSecret", "personalGoal", "currentState", "abilityText", "arcText", "knownInfo", "cannotDo", "portrait", "canBeHumanControlled", "canBeAiControlled"]);
    for (const key of ["roleKey", "roleName", "identity", "publicInfo", "hiddenSecret", "personalGoal", "currentState", "abilityText", "arcText"] as const) text(role[key], `roles[${index}].${key}`);
    roleKeys.push(String(role.roleKey));
    textArray(role.knownInfo, `roles[${index}].knownInfo`);
    textArray(role.cannotDo, `roles[${index}].cannotDo`);
    publicAssetPath(role.portrait, `roles[${index}].portrait`);
    if (boolean(role.canBeHumanControlled, `roles[${index}].canBeHumanControlled`) !== true) fail(`roles[${index}] must support human control`);
    if (boolean(role.canBeAiControlled, `roles[${index}].canBeAiControlled`) !== true) fail(`roles[${index}] must support AI Agent control`);
  });
  if (new Set(roleKeys).size !== roleKeys.length) fail("roleKey values must be unique");
  if (root.status === "playable" && maxHumanPlayers > root.roles.length) fail("maxHumanPlayers cannot exceed the configured role count");
  if (root.worldActor && roleKeys.includes(String((root.worldActor as JsonRecord).actorKey))) fail("worldActor must not duplicate a player roleKey");
  if (engineVersion.startsWith("continuous_strategy_") && (!engine.strategyRegistryPath || !root.worldActor)) fail("continuous strategy games require a strategy registry and a separate worldActor");
  return root as GameDefinition;
}
