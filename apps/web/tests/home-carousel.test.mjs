import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHomeApp } from "../public/home.js";
import { worldApiFetch, worldApiPayload } from "./fixtures/world-api.mjs";

test("homepage carousel loads the shared World API and rotates persistent cards", async () => {
  const dom = new JSDOM('<!doctype html><main id="homeApp"></main>', { url:"http://home.test/" });
  const intervals = [];
  dom.window.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
  dom.window.clearInterval = () => {};
  dom.window.setTimeout = (callback) => { callback(); return 1; };
  dom.window.clearTimeout = () => {};
  dom.window.fetch = worldApiFetch();
  const root = dom.window.document.querySelector("#homeApp");

  const app = createHomeApp({ root, window:dom.window });
  await app.ready;

  const carousel = root.querySelector("[data-carousel]");
  const before = [...carousel.querySelectorAll("[data-carousel-item]")];
  assert.equal(before.length, 6);
  assert.equal(carousel.querySelectorAll("button").length, 6, "world cards themselves are the only click targets");
  assert.equal(root.querySelectorAll(".carousel-controls").length, 0, "carousel has no arrows or pagination controls");
  assert.equal(intervals.at(-1).delay, 3000, "autoplay advances every three seconds");
  assert.match(carousel.querySelector('[data-role="center"] h3').textContent, /Caesar/);

  intervals.at(-1).callback();

  const after = [...carousel.querySelectorAll("[data-carousel-item]")];
  assert.deepEqual(after, before, "animation keeps the same card nodes mounted");
  assert.match(carousel.querySelector('[data-role="center"] h3').textContent, /Last Will/);
  assert.equal(carousel.dataset.activeIndex, "2");
});

test("clicking a rear carousel card promotes API content and restarts three-second autoplay", async () => {
  const dom = new JSDOM('<!doctype html><main id="homeApp"></main>', { url:"http://home.test/" });
  const intervals = [];
  dom.window.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
  dom.window.clearInterval = () => {};
  dom.window.setTimeout = (callback) => { callback(); return 1; };
  dom.window.clearTimeout = () => {};
  dom.window.fetch = worldApiFetch();
  const root = dom.window.document.querySelector("#homeApp");

  const app = createHomeApp({ root, window:dom.window });
  await app.ready;
  const carousel = root.querySelector("[data-carousel]");
  const rightNear = carousel.querySelector('[data-role="right-near"]');
  assert.match(rightNear.textContent, /Last Will/);

  rightNear.click();

  assert.equal(carousel.dataset.activeIndex, "2");
  assert.match(carousel.querySelector('[data-role="center"] h3').textContent, /Last Will/);
  assert.equal(intervals.length, 2, "click resets the autoplay clock");
  assert.equal(intervals.at(-1).delay, 3000);

  intervals.at(-1).callback();
  assert.equal(carousel.dataset.activeIndex, "3");
  assert.match(carousel.querySelector('[data-role="center"] h3').textContent, /Ten Years Later/);
});

test("a third playable registry entry appears on the homepage without a page-code change", async () => {
  const dom = new JSDOM('<!doctype html><main id="homeApp"></main>', { url:"http://home.test/" });
  dom.window.setInterval = () => 1;
  dom.window.clearInterval = () => {};
  dom.window.fetch = worldApiFetch({
    worlds: [...worldApiPayload.worlds, {
      worldId: "third-playable-world",
      status: "playable",
      playable: true,
      cardTitle: "A Third Playable World",
      cardDescription: "A registry-only launch fixture.",
      categoryLabel: "New Category",
      cardCover: "/assets/game/third-playable-world/catalog-cover.png",
      durationLabel: "30–45 Minutes",
      minHumanPlayers: 1,
      maxHumanPlayers: 4,
      detailPath: "/worlds/third-playable-world"
    }]
  });
  const root = dom.window.document.querySelector("#homeApp");

  const app = createHomeApp({ root, window:dom.window });
  await app.ready;

  assert.equal(root.querySelectorAll(".world-grid .world-card").length, 6, "homepage keeps its six-card layout");
  assert.match(root.querySelector(".world-grid")?.textContent || "", /A Third Playable World/);
  assert.match(root.querySelector(".world-filters")?.textContent || "", /New Category/);
  dom.window.close();
});
