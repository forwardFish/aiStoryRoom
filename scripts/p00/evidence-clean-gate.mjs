#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkspaceScript } from "./workspace-script-gate.mjs";

export const EVIDENCE_OUTPUT_PATH = "packages/openovel-runtime/generated/source-evidence";

export function inspectEvidenceDiff(root, spawn = spawnSync) {
  const result = spawn("git", ["status", "--porcelain=v1", "--", EVIDENCE_OUTPUT_PATH], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git status exited with ${result.status}`);
  return result.stdout.trim();
}

export async function runEvidenceCleanGate(root, options = {}) {
  const before = inspectEvidenceDiff(root, options.gitSpawn);
  if (before) throw new Error(`evidence outputs are dirty before build:\n${before}`);
  await runWorkspaceScript(root, "@ai-story/openovel-runtime", "evidence:build", [], options);
  const after = inspectEvidenceDiff(root, options.gitSpawn);
  if (after) throw new Error(`evidence build changed tracked outputs:\n${after}`);
  return { outputPath: EVIDENCE_OUTPUT_PATH, clean: true };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  try {
    const result = await runEvidenceCleanGate(root);
    console.log(`P00_EVIDENCE_CLEAN_OK path=${result.outputPath}`);
  } catch (error) {
    console.error(`P00_EVIDENCE_CLEAN_FAILED ${error.message}`);
    process.exitCode = 1;
  }
}
