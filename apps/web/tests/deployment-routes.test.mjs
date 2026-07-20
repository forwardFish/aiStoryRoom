import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local and Vercel routes keep home, game, result and legacy redirect distinct", async () => {
  const [index, home, server, deploy, vercel, proxy] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/home.html", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/deploy/prepare-vercel-web-assets.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../../api/proxy.js", import.meta.url), "utf8")
  ]);

  assert.match(index, /data-testid="web-game-root"/);
  assert.match(index, /game-bootstrap\.js/);
  assert.doesNotMatch(index, /home\.js|story-lobby-root/);
  assert.match(home, /story-lobby-root/);
  assert.match(home, /home\.js/);

  assert.match(server, /\["\/", "\/home\.html"\]/);
  assert.match(server, /\["\/game", "\/index\.html"\]/);
  assert.match(server, /\["\/game\/result", "\/platform\.html"\]/);
  assert.match(server, /\["\/account", "\/platform\.html"\]/);
  assert.match(server, /\["\/room-game", "\/game"\]/);
  assert.match(server, /location: `\$\{canonical\}\$\{url\.search\}`/);

  assert.deepEqual(vercel.redirects.find((entry) => entry.source === "/room-game"), {
    source: "/room-game", destination: "/game", permanent: true
  });
  assert.deepEqual(vercel.redirects.find((entry) => entry.source === "/"), {
    source: "/", destination: "/home", permanent: false
  });
  assert.equal(vercel.rewrites.some((entry) => entry.source === "/room-game"), false);
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/")?.destination, undefined);
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/home")?.destination, "/home.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/game")?.destination, "/index.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/game/result")?.destination, "/platform.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/account")?.destination, "/platform.html");

  assert.match(deploy, /await cp\(webPublic, vercelOutput, \{ recursive: true \}\)/);
  assert.doesNotMatch(deploy, /cp\([^\n]*home\.html[^\n]*index\.html/);
  assert.match(proxy, /text\/event-stream/);
  assert.match(proxy, /for await \(const chunk of upstream\.body\)/);
  assert.doesNotMatch(proxy, /await upstream\.arrayBuffer\(\)[\s\S]*text\/event-stream/);
});
