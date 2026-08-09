import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const REPO_ROOT = resolve(process.cwd(), "../..");
const API_SOURCE_ROOT = join(REPO_ROOT, "apps", "api", "src");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "prisma",
  "migrations",
  "20260809020000_b0_role_control_reason_vocabulary",
  "migration.sql",
);

const PRESERVED_LEGACY_REASONS = new Set([
  "EXPLICIT_EXIT",
  "HUMAN_RECLAIM",
  "SYSTEM",
]);

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...sourceFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      result.push(path);
    }
  }
  return result;
}

function roleControlMutationCalls(source: string): string[] {
  const calls: string[] = [];
  const startPattern = /\broleControl\.(?:create|createMany|update|updateMany|upsert)\s*\(/g;
  for (const match of source.matchAll(startPattern)) {
    const open = source.indexOf("(", match.index);
    if (open < 0) continue;

    let depth = 0;
    let mode: "code" | "string" | "line-comment" | "block-comment" = "code";
    let quote = "";
    let escaped = false;

    for (let index = open; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1] ?? "";

      if (mode === "code") {
        if (character === '"' || character === "'" || character === "`") {
          mode = "string";
          quote = character;
          escaped = false;
          continue;
        }
        if (character === "/" && next === "/") {
          mode = "line-comment";
          index += 1;
          continue;
        }
        if (character === "/" && next === "*") {
          mode = "block-comment";
          index += 1;
          continue;
        }
        if (character === "(") depth += 1;
        if (character === ")") {
          depth -= 1;
          if (depth === 0) {
            calls.push(source.slice(match.index, index + 1));
            break;
          }
        }
        continue;
      }

      if (mode === "string") {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          mode = "code";
        }
        continue;
      }

      if (mode === "line-comment") {
        if (character === "\n") mode = "code";
        continue;
      }

      if (character === "*" && next === "/") {
        mode = "code";
        index += 1;
      }
    }
  }
  return calls;
}

function sourceRoleControlReasons(): Set<string> {
  const reasons = new Set<string>();
  for (const path of sourceFiles(API_SOURCE_ROOT)) {
    const source = readFileSync(path, "utf8");
    for (const call of roleControlMutationCalls(source)) {
      for (const match of call.matchAll(/\breason\s*:\s*([^,}\n]+)/g)) {
        const expression = match[1];
        for (const literal of expression.matchAll(/["']([A-Z][A-Z0-9_]*)["']/g)) {
          reasons.add(literal[1]);
        }
      }
    }
  }
  return reasons;
}

function migrationReasons(): Set<string> {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(migration, /ADD CONSTRAINT "RoleControl_reason_check"/);
  return new Set([...migration.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((match) => match[1]));
}

test("fresh PostgreSQL migrations admit every RoleControl reason emitted by runtime code", () => {
  const emitted = sourceRoleControlReasons();
  const allowed = migrationReasons();
  const expected = new Set([...emitted, ...PRESERVED_LEGACY_REASONS]);

  assert.ok(emitted.has("B0_INITIAL_ROLE_BINDING"), "the B0 startup reason must remain source-derived");
  assert.deepEqual(
    [...allowed].sort(),
    [...expected].sort(),
    "RoleControl_reason_check must exactly cover runtime writes plus preserved legacy rows",
  );
});
