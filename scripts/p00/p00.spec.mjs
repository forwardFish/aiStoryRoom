import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { calculateStats, filterRecords, loadCorpus, validateCorpus } from "./corpus.mjs";
import { EXPECTED_WORKSPACE, inspectTestTarget, parseTestCount } from "./openovel-test-gate.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("root OpenNovel scripts target the real workspace and test uses the gate", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:openovel-runtime"], "node scripts/p00/openovel-test-gate.mjs");
  for (const [name, command] of Object.entries(pkg.scripts).filter(([name]) => name.startsWith("openovel:"))) {
    assert.match(command, /@apps\/openovel-runtime/, name);
    assert.doesNotMatch(command, /@ai-story\/openovel-runtime/, name);
  }
});

test("OpenNovel target discovers the real non-empty spec set", async () => {
  const target = await inspectTestTarget(root);
  assert.equal(target.workspace, EXPECTED_WORKSPACE);
  assert.deepEqual(target.testFiles, ["durable-truth-gate.spec.ts", "openovel-first.spec.ts"]);
});

test("non-empty gate rejects a wrong workspace", async () => {
  await assert.rejects(() => inspectTestTarget(root, "@wrong/runtime"), /unexpected workspace/);
});

test("non-empty gate rejects zero discovered tests", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "p00-zero-tests-"));
  await mkdir(resolve(fixture, "apps/openovel-runtime/tests"), { recursive: true });
  await writeFile(resolve(fixture, "apps/openovel-runtime/package.json"), JSON.stringify({ name: EXPECTED_WORKSPACE, scripts: { test: "node --test tests/*.spec.ts" } }));
  await assert.rejects(() => inspectTestTarget(fixture), /No OpenNovel test files discovered/);
});

test("test output parser rejects zero and No projects matched", () => {
  assert.throws(() => parseTestCount("# tests 0\n"), /zero tests/);
  assert.throws(() => parseTestCount("ℹ tests 0\n"), /zero tests/);
  assert.throws(() => parseTestCount("No projects matched the filters"), /No projects matched/);
  assert.equal(parseTestCount("# tests 14\n# pass 14\n"), 14);
  assert.equal(parseTestCount("ℹ tests 14\nℹ pass 14\n"), 14);
});

test("historical corpus schema has 98 of 98 complete manual labels", async () => {
  const corpus = await loadCorpus(resolve(root, "p00-historical-blockers.sanitized.json"));
  assert.deepEqual(validateCorpus(corpus), []);
  assert.equal(corpus.records.length, 98);
  assert.equal(corpus.records.filter((record) => record.humanClassification === "UNLABELED").length, 0);
  assert.equal(corpus.records.filter((record) => record.classificationRationale.trim().length >= 12).length, 98);
  assert.deepEqual(calculateStats(corpus).classifications, { REAL_P0: 76, FALSE_POSITIVE: 11, UNCERTAIN: 11 });
});

test("query and statistics are stable across equivalent calls", async () => {
  const corpus = await loadCorpus(resolve(root, "p00-historical-blockers.sanitized.json"));
  const filters = { classification: "REAL_P0", severity: "HIGH", turnId: "T03", keyword: "文书" };
  const first = filterRecords(corpus.records, filters);
  const second = filterRecords([...corpus.records].reverse(), filters);
  assert.deepEqual(first.map((record) => record.auditId), second.map((record) => record.auditId));
  assert.deepEqual(calculateStats(corpus, first), calculateStats(corpus, second));
  assert.ok(first.length > 0);
});
