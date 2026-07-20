import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const readPublic = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

test("the standard page header renders the approved sparse Back and brand layout", async () => {
  const source = await readPublic("standard-page-header.js");
  const executable = source.replace(/export \{ StandardPageHeader \};?\s*$/, "");
  const dom = new JSDOM('<!doctype html><standard-page-header back-href="/worlds" dynamic-return></standard-page-header>', {
    url: "http://local.test/credits",
    runScripts: "outside-only"
  });

  dom.window.eval(executable);

  const header = dom.window.document.querySelector("standard-page-header");
  assert.equal(header?.querySelector(".standard-page-header__back")?.getAttribute("href"), "/worlds");
  assert.equal(header?.querySelector("[data-return-link]")?.textContent.replace(/\s+/g, " ").trim(), "← Back");
  assert.equal(header?.querySelector(".standard-page-header__brand strong")?.textContent, "Our Many Worlds");
  assert.equal(header?.querySelector(".standard-page-header__brand small")?.textContent, "Real players. Living worlds.");
  assert.equal(header?.querySelector("nav"), null);
  dom.window.close();
});

test("ordinary product pages load one shared header while the homepage remains separate", async () => {
  const [credits, worlds, roles, platform, reset, home, css] = await Promise.all([
    readPublic("credits.html"),
    readPublic("worlds.html"),
    readPublic("role-select.html"),
    readPublic("platform.html"),
    readPublic("reset-password.html"),
    readPublic("home.html"),
    readPublic("standard-page-header.css")
  ]);

  for (const page of [credits, worlds, roles, platform, reset]) {
    assert.match(page, /\/standard-page-header\.css/);
    assert.match(page, /\/standard-page-header\.js/);
  }
  assert.doesNotMatch(home, /standard-page-header/);
  assert.match(css, /justify-content:\s*space-between/);
  assert.match(css, /\.standard-page-header__brand[\s\S]*justify-content:\s*flex-end/);
  assert.match(css, /\.standard-page-header__back[\s\S]*border-radius:\s*999px/);
  assert.match(css, /standard-page-header\s*\{[\s\S]*background:\s*transparent/);
});
