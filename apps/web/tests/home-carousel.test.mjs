import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHomeApp } from "../public/home.js";

test("homepage carousel rotates persistent cards instead of rebuilding the DOM", () => {
  const dom = new JSDOM('<!doctype html><main id="homeApp"></main>', { url:"http://home.test/" });
  const intervals = [];
  dom.window.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
  dom.window.clearInterval = () => {};
  dom.window.setTimeout = (callback) => { callback(); return 1; };
  dom.window.clearTimeout = () => {};
  const root = dom.window.document.querySelector("#homeApp");

  createHomeApp({ root, window:dom.window });

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
  assert.match(carousel.querySelector('[data-role="center"] h3').textContent, /Ninety Days Left/);
  assert.equal(carousel.dataset.activeIndex, "3");
});

test("clicking a rear carousel card promotes it and restarts three-second autoplay", () => {
  const dom = new JSDOM('<!doctype html><main id="homeApp"></main>', { url:"http://home.test/" });
  const intervals = [];
  dom.window.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
  dom.window.clearInterval = () => {};
  dom.window.setTimeout = (callback) => { callback(); return 1; };
  dom.window.clearTimeout = () => {};
  const root = dom.window.document.querySelector("#homeApp");

  createHomeApp({ root, window:dom.window });
  const carousel = root.querySelector("[data-carousel]");
  const rightNear = carousel.querySelector('[data-role="right-near"]');
  assert.match(rightNear.textContent, /Ninety Days Left/);

  rightNear.click();

  assert.equal(carousel.dataset.activeIndex, "3");
  assert.match(carousel.querySelector('[data-role="center"] h3').textContent, /Ninety Days Left/);
  assert.equal(intervals.length, 2, "click resets the autoplay clock");
  assert.equal(intervals.at(-1).delay, 3000);

  intervals.at(-1).callback();
  assert.equal(carousel.dataset.activeIndex, "4");
  assert.match(carousel.querySelector('[data-role="center"] h3').textContent, /Blackout Protocol/);
});
