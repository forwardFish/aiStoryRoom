import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { B0WindowClient } from "../public/b0-window/b0-window-client.js";
import {
  applyB0WindowProjection,
  b0CanConfirm,
  b0CanEdit,
  b0CanReady,
  b0WindowRemainingMs,
  createB0WindowState,
  normalizeB0WindowProjection,
} from "../public/b0-window/b0-window-state.js";
import { renderB0WindowResultsV1, renderB0WindowStatusV1 } from "../public/b0-window/b0-window-view.js";
import { createManeuverV1Controller } from "../public/maneuver-v1/maneuver-v1-controller.js";

function maneuverProjection() {
  return {
    schemaVersion: "maneuver_projection_v1",
    maxPerTurn: 2,
    remaining: 2,
    windowState: "OPEN",
    stateRevision: 7,
    turnRevision: 3,
    contacts: [{ id: "actor.b", label: "Counterpart" }],
    traces: [],
    leverageAssets: [],
    inProgress: [],
    privateEvidence: [],
  };
}

function plan(status = "DRAFT", revision = 1) {
  return {
    status,
    revision,
    visibility: "PRIVATE",
    presentation: {
      title: "Ask for bounded support",
      description: "Send one private request.",
      visibleEffect: "The request enters the shared settlement.",
      visibleRisk: "The counterpart may refuse.",
      confirmLabel: "Confirm this plan",
      predicate: "must-not-render",
    },
  };
}

function windowProjection({
  status = "OPEN",
  planValue = null,
  ready = false,
  readyRevision = 1,
  readyCount = 0,
  results = [],
  narrative = { status: "NOT_REQUESTED", content: null, updatedAt: null },
  serverNow = "2026-08-07T00:02:00.000Z",
} = {}) {
  return {
    schemaVersion: "b0-player-window-projection-v1",
    serverNow,
    window: {
      id: "window.one",
      ordinal: 1,
      situationId: "A decision before the meeting",
      status,
      openedAt: "2026-08-07T00:00:00.000Z",
      locksAt: status === "OPEN" ? "2026-08-07T00:05:00.000Z" : null,
      lockedAt: status === "OPEN" ? null : "2026-08-07T00:05:00.000Z",
      committedAt: ["COMMITTED", "PUBLISHING", "COMPLETED"].includes(status) ? "2026-08-07T00:05:05.000Z" : null,
      completedAt: status === "COMPLETED" ? "2026-08-07T00:05:10.000Z" : null,
      lockReason: status === "OPEN" ? null : "ALL_READY",
      rulesetVersion: "b0-rules-v1",
      inputHash: "must-not-render",
    },
    actor: { ready, readyRevision, userId: "must-not-render" },
    readyCount,
    expectedCount: 3,
    plan: planValue,
    settlement: { status: status === "OPEN" ? "NOT_STARTED" : status, resolutionHash: "must-not-render" },
    structuredResults: results,
    narrative,
    audience: { recipientActorIds: ["actor.a", "actor.secret"] },
  };
}

function result(overrides = {}) {
  return {
    resultId: "result.cross",
    resultKind: "CROSS_PLAYER_IMPACT",
    visibility: "TARGETED",
    summary: "Another committed plan reduced your access.",
    outcomeStatus: "PARTIAL_SUCCESS",
    changes: [{ kind: "RELATION", operation: "INCREMENT", numericDelta: -1, entityId: "secret" }],
    reasons: [{ kind: "OTHER_PLAN", summary: "Another plan created a durable change.", originActorId: "actor.secret" }],
    originActorIds: ["actor.secret"],
    targetActorIds: ["actor.a"],
    ...overrides,
  };
}

test("C7 browser state keeps only the player-safe B0 projection", () => {
  const normalized = normalizeB0WindowProjection(windowProjection({
    planValue: plan("CONFIRMED"),
    results: [result()],
    narrative: { status: "PENDING", content: null, updatedAt: null, prompt: "secret" },
  }));
  const json = JSON.stringify(normalized);
  assert.equal(normalized.plan.status, "CONFIRMED");
  assert.equal(normalized.structuredResults.length, 1);
  assert.doesNotMatch(json, /inputHash|resolutionHash|recipientActorIds|originActorIds|targetActorIds|entityId|actor\.secret|predicate|userId|prompt/u);
});

test("C7 countdown uses server time rather than the browser clock", () => {
  const state = createB0WindowState();
  applyB0WindowProjection(state, windowProjection({ serverNow: "2026-08-07T00:02:00.000Z" }), Date.parse("2026-08-07T10:00:00.000Z"));
  assert.equal(b0WindowRemainingMs(state, Date.parse("2026-08-07T10:01:00.000Z")), 120_000);
});

test("C7 edit, confirm and ready states are reconstructed from the server", () => {
  const state = createB0WindowState();
  applyB0WindowProjection(state, windowProjection({ planValue: plan("DRAFT") }), Date.parse("2026-08-07T00:02:00.000Z"));
  assert.equal(b0CanEdit(state), true);
  assert.equal(b0CanConfirm(state), true);
  assert.equal(b0CanReady(state), false);
  applyB0WindowProjection(state, windowProjection({ planValue: plan("CONFIRMED"), ready: false }), Date.parse("2026-08-07T00:02:00.000Z"));
  assert.equal(b0CanReady(state), true);
  applyB0WindowProjection(state, windowProjection({ planValue: plan("CONFIRMED"), ready: true }), Date.parse("2026-08-07T00:02:00.000Z"));
  assert.equal(b0CanEdit(state), false);
  assert.equal(b0CanReady(state), false);
});

test("C7 status UI shows only the ready count and never identifies who is pending", () => {
  const state = createB0WindowState();
  applyB0WindowProjection(state, windowProjection({ readyCount: 2, planValue: plan("CONFIRMED") }), Date.parse("2026-08-07T00:02:00.000Z"));
  const html = renderB0WindowStatusV1(state, "en", Date.parse("2026-08-07T00:02:30.000Z"));
  assert.match(html, /2 \/ 3/);
  assert.match(html, /02:30/);
  assert.match(html, /I am ready/);
  assert.doesNotMatch(html, /actor\.a|actor\.b|actor\.secret|recipient|audience|hash/i);
});

test("C7 structured results precede Narrative and Narrative failure does not hide the result", () => {
  const state = createB0WindowState();
  applyB0WindowProjection(state, windowProjection({
    status: "COMMITTED",
    planValue: plan("LOCKED"),
    ready: true,
    readyCount: 3,
    results: [result()],
    narrative: { status: "FAILED_RETRYABLE", content: null, updatedAt: "2026-08-07T00:05:06.000Z" },
  }), Date.parse("2026-08-07T00:05:06.000Z"));
  const html = renderB0WindowResultsV1(state, "en");
  assert.match(html, /Another committed plan reduced your access/);
  assert.match(html, /Narrative is temporarily unavailable/);
  assert.match(html, /authoritative result and next window are unaffected/);
  assert.doesNotMatch(html, /actor\.secret|originActorId|targetActorId|entityId/i);
});

test("C7 HTTP client uses explicit B0 preview, confirm, ready and unready routes", async () => {
  const calls = [];
  const client = new B0WindowClient({
    runId: "run / one",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  await client.projection();
  await client.preview({ draft: { kind: "CONTACT" }, expectedStateRevision: 7, expectedRevision: 0, clientRequestId: "draft:b0:one" });
  await client.confirm({ expectedRevision: 1 });
  await client.ready({ expectedReadyRevision: 2 });
  await client.unready({ expectedReadyRevision: 3 });
  assert.deepEqual(calls.map(({ url, init }) => [init.method, url]), [
    ["GET", "/api/v4/rooms/run%20%2F%20one/b0/window"],
    ["POST", "/api/v4/rooms/run%20%2F%20one/b0/window/preview"],
    ["POST", "/api/v4/rooms/run%20%2F%20one/b0/window/confirm"],
    ["POST", "/api/v4/rooms/run%20%2F%20one/b0/window/ready"],
    ["DELETE", "/api/v4/rooms/run%20%2F%20one/b0/window/ready"],
  ]);
  assert.equal(JSON.parse(calls[1].init.body).expectedRevision, 0);
  assert.equal(JSON.parse(calls[3].init.body).expectedReadyRevision, 2);
});

test("C7 real game controller previews and confirms through B0 without invoking legacy immediate commit", async () => {
  const dom = new JSDOM(`<!doctype html><html lang="en"><head></head><body><main id="game">
    <aside class="causal-left"></aside>
    <section class="causal-center"><div class="decision-zone" data-testid="decision-zone">Main decision</div></section>
    <aside class="causal-right"><section data-testid="maneuver-panel">Legacy maneuver panel</section></aside>
  </main></body></html>`, { url: "https://example.test/game?runId=run.one" });
  const win = dom.window;
  win.setInterval = () => 1;
  win.clearInterval = () => undefined;
  const calls = [];
  let b0 = windowProjection();
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/maneuvers/projection")) return response(maneuverProjection());
    if (url.endsWith("/b0/window") && init.method === "GET") return response(b0);
    if (url.endsWith("/b0/window/preview")) {
      b0 = windowProjection({ planValue: plan("DRAFT", 1), readyRevision: 1 });
      return response({
        decision: "READY",
        previewToken: "signed.preview.token",
        expiresAt: "2026-08-07T00:05:00.000Z",
        presentation: plan("DRAFT").presentation,
        remaining: 2,
        maxPerTurn: 2,
        window: b0,
      });
    }
    if (url.endsWith("/b0/window/confirm")) {
      b0 = windowProjection({ planValue: plan("CONFIRMED", 1), readyRevision: 2 });
      return response(b0);
    }
    if (url.endsWith("/b0/window/ready") && init.method === "POST") {
      b0 = windowProjection({ status: "LOCKED", planValue: plan("LOCKED", 1), ready: true, readyRevision: 3, readyCount: 3 });
      return response(b0);
    }
    if (url.endsWith("/maneuvers/preview")) throw new Error("legacy preview must not run while B0 is active");
    if (url.endsWith("/maneuvers/commit")) throw new Error("legacy immediate commit must not run while B0 is active");
    return response({ code: "NOT_FOUND" }, 404);
  };
  const controller = createManeuverV1Controller({
    root: win.document.querySelector("#game"),
    window: win,
    runId: "run.one",
    fetchImpl,
  });
  await controller.boot();
  assert.deepEqual(calls.slice(0, 2).map(({ url }) => url.split("?")[0]), [
    "/api/v4/rooms/run.one/b0/window",
    "/api/v4/rooms/run.one/maneuvers/projection",
  ]);
  const textarea = win.document.querySelector('[data-mv1-for="CONTACT"][data-mv1-field="rawText"]');
  textarea.value = "Ask for bounded support.";
  textarea.dispatchEvent(new win.Event("input", { bubbles: true }));
  win.document.querySelector("[data-mv1-preview]").click();
  await settled();
  assert.ok(win.document.querySelector("[data-maneuver-v1-preview]"));
  win.document.querySelector("[data-mv1-confirm]").click();
  await settled();
  assert.match(win.document.querySelector("[data-b0-window-status]").textContent, /Plan confirmed/);
  win.document.querySelector("[data-b0-ready]").click();
  await settled();
  assert.match(win.document.querySelector("[data-b0-window-status]").textContent, /All plans are locked/);
  assert.equal(calls.some(({ url }) => url.endsWith("/maneuvers/commit")), false);
  assert.equal(calls.filter(({ url }) => url.endsWith("/b0/window/preview")).length, 1);
  assert.equal(calls.filter(({ url }) => url.endsWith("/b0/window/confirm")).length, 1);
  assert.equal(calls.filter(({ url, init }) => url.endsWith("/b0/window/ready") && init.method === "POST").length, 1);
  assert.equal(controller.getState().b0Window.status, "LOCKED");
  controller.destroy();
  dom.window.close();
});

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
