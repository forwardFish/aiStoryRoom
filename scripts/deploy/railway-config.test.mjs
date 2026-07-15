import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [railway, main] = await Promise.all([
  readFile(new URL("../../railway.toml", import.meta.url), "utf8"),
  readFile(new URL("../../apps/api/src/main.ts", import.meta.url), "utf8")
]);

assert.match(railway, /startCommand = "pnpm --filter @apps\/api start"/);
assert.doesNotMatch(railway, /startCommand\s*=\s*"[^"]*\bPORT=/, "Railway must supply the container port");
assert.match(railway, /healthcheckPath = "\/api\/health"/);
assert.match(main, /process\.env\.PORT \|\| process\.env\.API_PORT/);
assert.match(main, /app\.listen\(port, "0\.0\.0\.0"\)/);

const controller = await readFile(new URL("../../apps/api/src/story.controller.ts", import.meta.url), "utf8");
assert.match(controller, /process\.env\.RAILWAY_GIT_COMMIT_SHA/);
assert.match(controller, /version: deploymentVersion\(\)/);

console.log("Railway deployment configuration assertions passed");
