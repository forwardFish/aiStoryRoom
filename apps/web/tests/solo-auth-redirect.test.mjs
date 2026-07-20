import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";
import { StoryApiError } from "../public/api-story-storage.js";

test("unauthenticated Solo entry redirects to sign-in instead of rendering a service outage", async () => {
  const dom = new JSDOM('<!doctype html><main id="app"></main>');
  let navigationTarget = "";
  const app = createStoryApp({
    root: dom.window.document.getElementById("app"),
    window: { location: { pathname: "/game", search: "", hash: "", assign: (url) => { navigationTarget = url; } } },
    storage: { restoreOrCreate: async () => { throw new StoryApiError("Login required", { status: 401, code: "AUTHENTICATION_REQUIRED" }); } }
  });

  await app.boot();

  assert.equal(navigationTarget, "/auth?returnTo=%2Fgame");
  assert.doesNotMatch(dom.window.document.getElementById("app").textContent, /temporarily unavailable/);
  dom.window.close();
});
