import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type { WorldRegistryIndex, WorldRuntimeContract } from "./types";
import { validateWorldRuntimeContract } from "./validation";

function canonical(value: unknown): string { if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`; if(value&&typeof value==="object")return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`; return JSON.stringify(value); }
export function runtimeContractSha256(contract: WorldRuntimeContract): string { return createHash("sha256").update(canonical(contract)).digest("hex"); }
function safe(root:string,path:string){if(isAbsolute(path))throw new Error(`WORLD_REGISTRY_PATH_INVALID:${path}`);const base=resolve(root),target=resolve(base,path);if(target!==base&&!target.startsWith(`${base}${sep}`))throw new Error(`WORLD_REGISTRY_PATH_INVALID:${path}`);return target;}

export class WorldRegistry {
  private readonly byKey=new Map<string,WorldRuntimeContract>();
  constructor(index: WorldRegistryIndex, root: string) {
    if(!index||index.registryVersion!==1||!Array.isArray(index.worlds)||Object.keys(index).some(k=>!["registryVersion","worlds"].includes(k)))throw new Error("WORLD_REGISTRY_INVALID");
    for(const entry of index.worlds){const allowed=["worldKey","aliases","worldId","contractVersion","contractSha256","contractPath"];if(Object.keys(entry).some(k=>!allowed.includes(k)))throw new Error(`WORLD_REGISTRY_UNKNOWN_FIELD:${Object.keys(entry).find(k=>!allowed.includes(k))}`);const contract=validateWorldRuntimeContract(JSON.parse(readFileSync(safe(root,entry.contractPath),"utf8")));if(contract.worldId!==entry.worldId)throw new Error(`WORLD_REGISTRY_WORLD_MISMATCH:${entry.worldKey}`);if(contract.contractVersion!==entry.contractVersion)throw new Error(`WORLD_REGISTRY_VERSION_MISMATCH:${entry.worldKey}`);if(runtimeContractSha256(contract)!==entry.contractSha256)throw new Error(`WORLD_REGISTRY_HASH_MISMATCH:${entry.worldKey}`);for(const key of [entry.worldKey,...entry.aliases,...contract.aliases]){if(this.byKey.has(key))throw new Error(`WORLD_REGISTRY_ALIAS_COLLISION:${key}`);this.byKey.set(key,contract);}}
  }
  get(worldKey:string):WorldRuntimeContract{const value=this.byKey.get(worldKey);if(!value)throw new Error(`WORLD_REGISTRY_UNKNOWN_WORLD:${worldKey}`);return value;}
}
