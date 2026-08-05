import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoredDecisionAdapter } from "../src/decision-adapter.js";
import type { EndingModule } from "../src/ending-module.js";
import { OpenNovelRuntime } from "../src/runtime.js";
import type { OpenNovelProvider, RunMetadata } from "../src/types.js";
import { WorldModuleRegistry, type RuntimeWorldModule } from "../src/world-module-registry.js";

function moduleFixture(worldId: string, roleId: string): RuntimeWorldModule {
  return {
    worldId,
    seeder: {
      supports: (input) => input.worldId === worldId.trim() && input.roleId === roleId,
      seed: async (_paths, metadata) => ({
        openingOptions: [{ id: "begin", label: `Begin ${metadata.worldId}` }],
        prologueNarrative: `Opening for ${metadata.worldId}`,
      }),
    },
    decisionAdapter: {
      moduleIds: {
        factSettlement: `${worldId.trim()}.settlement.v1`,
        nextBeatPlanner: `${worldId.trim()}.beat.v1`,
      },
    } as AuthoredDecisionAdapter,
    endingModule: {
      moduleId: `${worldId.trim()}.ending.v1`,
      build: (input) => ({
        schemaVersion: "openovel_ending_v1",
        scope: "STORY",
        endingKey: "complete",
        title: "Complete",
        finalSceneNarrative: input.finalNarration,
        protagonistFate: "Resolved",
        aftermath: [],
        sourceTurnId: input.turnId,
        sourceRevision: input.turnNumber,
      }),
    } satisfies EndingModule,
  };
}

const provider: OpenNovelProvider = {
  describe: () => ({ provider: "test", model: "test", configured: true }),
  generate: async () => ({
    text: "",
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0 },
    latencyMs: 0,
  }),
};

test("world registry rejects invalid or duplicate module identities", () => {
  assert.throws(() => new WorldModuleRegistry([]), /WORLD_MODULE_REGISTRY_EMPTY/u);
  assert.throws(
    () => new WorldModuleRegistry([moduleFixture("Invalid World", "role-a")]),
    /WORLD_MODULE_ID_INVALID/u,
  );
  assert.throws(
    () => new WorldModuleRegistry([
      moduleFixture("world-a", "role-a"),
      moduleFixture("world-a", "role-b"),
    ]),
    /WORLD_MODULE_DUPLICATE:world-a/u,
  );
});

test("world registry dispatches two worlds without core world-specific branches", async () => {
  const registry = new WorldModuleRegistry([
    moduleFixture("world-a", "role-a"),
    moduleFixture("world-b", "role-b"),
  ]);

  assert.equal(registry.supports({ worldId: "world-a", roleId: "role-a" }), true);
  assert.equal(registry.supports({ worldId: "world-a", roleId: "role-b" }), false);
  assert.equal(registry.supports({ worldId: "world-b", roleId: "role-b" }), true);
  assert.equal(registry.supports({ worldId: "world-c", roleId: "role-c" }), false);

  const metadata = {
    worldId: "world-b",
    roleId: "role-b",
  } as RunMetadata;
  const seeded = await registry.seed({} as never, metadata, "C:/project");
  assert.equal(seeded.prologueNarrative, "Opening for world-b");
  assert.deepEqual(registry.moduleIds().map((entry) => entry.worldId), ["world-a", "world-b"]);
});

test("runtime resolves settlement, beat and ending modules by registered world", () => {
  const registry = new WorldModuleRegistry([
    moduleFixture("world-a", "role-a"),
    moduleFixture("world-b", "role-b"),
  ]);
  const runtime = new OpenNovelRuntime(
    {} as never,
    provider,
    { kick: () => {} },
    { publish: async () => {} },
    { decisionMode: "AUTHORED_WHEN_AVAILABLE", worldModules: registry },
  );

  const worldA = runtime.describeTurnModules("world-a");
  const worldB = runtime.describeTurnModules("world-b");
  assert.equal(worldA.find((item) => item.kind === "FACT_SETTLEMENT")?.moduleId, "world-a.settlement.v1");
  assert.equal(worldA.find((item) => item.kind === "NEXT_BEAT_PLANNER")?.moduleId, "world-a.beat.v1");
  assert.equal(worldA.find((item) => item.kind === "ENDING")?.moduleId, "world-a.ending.v1");
  assert.equal(worldB.find((item) => item.kind === "FACT_SETTLEMENT")?.moduleId, "world-b.settlement.v1");
  assert.equal(worldB.find((item) => item.kind === "NEXT_BEAT_PLANNER")?.moduleId, "world-b.beat.v1");
  assert.equal(worldB.find((item) => item.kind === "ENDING")?.moduleId, "world-b.ending.v1");
});
