import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHomeApp } from "../public/home.js";

test("homepage keeps the last verified world catalog when its API request fails", async () => {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "https://ourmanyworlds.com/" });
  dom.window.fetch = async () => { throw new Error("upstream unavailable"); };
  const root = dom.window.document.getElementById("app");
  const app = createHomeApp({ root, window: dom.window });

  await app.ready;

  assert.match(root.textContent, /Sangtian Edict/);
  assert.match(root.textContent, /Caesar: The Last Spring/);
  assert.equal(root.querySelectorAll(".world-card-link").length, 6);
  dom.window.close();
});
