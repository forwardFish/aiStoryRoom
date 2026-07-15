import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("auth page loads the public runtime configuration before its Google button", async () => {
  const [html, runtimeConfig, server, deploy] = await Promise.all([
    readFile(new URL("../public/platform.html", import.meta.url), "utf8"),
    readFile(new URL("../public/runtime-config.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/deploy/prepare-vercel-web-assets.mjs", import.meta.url), "utf8")
  ]);

  assert.match(html, /<script src="\/runtime-config\.js"><\/script>\s*<script type="module" src="\/platform\.js">/);
  assert.match(runtimeConfig, /googleWebClientId: ""/);
  assert.match(server, /PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  assert.match(server, /cache-control": "no-store/);
  assert.match(deploy, /writeFile/);
  assert.match(deploy, /PUBLIC_GOOGLE_WEB_CLIENT_ID/);
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
  assert.match(source, /function clearLocalSession\(\) \{ localStorage\.removeItem\("many-worlds-token"\); globalThis\.google\?\.accounts\?\.id\?\.disableAutoSelect\?\.\(\); \}/);
  assert.match(source, /"sign-out": \(\) => \{ clearLocalSession\(\); location\.assign\("\/"\); \}/);
});
