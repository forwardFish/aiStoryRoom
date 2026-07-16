import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

test("auth page loads the public runtime configuration before its Google button", async () => {
  const [html, runtimeConfig, server, deploy, vercelSource] = await Promise.all([
    readFile(new URL("../public/platform.html", import.meta.url), "utf8"),
    readFile(new URL("../public/runtime-config.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/deploy/prepare-vercel-web-assets.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8")
  ]);

  assert.match(html, /<script src="\/runtime-config\.js"><\/script>\s*<script type="module" src="\/platform\.js">/);
  assert.match(runtimeConfig, /googleWebClientId: ""/);
  assert.match(server, /PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  assert.match(server, /cache-control": "no-store/);
  assert.match(deploy, /writeFile/);
  assert.match(deploy, /PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  const vercel = JSON.parse(vercelSource);
  const headers = vercel.headers?.flatMap((entry) => entry.headers || []) || [];
  const value = (key) => headers.find((entry) => entry.key === key)?.value || "";
  assert.match(value("Content-Security-Policy"), /script-src[^;]*https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(value("Content-Security-Policy"), /frame-src[^;]*https:\/\/accounts\.google\.com/);
  assert.equal(value("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
});

test("Google browser sign-in is challenge-bound and leaves email authentication available", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = source.indexOf("function mountGoogleSignIn");
  const end = source.indexOf("function renderAuth()", start);
  const google = source.slice(start, end);

  assert.match(google, /\/api\/v4\/auth\/google\/challenge/);
  assert.match(google, /nonce: challenge\.nonce/);
  assert.match(google, /challengeId: challenge\.challengeId/);
  assert.match(google, /x-requested-with": "many-worlds-web/);
  assert.match(google, /google\.accounts\.id\.renderButton/);
  assert.doesNotMatch(google, /client_secret/i);
  assert.match(source, /function apiUrl\(url\)/);
});

test("production Google sign-in reaches the same-origin cookie session endpoint without runtime errors", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const requests = [];
  let initialized = null;
  let rendered = false;
  const dom = new JSDOM('<!doctype html><main id="platform-app"></main>', {
    url: "https://ourmanyworlds.com/auth",
    runScripts: "outside-only"
  });
  dom.window.__MANY_WORLDS_RUNTIME__ = { googleWebClientId: "test-client.apps.googleusercontent.com" };
  dom.window.google = {
    accounts: {
      id: {
        initialize(options) { initialized = options; },
        renderButton() { rendered = true; },
        disableAutoSelect() {}
      }
    }
  };
  dom.window.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), credentials: options.credentials });
    return new Response(JSON.stringify({ challengeId: "challenge-1", nonce: "nonce-1" }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  };

  dom.window.eval(source);
  const deadline = Date.now() + 2_000;
  while (!rendered && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(requests[0], { url: "/api/v4/auth/google/challenge", credentials: "include" });
  assert.equal(initialized?.client_id, "test-client.apps.googleusercontent.com");
  assert.equal(initialized?.nonce, "nonce-1");
  assert.equal(rendered, true);
  const auth = dom.window.document.querySelector("[data-auth-form]");
  assert.ok(auth);
  assert.equal(auth.querySelector('[data-action="show-signup"]'), null);
  assert.equal(auth.querySelector('[data-sign-out]'), null);
  assert.equal(auth.querySelector('[data-reset-form]'), null);
  assert.equal(auth.querySelectorAll("[data-auth-tab]").length, 2);
  dom.window.close();
});
