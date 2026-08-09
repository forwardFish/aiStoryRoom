import assert from "node:assert/strict";
import test from "node:test";
import { IntegritySoloEndingResultService } from "./integrity-solo-ending-result.service";
import { canonicalOpenNovelHash, stableCanonicalJson } from "./openovel-result-integrity";
import { creditRequestHash } from "../credits/credit-policy";
import {
  committedResult,
  createHarness,
  publicRuntime,
  responseCode,
  stageBEnding,
  user,
} from "./openovel-stage-b-test-fixture";
import {
  openNovelActionIdempotencyKey,
  openNovelPlayerActionId,
  openNovelRevisionNodeId,
  openNovelRevisionNodeIndex,
} from "./reconciled-openovel-adapter.service";

test("Result racing T20 commit is either RESULT_NOT_READY or the immutable final presentation with stable hashes", async () => {
  const h = createHarness();
  const input = {
    action: "完成最后提交。",
    idempotencyKey: "result-race-stage-b-001",
    expectedStateRevision: 19,
    boundOption: { id: "T20_A", label: "完成最后提交。" },
  };
  const actionKey = openNovelActionIdempotencyKey(h.runId, user.id, input.idempotencyKey);
  const actionId = openNovelPlayerActionId(actionKey);
  const runtimeResult = committedResult(h.runId, actionId);
  const raw = {
    room: { id: h.runId, worldId: "sangtian" },
    ending: stageBEnding(),
    completedNodes: 20,
  };

  // Runtime becomes authoritative first while the DB mirror is still absent.
  h.committed.set(actionId, runtimeResult);
  Object.assign(h.runtimeState(), publicRuntime(h.runId, 20, "COMPLETED"));
  const resultService = new IntegritySoloEndingResultService(h.prisma, h.runtime);
  await assert.rejects(
    resultService.present(user as any, h.runId, raw),
    (error: any) => responseCode(error) === "RESULT_NOT_READY",
  );

  // A same-key retry claims/replays and finishes the mirror without another Head.
  // Seed the exact revision claim as it would exist after a lost API process.
  const nodeId = openNovelRevisionNodeId(h.runId, 20);
  h.nodes.set(nodeId, {
    id: nodeId,
    runId: h.runId,
    chapterIndex: 1,
    nodeIndex: openNovelRevisionNodeIndex(20),
    status: "resolving",
  });
  h.actions.set(actionId, {
    id: actionId,
    runId: h.runId,
    nodeId,
    chapterIndex: 1,
    userId: user.id,
    roleId: h.role.id,
    actorKind: "HUMAN",
    actionSlot: "MAIN",
    status: "generating",
    method: input.action,
    freeText: null,
    idempotencyKey: actionKey,
    requestHash: creditRequestHash({ runId: h.runId, action: input.action, boundOption: input.boundOption }),
    immediateJson: {
      boundOption: input.boundOption,
      expectedStateRevision: 19,
      requestedTurnId: "T20",
      chargeAttempt: 1,
    },
    createdAt: new Date("2026-08-09T11:00:00.000Z"),
    resolvedAt: null,
    resolvedJson: null,
  });
  h.run.status = "playing";
  const recovered = await h.service().submitAction(user, h.runId, input, () => undefined);
  assert.equal(recovered.turnId, "T20");
  assert.equal(h.run.status, "chapter_generated");

  const first = await resultService.present(user as any, h.runId, raw) as any;
  const restartedResultService = new IntegritySoloEndingResultService(h.prisma, h.runtime);
  const second = await restartedResultService.present(user as any, h.runId, raw) as any;
  assert.equal(first.integrity.schemaVersion, "openovel_result_integrity_v1");
  assert.equal(first.integrity.endingHash, canonicalOpenNovelHash(first.ending));
  assert.equal(first.integrity.presentationHash, canonicalOpenNovelHash(first.presentation));
  assert.equal(first.integrity.endingInputHash, second.integrity.endingInputHash);
  assert.equal(first.integrity.endingHash, second.integrity.endingHash);
  assert.equal(first.integrity.presentationHash, second.integrity.presentationHash);
  assert.deepEqual(first, second);
});

test("result integrity canonicalization is independent of object insertion order and ignores undefined fields", () => {
  assert.equal(
    stableCanonicalJson({ b: 2, omitted: undefined, a: { y: 2, x: 1 } }),
    stableCanonicalJson({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.equal(
    canonicalOpenNovelHash({ ending: stageBEnding(), completedNodes: 20 }),
    canonicalOpenNovelHash({ completedNodes: 20, ending: stageBEnding() }),
  );
});
