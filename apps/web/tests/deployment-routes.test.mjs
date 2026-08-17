import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local and Vercel routes keep canonical marketing pages, app pages and legacy redirects distinct", async () => {
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
  assert.match(server, /\["\/worlds\/caesar", "\/worlds-caesar\.html"\]/);
  assert.match(server, /\["\/worlds\/sangtian", "\/worlds-sangtian\.html"\]/);
  assert.match(server, /\["\/room-game", "\/game"\]/);
  assert.match(server, /location: `\$\{canonical\}\$\{url\.search\}`/);
  assert.match(server, /x-robots-tag/);

  assert.deepEqual(vercel.redirects.find((entry) => entry.source === "/home"), {
    source: "/home", destination: "/", permanent: true
  });
  assert.deepEqual(vercel.redirects.find((entry) => entry.source === "/home.html"), {
    source: "/home.html", destination: "/", permanent: true
  });
  assert.deepEqual(vercel.redirects.find((entry) => entry.source === "/room-game"), {
    source: "/room-game", destination: "/game", permanent: true
  });
  assert.equal(vercel.redirects.some((entry) => entry.source === "/"), false);
  assert.equal(vercel.rewrites.some((entry) => entry.source === "/room-game"), false);
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/")?.destination, "/home.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/home")?.destination, undefined);
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/game")?.destination, "/index.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/game/result")?.destination, "/platform.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/account")?.destination, "/platform.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/worlds/caesar")?.destination, "/worlds-caesar.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/worlds/sangtian")?.destination, "/worlds-sangtian.html");
  assert.ok(vercel.rewrites.findIndex((entry) => entry.source === "/worlds/caesar") < vercel.rewrites.findIndex((entry) => entry.source === "/worlds/:path*"));
  assert.ok(vercel.rewrites.findIndex((entry) => entry.source === "/worlds/sangtian") < vercel.rewrites.findIndex((entry) => entry.source === "/worlds/:path*"));
  assert.equal(
    vercel.headers.find((entry) => entry.source === "/game")?.headers?.find((header) => header.key === "X-Robots-Tag")?.value,
    "noindex, nofollow, noarchive"
  );

  assert.match(deploy, /await cp\(webPublic, vercelOutput, \{ recursive: true \}\)/);
  assert.doesNotMatch(deploy, /cp\([^\n]*home\.html[^\n]*index\.html/);
  assert.match(proxy, /text\/event-stream/);
  assert.match(proxy, /for await \(const chunk of upstream\.body\)/);
  assert.doesNotMatch(proxy, /await upstream\.arrayBuffer\(\)[\s\S]*text\/event-stream/);
});


test("RoomLobby Upgrade handling is feature-gated and restricted to the approved path", async () => {
  const server = await readFile(new URL("../src/server.mjs", import.meta.url), "utf8");

  assert.match(server, /ROOM_LOBBY_SOCKET_PATH = "\/api\/v4\/room-lobby\/socket"/);
  assert.match(server, /ROOM_LOBBY_SOCKET_ENABLED/);
  assert.match(server, /ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS/);
  assert.match(server, /ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS/);
  assert.match(server, /if \(socketConfig\.enabled\) \{/);
  assert.match(server, /webServer\.on\("upgrade"/);
  assert.match(server, /url\.pathname !== config\.path/);
  assert.match(server, /url\.search \|\| url\.hash/);
  assert.match(server, /cookie: header\(req, "cookie"\)/);
  assert.match(server, /origin,/);
  assert.match(server, /"sec-websocket-key"/);
  assert.match(server, /rejectUpgrade\(socket, 502\)/);
  assert.match(server, /proxyApiRequest\(req, res, url, apiPortValue\)/);
});
