import type { AuthoredDecisionAdapter } from "./decision-adapter.js";
import type { EndingModule } from "./ending-module.js";
import type { WorkspacePaths } from "./paths.js";
import type { OpenNovelOption, RunMetadata } from "./types.js";
import type { WorkspaceRunSeeder } from "./workspace-seeder.js";
import type { PlayerActionIntent, SettlementPackage, WorldRuntimeContract } from "@ai-story/templates";

export type SharedActionDefinition = {
  readonly id: string;
  readonly label: string;
  readonly roleKeys: readonly string[];
  readonly intentType: PlayerActionIntent["intentType"];
  readonly referencedEntityIds: readonly string[];
  readonly proposedCapabilityId: string;
  readonly explicitCommitment?: boolean;
  readonly explicitOrder?: boolean;
};

export interface RuntimeWorldModule {
  readonly worldId: string;
  readonly seeder: WorkspaceRunSeeder;
  readonly decisionAdapter?: AuthoredDecisionAdapter;
  readonly endingModule?: EndingModule;
  readonly runtimeContract?: WorldRuntimeContract;
  readonly settlementPackage?: SettlementPackage;
  readonly actorByRoleKey?: Readonly<Record<string, string>>;
  readonly sharedActions?: readonly SharedActionDefinition[];
}

/**
 * Composition-root registry for world-specific assets and adapters.
 *
 * The turn pipeline consumes only the generic module contracts. Adding a new
 * world registers another module here; it never adds a worldId branch to the
 * runtime, settlement, projection, review, or Canon code.
 */
export class WorldModuleRegistry implements WorkspaceRunSeeder {
  private readonly modules: ReadonlyMap<string, RuntimeWorldModule>;

  constructor(entries: readonly RuntimeWorldModule[]) {
    if (!entries.length) throw new Error("WORLD_MODULE_REGISTRY_EMPTY");
    const modules = new Map<string, RuntimeWorldModule>();
    for (const entry of entries) {
      const worldId = normalizeWorldId(entry.worldId);
      if (modules.has(worldId)) throw new Error(`WORLD_MODULE_DUPLICATE:${worldId}`);
      modules.set(worldId, { ...entry, worldId });
    }
    this.modules = modules;
  }

  resolve(worldId: string): RuntimeWorldModule | undefined {
    return this.modules.get(normalizeWorldId(worldId));
  }

  require(worldId: string): RuntimeWorldModule {
    const module = this.resolve(worldId);
    if (!module) throw new Error(`WORLD_MODULE_NOT_REGISTERED:${worldId}`);
    return module;
  }

  supports(input: { worldId: string; roleId: string }): boolean {
    const module = this.resolve(input.worldId);
    return Boolean(module?.seeder.supports(input));
  }

  seed(
    paths: WorkspacePaths,
    metadata: RunMetadata,
    projectRoot: string,
  ): Promise<{ openingOptions: OpenNovelOption[]; prologueNarrative?: string }> {
    return this.require(metadata.worldId).seeder.seed(paths, metadata, projectRoot);
  }

  moduleIds() {
    return [...this.modules.values()].map((entry) => ({
      worldId: entry.worldId,
      factSettlement: entry.decisionAdapter?.moduleIds?.factSettlement || null,
      nextBeatPlanner: entry.decisionAdapter?.moduleIds?.nextBeatPlanner || null,
      ending: entry.endingModule?.moduleId || null,
    }));
  }

  requireSharedWorld(worldId: string) {
    const module = this.require(worldId);
    if (!module.runtimeContract || !module.settlementPackage) {
      throw new Error(`WORLD_MODULE_SHARED_RUNTIME_MISSING:${module.worldId}`);
    }
    return {
      module,
      contract: module.runtimeContract,
      settlementPackage: module.settlementPackage,
    };
  }

  actorForRole(worldId: string, roleKey: string) {
    const { module, contract } = this.requireSharedWorld(worldId);
    const actorId = module.actorByRoleKey?.[String(roleKey || "").trim()];
    if (!actorId || !contract.roles.some((role) => role.actorId === actorId)) {
      throw new Error(`WORLD_ROLE_NOT_REGISTERED:${worldId}:${roleKey}`);
    }
    return actorId;
  }

  sharedActionsForRole(worldId: string, roleKey: string) {
    const { module } = this.requireSharedWorld(worldId);
    this.actorForRole(worldId, roleKey);
    return (module.sharedActions || [])
      .filter((action) => action.roleKeys.includes(roleKey))
      .map((action) => ({ id: action.id, label: action.label }));
  }

  sharedAction(worldId: string, roleKey: string, actionId?: string) {
    const { module, contract } = this.requireSharedWorld(worldId);
    const actorId = this.actorForRole(worldId, roleKey);
    const candidates = (module.sharedActions || []).filter((action) => action.roleKeys.includes(roleKey));
    const action = actionId
      ? candidates.find((candidate) => candidate.id === actionId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!action) throw new Error(`WORLD_ACTION_NOT_REGISTERED:${worldId}:${roleKey}:${actionId || "default"}`);
    const policy = contract.actorPolicies.find((candidate) => candidate.actorId === actorId);
    if (!policy?.capabilityIds.includes(action.proposedCapabilityId)) {
      throw new Error(`WORLD_ACTION_CAPABILITY_DENIED:${action.id}`);
    }
    for (const entityId of action.referencedEntityIds) {
      if (!contract.entities.some((entity) => entity.id === entityId)) {
        throw new Error(`WORLD_ACTION_ENTITY_MISSING:${action.id}:${entityId}`);
      }
    }
    return action;
  }
}

function normalizeWorldId(value: string) {
  const worldId = String(value || "").trim();
  if (!/^[a-z][a-z0-9_-]{1,63}$/u.test(worldId)) {
    throw new Error("WORLD_MODULE_ID_INVALID");
  }
  return worldId;
}
