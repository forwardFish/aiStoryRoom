#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const EXPECTED_WORKSPACE = "@apps/openovel-runtime";
export const NO_PROJECTS = /No projects matched/i;

export async function inspectTestTarget(root, workspace = EXPECTED_WORKSPACE) {
  if (workspace !== EXPECTED_WORKSPACE) throw new Error(`Refusing unexpected workspace target: ${workspace}`);
  const packagePath = resolve(root, "apps/openovel-runtime/package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  if (pkg.name !== workspace) throw new Error(`Workspace ${workspace} does not exist at apps/openovel-runtime`);
  if (typeof pkg.scripts?.test !== "string" || !pkg.scripts.test.includes("tests/*.spec.ts")) throw new Error("Workspace test script does not target tests/*.spec.ts");
  const testDir = resolve(root, "apps/openovel-runtime/tests");
  const testFiles = (await readdir(testDir)).filter((name) => name.endsWith(".spec.ts")).sort();
  if (testFiles.length === 0) throw new Error("No OpenNovel test files discovered");
  return { packagePath, testFiles, workspace };
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
  const target = await inspectTestTarget(root, options.workspace);
  if (options.inspectOnly) return { ...target, testCount: null };
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, ["--filter", target.workspace, "test"], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { output += chunk; process.stderr.write(chunk); });
  const exitCode = await new Promise((done, reject) => { child.once("error", reject); child.once("close", done); });
  if (exitCode !== 0) throw new Error(`OpenNovel workspace tests exited with ${exitCode}`);
  return { ...target, testCount: parseTestCount(output) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  try {
    const result = await runGate(root);
    console.log(`P00_OPENOVEL_GATE_OK workspace=${result.workspace} files=${result.testFiles.length} tests=${result.testCount}`);
  } catch (error) {
    console.error(`P00_OPENOVEL_GATE_FAILED ${error.message}`);
    process.exitCode = 1;
  }
}
