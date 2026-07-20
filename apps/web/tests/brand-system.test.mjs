import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

test("user-facing surfaces use the Our Many Worlds brand and tagline", async () => {
  const [homeHtml, homeJs, platformHtml, platformJs, standardHeader, credits, worlds, roleSelect, roleSelectionView] = await Promise.all([
    readFile(new URL("../public/home.html", import.meta.url), "utf8"),
    readFile(new URL("../public/home.js", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.html", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
    readFile(new URL("../public/standard-page-header.js", import.meta.url), "utf8"),
    readFile(new URL("../public/credits.html", import.meta.url), "utf8"),
    readFile(new URL("../public/worlds.html", import.meta.url), "utf8"),
    readFile(new URL("../public/role-select.js", import.meta.url), "utf8"),
    readFile(new URL("../public/room-role-selection-view.js", import.meta.url), "utf8")
  ]);

  assert.match(homeHtml, /<title>Our Many Worlds \| Real players\. Living worlds\.<\/title>/);
  assert.match(homeJs, /Our Many Worlds<small>Real players\. Living worlds\.<\/small>/);
  assert.match(homeJs, /© 2026 Our Many Worlds/);
  assert.match(platformHtml, /<title>Our Many Worlds<\/title>/);
  assert.match(platformJs, /const BRAND_NAME = "Our Many Worlds"/);
  assert.match(platformJs, /const BRAND_TAGLINE = "Real players\. Living worlds\."/);
  assert.match(standardHeader, /<strong>Our Many Worlds<\/strong>/);
  assert.match(standardHeader, /<small>Real players\. Living worlds\.<\/small>/);
  assert.match(credits, /<standard-page-header back-href="\/" dynamic-return>/);
  assert.match(worlds, /Explore Worlds \| Our Many Worlds/);
  assert.match(roleSelect, /renderRoomSelectionPage/);
  assert.doesNotMatch(roleSelectionView, /mw-room-brand|<strong>Our Many Worlds<\/strong>/);

  const combined = [homeHtml, homeJs, platformHtml, platformJs, standardHeader, credits, worlds, roleSelect, roleSelectionView].join("\n");
  assert.doesNotMatch(combined, /AI-powered story rooms|AI-powered social simulations/);
  assert.doesNotMatch(platformJs, /MutationObserver|applyBrandText/);
  assert.doesNotMatch(platformJs, /openInviteShareLegacy|on Many Worlds/);
  assert.doesNotMatch(platformJs, new RegExp("<strong>Many Worlds</strong>"));
});

test("public result renders the exact brand instead of the legacy name", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const dom = new JSDOM('<!doctype html><main id="platform-app"></main>', {
    url: "http://127.0.0.1:5200/shared/result?token=share-token",
    runScripts: "outside-only"
  });
  dom.window.fetch = async () => new Response(JSON.stringify({
    recap: { title: "A shared ending", highlights: [] },
    room: { title: "", completedNodes: 7 },
    share: { expiresAt: "2026-08-01T00:00:00.000Z" }
  }), { status: 200, headers: { "content-type": "application/json" } });
  dom.window.eval(source);
  const deadline = Date.now() + 2_000;
  while (!dom.window.document.querySelector(".public-result-meta")) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the public result");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(dom.window.document.querySelector(".public-result-brand strong")?.textContent, "Our Many Worlds");
  assert.match(dom.window.document.querySelector(".public-result-meta")?.textContent || "", /^Our Many Worlds/);
  assert.match(dom.window.document.querySelector(".public-result-meta")?.textContent || "", /7 rounds completed$/);
  dom.window.close();
});
