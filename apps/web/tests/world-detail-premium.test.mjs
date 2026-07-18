import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("../public/", import.meta.url);

test("world detail loads its isolated premium stylesheet", async () => {
  const html = await readFile(new URL("platform.html", publicUrl), "utf8");

  assert.match(html, /<link rel="stylesheet" href="\/world-detail\.css\?v=[^"]+" \/>/);
});

test("premium world-detail styling stays page-scoped and responsive", async () => {
  const css = await readFile(new URL("world-detail.css", publicUrl), "utf8");

  assert.match(css, /body:has\(\[data-world-detail\]\) \.world-image/);
  assert.match(css, /body:has\(\[data-world-detail\]\) \{[\s\S]*?min-width:\s*0/);
  assert.match(css, /aspect-ratio:\s*1\.76/);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.mode-card \.btn:focus-visible/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(css, /(^|\n)(?!body:has\()\s*\.(world-hero|role-card|mode-card)\s*\{/);
});
