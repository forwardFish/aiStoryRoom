import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("password reset has a dedicated page and shares the login visual contract", async () => {
  const [html, platformHtml, sharedCss, resetSource, platformSource, vercel, server] = await Promise.all([
    readFile(new URL("../public/reset-password.html", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.html", import.meta.url), "utf8"),
    readFile(new URL("../public/auth-shared.css", import.meta.url), "utf8"),
    readFile(new URL("../public/reset-password.js", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="reset-password-app"/);
  assert.match(html, /data-reset-password-form/);
  assert.match(html, /Confirm new password/);
  assert.doesNotMatch(html, /data-auth-form|data-google-signin|Create account|Remember me/);
  assert.match(html, /class="reset-password-topbar"/);
  assert.match(html, /class="reset-password-brand"/);
  assert.match(html, /Secure account recovery/);
  assert.doesNotMatch(html, /reset-password-aside|security-visual|many-worlds-logo\.png/);

  assert.match(html, /href="\/auth-shared\.css"/);
  assert.match(platformHtml, /href="\/auth-shared\.css"/);
  assert.match(sharedCss, /\.auth-card,\s*\.reset-password-shell/);
  assert.match(sharedCss, /\.auth-card \.field input,\s*\.reset-password-card \.field input/);
  assert.match(sharedCss, /\.auth-card \.btn\.primary,\s*\.reset-password-card \.btn\.primary/);

  assert.match(resetSource, /\/api\/v4\/auth\/password-reset\/confirm/);
  assert.match(resetSource, /JSON\.stringify\(\{ token, password \}\)/);
  assert.match(resetSource, /The two passwords do not match/);
  assert.match(resetSource, /Your account is secure again/);
  assert.match(html, /href="\/auth\?mode=login&amp;reauth=1"/);
  assert.match(resetSource, /href="\/auth\?mode=login&amp;reauth=1"/);
  assert.match(platformSource, /!reauthenticate && hasSessionCookie\(\)/);

  const renderAuthStart = platformSource.indexOf("function renderAuth()");
  const firstAppShell = platformSource.indexOf("appShell(", renderAuthStart);
  const legacyRedirect = platformSource.indexOf("location.replace(`/reset-password", renderAuthStart);
  assert.ok(legacyRedirect > renderAuthStart && legacyRedirect < firstAppShell, "legacy reset links must redirect before the login page renders");
  assert.match(vercel, /"source": "\/reset-password", "destination": "\/reset-password\.html"/);
  assert.match(server, /\["\/reset-password", "\/reset-password\.html"\]/);
});
