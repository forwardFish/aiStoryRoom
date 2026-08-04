import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStoryWorkspace } from "./workspace.js";
import { runtimeRoot } from "./paths.js";
import { OpenAICompatibleProvider } from "./provider.js";
import { DurableEventMirror, HttpEventMirror } from "./mirror.js";
import { StorykeeperDrain } from "./storykeeper.js";
import { OpenNovelRuntime } from "./runtime.js";
import { scenePipelineModulesFromEnv } from "./scene-pipeline.js";
import { recoverRuntimeRuns } from "./recovery.js";
import { sangtianDecisionAdapter } from "./sangtian-decisions.js";
import { sangtianWorkspaceSeeder } from "./sangtian-workspace.js";
import type { TurnEvent, TurnResult } from "./types.js";
import { isRuntimeActionError } from "./runtime-errors.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(process.env.OPENOVEL_PROJECT_ROOT || path.join(currentDir, "..", "..", ".."));
const playtestDir = path.resolve(projectRoot, "apps", "openovel-runtime", "public");
const upstreamCommit = "1b4404e85d03d1e41e5d745e303372333b29c610";
const provider = OpenAICompatibleProvider.fromEnv();
const workspace = new FileStoryWorkspace(
  runtimeRoot(),
  projectRoot,
  upstreamCommit,
  sangtianWorkspaceSeeder,
);
const mirrorTransport = HttpEventMirror.fromEnv();
const mirror = mirrorTransport.configured
  ? new DurableEventMirror(workspace, mirrorTransport)
  : mirrorTransport;
const storykeeper = new StorykeeperDrain(workspace, provider);
const runtime = new OpenNovelRuntime(
  workspace,
  provider,
  storykeeper,
  mirror,
  {
    decisionMode: "AUTHORED_WHEN_AVAILABLE",
    authoredDecisionAdapter: sangtianDecisionAdapter,
    scenePipelineModules: scenePipelineModulesFromEnv(provider),
  },
);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://runtime.local");
    if (request.method === "GET" && playtestEnabled() && isPlaytestPath(url.pathname)) {
      return servePlaytest(response, url.pathname);
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, healthPayload());
    }
    if (!authorized(request)) return json(response, 401, { error: "UNAUTHORIZED" });
    if (request.method === "GET" && url.pathname === "/internal/openovel/health") {
      return json(response, 200, healthPayload());
    }
    if (request.method === "GET" && url.pathname === "/internal/openovel/providers") {
      return json(response, 200, provider.describe());
    }
    if (request.method === "POST" && url.pathname === "/internal/openovel/runs") {
      const body = await bodyJson(request);
      const run = await runtime.createRun({
        runId: String(body.runId || ""),
        worldId: String(body.worldId || ""),
        roleId: String(body.roleId || ""),
        storyPackageVersion: String(body.storyPackageVersion || "current"),
        openingVersion: String(body.openingVersion || "current"),
      });
      return json(response, 201, run);
    }
    const runMatch = url.pathname.match(/^\/internal\/openovel\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      return json(response, 200, await runtime.getRun(decodeURIComponent(runMatch[1])));
    }
    const jobsMatch = url.pathname.match(/^\/internal\/openovel\/runs\/([^/]+)\/jobs$/);
    if (request.method === "GET" && jobsMatch) {
      const run = await runtime.getRun(decodeURIComponent(jobsMatch[1]));
      return json(response, 200, run.jobs);
    }
    const optionsRecoveryMatch = url.pathname.match(
      /^\/internal\/openovel\/runs\/([^/]+)\/options\/recover$/,
    );
    if (request.method === "POST" && optionsRecoveryMatch) {
      const recovered = await runtime.recoverOptions(
        decodeURIComponent(optionsRecoveryMatch[1]),
      );
      return json(response, 200, {
        turnId: recovered.turnId,
        options: recovered.options.map(({ effect: _hidden, ...visible }) => visible),
        framing: recovered.framing,
        tension: recovered.tension,
        storyComplete: recovered.storyComplete,
      });
    }
    const actionMatch = url.pathname.match(/^\/internal\/openovel\/runs\/([^/]+)\/actions$/);
    if (request.method === "POST" && actionMatch) {
      const runId = decodeURIComponent(actionMatch[1]);
      const body = await bodyJson(request);
      if (acceptsSse(request)) {
        prepareSse(response);
        try {
          await runtime.processAction({
            runId,
            action: String(body.action || ""),
            submissionId: String(body.submissionId || ""),
            expectedStateRevision: optionalRevision(body.expectedStateRevision),
            boundOption: normalizeBoundOption(body.boundOption),
            onEvent: (event) => writeSse(response, sanitizeEvent(event)),
          });
        } catch (error) {
          writeSse(response, {
            type: "runtime.warning",
            data: {
              code: "FOREGROUND_FAILED",
              message: String((error as Error).message || error),
              severity: "HIGH",
              blocksPlayer: false,
            },
          });
        } finally {
          response.end();
        }
        return;
      }
      const result = await runtime.processAction({
        runId,
        action: String(body.action || ""),
        submissionId: String(body.submissionId || ""),
        expectedStateRevision: optionalRevision(body.expectedStateRevision),
        boundOption: normalizeBoundOption(body.boundOption),
      });
      return json(response, 200, sanitizeTurn(result));
    }
    return json(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    const message = String((error as Error).message || error);
    const status = isRuntimeActionError(error)
      ? error.status
      : message === "RUN_FOREGROUND_BUSY"
        ? 409
        : /not found/i.test(message)
          ? 404
          : 400;
    return json(response, status, { error: message });
  }
});

const port = Number(process.env.PORT || process.env.OPENOVEL_RUNTIME_PORT || 3110);
const host = String(
  process.env.OPENOVEL_RUNTIME_HOST
  || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
).trim();
const recovery = await recoverRuntimeRuns(workspace, storykeeper);
if (mirror instanceof DurableEventMirror) {
  for (const runId of recovery.recovered) void mirror.kick(runId);
}
server.listen(port, host, () => {
  process.stdout.write(
    `OpenNovel runtime listening on http://${host}:${port}; recovered=${recovery.recovered.length}; interrupted=${recovery.interrupted.length}; failures=${recovery.failures.length}\n`,
  );
});

function healthPayload() {
  return {
    ok: true,
    runtimeMode: "OPENOVEL_V1",
    provider: provider.describe(),
    upstreamCommit,
  };
}

function authorized(request: IncomingMessage) {
  const expected = String(process.env.OPENOVEL_INTERNAL_TOKEN || "").trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.authorization === `Bearer ${expected}`;
}

function playtestEnabled() {
  return process.env.NODE_ENV !== "production"
    || String(process.env.OPENOVEL_PLAYTEST_ENABLED || "").trim() === "1";
}

function isPlaytestPath(pathname: string) {
  return pathname === "/"
    || pathname === "/play"
    || pathname === "/play/"
    || pathname === "/play/app.js"
    || pathname === "/play/styles.css";
}

async function servePlaytest(response: ServerResponse, pathname: string) {
  const asset = pathname === "/play/app.js"
    ? { name: "app.js", type: "text/javascript; charset=utf-8" }
    : pathname === "/play/styles.css"
      ? { name: "styles.css", type: "text/css; charset=utf-8" }
      : { name: "index.html", type: "text/html; charset=utf-8" };
  const content = await readFile(path.join(playtestDir, asset.name));
  response.writeHead(200, {
    "content-type": asset.type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(content);
}

function acceptsSse(request: IncomingMessage) {
  return String(request.headers.accept || "").includes("text/event-stream");
}

function prepareSse(response: ServerResponse) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
}

function writeSse(response: ServerResponse, event: { type: string; data: unknown }) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function bodyJson(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1_000_000) throw new Error("REQUEST_TOO_LARGE");
  }
  return body.trim() ? JSON.parse(body) as Record<string, unknown> : {};
}

function normalizeBoundOption(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id || "").trim();
  const label = String(record.label || "").trim();
  return id && label ? { id, label } : null;
}

function optionalRevision(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error("EXPECTED_STATE_REVISION_INVALID");
  }
  return revision;
}

function sanitizeTurn(result: TurnResult) {
  const {
    causalDelta: _causalDelta,
    narrator: _narrator,
    optionsProvider: _optionsProvider,
    warnings: _warnings,
    ...visible
  } = result;
  return {
    ...visible,
    options: result.options.map(({ effect: _hidden, ...visible }) => visible),
  };
}

function sanitizeEvent(event: TurnEvent) {
  if (event.type === "options.complete") {
    return {
      ...event,
      data: {
        ...event.data,
        options: event.data.options.map(({ effect: _hidden, ...visible }) => visible),
      },
    };
  }
  if (event.type === "turn.committed") {
    return { ...event, data: sanitizeTurn(event.data) };
  }
  return event;
}

export { server, runtime };
