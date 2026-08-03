import assert from "node:assert/strict";
import test from "node:test";
import { continuousStoryV2Serializable, isRetryableSerializableError } from "./serializable-retry";

test("the authoritative Serializable boundary retries the whole operation after two P2034 conflicts", async () => {
  let attempts = 0;
  const host = {
    $transaction: async (operation: (tx: any) => Promise<unknown>) => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("Transaction failed due to a write conflict"), { code: "P2034" });
      return operation({ marker: "tx" });
    }
  };
  const result = await continuousStoryV2Serializable(host as any, async (tx: any) => tx.marker, { retryDelayMs: () => 0 });
  assert.equal(result, "tx");
  assert.equal(attempts, 3);
});

test("non-transaction errors fail immediately and message-only PostgreSQL conflicts remain retryable", async () => {
  let attempts = 0;
  const host = { $transaction: async () => { attempts += 1; throw new Error("IDENTITY_CONFLICT"); } };
  await assert.rejects(() => continuousStoryV2Serializable(host as any, async () => undefined, { retryDelayMs: () => 0 }), /IDENTITY_CONFLICT/);
  assert.equal(attempts, 1);
  assert.equal(isRetryableSerializableError(new Error("deadlock detected while committing")), true);
  assert.equal(isRetryableSerializableError({ code: "P2025", message: "not found" }), false);
});

test("a read-committed heartbeat retries the whole transaction after P1017", async () => {
  let attempts = 0;
  const isolationLevels: string[] = [];
  const host = {
    $transaction: async (operation: (tx: any) => Promise<unknown>, options: { isolationLevel: string }) => {
      attempts += 1;
      isolationLevels.push(options.isolationLevel);
      if (attempts === 1) {
        throw Object.assign(new Error("Server has closed the connection."), { code: "P1017" });
      }
      return operation({ marker: "heartbeat-tx" });
    }
  };

  const result = await continuousStoryV2Serializable(
    host as any,
    async (tx: any) => tx.marker,
    { attempts: 3, isolationLevel: "ReadCommitted" as any, retryDelayMs: () => 0 }
  );

  assert.equal(result, "heartbeat-tx");
  assert.equal(attempts, 2);
  assert.deepEqual(isolationLevels, ["ReadCommitted", "ReadCommitted"]);
  assert.equal(isRetryableSerializableError(new Error("Server has closed the connection.")), true);
});
