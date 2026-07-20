import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { worlds as legacyWorlds } from "../public/world-catalog.js";
import { loadWorldCatalog, renderWorldCatalog } from "../public/worlds.js";
import { worldApiFetch, worldApiPayload } from "./fixtures/world-api.mjs";

test("the MVP worlds lobby exposes two playable worlds and four non-interactive previews", async () => {
  const html = await readFile(new URL("../public/worlds.html", import.meta.url), "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  renderWorldCatalog(document, worldApiPayload.worlds);

  assert.equal(document.querySelector("h1")?.textContent, "Explore Worlds");
  assert.equal(document.querySelector("standard-page-header")?.getAttribute("back-href"), "/");
  assert.equal(document.querySelector(".lobby-back"), null);
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
    [
      "/assets/game/sangtian/catalog-cover.png",
      "/assets/game/caesar/catalog-cover.png",
      "/assets/game/last-will/catalog-cover.png",
      "/assets/game/ten-years-later/catalog-cover.png",
      "/assets/game/romeo-and-juliet/catalog-cover.png",
      "/assets/game/hamlet/catalog-cover.png"
    ]
  );

  dom.window.close();
});

test("the worlds lobby obtains all card content from the shared World API", async () => {
  const html = await readFile(new URL("../public/worlds.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://worlds.test/worlds" });
  dom.window.fetch = worldApiFetch();

  const catalog = await loadWorldCatalog(dom.window.document, dom.window);

  assert.equal(catalog.length, 6);
  assert.equal(dom.window.document.querySelectorAll(".world-card").length, 6);
  assert.match(dom.window.document.body.textContent, /Romeo & Juliet: Before Dawn/);
  assert.match(dom.window.document.body.textContent, /Denmark may not survive the truth/);
  assert.equal(dom.window.document.querySelector('[data-world-id="sangtian"] img')?.getAttribute("src"), "/assets/game/sangtian/catalog-cover.png");
  dom.window.close();
});

test("a newly registered playable world grows the lobby without changing the page", async () => {
  const html = await readFile(new URL("../public/worlds.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://worlds.test/worlds" });
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

  await loadWorldCatalog(dom.window.document, dom.window);

  assert.equal(dom.window.document.querySelectorAll(".world-card").length, 7);
  assert.equal(dom.window.document.querySelector('[data-world-id="third-playable-world"]')?.getAttribute("href"), "/worlds/third-playable-world");
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
  dom.window.MANY_WORLDS_CATALOG = legacyWorlds;
  dom.window.fetch = async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } });
  dom.window.eval(source);
  const deadline = Date.now() + 2_000;
  while (!dom.window.document.querySelector(".world-hero")) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for shared-catalog world detail");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(dom.window.document.querySelector(".world-hero")?.dataset.worldId, "caesar");
  assert.equal(dom.window.document.querySelector(".world-hero h1")?.textContent, legacyWorlds.find((world) => world.id === "caesar").title);
  assert.equal(dom.window.document.querySelector("standard-page-header")?.getAttribute("back-href"), "/worlds");
  dom.window.close();
});
