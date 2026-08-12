import assert from "node:assert/strict";
import test from "node:test";
import { RoomsController } from "./rooms.controller";

test("Promise HTTP delegates authenticated subject and the minimal preset body", async () => {
  const calls: unknown[] = [];
  const controller = new RoomsController({
    createPressurePromise: async (...args: unknown[]) => {
      calls.push(["create", ...args]);
      return { submitStatus: "ACCEPTED" };
    },
    applyPressurePromiseOperation: async (...args: unknown[]) => {
      calls.push(["apply", ...args]);
      return { submitStatus: "ACCEPTED" };
    },
  } as never);
  const user = { id: "authenticated-user" } as never;
  const createBody = {
    targetRoleId: "zhejiang_governor" as const,
    promiseCode: "DELIVER_ORIGINAL_LEDGER" as const,
    visibility: "PRIVATE" as const,
    clientRequestId: "request-create-1",
  };
  const operationBody = {
    operationCode: "PROMISE_DELIVER_ORIGINAL_FULFILL" as const,
    clientRequestId: "request-operation-1",
  };

  await controller.createPressurePromise(user, "run-1", createBody);
  await controller.applyPressurePromiseOperation(user, "run-1", "promise-1", operationBody);

  assert.deepEqual(calls, [
    ["create", user, "run-1", createBody],
    ["apply", user, "run-1", "promise-1", operationBody],
  ]);
  assert.equal("subjectId" in createBody, false);
  assert.equal("issuerSeatId" in createBody, false);
  assert.equal("controlEpoch" in createBody, false);
});
