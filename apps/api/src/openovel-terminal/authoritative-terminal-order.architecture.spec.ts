import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("authoritative legacy committer has no narrative renderer provider or truth guard port", () => {
  const committer = source("./authoritative-legacy-terminal-committer.ts");
  for (const forbidden of [
    "NarrativeRenderer",
    "NarrativeTruthGuard",
    "NarrativePublisher",
    "DeepSeek",
    "OpenNovelRuntimeClient",
    ".render(",
  ]) {
    assert.equal(committer.includes(forbidden), false, `authoritative committer must not reference ${forbidden}`);
  }
  assert.match(committer, /storyRun\.update/);
  assert.match(committer, /canonFact\.upsert/);
  assert.match(committer, /storyTaskOutbox\.upsert/);
});

test("B0 finalization commits result and outbox without a synchronous NarrativeEntry", () => {
  const pipeline = source("../b0-settlement/b0-settlement-pipeline.service.ts");
  const start = pipeline.indexOf("  private async finalizeRun(");
  const end = pipeline.indexOf("\n  private async rulesetForWindow(", start);
  assert.ok(start >= 0 && end > start, "finalizeRun source block must exist");
  const block = pipeline.slice(start, end);
  assert.match(block, /openNovelResultV2/);
  assert.match(block, /storyTaskOutbox\.upsert/);
  assert.match(block, /storyRun\.update/);
  assert.equal(block.includes("narrativeEntry"), false);
  assert.equal(block.includes("NarrativeRenderer"), false);
  assert.equal(block.includes("Provider"), false);
});

test("active OpenNovel path adapts T19 before any runtime T20 stream", () => {
  const adapter = source("../openovel-adapter/openovel-adapter.service.ts");
  const adaptIndex = adapter.indexOf("shouldAdaptUnfinished");
  const streamIndex = adapter.indexOf("runtime.streamAction");
  assert.ok(adaptIndex >= 0, "T19 adapter branch must exist");
  assert.ok(streamIndex >= 0, "legacy runtime stream remains for T01-T19");
  assert.ok(adaptIndex < streamIndex, "T19 must be committed before a runtime T20 could be requested");
  assert.match(adapter, /assertNoNewT20Head/);
});

test("Result V2 reader is a GET-safe projection without Prisma write vocabulary", () => {
  const reader = source("../openovel-result-v2.ts");
  for (const forbidden of [
    /prisma\.[A-Za-z0-9_]+\.update(?:Many)?\s*\(/,
    /prisma\.[A-Za-z0-9_]+\.create(?:Many)?\s*\(/,
    /prisma\.[A-Za-z0-9_]+\.upsert\s*\(/,
    /prisma\.\$transaction\s*\(/,
  ]) {
    assert.doesNotMatch(reader, forbidden);
  }
  assert.match(reader, /openovel-result-v2|OPENOVEL_RESULT_SCHEMA_V2/);
});
