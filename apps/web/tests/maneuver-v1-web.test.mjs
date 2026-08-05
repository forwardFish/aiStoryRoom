import assert from "node:assert/strict";
import test from "node:test";
import { ManeuverV1Client } from "../public/maneuver-v1/maneuver-v1-client.js";
import {
  applyManeuverPreviewV1,
  applyManeuverProjectionV1,
  buildManeuverDraftV1,
  createManeuverV1State,
  selectManeuverKindV1,
  updateManeuverDraftV1,
} from "../public/maneuver-v1/maneuver-v1-state.js";
import { renderEvidenceHandV1, renderManeuverPanelV1, renderManeuverPreviewV1 } from "../public/maneuver-v1/maneuver-v1-view.js";
import { attachManeuverV1Controller } from "../public/maneuver-v1/maneuver-v1-controller.js";

function projection(overrides = {}) {
  return {
    schemaVersion: "maneuver_projection_v1",
    maxPerTurn: 2,
    remaining: 2,
    windowState: "OPEN",
    stateRevision: 7,
    turnRevision: 3,
    contacts: [{ id: "role.contact", label: "Records Officer", acl: "must-not-render" }],
    traces: [{
      traceId: "trace.record",
      label: "Record mismatch",
      description: "Two visible records disagree.",
      sourceKind: "DOCUMENT",
      internalFactKey: "fact.secret",
      routeOptions: [{ routeId: "route.compare", label: "Compare records", method: "Compare the two signed copies.", predicate: "must-not-render" }],
    }],
    leverageAssets: [{ id: "asset.authorization", label: "Signed authorization", effectSummary: "Changes the access boundary.", legalTargetIds: ["hidden"] }],
    inProgress: [{ actionId: "action.pending", label: "Compare signed records", status: "PENDING", normalizedJson: { secret: true } }],
    privateEvidence: [{
      evidenceId: "evidence.owner",
      title: "Signed record comparison",
      summary: "The timestamps differ.",
      supports: "A record changed after the first signature.",
      cannotProve: "Who intended the change.",
      sourceKind: "RECORD",
      provenanceKey: "source.secret",
      obtainedFromActionId: "action.secret",
      visibility: "PRIVATE",
    }],
    ...overrides,
  };
}

test("server projection drives four distinct entries and authoritative 2/2", () => {
  const state = createManeuverV1State();
  applyManeuverProjectionV1(state, projection());
  const html = renderManeuverPanelV1(state, "zh");
  for (const label of ["人物交谈", "派釣调查", "使用筹码", "自拟谋划"]) assert.match(html, new RegExp(label));
  assert.match(html, /2 \/ 2/);
  assert.match(html, /正在推进/);
  assert.doesNotMatch(html, /must-not-render|fact\.secret|normalizedJson|legalTargetIds/);
});

test("switching entry only changes the local draft and does not consume an opportunity", () => {
  const state = createManeuverV1State();
  applyManeuverProjectionV1(state, projection());
  assert.equal(selectManeuverKindV1(state, "INVESTIGATE"), true);
  updateManeuverDraftV1(state, "INVESTIGATE", { traceId: "trace.record", routeId: "route.compare" });
  assert.equal(state.selectedKind, "INVESTIGATE");
  assert.equal(state.projection.remaining, 2);
});

test("all four entries compile to player drafts with at most one leverage", () => {
  const state = createManeuverV1State();
  applyManeuverProjectionV1(state, projection());
  updateManeuverDraftV1(state, "CONTACT", { targetId: "role.contact", rawText: "Ask for the signed handoff record.", leverageAssetId: "asset.authorization" });
  assert.deepEqual(buildManeuverDraftV1(state), {
    kind: "CONTACT", targetId: "role.contact", rawText: "Ask for the signed handoff record.", leverageAssetId: "asset.authorization", expectedTurnRevision: 3,
  });
  selectManeuverKindV1(state, "INVESTIGATE");
  updateManeuverDraftV1(state, "INVESTIGATE", { traceId: "trace.record", routeId: "route.compare" });
  assert.equal(buildManeuverDraftV1(state).kind, "INVESTIGATE");
  selectManeuverKindV1(state, "LEVERAGE");
  updateManeuverDraftV1(state, "LEVERAGE", { targetId: "role.contact", leverageAssetId: "asset.authorization", rawText: "Request access." });
  assert.deepEqual(buildManeuverDraftV1(state), {
    kind: "LEVERAGE", targetId: "role.contact", leverageAssetId: "asset.authorization", rawText: "Request access.", expectedTurnRevision: 3,
  });
  selectManeuverKindV1(state, "CUSTOM");
  updateManeuverDraftV1(state, "CUSTOM", { rawText: "Assign the watch team to the archive entrance." });
  assert.equal(buildManeuverDraftV1(state).kind, "CUSTOM");
});

test("preview leaves authoritative opportunities unchanged and renders only player-facing fields", () => {
  const state = createManeuverV1State();
  applyManeuverProjectionV1(state, projection());
  applyManeuverPreviewV1(state, {
    decision: "READY",
    previewToken: "header.payload.signature",
    expiresAt: "2026-08-05T00:05:00.000Z",
    remaining: 2,
    presentation: {
      title: "Compare the signed records",
      description: "A reviewer will compare the signed copies.",
      visibleEffect: "The comparison begins when you confirm.",
      visibleRisk: "The comparison cannot prove intent.",
      confirmLabel: "Start the comparison",
      primaryEffect: "MUST_NOT_RENDER",
    },
  }, () => "commit:test:preview");
  assert.equal(state.projection.remaining, 2);
  const html = renderManeuverPreviewV1(state, "en");
  assert.match(html, /Start the comparison/);
  assert.match(html, /cannot prove intent/);
  assert.doesNotMatch(html, /primaryEffect|MUST_NOT_RENDER|previewToken|contextHash|predicate|ACL/i);
});

test("private evidence shows support and limitation without internal provenance", () => {
  const state = createManeuverV1State();
  applyManeuverProjectionV1(state, projection());
  const html = renderEvidenceHandV1(state, "en");
  assert.match(html, /Supports/);
  assert.match(html, /Does not prove/);
  assert.match(html, /Only you can see this/);
  assert.doesNotMatch(html, /provenanceKey|source\.secret|obtainedFromActionId|action\.secret/);
});

test("another role projection with no private evidence has no evidence body in HTML", () => {
  const state = createManeuverV1State();
  applyManeuverProjectionV1(state, projection(; privateEvidence: [] }));
  const html = renderEvidenceHandV1(state, "en");
  assert.doesNotMatch(html, /Signed record comparison|timestamps differ|Who intended/);
});

test("HTTP client uses projection, side-effect-free preview, and explicit commit routes", async () => {
  const calls = [];
  const payloads = [projection(), { decision: "READY", previewToken: "token", presentation: {} }, { accepted: true }];
  const client = new ManeuverV1Client({
    runId: "run / alpha",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => payloads.shift() };
    },
  });
  await client.projection();
  await client.preview({ draft: { kind: "CUSTOM" }, expectedStateRevision: 7 });
  await client.commit({ previewToken: "token", idempotencyKey: "commit:test:001", expectedStateRevision: 7 });
  assert.deepEqual(calls.map((call) => [call.init.method, call.url]), [
    ["GET", "/api/v4/rooms/run%20%2F%20alpha/maneuvers/projection"],
    ["POST", "/api/v4/rooms/run%20%2F%20alpha/maneuvers/preview"],
    ["POST", "/api/v4/rooms/run%20%2F%20alpha/maneuvers/commit"],
  ]);
  assert.equal(JSON.parse(calls[1].init.body).expectedStateRevision, 7);
  assert.equal(JSON.parse(calls[2].init.body).idempotencyKey, "commit:test:001");
});

test("revision change marks an open preview stale instead of silently submitting it", () => {
  const state = createManeuverV1State();
  applyManeuverProjectionV1(state, projection());
  applyManeuverPreviewV1(state, {
    decision: "READY", previewToken: "token", presentation: { title: "Plan", description: "Method", visibleEffect: "Starts", confirmLabel: "Confirm" },
  });
  applyManeuverProjectionV1(state, projection({ stateRevision: 8 }));
  assert.equal(state.preview.decision, "STALE");
  assert.equal(state.previewCommitKey, "");
});

test("attachment preserves the existing main game app and refreshes the maneuver projection", async () => {
  const calls = [];
  let capturedOptions = null;
  const app = {
    async boot() {},
    async refresh(...args) { calls.push(["app.refresh", ...args]); return "refreshed"; },
    destroy() { calls.push(["app.destroy"]); },
    getState() { return { mainlineAvailable: true }; },
  };
  const controller = {
    async boot() { calls.push(["controller.boot"]); },
    async refresh(options) { calls.push(["controller.refresh", options]); },
    destroy() { calls.push(["controller.destroy"]); },
    getState() { return { active: true, remaining: 2 }; },
  };
  await attachManeuverV1Controller({
    app, root: {}, window: {}, runId: "run.alpha", fetchImpl: async () => ({}),
    createController(options) { capturedOptions = options; return controller; },
  });
  assert.equal(app.getState().mainlineAvailable, true);
  assert.equal(app.getState().maneuverV1.remaining, 2);
  assert.equal(await app.refresh(true), "refreshed");
  await capturedOptions.onCommitted();
  app.destroy();
  assert.deepEqual(calls, [
    ["controller.boot"],
    ["app.refresh", true],
    ["controller.refresh", { suppressError: true }],
    ["app.refresh", true],
    ["controller.destroy"],
    ["app.destroy"],
  ]);
});
