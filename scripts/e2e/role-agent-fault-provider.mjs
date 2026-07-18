import http from "node:http";
import { appendFile } from "node:fs/promises";

const mode = process.argv[2] || "invalid-json";
const port = Number(process.argv[3] || 3148);
const logPath = process.argv[4] || "D:/tmp/role-agent-fault-provider.ndjson";

if (!new Set(["invalid-json", "timeout"]).has(mode)) {
  throw new Error("mode must be invalid-json or timeout");
}

async function record(value) {
  await appendFile(logPath, `${JSON.stringify(value)}\n`, "utf8");
}

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  await record({
    mode,
    method: request.method,
    url: request.url,
    receivedAt: new Date().toISOString(),
    bodyBytes: Buffer.byteLength(body)
  });

  if (mode === "timeout") {
    setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    }, 10_000).unref();
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: "this is not JSON" } }] }));
});

server.listen(port, "127.0.0.1", async () => {
  await record({ mode, status: "LISTENING", port, startedAt: new Date().toISOString() });
  console.log(JSON.stringify({ status: "READY", mode, port }));
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
