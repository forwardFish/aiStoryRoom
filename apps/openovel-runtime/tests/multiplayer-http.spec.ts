import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shared-world HTTP contract persists one action and projects its impact to another role", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openovel-shared-http-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      OPENOVEL_RUNTIME_PORT: String(port),
      OPENOVEL_RUNTIME_HOST: "127.0.0.1",
      OPENOVEL_WORKSPACE_ROOT: path.join(root, "runtime"),
      OPENOVEL_PROJECT_ROOT: path.resolve(packageRoot, "..", ".."),
      OPENOVEL_INTERNAL_TOKEN: "shared-http-test-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    if (child.exitCode === null) await once(child, "exit").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = {
    authorization: "Bearer shared-http-test-token",
    "content-type": "application/json",
  };
  await waitForHealth(baseUrl, headers, () => stderr);
  const created = await request(`${baseUrl}/internal/openovel/shared-runs`, headers, {
    method: "POST",
    body: JSON.stringify({
      runId: "http.shared.run.1",
      worldId: "sangtian",
      roleKeys: ["zhejiang_governor", "xunfu"],
    }),
  });
  assert.equal(created.stateRevision, 0);

  const action = await request(
    `${baseUrl}/internal/openovel/shared-runs/http.shared.run.1/actions`,
    headers,
    {
      method: "POST",
      body: JSON.stringify({
        roleKey: "zhejiang_governor",
        rawText: "Use the authorized capability.",
        expectedStateRevision: 0,
        idempotencyKey: "http-shared-action-0001",
        candidateId: "issue-order",
      }),
    },
  );
  assert.equal(action.kind, "ACCEPTED");
  assert.equal(action.stateRevision, 1);

  const impact = await request(
    `${baseUrl}/internal/openovel/shared-runs/http.shared.run.1/roles/xunfu/impact`,
    headers,
  );
  assert.equal(impact.crossPlayer.length, 1);
  assert.equal(impact.world.length, 1);
});

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FREE_PORT_UNAVAILABLE");
  server.close();
  await once(server, "close");
  return address.port;
}

async function waitForHealth(
  baseUrl: string,
  headers: Record<string, string>,
  stderr: () => string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/internal/openovel/health`, { headers });
      if (response.ok) return;
    } catch {
      // The child process has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`SHARED_HTTP_SERVER_NOT_READY:${stderr()}`);
}

async function request(
  url: string,
  headers: Record<string, string>,
  init: RequestInit = {},
) {
  const response = await fetch(url, { ...init, headers });
  const value = await response.json() as any;
  if (!response.ok) throw new Error(`HTTP_${response.status}:${JSON.stringify(value)}`);
  return value;
}
