import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { calculateStats, filterRecords, loadCorpus, validateCorpus } from "./corpus.mjs";
import { inspectTestTarget, parseTestCount } from "./openovel-test-gate.mjs";
import { buildPnpmInvocation, runPnpm } from "./pnpm-runner.mjs";
import { inspectWorkspaceScript, LEGACY_ROOT_COMMANDS } from "./workspace-script-gate.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("root commands target the workspace that actually provides each script", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:openovel-runtime"], "node scripts/p00/openovel-test-gate.mjs");
  assert.equal(pkg.scripts["test:openovel-evidence-runtime"], "node scripts/p00/openovel-test-gate.mjs --target evidence");
  for (const [name, script] of Object.entries(LEGACY_ROOT_COMMANDS)) {
    const command = pkg.scripts[name];
    assert.match(command, /--workspace @ai-story\/openovel-runtime/, name);
    assert.match(command, new RegExp(`--script ${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`), name);
    await inspectWorkspaceScript(root, "@ai-story/openovel-runtime", script);
  }
});

test("both OpenNovel targets discover their unique non-empty spec sets", async () => {
  const app = await inspectTestTarget(root, "app");
  const evidence = await inspectTestTarget(root, "evidence");
  assert.equal(app.workspace, "@apps/openovel-runtime");
  assert.equal(evidence.workspace, "@ai-story/openovel-runtime");
  assert.deepEqual(app.testFiles, ["durable-truth-gate.spec.ts", "openovel-first.spec.ts"]);
  assert.deepEqual(evidence.testFiles, ["context.spec.ts", "evidence.spec.ts"]);
});

test("non-empty gate rejects a wrong workspace", async () => {
  await assert.rejects(() => inspectTestTarget(root, "wrong"), /unexpected test target/);
});

test("non-empty gate rejects zero discovered tests", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "p00-zero-tests-"));
  await mkdir(resolve(fixture, "runtime/tests"), { recursive: true });
  await writeFile(resolve(fixture, "runtime/package.json"), JSON.stringify({ name: "@fixture/runtime", scripts: { test: "node --test tests/*.spec.ts" } }));
  await assert.rejects(() => inspectTestTarget(fixture, "fixture", { workspace: "@fixture/runtime", relativeDir: "runtime" }), /No test files discovered/);
});

test("script gate rejects an existing workspace with a missing script", async () => {
  await assert.rejects(() => inspectWorkspaceScript(root, "@apps/openovel-runtime", "evidence:build"), /does not provide script/);
});

test("Windows runner uses node plus npm_execpath with shell disabled", async () => {
  const invocation = buildPnpmInvocation(["--filter", "@apps/openovel-runtime", "test"], {
    platform: "win32", env: { npm_execpath: "C:\\tools\\pnpm.cjs" }, execPath: "C:\\node.exe",
  });
  assert.deepEqual(invocation, { command: "C:\\node.exe", args: ["C:\\tools\\pnpm.cjs", "--filter", "@apps/openovel-runtime", "test"] });
  let called;
  const spawn = (command, args, options) => {
    called = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => { child.stdout.end("ℹ tests 3\n"); child.emit("close", 0); });
    return child;
  };
  const result = await runPnpm(["--filter", "@apps/openovel-runtime", "test"], {
    platform: "win32", env: { npm_execpath: "C:\\tools\\pnpm.cjs" }, execPath: "C:\\node.exe", spawn, quiet: true,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, "ℹ tests 3\n");
  assert.equal(called.options.shell, false);
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
