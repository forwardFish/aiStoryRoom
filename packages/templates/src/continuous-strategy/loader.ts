import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { defaultGameConfigRoot, getGameDefinition } from "../game-registry";
import {
  SANGTIAN_PLAYABLE_ROLE_KEYS,
  SANGTIAN_STRATEGY_VERSION,
  SANGTIAN_SYSTEM_ROLE_KEY,
  type ContinuousStrategyPackage,
  type StrategyManifest,
  type StrategyRegistry
} from "./types";
import {
  validateAgentPolicies,
  validateContinuousStrategyPackage,
  validateEndingRules,
  validateManeuverStrategies,
  validateReactionScenarios,
  validateRoleStageContent,
  validateResultRules,
  validateStages,
  validateStrategyManifest,
  validateStrategyRegistry,
  validateSystemActions
} from "./validation";

export const defaultSangtianStrategyRoot = resolve(__dirname, "../../config/sangtian");

export type ContinuousStrategyLoadContract = {
  worldId: string;
  strategyVersion: string;
  playableRoleKeys: string[];
  worldActorKey: string;
};

export function canonicalUtf8Text(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(canonicalUtf8Text(value)).digest("hex");
}

export function assertSha256(value: string, expected: string, label: string): string {
  const actual = sha256Utf8(value);
  if (actual !== expected) throw new Error(`CONTENT_HASH_MISMATCH:${label}:expected=${expected}:actual=${actual}`);
  return actual;
}

function parseJson(bytes: string, label: string): unknown {
  try {
    return JSON.parse(bytes);
  } catch (error) {
    throw new Error(`CONTENT_JSON_INVALID:${label}:${error instanceof Error ? error.message : String(error)}`);
  }
}

function safeResolve(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error(`CONTENT_PATH_INVALID:${relativePath}`);
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) throw new Error(`CONTENT_PATH_INVALID:${relativePath}`);
  return absolutePath;
}

function readJsonFile(root: string, relativePath: string): { bytes: string; value: unknown } {
  const bytes = readFileSync(safeResolve(root, relativePath), "utf8");
  return { bytes, value: parseJson(bytes, relativePath) };
}

function assertSchemaArtifacts(files: Map<string, unknown>) {
  const requiredSchemas = [
    "schemas/manifest.schema.json",
    "schemas/stages.schema.json",
    "schemas/role-stage-content.schema.json",
    "schemas/maneuver-strategies.schema.json",
    "schemas/reaction-scenarios.schema.json",
    "schemas/system-actions.schema.json",
    "schemas/agent-policies.schema.json",
    "schemas/result-rules.schema.json",
    "schemas/ending-rules.schema.json",
    "schemas/strategy-registry.schema.json"
  ];
  for (const path of requiredSchemas) {
    const schema = files.get(path);
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`CONTENT_SCHEMA_MISSING:${path}`);
    const record = schema as Record<string, unknown>;
    if (record.$schema !== "https://json-schema.org/draft/2020-12/schema" || record.additionalProperties !== false) throw new Error(`CONTENT_SCHEMA_NOT_STRICT:${path}`);
  }
}

export function loadContinuousStrategyPackageFromRoot(
  contract: ContinuousStrategyLoadContract,
  strategyRoot: string,
  registryRelativePath = "strategy-registry.json"
): ContinuousStrategyPackage {
  const { worldId, strategyVersion, playableRoleKeys, worldActorKey } = contract;
  const registryAbsolutePath = safeResolve(strategyRoot, registryRelativePath);
  const registryRoot = dirname(registryAbsolutePath);
  const registryBytes = readFileSync(registryAbsolutePath, "utf8");
  const registryFile = { bytes: registryBytes, value: parseJson(registryBytes, registryRelativePath) };
  const registry = validateStrategyRegistry(registryFile.value) as StrategyRegistry;
  const registryEntry = registry.strategies[strategyVersion];
  if (!registryEntry) throw new Error(`STRATEGY_VERSION_NOT_REGISTERED:${strategyVersion}`);

  const artifactRoot = safeResolve(registryRoot, registryEntry.artifactDirectory);
  const manifestFile = readJsonFile(artifactRoot, "manifest.json");
  assertSha256(manifestFile.bytes, registryEntry.manifestSha256, "manifest.json");
  const manifest = validateStrategyManifest(manifestFile.value) as StrategyManifest;
  if (manifest.contentVersion !== strategyVersion) throw new Error(`STRATEGY_VERSION_MANIFEST_MISMATCH:${strategyVersion}:${manifest.contentVersion}`);
  if (manifest.templateKey !== worldId) throw new Error(`STRATEGY_WORLD_MANIFEST_MISMATCH:${worldId}:${manifest.templateKey}`);

  const artifactValues = new Map<string, unknown>();
  const artifactHashes: Record<string, string> = {};
  for (const file of manifest.files) {
    const artifact = readJsonFile(artifactRoot, file.path);
    artifactHashes[file.path] = assertSha256(artifact.bytes, file.sha256, file.path);
    artifactValues.set(file.path, artifact.value);
  }
  assertSchemaArtifacts(artifactValues);

  const required = <T>(path: string): T => {
    if (!artifactValues.has(path)) throw new Error(`CONTENT_ARTIFACT_MISSING:${path}`);
    return artifactValues.get(path) as T;
  };
  const content: ContinuousStrategyPackage = {
    contract: { worldId, strategyVersion, playableRoleKeys: [...playableRoleKeys], worldActorKey },
    registry,
    manifest,
    stages: validateStages(required("stages.json")),
    roleStageContent: validateRoleStageContent(required("role-stage-content.json")),
    systemActions: validateSystemActions(required("system-actions.json")),
    agentPolicies: validateAgentPolicies(required("agent-policies.json")),
    maneuverStrategies: validateManeuverStrategies(required("maneuver-strategies.json")),
    reactionScenarios: validateReactionScenarios(required("reaction-scenarios.json")),
    resultRules: validateResultRules(required("result-rules.json")),
    endingRules: validateEndingRules(required("ending-rules.json")),
    artifactHashes
  };
  return validateContinuousStrategyPackage(content);
}

/** Loads a continuous strategy package using the canonical game definition. */
export function loadGameContinuousStrategyPackage(
  worldId: string,
  strategyVersion?: string,
  configRoot = defaultGameConfigRoot
): ContinuousStrategyPackage {
  const game = getGameDefinition(worldId, configRoot);
  if (!game.engine.engineVersion.startsWith("continuous_strategy_")) throw new Error(`GAME_ENGINE_NOT_CONTINUOUS:${game.worldId}:${game.engine.engineVersion}`);
  if (!game.engine.strategyRegistryPath) throw new Error(`GAME_STRATEGY_REGISTRY_MISSING:${game.worldId}`);
  const resolvedVersion = strategyVersion || game.engine.strategyVersion;
  const strategyRoot = safeResolve(configRoot, game.worldId);
  const worldActorKey = game.worldActor?.actorKey;
  if (!worldActorKey) throw new Error(`GAME_WORLD_ACTOR_MISSING:${game.worldId}`);
  return loadContinuousStrategyPackageFromRoot({
    worldId: game.worldId,
    strategyVersion: resolvedVersion,
    playableRoleKeys: game.roles.map((role) => role.roleKey),
    worldActorKey
  }, strategyRoot, game.engine.strategyRegistryPath);
}

/** Backward-compatible Sangtian wrapper. Runtime multi-game code should use loadGameContinuousStrategyPackage. */
export function loadContinuousStrategyPackage(
  strategyVersion = SANGTIAN_STRATEGY_VERSION,
  strategyRoot = defaultSangtianStrategyRoot
): ContinuousStrategyPackage {
  return loadContinuousStrategyPackageFromRoot({
    worldId: "sangtian",
    strategyVersion,
    playableRoleKeys: [...SANGTIAN_PLAYABLE_ROLE_KEYS],
    worldActorKey: SANGTIAN_SYSTEM_ROLE_KEY
  }, strategyRoot);
}
