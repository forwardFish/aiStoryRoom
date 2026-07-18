import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { StoryService } from "./story.service";

test("run creation removes a partial StoryRun when dependent assets fail", async () => {
  const deletedRunIds: string[] = [];
  const failure = new Error("injected asset failure");
  const prisma = {
    worldTemplate: { upsert: async () => ({}) },
    storyRun: {
      create: async ({ data }: { data: { id?: string } }) => ({ id: data.id || "generated-run" }),
      deleteMany: async ({ where }: { where: { id: string } }) => {
        deletedRunIds.push(where.id);
        return { count: 1 };
      }
    }
  };
  const service = new StoryService(prisma as never);
  const internal = service as any;
  internal.ensureUser = async () => ({ id: "owner-1" });
  internal.nextInviteCode = async () => "ROLLBACK";
  internal.createInitialRunAssets = async () => { throw failure; };

  const world = getGameDefinition("sangtian");
  await assert.rejects(
    () => service.createRun(
      "owner-openid",
      { templateId: world.templateId, mode: "room", maxPlayers: 3, aiPlayerCount: 0, ownerAsPlayer: true },
      { engineVersion: world.engine.engineVersion, strategyVersion: world.engine.strategyVersion, runId: "room_deterministic" }
    ),
    (error) => error === failure
  );

  assert.deepEqual(deletedRunIds, ["room_deterministic"]);
});
