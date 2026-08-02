#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPnpm } from "./pnpm-runner.mjs";

export const WORKSPACES = {
  "@apps/openovel-runtime": "apps/openovel-runtime",
  "@ai-story/openovel-runtime": "packages/openovel-runtime",
};
export const LEGACY_ROOT_COMMANDS = {
  "openovel:evidence": "evidence:build",
  "openovel:evidence:validate": "evidence:validate",
  "openovel:evidence:review:init": "evidence:review:init",
  "openovel:evidence:review:status": "evidence:review:status",
  "openovel:world-bible": "world-bible:build",
  "openovel:compare": "context:compare",
  "openovel:shadow-turn": "shadow:turn",
  "openovel:shadow-selected-turn": "shadow:selected-turn",
};

export async function inspectWorkspaceScript(root, workspace, script) {
  const relativeDir = WORKSPACES[workspace];
  if (!relativeDir) throw new Error(`Refusing unexpected workspace target: ${workspace}`);
  const packagePath = resolve(root, relativeDir, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  if (pkg.name !== workspace) throw new Error(`Workspace name mismatch at ${relativeDir}`);
  if (typeof pkg.scripts?.[script] !== "string" || !pkg.scripts[script].trim()) {
    throw new Error(`Workspace ${workspace} does not provide script ${script}`);
  }
  return { workspace, script, relativeDir, packagePath, command: pkg.scripts[script] };
}

export async function runWorkspaceScript(root, workspace, script, args = [], options = {}) {
  const target = await inspectWorkspaceScript(root, workspace, script);
  if (options.checkOnly) return { ...target, exitCode: null, output: "" };
  const result = await runPnpm(["--filter", workspace, "run", script, ...args], { ...options, cwd: root });
  if (result.exitCode !== 0) throw new Error(`${workspace} ${script} exited with ${result.exitCode}`);
  if (/None of the selected packages has a/i.test(result.output)) {
    throw new Error(`${workspace} did not execute script ${script}`);
  }
  return { ...target, ...result };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const args = process.argv.slice(2);
  const take = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0 || !args[index + 1]) throw new Error(`Missing ${flag}`);
    return args[index + 1];
  };
  try {
    const workspace = take("--workspace");
    const script = take("--script");
    const consumed = new Set(["--workspace", workspace, "--script", script, "--check-only"]);
    const passthrough = args.filter((value) => !consumed.has(value) && value !== "--");
    const result = await runWorkspaceScript(root, workspace, script, passthrough, { checkOnly: args.includes("--check-only") });
    console.log(`P00_WORKSPACE_SCRIPT_OK workspace=${result.workspace} script=${result.script} executed=${result.exitCode !== null}`);
  } catch (error) {
    console.error(`P00_WORKSPACE_SCRIPT_FAILED ${error.message}`);
    process.exitCode = 1;
  }
}
