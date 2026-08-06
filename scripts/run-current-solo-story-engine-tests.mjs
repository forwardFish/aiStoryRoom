import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const apiRoot = resolve(import.meta.dirname, "..", "apps", "api");
const testsRoot = resolve(apiRoot, "src", "solo-story-engine", "__tests__");
const legacyOnly = new Set([
  // Sangtian now routes through openovel_v1. This file remains available via
  // test:solo-story-engine:legacy-sangtian for historical comparison, but its
  // old prompt-shape and lexical-gate assertions are not a current product gate.
  "part-one-runtime-integration.spec.ts",
]);
const files = readdirSync(testsRoot)
  .filter((name) => name.endsWith(".spec.ts") && !legacyOnly.has(name))
  .sort()
  .map((name) => resolve(testsRoot, name));

if (!files.length) throw new Error("CURRENT_SOLO_STORY_TESTS_MISSING");

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { cwd: apiRoot, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
