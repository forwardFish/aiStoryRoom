import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("../public/", import.meta.url);

test("all user-facing pages load the shared Many Worlds typography system", async () => {
  const pages = {
    "home.html": "mw-type-marketing",
    "worlds.html": "mw-type-marketing",
    "legal.html": "mw-type-marketing",
    "platform.html": "mw-type-product",
    "credits.html": "mw-type-product",
    "credits-status.html": "mw-type-product",
    "credits-success.html": "mw-type-product",
    "join.html": "mw-type-product",
    "reset-password.html": "mw-type-product",
    "role-select.html": "mw-type-product",
    "room-game.html": "mw-type-product",
    "index.html": "mw-type-game",
    "trio.html": "mw-type-game"
  };

  for (const [file, bodyClass] of Object.entries(pages)) {
    const html = await readFile(new URL(file, publicUrl), "utf8");
    assert.match(html, /href="\/typography\.css\?v=/, `${file} must load typography.css`);
    assert.match(html, new RegExp(`<body[^>]+class="[^"]*${bodyClass}`), `${file} must declare ${bodyClass}`);
  }
});

test("typography tokens define a readable, categorized type scale", async () => {
  const css = await readFile(new URL("typography.css", publicUrl), "utf8");
  assert.match(css, /--mw-font-display:/);
  assert.match(css, /--mw-font-sans:/);
  assert.match(css, /--mw-type-display:/);
  assert.match(css, /--mw-type-h1:/);
  assert.match(css, /--mw-type-h2:/);
  assert.match(css, /--mw-type-h3:/);
  assert.match(css, /--mw-type-body-lg:\s*18px/);
  assert.match(css, /--mw-type-body:\s*16px/);
  assert.match(css, /--mw-type-body-sm:\s*14px/);
  assert.match(css, /--mw-type-label:\s*13px/);
  assert.match(css, /--mw-type-caption:\s*12px/);
  assert.doesNotMatch(css, /font-size:\s*(?:[0-9]|1[01])px/);
  assert.match(css, /\.mw-type-marketing/);
  assert.match(css, /\.mw-type-product/);
  assert.match(css, /\.mw-type-game/);
});
