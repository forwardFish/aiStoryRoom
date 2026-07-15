import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser authentication uses a same-origin HttpOnly cookie session", async () => {
  const [platform, apiClient, apiStoryStorage, roleSelect, roomGame, vercel, apiProxy] = await Promise.all([
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/api-client.js", import.meta.url), "utf8"),
    readFile(new URL("../public/api-story-storage.js", import.meta.url), "utf8"),
    readFile(new URL("../public/role-select.js", import.meta.url), "utf8"),
    readFile(new URL("../public/room-game.js", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../../../api/proxy.js", import.meta.url), "utf8")
  ]);

  assert.match(vercel, /"source": "\/api\/:path\*", "destination": "\/api\/proxy\?path=:path\*"/);
  assert.match(apiProxy, /appsapi-test\.up\.railway\.app/);
  assert.match(apiProxy, /set-cookie/);
  assert.match(platform, /const deployedApiBase = "\/api"/);
  assert.match(platform, /credentials: "include"/);
  assert.match(platform, /many_worlds_session_hint=1/);
  assert.match(platform, /auth\/session\/upgrade/);
  assert.match(platform, /localStorage\.removeItem\("many-worlds-token"\)/);
  assert.doesNotMatch(platform, /localStorage\.setItem\("many-worlds-token"/);
  assert.doesNotMatch(platform, /authorization:\s*`Bearer \$\{sessionToken\(\)\}`/);
  assert.match(apiClient, /const deployedApiBase = "\/api"/);
  assert.match(apiClient, /credentials: "include"/);
  assert.doesNotMatch(apiClient, /headers\.set\("authorization"/);
  assert.match(apiStoryStorage, /credentials: "include"/);
  assert.match(roleSelect, /credentials: "include"/);
  assert.match(roomGame, /credentials: "include"/);
  assert.doesNotMatch(roomGame, /Bearer \$\{token\(\)\}/);
});

test("the platform header stays disabled", async () => {
  const platform = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = platform.indexOf("function appShell");
  const end = platform.indexOf("function bind()", start);
  const appShell = platform.slice(start, end);
  assert.match(appShell, /root\.innerHTML = content/);
  assert.doesNotMatch(appShell, /^\s*root\.innerHTML = `\$\{header\(/m);
});
