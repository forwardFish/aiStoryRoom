import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type { WorldRegistryEntry, WorldRegistryIndex, WorldRuntimeContract } from "./types";
import { validateWorldRuntimeContract } from "./validation";

const KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RELATIVE_PATH = /^(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?![\\/])(?!.*[\\/]$).+$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function runtimeContractSha256(contract: WorldRuntimeContract): string {
  return createHash("sha256").update(canonical(contract)).digest("hex");
}
function entry(input: unknown, index: number): WorldRegistryEntry {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`WORLD_REGISTRY_ENTRY_INVALID:${index}:OBJECT`);
  const value = input as Record<string, unknown>;
  const fields = ["worldKey", "aliases", "worldId", "contractVersion", "contractSha256", "contractPath"];
  if (Object.keys(value).length !== fields.length || fields.some((field) => !(field in value)) || Object.keys(value).some((field) => !fields.includes(field))) throw new Error(`WORLD_REGISTRY_ENTRY_INVALID:${index}:FIELDS`);
  if (typeof value.worldKey !== "string" || !KEY.test(value.worldKey) || typeof value.worldId !== "string" || !KEY.test(value.worldId)) throw new Error(`WORLD_REGISTRY_ENTRY_INVALID:${index}:KEY`);
  if (typeof value.contractVersion !== "string" || !VERSION.test(value.contractVersion)) throw new Error(`WORLD_REGISTRY_ENTRY_INVALID:${index}:VERSION`);
  if (typeof value.contractSha256 !== "string" || !SHA256.test(value.contractSha256)) throw new Error(`WORLD_REGISTRY_ENTRY_INVALID:${index}:HASH`);
  if (typeof value.contractPath !== "string" || !value.contractPath.trim() || isAbsolute(value.contractPath) || !RELATIVE_PATH.test(value.contractPath)) throw new Error(`WORLD_REGISTRY_ENTRY_INVALID:${index}:PATH`);
  if (!Array.isArray(value.aliases) || value.aliases.some((alias) => typeof alias !== "string" || !KEY.test(alias)) || new Set(value.aliases).size !== value.aliases.length) throw new Error(`WORLD_REGISTRY_ENTRY_INVALID:${index}:ALIASES`);
  return value as unknown as WorldRegistryEntry;
}
export function validateWorldRegistryIndex(input: unknown): WorldRegistryIndex {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("WORLD_REGISTRY_INVALID:OBJECT");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || value.registryVersion !== 1 || !Array.isArray(value.worlds)) throw new Error("WORLD_REGISTRY_INVALID:SHAPE");
  const worlds = value.worlds.map(entry); if (worlds.length === 0) throw new Error("WORLD_REGISTRY_EMPTY"); const worldKeys = new Set<string>(); const lookupKeys = new Set<string>();
  for (const world of worlds) {
    if (worldKeys.has(world.worldKey)) throw new Error(`WORLD_REGISTRY_WORLD_KEY_COLLISION:${world.worldKey}`); worldKeys.add(world.worldKey);
    for (const key of [world.worldKey, ...world.aliases]) { if (lookupKeys.has(key)) throw new Error(`WORLD_REGISTRY_ALIAS_COLLISION:${key}`); lookupKeys.add(key); }
  }
  return { registryVersion: 1, worlds };
}
export class WorldRegistry {
  private readonly contracts = new Map<string, WorldRuntimeContract>();
  constructor(index: WorldRegistryIndex, root: string) {
    const base = resolve(root);
    for (const registryEntry of validateWorldRegistryIndex(index).worlds) {
      const path = resolve(base, registryEntry.contractPath);
      if (!path.startsWith(`${base}${sep}`)) throw new Error("WORLD_REGISTRY_PATH_INVALID");
      const contract = validateWorldRuntimeContract(JSON.parse(readFileSync(path, "utf8")));
      if (contract.worldId !== registryEntry.worldId) throw new Error("WORLD_REGISTRY_WORLD_MISMATCH");
      if (contract.contractVersion !== registryEntry.contractVersion) throw new Error("WORLD_REGISTRY_VERSION_MISMATCH");
      if (runtimeContractSha256(contract) !== registryEntry.contractSha256) throw new Error("WORLD_REGISTRY_HASH_MISMATCH");
      for (const key of [registryEntry.worldKey, ...registryEntry.aliases]) this.contracts.set(key, contract);
    }
  }
  get(worldKey: string): WorldRuntimeContract {
    const contract = this.contracts.get(worldKey); if (!contract) throw new Error(`WORLD_REGISTRY_UNKNOWN_WORLD:${worldKey}`); return structuredClone(contract);
  }
}
