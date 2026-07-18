import assert from "node:assert/strict";
import test from "node:test";
import { isReactionCommandWindowOpen } from "./action-command.service";
import { continuousSerializableRetryDelayMs } from "./room-transaction";

test("directed reactions may be answered immediately while MAIN remains open", () => {
  assert.equal(isReactionCommandWindowOpen("MAIN_OPEN"), true);
  assert.equal(isReactionCommandWindowOpen("INTERACTION_GRACE"), true);
});

test("directed reactions remain sealed outside interactive window states", () => {
  for (const status of ["PREPARING", "CLOSING", "RESOLVING", "PROJECTING", "RESOLVED"]) {
    assert.equal(isReactionCommandWindowOpen(status), false, status);
  }
});

test("serializable command retries use bounded jitter instead of synchronized delays", () => {
  assert.equal(continuousSerializableRetryDelayMs(0, 0), 25);
  assert.equal(continuousSerializableRetryDelayMs(0, 1), 50);
  assert.equal(continuousSerializableRetryDelayMs(6, 0), 1_000);
  assert.equal(continuousSerializableRetryDelayMs(6, 1), 2_000);
  assert.equal(continuousSerializableRetryDelayMs(20, 1), 2_000);
});
