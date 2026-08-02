#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateStats, loadCorpus, validateCorpus } from "./corpus.mjs";
import { inspectTestTarget } from "./openovel-test-gate.mjs";
import { inspectWorkspaceScript, LEGACY_ROOT_COMMANDS } from "./workspace-script-gate.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const corpus = await loadCorpus(resolve(root, "p00-historical-blockers.sanitized.json"));
const errors = validateCorpus(corpus);
const rootPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (rootPackage.scripts?.["test:openovel-runtime"] !== "node scripts/p00/openovel-test-gate.mjs") errors.push("root test:openovel-runtime must use the non-empty gate");
if (rootPackage.scripts?.["test:openovel-evidence-runtime"] !== "node scripts/p00/openovel-test-gate.mjs --target evidence") errors.push("root evidence runtime test must use its named non-empty gate");
for (const [name, script] of Object.entries(LEGACY_ROOT_COMMANDS)) {
  const command = rootPackage.scripts?.[name] ?? "";
  if (!command.includes("--workspace @ai-story/openovel-runtime") || !command.includes(`--script ${script}`)) errors.push(`${name} targets the wrong workspace or script`);
  try { await inspectWorkspaceScript(root, "@ai-story/openovel-runtime", script); } catch (error) { errors.push(`${name}: ${error.message}`); }
}
const targets = [];
for (const targetName of ["app", "evidence"]) {
  try { targets.push(await inspectTestTarget(root, targetName)); } catch (error) { errors.push(error.message); }
}
if (errors.length) {
  console.error(JSON.stringify({ ok: false, providerCalls: 0, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true, providerCalls: 0, baselineCommit: corpus.baselineCommit, schemaVersion: corpus.schemaVersion,
    statistics: calculateStats(corpus),
    workspaces: targets.map((target) => ({ target: target.targetName, packageName: target.workspace, directory: target.relativeDir, discoveredTestFiles: target.testFiles })),
  }, null, 2));
}
