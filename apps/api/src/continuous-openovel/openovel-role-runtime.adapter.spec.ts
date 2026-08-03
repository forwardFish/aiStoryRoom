import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { MODEL_CALL_BUDGET_SCHEMA_VERSION, OPENOVEL_ROLE_RUNTIME_MODE, ROLE_NARRATIVE_INPUT_SCHEMA_VERSION, ROLE_NARRATIVE_OUTPUT_SCHEMA_VERSION, type RoleNarrativeInputV1, type RoleNarrativeOutputV1 } from "@ai-story/shared";
import { OpenNovelRoleNarrativeAdapter } from "./openovel-role-runtime.adapter";

const input: RoleNarrativeInputV1 = {
  schemaVersion: ROLE_NARRATIVE_INPUT_SCHEMA_VERSION,
  runtimeMode: OPENOVEL_ROLE_RUNTIME_MODE,
  turnKind: "RESULT",
  roomId: "room-http",
  roleId: "role-http",
  actorTurnId: "turn-http",
  turnIndex: 1,
  baseWorldSequence: 0,
  appliedWorldSequence: 1,
  contextSnapshotHash: "snapshot-http",
  renderedWorkingSet: "Only this role's context.",
  visibleWorldEvents: [],
  pendingInteractions: [],
  modelCallBudget: { schemaVersion: MODEL_CALL_BUDGET_SCHEMA_VERSION, kind: "NORMAL", hardLimit: 3, consumed: 0 },
  idempotencyKey: "result:turn-http:1"
};

const output: RoleNarrativeOutputV1 = {
  schemaVersion: ROLE_NARRATIVE_OUTPUT_SCHEMA_VERSION,
  roomId: input.roomId,
  roleId: input.roleId,
  actorTurnId: input.actorTurnId,
  narration: "The confirmed consequence reaches this role without deciding anyone else's reply.",
  options: [],
  canonHash: "canon-http",
  workspaceRevision: 1,
  appliedWorldSequence: 1,
  warnings: [],
  usage: { narratorCalls: 1, optionsCalls: 0, storykeeperCalls: 1, inputTokens: 5, outputTokens: 8 }
};

test("role runtime adapter sends the exact role endpoint, token and strict contract", async () => {
  const previous = captureEnv();
  const previousFetch = globalThis.fetch;
  process.env.OPENOVEL_RUNTIME_URL = "http://runtime.test";
  process.env.OPENOVEL_INTERNAL_TOKEN = "temporary-test-token";
  let request: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init: init || {} };
    return new Response(JSON.stringify(output), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await new OpenNovelRoleNarrativeAdapter().generateResult(input);
    assert.equal(result.canonHash, "canon-http");
    assert.equal(request!.url, "http://runtime.test/internal/openovel/rooms/room-http/roles/role-http/turns");
    const headers = request!.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer temporary-test-token");
    assert.deepEqual(JSON.parse(String(request!.init.body)), input);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
  }
});

test("role runtime adapter preserves 409 conflict semantics", async () => {
  const previous = captureEnv();
  const previousFetch = globalThis.fetch;
  process.env.OPENOVEL_INTERNAL_TOKEN = "temporary-test-token";
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: "STALE_ROLE_PROJECTION", message: "stale" }), { status: 409 })) as typeof fetch;
  try {
    await assert.rejects(
      () => new OpenNovelRoleNarrativeAdapter().generateResult(input),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 409
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
  }
});

test("role runtime adapter rejects an identity or sequence mismatch", async () => {
  const previous = captureEnv();
  const previousFetch = globalThis.fetch;
  process.env.OPENOVEL_INTERNAL_TOKEN = "temporary-test-token";
  globalThis.fetch = (async () => new Response(JSON.stringify({ ...output, roleId: "role-other" }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(() => new OpenNovelRoleNarrativeAdapter().generateResult(input), /different room, role, or turn/);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
  }
});

test("role runtime adapter aborts at the configured deadline with a stable 503 code", async () => {
  const previous = { ...captureEnv(), timeout: process.env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS };
  const previousFetch = globalThis.fetch;
  process.env.OPENOVEL_INTERNAL_TOKEN = "temporary-test-token";
  process.env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS = "10";
  globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true });
  })) as typeof fetch;
  try {
    await assert.rejects(
      () => new OpenNovelRoleNarrativeAdapter().generateResult(input),
      (error: unknown) => error instanceof HttpException
        && error.getStatus() === 503
        && (error.getResponse() as { code?: string }).code === "OPENOVEL_ROLE_RUNTIME_TIMEOUT"
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
    if (previous.timeout === undefined) delete process.env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS; else process.env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS = previous.timeout;
  }
});

test("role runtime timeout config rejects non-positive and non-integer values", async () => {
  const previous = { ...captureEnv(), timeout: process.env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS };
  process.env.OPENOVEL_INTERNAL_TOKEN = "temporary-test-token";
  try {
    for (const invalid of ["0", "-1", "1.5", "abc"]) {
      process.env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS = invalid;
      await assert.rejects(() => new OpenNovelRoleNarrativeAdapter().generateResult(input), /positive integer|between/);
    }
  } finally {
    restoreEnv(previous);
    if (previous.timeout === undefined) delete process.env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS; else process.env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS = previous.timeout;
  }
});

function captureEnv() {
  return { url: process.env.OPENOVEL_RUNTIME_URL, token: process.env.OPENOVEL_INTERNAL_TOKEN };
}

function restoreEnv(previous: ReturnType<typeof captureEnv>) {
  if (previous.url === undefined) delete process.env.OPENOVEL_RUNTIME_URL; else process.env.OPENOVEL_RUNTIME_URL = previous.url;
  if (previous.token === undefined) delete process.env.OPENOVEL_INTERNAL_TOKEN; else process.env.OPENOVEL_INTERNAL_TOKEN = previous.token;
}
