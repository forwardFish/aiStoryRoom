import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), "..", "public"));
const port = Number(process.env.PORT || 5177);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(join(root, requested));
  if (!safePath.startsWith(root) || !existsSync(safePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(safePath)] || "application/octet-stream" });
  createReadStream(safePath).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(`AI Story Room Web validation cabin: http://localhost:${port}`);
  console.log("Default API base: http://localhost:3001/api (run `pnpm dev:preview-api` first)");
});
