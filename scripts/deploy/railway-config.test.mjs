import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [railway, main, prepareEnv, testEnvironment, productionEnvironment] = await Promise.all([
  readFile(new URL("../../railway.toml", import.meta.url), "utf8"),
  readFile(new URL("../../apps/api/src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("./prepare-env-files.mjs", import.meta.url), "utf8"),
  readFile(new URL("../../deploy/env/test.railway.env.example", import.meta.url), "utf8"),
  readFile(new URL("../../deploy/env/production.railway.env.example", import.meta.url), "utf8")
]);

assert.match(railway, /startCommand = "pnpm --filter @apps\/api start"/);
assert.doesNotMatch(railway, /startCommand\s*=\s*"[^"]*\bPORT=/, "Railway must supply the container port");
assert.match(railway, /healthcheckPath = "\/api\/health"/);
assert.match(main, /process\.env\.PORT \|\| process\.env\.API_PORT/);
assert.match(main, /app\.listen\(port, "0\.0\.0\.0"\)/);

const controller = await readFile(new URL("../../apps/api/src/story.controller.ts", import.meta.url), "utf8");
assert.match(controller, /process\.env\.RAILWAY_GIT_COMMIT_SHA/);
assert.match(controller, /version: deploymentVersion\(\)/);

for (const source of [testEnvironment, productionEnvironment]) {
  assert.match(source, /^MANY_WORLDS_API_ORIGIN=/m);
  assert.match(source, /^ROOM_LOBBY_SOCKET_ENABLED=(?:true|false)$/m);
  assert.match(source, /^ROOM_LOBBY_SOCKET_PATH=\/api\/v4\/room-lobby\/socket$/m);
  assert.match(source, /^ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS=https:\/\//m);
  assert.match(source, /^ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS=3000$/m);
  assert.doesNotMatch(source, /^ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS=.*\*/m);
}
assert.doesNotMatch(productionEnvironment, /^CORS_ALLOWED_ORIGINS=.*\*/m);
assert.match(prepareEnv, /ROOM_LOBBY_SOCKET_ENABLED/);
assert.match(prepareEnv, /ROOM_LOBBY_SOCKET_PATH/);
assert.match(prepareEnv, /ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS/);
assert.match(prepareEnv, /ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS/);
assert.match(prepareEnv, /PRODUCTION Origin allowlists must not contain \*/);
assert.match(prepareEnv, /every ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS value must also appear in CORS_ALLOWED_ORIGINS/);

console.log("Railway deployment configuration assertions passed");
