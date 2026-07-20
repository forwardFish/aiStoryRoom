import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderTransitionScreen } from "../public/transition-screen.js";

const readPublic = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
const hasCjk = (value) => /[\u3400-\u9fff]/u.test(value);

test("the shared transition screen is an English, accessible opening state", () => {
  const html = renderTransitionScreen();

  assert.match(html, /Opening Your World/);
  assert.match(html, /Entering the story/);
  assert.match(html, /Our Many Worlds/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
  assert.equal(hasCjk(html), false);
});

test("game, role selection, and story recovery use the same transition component", async () => {
  const [game, roleSelect, storyV2, index, roleHtml, css] = await Promise.all([
    readPublic("game-bootstrap.js"),
    readPublic("role-select.js"),
    readPublic("continuous-story-v2-view.js"),
    readPublic("index.html"),
    readPublic("role-select.html"),
    readPublic("transition-screen.css")
  ]);

  assert.match(game, /renderTransitionScreen\(\{/);
  assert.match(roleSelect, /Opening the Role Roster/);
  assert.match(storyV2, /Restoring Your Storyline/);
  assert.match(index, /transition-screen\.css/);
  assert.match(roleHtml, /transition-screen\.css/);
  assert.match(index, /<html lang="en">/);
  assert.match(roleHtml, /<html lang="en">/);
  assert.doesNotMatch(game.slice(game.indexOf("function loadingView"), game.indexOf("function renderClosedError")), /[\u3400-\u9fff]/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
});
