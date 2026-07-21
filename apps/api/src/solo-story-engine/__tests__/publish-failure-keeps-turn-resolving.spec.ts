import assert from "node:assert/strict";
import { SoloStoryEngineService } from "../solo-story-engine.service";

void (async () => {
  const calls: Array<{ model: string; args: unknown }> = [];
  const prisma = {
    soloGenerationAttempt: {
      findUnique: async () => ({ runId: "run-1", status: "SUCCEEDED" }),
      updateMany: (args: unknown) => {
        calls.push({ model: "soloGenerationAttempt", args });
        return Promise.resolve({ count: 1 });
      }
    },
    storyRun: {
      update: (args: unknown) => {
        calls.push({ model: "storyRun", args });
        return Promise.resolve({ id: "run-1" });
      }
    },
    actorTurn: {
      updateMany: (args: unknown) => {
        calls.push({ model: "actorTurn", args });
        return Promise.resolve({ count: 1 });
      }
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations)
  };
  const service = new SoloStoryEngineService(prisma as never, {} as never);

  await (service as any).markPublishFailure("attempt-1", new Error("temporary database failure"), "turn-1");

  const runUpdate = calls.find((call) => call.model === "storyRun")?.args as any;
  assert.equal(runUpdate.data.status, "resolving");
  assert.equal(calls.some((call) => call.model === "actorTurn"), false, "a durable model result must not reopen the reserved turn");
  console.log("solo publish failure keeps turn resolving: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
