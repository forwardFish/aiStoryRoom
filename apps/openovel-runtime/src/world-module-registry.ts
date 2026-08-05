import type { AuthoredDecisionAdapter } from "./decision-adapter.js";
import type { EndingModule } from "./ending-module.js";
import type { WorkspacePaths } from "./paths.js";
import type { OpenNovelOption, RunMetadata } from "./types.js";
import type { WorkspaceRunSeeder } from "./workspace-seeder.js";
import type { SettlementPackage, WorldRuntimeContract } from "@ai-story/templates";

export interface RuntimeWorldModule {
  readonly worldId: string;
  readonly seeder: WorkspaceRunSeeder;
  readonly decisionAdapter?: AuthoredDecisionAdapter;
  readonly endingModule?: EndingModule;
  readonly runtimeContract?: WorldRuntimeContract;
  readonly settlementPackage?: SettlementPackage;
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
}

function normalizeWorldId(value: string) {
  const worldId = String(value || "").trim();
  if (!/^[a-z][a-z0-9_-]{1,63}$/u.test(worldId)) {
    throw new Error("WORLD_MODULE_ID_INVALID");
  }
  return worldId;
}
