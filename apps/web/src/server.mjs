import { createReadStream, existsSync, readdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer, request as requestUpstream } from "node:http";
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

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
  ["/room-game", "/room-game.html"],
  ["/credits", "/credits.html"],
  ["/credits/status", "/credits-status.html"],
  ["/credits/cancel", "/credits-status.html"],
  ["/credits/failed", "/credits-status.html"],
  ["/auth", "/platform.html"],
  ["/join", "/platform.html"],
  ["/worlds/sangtian", "/platform.html"],
  ["/worlds/caesar", "/platform.html"],
  ["/rooms", "/platform.html"],
  ["/rooms/fixture-caesar-waiting", "/platform.html"],
  ["/game/result", "/platform.html"]
]);

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
const gameAssetRoot = normalize(join(webUiRoot, "game", "嘉靖财政局"));
const gameAssetFiles = existsSync(gameAssetRoot) ? pngFiles(gameAssetRoot) : [];
const gameAssetByKey = new Map([
  ["background", gameAssetFiles[0]], ["governor", gameAssetFiles[1]], ["many-worlds", gameAssetFiles[2]],
  ["palace", gameAssetFiles[3]], ["treasury", gameAssetFiles[4]], ["heart", gameAssetFiles[5]],
  ["grain", gameAssetFiles[6]], ["sprout", gameAssetFiles[7]], ["crown", gameAssetFiles[8]],
  ["minister", gameAssetFiles[9]], ["magistrate", gameAssetFiles[10]], ["clerk", gameAssetFiles[11]],
  ["merchant", gameAssetFiles[12]], ["spy", gameAssetFiles[13]], ["network", gameAssetFiles[14]],
  ["rank", gameAssetFiles[15]], ["shield", gameAssetFiles[16]], ["eye", gameAssetFiles[17]]
]);

function isAllowedApiProxyPath(pathname) {
  return apiProxyPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function proxyApiRequest(req, res, url) {
  const upstream = requestUpstream({
    hostname: "127.0.0.1",
    port: apiPort,
    path: `${url.pathname}${url.search}`,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${apiPort}`, connection: "close" }
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

export const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const legacyRedirects = new Map([
    ["/home", "/"],
    ["/credits.html", "/credits"],
    ["/credits-success.html", "/credits/status"],
    ["/join.html", "/join"]
  ]);
  const canonical = legacyRedirects.get(url.pathname);
  if (canonical) {
    res.writeHead(302, { location: `${canonical}${url.search}` });
    res.end();
    return;
  }
  if (isAllowedApiProxyPath(url.pathname)) {
    proxyApiRequest(req, res, url);
    return;
  }
  const gameAssetMatch = url.pathname.match(/^\/assets\/game\/sangtian\/([a-z-]+)\.png$/);
  if (gameAssetMatch) {
    const assetName = gameAssetByKey.get(gameAssetMatch[1]);
    const assetPath = assetName ? join(gameAssetRoot, assetName) : null;
    if (assetPath && existsSync(assetPath)) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
      createReadStream(assetPath).pipe(res);
      return;
    }
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
  if (/^\/worlds\/[^/]+$/.test(normalizedPathname) || /^\/rooms\/[^/]+$/.test(normalizedPathname) || normalizedPathname === "/game/result") {
    requested = "/platform.html";
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
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": types[extname(safePath)] || "application/octet-stream",
    "cache-control": [".html", ".js", ".css"].includes(extname(safePath)) ? "no-cache" : "public, max-age=3600"
  });
  createReadStream(safePath).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(`AI Story Room Web MVP: http://localhost:${port}`);
  console.log(`Role selection: http://localhost:${port}/role-select?story=sangtian`);
  console.log(`Three-player AI simulation: http://localhost:${port}/trio`);
  console.log(`Game: http://localhost:${port}/game`);
  console.log(`Default API base: http://localhost:${apiPort}/api (or the local /api proxy)`);
});
