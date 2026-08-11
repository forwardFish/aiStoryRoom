import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const directory = join(process.cwd(), "src", "openovel-narrative-projector");

function source(name: string): string {
  return readFileSync(join(directory, name), "utf8");
}

test("OpenNovelNarrativeProjector has no authoritative repository or committer write port", () => {
  const projector = source("openovel-narrative-projector.service.ts");
  assert.doesNotMatch(projector, /PrismaService|B0SettlementCommitService|StoryService|FinaleCommitter|\$transaction/u);
  assert.match(projector, /NarrativeSourceReader/u);
  assert.match(projector, /NarrativePublisher/u);
});

test("the projector directory contains no second Narrator business module", () => {
  const files = readdirSync(directory).filter((name) => name.endsWith(".ts"));
  assert.equal(files.some((name) => /narrator/iu.test(name)), false);
  for (const name of files) {
    assert.doesNotMatch(source(name), /class\s+\w*Narrator\w*|@Module\([^]*Narrator/iu);
  }
});

test("B0 narrative failures bypass the authoritative B0 failure mutator", () => {
  const bridge = readFileSync(join(directory, "../b0-settlement/b0-outbox-bridge.service.ts"), "utf8");
  assert.match(bridge, /task\.taskType !== "B0_NARRATIVE_GENERATION"/u);
  assert.match(bridge, /narrativeProjector\.projectTask/u);
});
