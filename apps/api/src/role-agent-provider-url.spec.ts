import assert from "node:assert/strict";
import { deepSeekChatCompletionsUrl } from "./continuous-strategy/role-agent-task.service";

assert.equal(deepSeekChatCompletionsUrl(), "https://api.deepseek.com/chat/completions");
assert.equal(deepSeekChatCompletionsUrl("https://api.deepseek.com/"), "https://api.deepseek.com/chat/completions");
assert.equal(deepSeekChatCompletionsUrl("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
assert.equal(
  deepSeekChatCompletionsUrl("https://proxy.example.test/v1/chat/completions?tenant=one"),
  "https://proxy.example.test/v1/chat/completions?tenant=one"
);

console.log("role-agent provider endpoint normalization: PASS");