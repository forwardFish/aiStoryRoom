import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../../../", import.meta.url);
const approvedPath = "/api/v4/room-lobby/socket";
let createWebServer;
let resolveConfig;

before(async () => {
  await mkdir(new URL("../../../docs/UI/web/pic/", import.meta.url), { recursive: true });
  await mkdir(new URL("../../../apps/web/public/", import.meta.url), { recursive: true });
  ({
    createWebServer,
    resolveRoomLobbySocketTransportConfig: resolveConfig,
  } = await import(`../src/server.mjs?module-f-test=${Date.now()}`));
});

test("approved Upgrade path forwards Cookie, Origin, Host and WebSocket handshake headers", async () => {
  const upstreamHits = [];
  const upstream = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  });
  upstream.on("upgrade", (req, socket) => {
    upstreamHits.push({ url: req.url, headers: { ...req.headers } });
    const accept = createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));
    setImmediate(() => socket.end());
  });
  const upstreamPort = await listen(upstream);
  const config = resolveConfig({
    NODE_ENV: "test",
    ROOM_LOBBY_SOCKET_ENABLED: "true",
    ROOM_LOBBY_SOCKET_PATH: approvedPath,
    ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS: "http://web.test",
    CORS_ALLOWED_ORIGINS: "http://web.test",
    MANY_WORLDS_API_ORIGIN: `http://127.0.0.1:${upstreamPort}`,
  });
  const web = createWebServer({ apiPort: upstreamPort, socketConfig: config });
  const webPort = await listen(web);

  try {
    const upgraded = await rawUpgrade({ port: webPort });
    assert.match(upgraded.header, /^HTTP\/1\.1 101 /);
    assert.equal(upstreamHits.length, 1);
    const hit = upstreamHits[0];
    assert.equal(hit.url, approvedPath);
    assert.equal(hit.headers.cookie, "many_worlds_session=fake-session");
    assert.equal(hit.headers.origin, "http://web.test");
    assert.equal(hit.headers.host, "web.test");
    assert.equal(hit.headers.connection.toLowerCase(), "upgrade");
    assert.equal(hit.headers.upgrade.toLowerCase(), "websocket");
    assert.equal(hit.headers["sec-websocket-version"], "13");
    assert.equal(typeof hit.headers["sec-websocket-key"], "string");
    upgraded.socket.destroy();

    const response = await fetch(`http://127.0.0.1:${webPort}/api/health?probe=module-f`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { path: "/api/health?probe=module-f", method: "GET" });
  } finally {
    await close(web);
    await close(upstream);
  }
});

test("non-approved paths, query tokens, unknown Origins and a disabled flag never reach the API", async () => {
  let upstreamUpgrades = 0;
  const upstream = createServer();
  upstream.on("upgrade", (_req, socket) => {
    upstreamUpgrades += 1;
    socket.destroy();
  });
  const upstreamPort = await listen(upstream);
  const enabled = resolveConfig({
    NODE_ENV: "test",
    ROOM_LOBBY_SOCKET_ENABLED: "true",
    ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS: "http://web.test",
    CORS_ALLOWED_ORIGINS: "http://web.test",
    MANY_WORLDS_API_ORIGIN: `http://127.0.0.1:${upstreamPort}`,
  });
  const web = createWebServer({ socketConfig: enabled });
  const webPort = await listen(web);
  try {
    assert.match((await rawUpgrade({ port: webPort, path: "/api/v4/rooms/other" })).header, /^HTTP\/1\.1 404 /);
    const query = await rawUpgrade({ port: webPort, path: `${approvedPath}?token=forbidden` });
    assert.match(query.header, /^HTTP\/1\.1 400 /);
    assert.equal(query.header.includes("forbidden"), false);
    assert.match((await rawUpgrade({ port: webPort, origin: "https://unknown.test", host: "unknown.test" })).header, /^HTTP\/1\.1 403 /);
    assert.match((await rawUpgrade({ port: webPort, origin: "null" })).header, /^HTTP\/1\.1 403 /);
    assert.equal(upstreamUpgrades, 0);
  } finally {
    await close(web);
  }

  const disabled = createWebServer({
    socketConfig: { ...enabled, enabled: false },
  });
  assert.equal(disabled.listenerCount("upgrade"), 0);
  await close(upstream);
});

test("an unavailable API fails the Upgrade safely and the Web process continues serving HTTP", async () => {
  const unavailablePort = await unusedPort();
  const config = resolveConfig({
    NODE_ENV: "test",
    ROOM_LOBBY_SOCKET_ENABLED: "true",
    ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS: "http://web.test",
    CORS_ALLOWED_ORIGINS: "http://web.test",
    MANY_WORLDS_API_ORIGIN: `http://127.0.0.1:${unavailablePort}`,
  });
  const web = createWebServer({ socketConfig: config });
  const webPort = await listen(web);
  try {
    const startedAt = Date.now();
    const failed = await rawUpgrade({ port: webPort });
    assert.match(failed.header, /^HTTP\/1\.1 502 /);
    assert.equal(Date.now() - startedAt < 1_500, true);

    const response = await fetch(`http://127.0.0.1:${webPort}/runtime-config.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /window\.__MANY_WORLDS_RUNTIME__/);
  } finally {
    await close(web);
  }
});

test("production transport configuration fails closed for wildcard Origin, missing API Origin and wrong path", () => {
  const base = {
    NODE_ENV: "production",
    ROOM_LOBBY_SOCKET_ENABLED: "true",
    ROOM_LOBBY_SOCKET_PATH: approvedPath,
    ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS: "https://ourmanyworlds.com",
    CORS_ALLOWED_ORIGINS: "https://ourmanyworlds.com",
    MANY_WORLDS_API_ORIGIN: "https://api.ourmanyworlds.com",
    ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS: "3000",
  };
  assert.throws(() => resolveConfig({ ...base, CORS_ALLOWED_ORIGINS: "*" }), /must not contain \*/);
  assert.throws(() => resolveConfig({ ...base, MANY_WORLDS_API_ORIGIN: "" }), /MANY_WORLDS_API_ORIGIN is required/);
  assert.throws(() => resolveConfig({ ...base, ROOM_LOBBY_SOCKET_PATH: "/socket" }), /must be \/api\/v4\/room-lobby\/socket/);
  assert.throws(() => resolveConfig({ ...base, MANY_WORLDS_API_ORIGIN: "http://api.example.test" }), /API upstream Origin/);
  assert.throws(() => resolveConfig({ ...base, ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS: "100" }), /integer from 250 to 10000/);
  assert.throws(() => resolveConfig({
    ...base,
    ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS: "https://www.ourmanyworlds.com",
  }), /must also be allowed by CORS_ALLOWED_ORIGINS/);
  assert.deepEqual(resolveConfig(base), {
    enabled: true,
    path: approvedPath,
    allowedOrigins: ["https://ourmanyworlds.com"],
    upstreamOrigin: "https://api.ourmanyworlds.com",
    connectTimeoutMs: 3_000,
  });
});

test("deployment env validation accepts exact configuration and rejects production wildcard or wrong path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "room-lobby-module-f-"));
  const script = new URL("../../../scripts/deploy/prepare-env-files.mjs", import.meta.url);
  const testEnv = environment("test");
  const productionEnv = environment("prd");
  await writeFile(join(root, ".env.test"), testEnv);
  await writeFile(join(root, ".env.prd"), productionEnv);

  const testCheck = runEnvCheck(script, root, "test");
  const productionCheck = runEnvCheck(script, root, "prd");
  const prepared = runEnvPrepare(script, root, "test");
  if ([testCheck, productionCheck, prepared].some((result) => skipRestrictedCli(t, result))) return;
  assert.equal(testCheck.status, 0);
  assert.equal(productionCheck.status, 0);
  assert.equal(prepared.status, 0);
  const railway = await readFile(join(root, "deploy/env/generated/test.railway.local"), "utf8");
  const vercel = await readFile(join(root, "deploy/env/generated/test.vercel.local"), "utf8");
  assert.match(railway, /^MANY_WORLDS_API_ORIGIN=https:\/\/api\.test\.ourmanyworlds\.com$/m);
  assert.match(railway, /^ROOM_LOBBY_SOCKET_ENABLED=true$/m);
  assert.match(railway, /^ROOM_LOBBY_SOCKET_PATH=\/api\/v4\/room-lobby\/socket$/m);
  assert.match(railway, /^ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS=3000$/m);
  assert.match(vercel, /^MANY_WORLDS_API_ORIGIN=https:\/\/api\.test\.ourmanyworlds\.com$/m);

  await writeFile(join(root, ".env.prd"), productionEnv.replace(
    "CORS_ALLOWED_ORIGINS=https://ourmanyworlds.com",
    "CORS_ALLOWED_ORIGINS=*",
  ));
  const wildcard = runEnvCheck(script, root, "prd");
  if (skipRestrictedCli(t, wildcard)) return;
  assert.equal(wildcard.status, 1);
  assert.match(wildcard.stderr, /PRODUCTION Origin allowlists must not contain \*/);
  assert.equal(wildcard.stderr.includes("fake-auth-secret"), false);

  await writeFile(join(root, ".env.prd"), productionEnv.replace(
    `ROOM_LOBBY_SOCKET_PATH=${approvedPath}`,
    "ROOM_LOBBY_SOCKET_PATH=/wrong",
  ));
  const wrongPath = runEnvCheck(script, root, "prd");
  if (skipRestrictedCli(t, wrongPath)) return;
  assert.equal(wrongPath.status, 1);
  assert.match(wrongPath.stderr, /ROOM_LOBBY_SOCKET_PATH must be \/api\/v4\/room-lobby\/socket/);
});

test("deployment CLI runner treats only EPERM spawn failure as TESTS_NOT_RUN", () => {
  const restricted = classifyCliResult({
    status: null,
    error: Object.assign(new Error("restricted"), { code: "EPERM" }),
    stdout: null,
    stderr: null,
  });
  assert.equal(restricted.skipped, true);
  assert.equal(restricted.errorCode, "EPERM");

  const missing = classifyCliResult({
    status: null,
    error: Object.assign(new Error("missing"), { code: "ENOENT" }),
    stdout: null,
    stderr: null,
  });
  assert.equal(missing.skipped, false);
  assert.equal(missing.errorCode, "ENOENT");

  const failed = classifyCliResult({ status: 1, stdout: "", stderr: "failed" });
  assert.equal(failed.skipped, false);
  assert.equal(failed.errorCode, null);
  assert.equal(failed.status, 1);
});

function environment(target) {
  const production = target === "prd";
  return [
    `MANY_WORLDS_API_ORIGIN=https://api.${production ? "ourmanyworlds.com" : "test.ourmanyworlds.com"}`,
    `NODE_ENV=${production ? "production" : "test"}`,
    "DATABASE_URL=TEST_ONLY_DATABASE_URL_VALUE",
    "MVP_STORY_STORAGE=prisma",
    `PUBLIC_WEB_URL=https://${production ? "ourmanyworlds.com" : "test.ourmanyworlds.com"}`,
    `PAYMENT_RETURN_ORIGIN=https://${production ? "ourmanyworlds.com" : "test.ourmanyworlds.com"}`,
    `REFERRAL_BASE_URL=https://${production ? "ourmanyworlds.com" : "test.ourmanyworlds.com"}/join`,
    `CORS_ALLOWED_ORIGINS=https://${production ? "ourmanyworlds.com" : "test.ourmanyworlds.com"}`,
    "ROOM_LOBBY_SOCKET_ENABLED=true",
    `ROOM_LOBBY_SOCKET_PATH=${approvedPath}`,
    `ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS=https://${production ? "ourmanyworlds.com" : "test.ourmanyworlds.com"}`,
    "ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS=3000",
    "AUTH_TOKEN_SECRET=fake-auth-secret-at-least-sixty-four-bytes-000000000000000000000000",
    "AUTH_COOKIE_SECURE=true",
    "GOOGLE_AUTH_ENABLED=false",
    "EMAIL_PROVIDER=resend",
    "EMAIL_REPLY_TO=support@example.test",
    `CREEM_MODE=${production ? "live" : "test"}`,
    "CREEM_MOCK_MODE=false",
    "CREEM_API_KEY=fake-creem-api-key",
    "CREEM_WEBHOOK_SECRET=fake-creem-webhook-secret",
    "CREEM_PRODUCT_300_ID=fake-product-300",
    "CREEM_PRODUCT_650_ID=fake-product-650",
    "DEEPSEEK_API_KEY=fake-deepseek-key",
    "STORY_WORKER_EMBEDDED=false",
    "RESEND_API_KEY=fake-resend-key",
    "EMAIL_FROM=noreply@example.test",
    ...(production ? ["ADMIN_EMAILS=admin@example.test"] : ["ALLOW_TEST_CREDIT_GRANT=true"]),
    "",
  ].join("\n");
}

function runEnvCheck(script, cwd, target) {
  const result = spawnSync(process.execPath, [fileURLToPath(script), target, "--check"], {
    cwd,
    encoding: "utf8",
  });
  return classifyCliResult(result);
}

function runEnvPrepare(script, cwd, target) {
  const result = spawnSync(process.execPath, [fileURLToPath(script), target], {
    cwd,
    encoding: "utf8",
  });
  return classifyCliResult(result);
}

function classifyCliResult(result) {
  const errorCode = result.error?.code ?? null;
  return {
    status: result.status,
    errorCode,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    skipped: errorCode === "EPERM",
  };
}

function skipRestrictedCli(t, result) {
  if (result.skipped) {
    t.skip("TESTS_NOT_RUN: this runner forbids spawning the deployment CLI (EPERM)");
    return true;
  }
  assert.equal(result.errorCode, null, `deployment CLI failed to spawn: ${result.errorCode}`);
  return false;
}

async function listen(server) {
  const sockets = new Set();
  server.__moduleFSockets = sockets;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  for (const socket of server.__moduleFSockets || []) socket.destroy();
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function unusedPort() {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function rawUpgrade({
  port,
  path = approvedPath,
  host = "web.test",
  origin = "http://web.test",
  cookie = "many_worlds_session=fake-session",
} = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const chunks = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Upgrade response timed out"));
    }, 2_000);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        `Origin: ${origin}`,
        `Cookie: ${cookie}`,
        `Sec-WebSocket-Key: ${Buffer.alloc(16, 7).toString("base64")}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      const payload = Buffer.concat(chunks);
      const boundary = payload.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      clearTimeout(timer);
      socket.removeAllListeners("data");
      resolve({ socket, header: payload.subarray(0, boundary + 4).toString("utf8") });
    });
  });
}
