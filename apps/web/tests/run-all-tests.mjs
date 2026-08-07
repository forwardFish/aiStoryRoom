import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(directory)
  .filter((name) => name.endsWith(".test.mjs") && name !== path.basename(fileURLToPath(import.meta.url)))
  .sort();

if (!files.length) {
  console.error("No web test files were found.");
  process.exit(2);
}

for (const file of files) {
  const absolute = path.join(directory, file);
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, ["--test", absolute], {
    cwd: path.resolve(directory, ".."),
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nAll ${files.length} web test files passed.`);
