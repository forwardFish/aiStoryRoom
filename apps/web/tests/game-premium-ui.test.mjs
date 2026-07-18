import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("../public/", import.meta.url);

test("game page loads the premium legacy-story theme after shared styles", async () => {
  const html = await readFile(new URL("index.html", publicUrl), "utf8");
  const typography = html.indexOf("/typography.css");
  const premium = html.indexOf("/game-premium.css");

  assert.ok(typography >= 0);
  assert.ok(premium > typography);
});

test("premium game styling excludes the continuous renderer and preserves responsive controls", async () => {
  const css = await readFile(new URL("game-premium.css", publicUrl), "utf8");

  assert.match(css, /\.causal-shell:not\(\.continuous-game-shell\)/);
  assert.match(css, /--game-navy:\s*#354e73/);
  assert.match(css, /\.room-waiting-narrative \.room-stage-card/);
  assert.match(css, /\.room-party-status\.ready/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\.top-utility-cluster\s*\{\s*display:\s*none/);
});
