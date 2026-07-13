import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer, request as requestUpstream } from "node:http";
import { fileURLToPath } from "node:url";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), "..", "public"));
const projectRoot = normalize(join(root, "..", "..", ".."));
const uiRoot = normalize(join(projectRoot, "docs", "UI", "2"));
const port = Number(process.env.PORT || 5177);
const apiPort = Number(process.env.API_PORT || 3102);
const apiProxyPrefixes = [
  "/api/health",
  "/api/v4/auth/",
  "/api/v4/credits/",
  "/api/v4/referrals/",
  "/api/v4/billing/",
  "/api/v4/webhooks/creem"
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
  ["/role-select", "/role-select.html"],
  ["/game", "/index.html"]
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
  if (isAllowedApiProxyPath(url.pathname)) {
    proxyApiRequest(req, res, url);
    return;
  }
  const requested = pageRoutes.get(url.pathname.replace(/\/$/, "") || "/") || url.pathname;
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
    "cache-control": extname(safePath) === ".html" ? "no-cache" : "public, max-age=3600"
  });
  createReadStream(safePath).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(`AI Story Room Web MVP: http://localhost:${port}`);
  console.log(`Role selection: http://localhost:${port}/role-select?story=sangtian`);
  console.log(`Game: http://localhost:${port}/game`);
  console.log("Default API base: http://localhost:3001/api (run `pnpm dev:api` first)");
});
