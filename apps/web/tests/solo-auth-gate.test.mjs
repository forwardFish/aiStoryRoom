import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const platformUrl = new URL("../public/platform.js", import.meta.url);

async function authenticatedRouteHarness({ signedIn = false, requestImpl = async () => ({}) } = {}) {
  const source = await readFile(platformUrl, "utf8");
  const start = source.indexOf("function loginUrl(");
  const end = source.indexOf("function requireSession(", start);
  const helperSource = source.slice(start, end);
  const assignments = [];
  const notices = [];
  const safeReturnTo = (value) => value;
  const location = { assign: (value) => assignments.push(value) };
  const factory = Function("safeReturnTo", "sessionToken", "location", "request", "notice", `${helperSource}; return openAuthenticatedRoute;`);
  const openAuthenticatedRoute = factory(safeReturnTo, () => signedIn ? "cookie-session" : "", location, requestImpl, (value) => notices.push(value));
  return { openAuthenticatedRoute, assignments, notices, source };
}

test("Play Solo redirects a signed-out player to login before starting Solo", async () => {
  const harness = await authenticatedRouteHarness();

  await harness.openAuthenticatedRoute("/role-select?story=sangtian");

  assert.deepEqual(harness.assignments, ["/auth?returnTo=%2Frole-select%3Fstory%3Dsangtian"]);
  assert.deepEqual(harness.notices, []);
});

test("Play Solo verifies a cookie session before starting Solo", async () => {
  const requests = [];
  const harness = await authenticatedRouteHarness({
    signedIn: true,
    requestImpl: async (url) => { requests.push(url); return {}; }
  });

  await harness.openAuthenticatedRoute("/role-select?story=caesar");

  assert.deepEqual(requests, ["/api/v4/auth/me"]);
  assert.deepEqual(harness.assignments, ["/role-select?story=caesar"]);
});

test("Play Solo sends an expired hinted session back through login", async () => {
  const harness = await authenticatedRouteHarness({
    signedIn: true,
    requestImpl: async () => { throw Object.assign(new Error("expired"), { status: 401 }); }
  });

  await harness.openAuthenticatedRoute("/role-select?story=sangtian");

  assert.deepEqual(harness.assignments, ["/auth?returnTo=%2Frole-select%3Fstory%3Dsangtian"]);
  assert.deepEqual(harness.notices, []);
});

test("every normal Solo entry uses the direct Solo-start flow", async () => {
  const source = await readFile(platformUrl, "utf8");
  const actions = source.slice(source.indexOf("const actions ="), source.indexOf("async function initializePlatform"));

  assert.match(source, /function startSoloFromWorld/);
  assert.match(source, /runMutationOnce\(`solo-entry:\$\{worldId\}`/);
  assert.match(source, /\/api\/v4\/rooms\/solo/);
  assert.match(actions, /solo:[\s\S]*startSoloFromWorld\("caesar"/);
  assert.match(actions, /"sangtian-solo":[\s\S]*startSoloFromWorld\("sangtian"/);
  assert.match(actions, /"world-solo":[\s\S]*startSoloFromWorld\(worldId/);
});
