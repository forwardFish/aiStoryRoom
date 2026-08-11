import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { B0WindowCoordinatorService } from "./b0-window-coordinator.prisma";

type TransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};

type CoordinatorInternals = {
  projectionTransaction<T>(operation: (tx: any) => Promise<T>): Promise<T>;
  serializable<T>(operation: (tx: any) => Promise<T>): Promise<T>;
};

function internals(service: B0WindowCoordinatorService): CoordinatorInternals {
  return service as unknown as CoordinatorInternals;
}

function admissionTimeout(): Error & { code: string } {
  return Object.assign(
    new Error("Transaction API error: Unable to start a transaction in the given time."),
    { code: "P2028" },
  );
}

test("projection delegates to the bounded read transaction wrapper", async () => {
  const service = new B0WindowCoordinatorService({} as never);
  const expected = { schemaVersion: "b0-window-projection-v1" } as never;
  let wrapperCalls = 0;
  (service as any).projectionTransaction = async () => {
    wrapperCalls += 1;
    return expected;
  };

  assert.equal(await service.projection("window.remote.pool", "actor.a"), expected);
  assert.equal(wrapperCalls, 1);
});

test("projection read transactions use remote-pool options and retry only admission failures", async () => {
  let transactionAttempts = 0;
  let operationCalls = 0;
  const observedOptions: TransactionOptions[] = [];
  const service = new B0WindowCoordinatorService({
    $transaction: async (operation: (tx: any) => Promise<string>, options: TransactionOptions) => {
      transactionAttempts += 1;
      observedOptions.push(options);
      if (transactionAttempts < 3) throw admissionTimeout();
      operationCalls += 1;
      return operation({});
    },
  } as never);

  const result = await internals(service).projectionTransaction(async () => "projection-ready");
  assert.equal(result, "projection-ready");
  assert.equal(transactionAttempts, 3, "read-only projection may retry bounded pool-admission failures");
  assert.equal(operationCalls, 1, "failed admission attempts must not enter the transaction callback");
  assert.deepEqual(observedOptions, Array.from({ length: 3 }, () => ({
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 30_000,
  })));

  let nonAdmissionAttempts = 0;
  const nonAdmissionService = new B0WindowCoordinatorService({
    $transaction: async () => {
      nonAdmissionAttempts += 1;
      throw Object.assign(new Error("Transaction API error: Transaction already closed."), { code: "P2028" });
    },
  } as never);
  await assert.rejects(
    () => internals(nonAdmissionService).projectionTransaction(async () => "unreachable"),
    /Transaction already closed/,
  );
  assert.equal(nonAdmissionAttempts, 1, "unrelated P2028 failures must fail closed without retries");
});

test("write transactions do not retry P2028 after their callback may have run", async () => {
  let transactionAttempts = 0;
  let callbackCalls = 0;
  let observedOptions: TransactionOptions | undefined;
  const service = new B0WindowCoordinatorService({
    $transaction: async (operation: (tx: any) => Promise<unknown>, options: TransactionOptions) => {
      transactionAttempts += 1;
      observedOptions = options;
      await operation({});
      throw admissionTimeout();
    },
  } as never);

  await assert.rejects(
    () => internals(service).serializable(async () => {
      callbackCalls += 1;
      return "write-result";
    }),
    /Unable to start a transaction/,
  );
  assert.equal(transactionAttempts, 1, "ambiguous write-transaction failures must not be retried");
  assert.equal(callbackCalls, 1, "the write callback must not be invoked twice");
  assert.deepEqual(observedOptions, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 30_000,
  });
});
