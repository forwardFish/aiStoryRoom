import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const runtimeFiles = [
  "action-window.service.ts",
  "action-command.service.ts",
  "member-projection.service.ts",
  "role-agent-task.service.ts",
  "window-lifecycle.service.ts",
  "window-resolution.service.ts"
];

for (const file of runtimeFiles) {
  const source = readFileSync(join(__dirname, file), "utf8");
  assert.match(source, /\.forGame\(/, `${file} must bind content to the persisted run`);
  assert.doesNotMatch(source, /CONTINUOUS_(?:PLAYABLE_ROLE_KEYS|SYSTEM_ROLE_KEY|STRATEGY_VERSION)/, `${file} must not import Sangtian runtime constants`);
  assert.doesNotMatch(source, /this\.content\.(?:stage|roleStage|maneuver|reaction|agentPolicy|fallbackAction)\(/, `${file} must not use an unbound content reader`);
}

const resolutionSource = readFileSync(join(__dirname, "window-resolution.service.ts"), "utf8");
assert.doesNotMatch(resolutionSource, /财政危局|浙江|改桑|桑田/, "generic runtime result text must not leak Sangtian-specific language");

const roomsSource = readFileSync(join(__dirname, "..", "rooms.service.ts"), "utf8");
const soloSource = roomsSource.slice(roomsSource.indexOf("async createSolo"), roomsSource.indexOf("async joinByCode"));
assert.match(soloSource, /selectRunVersions/, "solo must use the same rollout version selection as multiplayer rooms");
assert.doesNotMatch(roomsSource, /forceContinuous/, "solo must not bypass the continuous-strategy rollout flag");
assert.match(soloSource, /world\.roles\[0\]\?\.roleKey/, "solo default role must come from the game registry");
assert.doesNotMatch(soloSource, /brutus|zhejiang_governor/, "solo must not hardcode a world-specific default role");
assert.match(soloSource, /idempotencyKey/, "solo creation must accept an idempotency key");
assert.match(soloSource, /soloRunIdForRequest/, "solo retries must share a deterministic database identity");
assert.match(soloSource, /soloCreationResponse/, "solo creation must return the canonical id, runId and roomId contract");

console.log("continuous strategy runtime genericity source gates: PASS");
