import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "prisma-snapshot.ts"), "utf8");

test("Prisma convergence snapshot captures route, W4, W5 and SeatControl in one bounded transaction", () => {
  assert.equal((source.match(/pressureFastSerializableTransaction\(/gu) ?? []).length, 1);
  // One definition call and exactly one capture call.
  assert.equal((source.match(/return pressureFastSerializableTransaction\(this\.prisma/gu) ?? []).length, 1);
  assert.match(source, /pressureRunRouteSnapshot\.findUnique/u);
  assert.match(source, /readCurrentOrchestratorState\(tx/u);
  assert.match(source, /pressureChapterRuntime\.findUnique/u);
  assert.match(source, /pressureSeatControlSnapshot\.findUnique/u);
  assert.match(source, /type:\s*LEDGER_EVENT_TYPE/u);
  assert.match(source, /TransactionIsolationLevel\.Serializable/u);
  assert.match(source, /maxWait:\s*500/u);
  assert.match(source, /timeout:\s*2_000/u);
});

test("snapshot transaction performs no policy, content, Provider or write operation", () => {
  assert.doesNotMatch(source, /policy\.select|content\.load|fetch\s*\(|provider/iu);
  assert.doesNotMatch(source, /\.create\s*\(|\.update(?:Many)?\s*\(|\.delete(?:Many)?\s*\(/u);
});
