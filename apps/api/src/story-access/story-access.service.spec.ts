import assert from "node:assert/strict";
import { CONTINUOUS_ENGINE_VERSION } from "@ai-story/shared";
import { StoryAccessService } from "./story-access.service";

async function main() {
  let transactionAttempts = 0;
  let spendCalls = 0;
  let resumeCalls = 0;

  const tx = {
    storyRun: {
      findUnique: async () => ({
        id: "run-concurrent-unlock",
        ownerUserId: "user-1",
        templateKey: "sangtian",
        engineVersion: CONTINUOUS_ENGINE_VERSION
      }),
      update: async () => ({ id: "run-concurrent-unlock" })
    },
    storyPlayer: { findFirst: async () => null },
    worldUnlock: {
      findUnique: async () => null,
      create: async () => ({ paidByUserId: "user-1" })
    }
  };
  const prisma = {
    $transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => {
      transactionAttempts += 1;
      if (transactionAttempts < 3) throw Object.assign(new Error("Transaction failed due to a write conflict"), { code: "P2034" });
      return operation(tx);
    }
  };
  const credits = {
    spendCredits: async () => {
      spendCalls += 1;
      return { id: "ledger-1" };
    }
  };
  const actionWindows = {
    resumeAfterUnlock: async () => {
      resumeCalls += 1;
    }
  };
  const projections = {
    game: async () => ({ access: { state: "UNLOCKED" } })
  };
  const service = new StoryAccessService(
    prisma as never,
    credits as never,
    { qualifyReferral: async () => undefined } as never,
    actionWindows as never,
    projections as never
  );

  const result = await service.unlock(
    { id: "user-1", openid: "openid-1" } as never,
    "run-concurrent-unlock",
    { idempotencyKey: "concurrent-unlock-test" }
  );
  assert.equal(transactionAttempts, 3, "the whole Serializable transaction must retry after P2034");
  assert.equal(spendCalls, 1, "rolled-back attempts must not double-spend credits");
  assert.equal(resumeCalls, 1, "the action window resumes exactly once after the committed unlock");
  assert.equal(result.creditsCharged, 100);
  assert.equal(result.payerUserId, "user-1");

  let permanentAttempts = 0;
  const permanentFailure = new StoryAccessService(
    {
      $transaction: async () => {
        permanentAttempts += 1;
        throw new Error("permanent database failure");
      }
    } as never,
    credits as never,
    { qualifyReferral: async () => undefined } as never,
    actionWindows as never,
    projections as never
  );
  await assert.rejects(
    () => permanentFailure.unlock(
      { id: "user-1", openid: "openid-1" } as never,
      "run-concurrent-unlock",
      { idempotencyKey: "permanent-failure-test" }
    ),
    /permanent database failure/
  );
  assert.equal(permanentAttempts, 1, "non-transient failures must not be retried");

  console.log("story access concurrent unlock retry: PASS");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
