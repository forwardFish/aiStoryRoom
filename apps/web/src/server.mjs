import { createReadStream, existsSync, readdirSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer, request as requestHttpUpstream, STATUS_CODES } from "node:http";
import { request as requestHttpsUpstream } from "node:https";
import { fileURLToPath } from "node:url";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), "..", "public"));
const projectRoot = normalize(join(root, "..", "..", ".."));
const uiRoot = normalize(join(projectRoot, "docs", "UI", "2"));
const webUiRoot = normalize(join(projectRoot, "docs", "UI", "web"));
const mainGameReference = normalize(join(projectRoot, "docs", "UI", "web", "主游戏.png"));
const homeReference = normalize(join(projectRoot, "docs", "UI", "web", "首页.png"));
const port = Number(process.env.PORT || 5177);
const apiPort = Number(process.env.API_PORT || 3102);
const apiProxyPrefixes = [
  "/api/health",
  "/api/v4/"
];

export const ROOM_LOBBY_SOCKET_PATH = "/api/v4/room-lobby/socket";
const ROOM_LOBBY_SOCKET_PROXY_TIMEOUT_MS = 3_000;
const ROOM_LOBBY_SOCKET_UPGRADE_RESPONSE_HEADERS = new Set([
  "cache-control",
  "connection",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "upgrade"
]);

export function resolveRoomLobbySocketTransportConfig(
  env = process.env,
  { webPort = Number(env.PORT || 5177), apiPort: configuredApiPort = Number(env.API_PORT || 3102) } = {}
) {
  const enabled = strictBoolean(env.ROOM_LOBBY_SOCKET_ENABLED, false, "ROOM_LOBBY_SOCKET_ENABLED");
  const path = String(env.ROOM_LOBBY_SOCKET_PATH || ROOM_LOBBY_SOCKET_PATH).trim();
  if (path !== ROOM_LOBBY_SOCKET_PATH) {
    throw new Error(`CONFIGURATION: ROOM_LOBBY_SOCKET_PATH must be ${ROOM_LOBBY_SOCKET_PATH}`);
  }

  const production = env.NODE_ENV === "production";
  const dedicatedOrigins = String(env.ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS || "").trim();
  const inheritedOrigins = String(env.CORS_ALLOWED_ORIGINS || "").trim();
  if (production && inheritedOrigins.split(",").map((value) => value.trim()).includes("*")) {
    throw new Error("CONFIGURATION: production CORS_ALLOWED_ORIGINS must not contain *");
  }
  const originSource = dedicatedOrigins || inheritedOrigins;
  const allowedOrigins = originSource
    ? parseOriginAllowlist(originSource, "ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS")
    : production
      ? []
      : [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`];

  if (enabled && !allowedOrigins.length) {
    throw new Error("CONFIGURATION: ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS is required when the Socket proxy is enabled");
  }
  if (dedicatedOrigins && inheritedOrigins && !inheritedOrigins.split(",").map((value) => value.trim()).includes("*")) {
    const corsOrigins = new Set(parseOriginAllowlist(inheritedOrigins, "CORS_ALLOWED_ORIGINS"));
    for (const origin of allowedOrigins) {
      if (!corsOrigins.has(origin)) {
        throw new Error("CONFIGURATION: every RoomLobby Socket Origin must also be allowed by CORS_ALLOWED_ORIGINS");
      }
    }
  }

  const configuredOrigin = String(env.MANY_WORLDS_API_ORIGIN || env.API_UPSTREAM_ORIGIN || "").trim();
  if (production && enabled && !configuredOrigin) {
    throw new Error("CONFIGURATION: MANY_WORLDS_API_ORIGIN is required for the production Socket proxy");
  }
  const upstreamOrigin = normalizeApiOrigin(
    configuredOrigin || `http://127.0.0.1:${configuredApiPort}`,
    production && enabled
  );

  return Object.freeze({
    enabled,
    path,
    allowedOrigins: Object.freeze([...new Set(allowedOrigins)]),
    upstreamOrigin,
    connectTimeoutMs: boundedInteger(
      env.ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS,
      ROOM_LOBBY_SOCKET_PROXY_TIMEOUT_MS,
      250,
      10_000,
      "ROOM_LOBBY_SOCKET_PROXY_CONNECT_TIMEOUT_MS"
    )
  });
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const pageRoutes = new Map([
  ["/", "/home.html"],
  ["/home", "/home.html"],
  ["/privacy", "/legal.html"],
  ["/terms", "/legal.html"],
  ["/refund", "/legal.html"],
  ["/role-select", "/role-select.html"],
  ["/trio", "/trio.html"],
  ["/game", "/index.html"],
  ["/credits", "/credits.html"],
  ["/credits/status", "/credits-status.html"],
  ["/credits/cancel", "/credits-status.html"],
  ["/credits/failed", "/credits-status.html"],
  ["/auth", "/platform.html"],
  ["/account", "/platform.html"],
  ["/admin/refunds", "/platform.html"],
  ["/shared/result", "/platform.html"],
  ["/reset-password", "/reset-password.html"],
  ["/join", "/platform.html"],
  ["/worlds", "/worlds.html"],
  ["/worlds/caesar", "/worlds-caesar.html"],
  ["/worlds/sangtian", "/worlds-sangtian.html"],
  ["/rooms", "/platform.html"],
  ["/rooms/fixture-caesar-waiting", "/platform.html"],
  ["/game/result", "/platform.html"]
]);

const indexableWorldPaths = new Set(["/worlds/caesar", "/worlds/sangtian"]);
const noIndexPrefixes = [
  "/account",
  "/admin",
  "/auth",
  "/game",
  "/join",
  "/reset-password",
  "/role-select",
  "/rooms",
  "/shared/result",
  "/trio",
  "/credits/status",
  "/credits/cancel",
  "/credits/failed",
  "/platform.html"
];

function shouldNoIndex(pathname) {
  if (/^\/worlds\/[^/]+$/.test(pathname) && !indexableWorldPaths.has(pathname)) return true;
  return noIndexPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function searchHeaders(pathname) {
  return shouldNoIndex(pathname)
    ? { "x-robots-tag": "noindex, nofollow, noarchive" }
    : {};
}

const pngFiles = (relativeRoot) => readdirSync(relativeRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
const picFiles = pngFiles(join(webUiRoot, "pic"));
const iconRoot = normalize(join(webUiRoot, "icon", "many-worlds-icons-clean", "png-tight"));
const iconFiles = existsSync(iconRoot) ? pngFiles(iconRoot) : [];
const assetFile = (group, key) => {
  const index = Number(key);
  if (!Number.isInteger(index) || index < 1) return null;
  if (group === "bg") {
    const backgrounds = picFiles.filter((name) => name.includes("22_46_") || name.includes("22_54_44") || name.includes("22_54_45"));
    return backgrounds[index - 1] ? join(webUiRoot, "pic", backgrounds[index - 1]) : null;
  }
  if (group === "portrait") {
    const portraits = picFiles.filter((name) => name.includes("22_49_") || name.includes("22_54_4") && !name.includes("22_54_44") && !name.includes("22_54_45"));
    return portraits[index - 1] ? join(webUiRoot, "pic", portraits[index - 1]) : null;
  }
  if (group === "icon") return iconFiles[index - 1] ? join(iconRoot, iconFiles[index - 1]) : null;
  return null;
};
function isAllowedApiProxyPath(pathname) {
  return apiProxyPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function proxyApiRequest(req, res, url, apiPortValue) {
  const upstream = requestHttpUpstream({
    hostname: "127.0.0.1",
    port: apiPortValue,
    path: `${url.pathname}${url.search}`,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${apiPortValue}`, connection: "close" }
  }, (upstreamResponse) => {
    const headers = { ...upstreamResponse.headers };
    delete headers.connection;
    res.writeHead(upstreamResponse.statusCode || 502, headers);
    upstreamResponse.pipe(res);
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ code: "LOCAL_API_PROXY_FAILED", message: error.message }));
  });
  req.pipe(upstream);
}

function handleWebRequest(req, res, apiPortValue) {
  const requestTarget = (req.url || "/").replace(/^\/{2,}/, "/");
  const url = new URL(requestTarget, `http://${req.headers.host || "localhost"}`);
  const legacyRedirects = new Map([
    ["/home", "/"],
    ["/home.html", "/"],
    ["/worlds.html", "/worlds"],
    ["/worlds-caesar.html", "/worlds/caesar"],
    ["/worlds-sangtian.html", "/worlds/sangtian"],
    ["/credits.html", "/credits"],
    ["/credits-success.html", "/credits/status"],
    ["/join.html", "/join"],
    ["/room-game", "/game"]
  ]);
  const canonical = legacyRedirects.get(url.pathname);
  if (canonical) {
    res.writeHead(302, { location: `${canonical}${url.search}` });
    res.end();
    return;
  }
  if (isAllowedApiProxyPath(url.pathname)) {
    proxyApiRequest(req, res, url, apiPortValue);
    return;
  }
  if (url.pathname === "/runtime-config.js") {
    const googleWebClientId = String(process.env.PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID || "").trim();
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    res.end(`window.__MANY_WORLDS_RUNTIME__ = { googleWebClientId: ${JSON.stringify(googleWebClientId)} };\n`);
    return;
  }
  if (url.pathname === "/reference/main-game.png" && existsSync(mainGameReference)) {
    res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
    createReadStream(mainGameReference).pipe(res);
    return;
  }
  if (url.pathname === "/reference/home.png" && existsSync(homeReference)) {
    res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
    createReadStream(homeReference).pipe(res);
    return;
  }
  if (url.pathname === "/assets/poster/invite-background.png") {
    const posterPath = join(webUiRoot, "pic", "ChatGPT Image 2026年7月14日 20_10_29.png");
    if (existsSync(posterPath)) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
      createReadStream(posterPath).pipe(res);
      return;
    }
  }
  const assetMatch = url.pathname.match(/^\/assets\/(bg|portrait|icon)\/(\d+)\.png$/);
  if (assetMatch) {
    const assetPath = assetFile(assetMatch[1], assetMatch[2]);
    if (assetPath && existsSync(assetPath)) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
      createReadStream(assetPath).pipe(res);
      return;
    }
  }
  const normalizedPathname = url.pathname.replace(/\/$/, "") || "/";
  let requested = pageRoutes.get(normalizedPathname) || url.pathname;
  if (/^\/worlds\/[^/]+$/.test(normalizedPathname) || /^\/rooms\/[^/]+$/.test(normalizedPathname)) {
    requested = pageRoutes.get(normalizedPathname) || "/platform.html";
  }
  if (requested.startsWith("/ui/2/")) {
    const uiPath = normalize(join(uiRoot, decodeURIComponent(requested.replace("/ui/2/", ""))));
    if (uiPath.startsWith(uiRoot) && existsSync(uiPath)) {
      res.writeHead(200, { "content-type": types[extname(uiPath)] || "application/octet-stream" });
      createReadStream(uiPath).pipe(res);
      return;
    }
  }
  const safePath = normalize(join(root, decodeURIComponent(requested)));
  if (!safePath.startsWith(root) || !existsSync(safePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...searchHeaders(url.pathname) });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": types[extname(safePath)] || "application/octet-stream",
    "cache-control": [".html", ".js", ".css"].includes(extname(safePath)) ? "no-cache" : "public, max-age=3600",
    ...searchHeaders(normalizedPathname)
  });
  createReadStream(safePath).pipe(res);
}

export function createWebServer({
  apiPort: apiPortValue = apiPort,
  socketConfig = resolveRoomLobbySocketTransportConfig(process.env, { webPort: port, apiPort: apiPortValue })
} = {}) {
  const webServer = createServer((req, res) => handleWebRequest(req, res, apiPortValue));
  if (socketConfig.enabled) {
    webServer.on("upgrade", (req, socket, head) => {
      proxyRoomLobbyUpgrade(req, socket, head, socketConfig);
    });
  }
  return webServer;
}

export const server = createWebServer();

if (isDirectExecution()) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`AI Story Room Web MVP: http://localhost:${port}`);
    console.log(`Role selection: http://localhost:${port}/role-select?story=sangtian`);
    console.log(`Three-player AI simulation: http://localhost:${port}/trio`);
    console.log(`Game: http://localhost:${port}/game`);
    console.log(`Default API base: http://localhost:${apiPort}/api (or the local /api proxy)`);
  });
}

function proxyRoomLobbyUpgrade(req, socket, head, config) {
  socket.pause();
  if (!config.enabled) {
    rejectUpgrade(socket, 404);
    return;
  }

  let url;
  try {
    url = new URL(req.url || "/", `http://${header(req, "host") || "localhost"}`);
  } catch {
    rejectUpgrade(socket, 400);
    return;
  }
  if (url.pathname !== config.path) {
    rejectUpgrade(socket, 404);
    return;
  }
  if (url.search || url.hash) {
    rejectUpgrade(socket, 400);
    return;
  }

  const origin = normalizeRequestOrigin(header(req, "origin"));
  const host = header(req, "host").toLowerCase();
  if (!origin || !host || new URL(origin).host.toLowerCase() !== host || !config.allowedOrigins.includes(origin)) {
    rejectUpgrade(socket, 403);
    return;
  }
  if (
    req.method !== "GET"
    || !headerTokens(req, "connection").includes("upgrade")
    || header(req, "upgrade").toLowerCase() !== "websocket"
    || header(req, "sec-websocket-version") !== "13"
    || !isWebSocketKey(header(req, "sec-websocket-key"))
    || header(req, "sec-websocket-protocol")
    || header(req, "authorization")
  ) {
    rejectUpgrade(socket, 400);
    return;
  }

  const target = new URL(config.path, config.upstreamOrigin);
  const requestUpstream = target.protocol === "https:"
    ? requestHttpsUpstream
    : requestHttpUpstream;
  const upstreamHeaders = {
    host: header(req, "host"),
    connection: "Upgrade",
    upgrade: "websocket",
    origin,
    "sec-websocket-key": header(req, "sec-websocket-key"),
    "sec-websocket-version": "13",
    ...(header(req, "sec-websocket-extensions")
      ? { "sec-websocket-extensions": header(req, "sec-websocket-extensions") }
      : {}),
    ...(header(req, "cookie") ? { cookie: header(req, "cookie") } : {}),
    ...(header(req, "user-agent") ? { "user-agent": header(req, "user-agent") } : {}),
    "x-forwarded-host": header(req, "host"),
    "x-forwarded-proto": origin.startsWith("https:") ? "https" : "http"
  };

  let upgraded = false;
  const upstream = requestUpstream({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: "GET",
    path: target.pathname,
    headers: upstreamHeaders,
    agent: false,
    timeout: config.connectTimeoutMs
  });

  upstream.once("upgrade", (response, upstreamSocket, upstreamHead) => {
    upgraded = true;
    if (socket.destroyed) {
      upstreamSocket.destroy();
      return;
    }
    socket.write(serializeUpgradeResponse(response));
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    bridgeSockets(socket, upstreamSocket);
  });
  upstream.once("response", (response) => {
    response.resume();
    const status = [400, 401, 403, 404, 429].includes(response.statusCode || 0)
      ? response.statusCode
      : 502;
    rejectUpgrade(socket, status || 502);
  });
  upstream.once("timeout", () => {
    upstream.destroy(new Error("PROXY_UPGRADE_TIMEOUT"));
  });
  upstream.once("error", () => {
    if (!upgraded) rejectUpgrade(socket, 502);
  });
  socket.once("error", () => upstream.destroy());
  socket.once("close", () => {
    if (!upgraded) upstream.destroy();
  });
  upstream.end();
}

function bridgeSockets(clientSocket, upstreamSocket) {
  let closed = false;
  const destroyBoth = () => {
    if (closed) return;
    closed = true;
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (!upstreamSocket.destroyed) upstreamSocket.destroy();
  };
  clientSocket.once("error", destroyBoth);
  upstreamSocket.once("error", destroyBoth);
  clientSocket.once("close", () => {
    if (!upstreamSocket.destroyed) upstreamSocket.destroy();
  });
  upstreamSocket.once("close", () => {
    if (!clientSocket.destroyed) clientSocket.destroy();
  });
  clientSocket.pipe(upstreamSocket);
  upstreamSocket.pipe(clientSocket);
  clientSocket.resume();
  upstreamSocket.resume();
}

function serializeUpgradeResponse(response) {
  const lines = [`HTTP/${response.httpVersion || "1.1"} ${response.statusCode || 101} ${response.statusMessage || "Switching Protocols"}`];
  const rawHeaders = Array.isArray(response.rawHeaders) ? response.rawHeaders : [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = String(rawHeaders[index]);
    if (!ROOM_LOBBY_SOCKET_UPGRADE_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    lines.push(`${name}: ${String(rawHeaders[index + 1])}`);
  }
  lines.push("", "");
  return lines.join("\r\n");
}

function rejectUpgrade(socket, statusCode) {
  if (socket.destroyed) return;
  const reason = STATUS_CODES[statusCode] || "Bad Gateway";
  try {
    socket.end([
      `HTTP/1.1 ${statusCode} ${reason}`,
      "Connection: close",
      "Cache-Control: no-store",
      "Content-Length: 0",
      "",
      ""
    ].join("\r\n"));
    const timer = setTimeout(() => {
      if (!socket.destroyed) socket.destroy();
    }, 250);
    timer.unref?.();
  } catch {
    socket.destroy();
  }
}

function header(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
}

function headerTokens(req, name) {
  return header(req, name).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function isWebSocketKey(value) {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").length === 16;
  } catch {
    return false;
  }
}

function normalizeRequestOrigin(value) {
  if (!value || value === "null") return null;
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
      || parsed.origin === "null"
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseOriginAllowlist(value, name) {
  const origins = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (origins.includes("*")) throw new Error(`CONFIGURATION: ${name} must not contain *`);
  return origins.map((origin) => {
    const normalized = normalizeRequestOrigin(origin);
    if (!normalized) throw new Error(`CONFIGURATION: ${name} contains an invalid Origin`);
    return normalized;
  });
}

function normalizeApiOrigin(value, requireHttps) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("CONFIGURATION: API upstream Origin is invalid");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || (requireHttps && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error("CONFIGURATION: API upstream Origin must be an origin without credentials, path, query, or fragment");
  }
  return parsed.origin;
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`CONFIGURATION: ${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function strictBoolean(value, fallback, name) {
  if (value === undefined || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`CONFIGURATION: ${name} must be true or false`);
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
