import assert from "node:assert/strict";
import test from "node:test";
import { endingAwareNarratorMessages } from "../src/runtime.js";
import type { ModelMessage } from "../src/types.js";

test("ordinary turns keep the existing Narrator prompt unchanged", () => {
  const messages: ModelMessage[] = [{ role: "system", content: "ordinary turn" }];
  assert.equal(endingAwareNarratorMessages(messages, false), messages);
});

test("a terminal turn adds one world-neutral final-chapter writing contract", () => {
  const messages: ModelMessage[] = [{ role: "user", content: "authoritative projection" }];
  const terminal = endingAwareNarratorMessages(messages, true);

  assert.equal(terminal.length, 2);
  assert.deepEqual(terminal[0], messages[0]);
  assert.equal(terminal[1]?.role, "system");
  assert.match(terminal[1]?.content || "", /小说终章/u);
  assert.match(terminal[1]?.content || "", /保住了什么并付出了什么/u);
  assert.match(terminal[1]?.content || "", /仍未解决/u);
  assert.match(terminal[1]?.content || "", /庆祝要克制/u);
  assert.match(terminal[1]?.content || "", /悲伤要克制/u);
  assert.doesNotMatch(terminal[1]?.content || "", /桑田|浙江|凯撒/u);
});
