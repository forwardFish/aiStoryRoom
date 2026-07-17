import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { worlds } from "../public/world-catalog.js";
import { renderWorldCatalog } from "../public/worlds.js";

test("the MVP worlds lobby exposes two playable worlds and four non-interactive previews", async () => {
  const html = await readFile(new URL("../public/worlds.html", import.meta.url), "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  renderWorldCatalog(document, worlds);

  assert.equal(document.querySelector("h1")?.textContent, "Explore Worlds");
  assert.equal(document.querySelector(".lobby-back")?.textContent.trim(), "←Back");
  assert.equal(document.querySelector(".lobby-back")?.getAttribute("href"), "/");
  assert.match(document.querySelector(".worlds-heading p")?.textContent || "", /Choose a world/);
  assert.equal(document.querySelectorAll(".world-card").length, 6);
  assert.equal(document.querySelectorAll("a.world-card.is-playable").length, 2);
  assert.equal(document.querySelectorAll("article.world-card.is-coming").length, 4);
  assert.deepEqual(
    [...document.querySelectorAll("a.world-card.is-playable")].map((card) => card.getAttribute("href")),
    ["/worlds/sangtian", "/worlds/caesar"]
  );
  assert.equal(document.querySelectorAll(".is-coming a").length, 0);
  assert.equal(document.querySelectorAll(".world-coming-badge").length, 4);
  assert.deepEqual(
    [...document.querySelectorAll(".world-card-art img")].map((image) => image.getAttribute("src")),
    ["/assets/bg/2.png", "/assets/bg/1.png", "/assets/bg/3.png", "/assets/bg/4.png", "/assets/bg/8.png", "/assets/bg/5.png"]
  );

  dom.window.close();
});

test("local and Vercel routes serve the dedicated lobby before dynamic world details", async () => {
  const [server, vercel] = await Promise.all([
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8")
  ]);

  assert.match(server, /\["\/worlds", "\/worlds\.html"\]/);
  const lobbyRoute = vercel.indexOf('{ "source": "/worlds", "destination": "/worlds.html" }');
  const detailRoute = vercel.indexOf('{ "source": "/worlds/:path*", "destination": "/platform.html" }');
  assert.ok(lobbyRoute >= 0);
  assert.ok(detailRoute > lobbyRoute);
});

test("world detail renders from the shared catalog", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const dom = new JSDOM('<!doctype html><main id="platform-app"></main>', {
    url: "http://127.0.0.1:5200/worlds/caesar",
    runScripts: "outside-only"
  });
  dom.window.MANY_WORLDS_CATALOG = worlds;
  dom.window.fetch = async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } });
  dom.window.eval(source);
  const deadline = Date.now() + 2_000;
  while (!dom.window.document.querySelector(".world-hero")) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for shared-catalog world detail");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(dom.window.document.querySelector(".world-hero")?.dataset.worldId, "caesar");
  assert.equal(dom.window.document.querySelector(".world-hero h1")?.textContent, worlds.find((world) => world.id === "caesar").title);
  assert.equal(dom.window.document.querySelector(".back-link")?.getAttribute("href"), "/worlds");
  dom.window.close();
});
