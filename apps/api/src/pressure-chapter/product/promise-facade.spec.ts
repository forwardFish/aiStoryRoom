import assert from "node:assert/strict";
import test from "node:test";
import { PressurePromiseProductAccessAdapterV1 } from "./promise-facade";
import { pressureSimplePromiseIdV1 } from "../a-emotion-promise";

test("Promise Product access derives all authority fences from server ports", async () => {
  const promiseId = pressureSimplePromiseIdV1({
    runId: "run-1",
    issuerSeatId: "zhejiang_administration",
  });
  const adapter = new PressurePromiseProductAccessAdapterV1({
    routes: {
      readStoredRoute: async () => ({ snapshot: {
        runId: "run-1",
        routeHash: "a".repeat(64),
        seatIds: ["zhejiang_administration", "zhejiang_governor"],
      } }),
    },
    orchestrators: {
      read: async () => ({
        phase: "ACTIVE",
        routeHash: "a".repeat(64),
        chapterRuntimeId: "runtime-1",
        currentChapterId: "N3",
        activeDecision: { decisionPointId: "decision-1" },
      }),
    },
    interactions: {
      load: async ({ subjectId }: { subjectId: string }) => {
        assert.equal(subjectId, "authenticated-user");
        return {
          routeHash: "a".repeat(64),
          chapterRuntimeId: "runtime-1",
          chapterId: "N3",
          activeDecisionPointId: "decision-1",
          workingRevision: 7,
          controlledSeatIds: ["zhejiang_administration"],
          controlEpochBySeat: { zhejiang_administration: 4 },
          interactableSeatIds: ["zhejiang_governor"],
        };
      },
    },
    working: {
      load: async () => ({
        state: { revision: 7 },
        nextDecisionPin: { decisionPointId: "decision-1" },
        acceptedActions: new Map([["action-1", { action: {
          seatId: "zhejiang_administration",
          decisionPointId: "decision-1",
          actionOrdinal: 2,
        } }]]),
        commitmentActionsByIdempotencyKey: new Map([["promise-operation:key", {
          action: {
            actionId: "operation-action",
            seatId: "zhejiang_administration",
            decisionPointId: "decision-1",
            actionOrdinal: 3,
          },
        }]]),
        commitments: new Map([[promiseId, {
          commitmentId: promiseId,
          operation: "BREAK",
          seatIds: ["zhejiang_administration", "zhejiang_governor"],
          sourceActionId: "operation-action",
        }]]),
      }),
    },
    bindings: {
      formalPromise: {
        promiseCodes: ["DELIVER_ORIGINAL_LEDGER"],
        deliverOriginalLedgerOperations: [
          { operationCode: "PROMISE_DELIVER_ORIGINAL_FULFILL", commitmentOperation: "FULFILL" },
        ],
      },
    },
  } as never);

  const access = await adapter.load({ roomId: "run-1", subjectId: "authenticated-user" });
  assert.equal(access.issuerSeatId, "zhejiang_administration");
  assert.equal(access.controlEpoch, 4);
  assert.equal(access.expectedWorkingRevision, 7);
  assert.equal(access.nextActionOrdinal, 4);
  assert.equal(access.decisionPointId, "decision-1");
  assert.deepEqual(access.allowedPromiseCodes, ["DELIVER_ORIGINAL_LEDGER"]);
  assert.deepEqual(access.allowedPromiseOperationCodes, ["PROMISE_DELIVER_ORIGINAL_FULFILL"]);
  assert.equal(access.currentPromiseOperation, "BREAK");
  assert.equal(
    access.priorCommitmentActionsByIdempotencyKey?.get("promise-operation:key")?.actionId,
    "operation-action",
  );
  assert.equal("provider" in access, false);
});
