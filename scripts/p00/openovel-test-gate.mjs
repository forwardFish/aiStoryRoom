#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPnpm } from "./pnpm-runner.mjs";

export const TEST_TARGETS = {
  app: { workspace: "@apps/openovel-runtime", relativeDir: "apps/openovel-runtime" },
  evidence: { workspace: "@ai-story/openovel-runtime", relativeDir: "packages/openovel-runtime" },
};
export const NO_PROJECTS = /No projects matched/i;

export async function inspectTestTarget(root, targetName = "app", override) {
  const target = override ?? TEST_TARGETS[targetName];
  if (!target) throw new Error(`Refusing unexpected test target: ${targetName}`);
  const { workspace, relativeDir } = target;
  const packagePath = resolve(root, relativeDir, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  if (pkg.name !== workspace) throw new Error(`Workspace ${workspace} does not exist at ${relativeDir}`);
  if (typeof pkg.scripts?.test !== "string" || !pkg.scripts.test.includes("tests/*.spec.ts")) throw new Error("Workspace test script does not target tests/*.spec.ts");
  const testDir = resolve(root, relativeDir, "tests");
  const testFiles = (await readdir(testDir)).filter((name) => name.endsWith(".spec.ts")).sort();
  if (testFiles.length === 0) throw new Error(`No test files discovered for ${workspace}`);
  return { packagePath, relativeDir, testFiles, workspace, targetName };
}

export function parseTestCount(output) {
  if (NO_PROJECTS.test(output)) throw new Error("pnpm reported No projects matched");
  const matches = [...output.matchAll(/^(?:#|ℹ) tests (\d+)\s*$/gm)];
  if (!matches.length) throw new Error("Test runner did not report a test count");
  const count = Number(matches.at(-1)[1]);
  if (count === 0) throw new Error("Test runner reported zero tests");
  return count;
}

export async function runGate(root, options = {}) {
  const target = await inspectTestTarget(root, options.targetName ?? "app", options.target);
  if (options.inspectOnly) return { ...target, testCount: null };
  const result = await runPnpm(["--filter", target.workspace, "test"], { ...options, cwd: root });
  if (result.exitCode !== 0) throw new Error(`${target.workspace} tests exited with ${result.exitCode}`);
  return { ...target, testCount: parseTestCount(result.output) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const targetIndex = process.argv.indexOf("--target");
  const targetName = targetIndex >= 0 ? process.argv[targetIndex + 1] : "app";
  try {
    const result = await runGate(root, { targetName });
    console.log(`P00_OPENOVEL_GATE_OK target=${result.targetName} workspace=${result.workspace} files=${result.testFiles.length} tests=${result.testCount}`);
  } catch (error) {
    console.error(`P00_OPENOVEL_GATE_FAILED ${error.message}`);
    process.exitCode = 1;
  }
}
