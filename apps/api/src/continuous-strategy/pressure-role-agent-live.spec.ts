import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { RoleAgentTaskService, type PressureRoleAgentInput } from "./role-agent-task.service";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.ROLE_AGENT_PROVIDER = "deepseek";
  process.env.ROLE_AGENT_MODEL = "deepseek-test";
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.ROLE_AGENT_TIMEOUT_MS = "250";
  delete process.env.FAIL_ROLE_AGENT_AT;
  delete process.env.FAIL_ROLE_AGENT_TASK_ID;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  globalThis.fetch = originalFetch;
});

function service() {
  return new RoleAgentTaskService({} as never, {} as never);
}

function input(seatId = "seat.alpha"): PressureRoleAgentInput {
  return {
    runId: "run-neutral",
    windowId: "window-neutral",
    nodeId: "N1",
    slot: "PREPARE",
    roleId: `role:${seatId}`,
    roleKey: `role.${seatId}`,
    seatId,
    currentActorId: `actor.${seatId}`,
    controlEpoch: 1,
    snapshotHash: "snapshot-neutral",
    policyVersion: "pressure:neutral:v1",
    viewerSafeContext: {
      institutionalMission: "Preserve the bounded public process.",
      knownFactIds: [`fact:${seatId}:known`],
      permissions: ["PLAN"],
      resources: { attention: 1 },
      visibleObjects: [],
      pressureLevel: 1,
      worldTimeMinutes: 0,
      deadlineEpochMs: 999999,
    },
    candidates: [
      {
        candidateId: `candidate:${seatId}:1`,
        displayText: "Inspect the visible record before acting.",
        sourceRefs: [`content:${seatId}:default`],
        normalizedIntent: { schemaVersion: "pressure_action_intent_v1", type: "INVESTIGATE" },
      },
      {
        candidateId: `candidate:${seatId}:2`,
        displayText: "Negotiate a bounded response.",
        sourceRefs: [`content:${seatId}:alternate`],
        normalizedIntent: { schemaVersion: "pressure_action_intent_v1", type: "NEGOTIATE" },
      },
    ],
    authoredDefaultCandidateId: `candidate:${seatId}:1`,
  };
}

function providerResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(body) } }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  }), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

test("pressure Role Agent accepts one legal viewer-safe provider decision", async () => {
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body || "{}"));
    assert.equal(request.messages[1].content.includes("otherSeatPrivate"), false);
    return providerResponse({
      candidateId: "candidate:seat.alpha:2",
      rationale: "The second candidate responds to the visible pressure without using hidden information.",
      visibleFactIds: ["fact:seat.alpha:known"],
    }, { "x-request-id": "provider-request-1" });
  };

  const [selection] = await service().decidePressureBatch([input()]);
  assert.equal(selection.fallback, false);
  assert.equal(selection.provider, "deepseek");
  assert.equal(selection.modelName, "deepseek-test");
  assert.equal(selection.providerRequestId, "provider-request-1");
  assert.equal(selection.candidateId, "candidate:seat.alpha:2");
  assert.equal(selection.attempts, 1);
  assert.deepEqual(selection.tokenUsage, { promptTokens: 11, completionTokens: 7, totalTokens: 18 });
});

test("pressure Role Agent uses authored default on timeout and records the true reason", async () => {
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  const [selection] = await service().decidePressureBatch([input()]);
  assert.equal(selection.fallback, true);
  assert.equal(selection.candidateId, "candidate:seat.alpha:1");
  assert.equal(selection.fallbackReason, "ROLE_AGENT_PROVIDER_TIMEOUT");
  assert.equal(selection.provider, "deepseek");
});

test("pressure Role Agent rejects effect/statePatch and unknown knowledge", async (t) => {
  await t.test("forbidden effect field", async () => {
    globalThis.fetch = async () => providerResponse({
      candidateId: "candidate:seat.alpha:2",
      rationale: "Attempt to smuggle an effect.",
      visibleFactIds: [],
      effect: { pressureDelta: -99 },
    });
    const [selection] = await service().decidePressureBatch([input()]);
    assert.equal(selection.fallback, true);
    assert.equal(selection.fallbackReason, "ROLE_AGENT_OUTPUT_FORBIDDEN_FIELD");
  });

  await t.test("unknown fact reference", async () => {
    globalThis.fetch = async () => providerResponse({
      candidateId: "candidate:seat.alpha:2",
      rationale: "Attempt to use a fact outside the viewer-safe context.",
      visibleFactIds: ["fact:seat.beta:private"],
    });
    const [selection] = await service().decidePressureBatch([input()]);
    assert.equal(selection.fallback, true);
    assert.equal(selection.fallbackReason, "ROLE_AGENT_KNOWLEDGE_BOUNDARY_VIOLATION");
  });

  await t.test("invalid JSON", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const [selection] = await service().decidePressureBatch([input()]);
    assert.equal(selection.fallback, true);
    assert.equal(selection.fallbackReason, "ROLE_AGENT_OUTPUT_INVALID_JSON");
  });
});

test("five pressure seats call the provider concurrently and remain isolated", async () => {
  const inputs = ["alpha", "beta", "gamma", "delta", "epsilon"].map((seat) => input(`seat.${seat}`));
  let inFlight = 0;
  let maxInFlight = 0;
  let started = 0;
  let release!: () => void;
  const allStarted = new Promise<void>((resolve) => { release = resolve; });

  globalThis.fetch = async (_url, init) => {
    inFlight += 1;
    started += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (started === inputs.length) release();
    await allStarted;
    const payload = JSON.parse(String(init?.body || "{}"));
    const user = JSON.parse(payload.messages[1].content);
    const seatId = String(user.seatId);
    inFlight -= 1;
    return providerResponse({
      candidateId: `candidate:${seatId}:2`,
      rationale: `Choose the legal alternate for ${seatId} using only that seat's projection.`,
      visibleFactIds: [`fact:${seatId}:known`],
    });
  };

  const results = await service().decidePressureBatch(inputs);
  assert.equal(results.length, 5);
  assert.equal(maxInFlight, 5);
  assert.equal(results.every((result) => !result.fallback), true);
  assert.deepEqual(results.map((result) => result.seatId).sort(), inputs.map((item) => item.seatId).sort());
});
