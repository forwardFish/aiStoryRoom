#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateStats, loadCorpus, validateCorpus } from "./corpus.mjs";
import { EXPECTED_WORKSPACE, inspectTestTarget } from "./openovel-test-gate.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const corpus = await loadCorpus(resolve(root, "p00-historical-blockers.sanitized.json"));
const errors = validateCorpus(corpus);
const rootPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (rootPackage.scripts?.["test:openovel-runtime"] !== "node scripts/p00/openovel-test-gate.mjs") errors.push("root test:openovel-runtime must use the non-empty gate");
for (const [name, command] of Object.entries(rootPackage.scripts ?? {}).filter(([name]) => name.startsWith("openovel:"))) {
  if (command.includes("@ai-story/openovel-runtime")) errors.push(`${name} still targets the obsolete workspace`);
}
let target;
try { target = await inspectTestTarget(root, EXPECTED_WORKSPACE); } catch (error) { errors.push(error.message); }
if (errors.length) {
  console.error(JSON.stringify({ ok: false, providerCalls: 0, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, providerCalls: 0, baselineCommit: corpus.baselineCommit, schemaVersion: corpus.schemaVersion, statistics: calculateStats(corpus), workspace: target.workspace, discoveredTestFiles: target.testFiles }, null, 2));
}
