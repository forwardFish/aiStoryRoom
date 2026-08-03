import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenNovelActionReceipt } from "./openovel-mp-action-receipt";

test("parses a synchronously published action receipt", () => {
  assert.deepEqual(parseOpenNovelActionReceipt(200, {
    accepted: true,
    resolution: { id: "resolution-1", appliedWorldSequence: 1 }
  }), { resolutionId: "resolution-1", appliedWorldSequence: 1, deferred: false });
});

test("treats world-first recoverable 503 as a committed receipt without resubmission", () => {
  assert.deepEqual(parseOpenNovelActionReceipt(503, {
    code: "STORY_GENERATION_IN_PROGRESS",
    details: {
      code: "STORY_GENERATION_IN_PROGRESS",
      recoverable: true,
      resolutionId: "resolution-2",
      appliedWorldSequence: 2
    }
  }), { resolutionId: "resolution-2", appliedWorldSequence: 2, deferred: true });
});

test("rejects a recoverable-looking response without a durable receipt", () => {
  assert.throws(() => parseOpenNovelActionReceipt(503, {
    code: "STORY_GENERATION_IN_PROGRESS",
    details: { code: "STORY_GENERATION_IN_PROGRESS", recoverable: true }
  }), /ACTION_RECEIPT_INVALID/);
});

test("rejects unrelated HTTP failures", () => {
  assert.throws(() => parseOpenNovelActionReceipt(409, { code: "STALE_TURN" }), /ACTION_HTTP_409/);
});
