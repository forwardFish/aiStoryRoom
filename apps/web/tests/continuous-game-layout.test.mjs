import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../public/continuous-game.css", import.meta.url), "utf8");
const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const platformPage = await readFile(new URL("../public/platform.html", import.meta.url), "utf8");

test("continuous-game left rail preserves each private-information panel's natural height", () => {
  assert.match(
    styles,
    /\.continuous-game-shell \.causal-left > \.causal-panel\s*\{\s*flex:\s*0 0 auto;\s*\}/,
    "identity, private brief, and action history must not flex-shrink and clip readable text",
  );
});

test("game page cache-busts the readable terminal-summary layout fix", () => {
  assert.match(page, /continuous-game\.css\?v=20260717-decision-reading-v2/);
});

test("main-decision submit control follows all three readable choices instead of covering the last card", () => {
  assert.match(styles, /\.continuous-card-stack > \.continuous-primary \{ position: static;[^}]*\}/);
  assert.doesNotMatch(styles, /\.continuous-card-stack > \.continuous-primary \{[^}]*position:\s*sticky;/);
});

test("continuous game preserves the full terminal location at a 1280px viewport", () => {
  assert.match(styles, /@media \(max-width: 1300px\) and \(min-width: 1181px\)/);
  assert.match(styles, /\.continuous-game-shell \.causal-topbar \{ grid-template-columns:[^}]*165px; \}/);
  assert.match(styles, /\.continuous-game-shell \.location-title \{[^}]*min-width: 220px;[^}]*overflow: visible;/);
});

test("directed-reaction modal is a viewport-centered readable overlay", () => {
  assert.match(styles, /\.continuous-game-shell > \.critical-overlay \{[^}]*position: fixed;[^}]*inset: 0;[^}]*display: grid;[^}]*place-items: center;/);
  assert.match(styles, /\.continuous-reaction \{[^}]*max-height: calc\(100vh - 48px\);[^}]*overflow-y: auto;/);
  assert.match(styles, /\.continuous-reaction-context \{/);
});

test("dedicated /game/result uses the platform shell that owns result rendering", () => {
  assert.match(platformPage, /src="\/platform\.js/);
  assert.doesNotMatch(page, /src="\/platform\.js/);
});
