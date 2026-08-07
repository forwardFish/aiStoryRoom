import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicFile = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
  const reversed = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`, "i"));
  return direct?.[1] || reversed?.[1] || "";
}

function propertyContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
  const reversed = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i"));
  return direct?.[1] || reversed?.[1] || "";
}

function canonical(html) {
  return html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1]
    || "";
}

function title(html) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || "";
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]));
}

function graphTypes(blocks) {
  return blocks.flatMap((block) => Array.isArray(block?.["@graph"]) ? block["@graph"] : [block])
    .map((entry) => entry?.["@type"])
    .filter(Boolean);
}

test("public acquisition pages expose unique crawlable metadata and static product copy", async () => {
  const [home, worlds, caesar, sangtian, credits] = await Promise.all([
    publicFile("home.html"),
    publicFile("worlds.html"),
    publicFile("worlds-caesar.html"),
    publicFile("worlds-sangtian.html"),
    publicFile("credits.html")
  ]);

  const pages = [
    { html: home, canonical: "https://ourmanyworlds.com/", title: /AI Multiplayer Story Game/ },
    { html: worlds, canonical: "https://ourmanyworlds.com/worlds", title: /AI Story Worlds/ },
    { html: caesar, canonical: "https://ourmanyworlds.com/worlds/caesar", title: /Caesar Historical AI Roleplay Game/ },
    { html: sangtian, canonical: "https://ourmanyworlds.com/worlds/sangtian", title: /Ming China Historical Strategy Story Game/ },
    { html: credits, canonical: "https://ourmanyworlds.com/credits", title: /World Credits and Pricing/ }
  ];

  const titles = pages.map((page) => title(page.html));
  const descriptions = pages.map((page) => metaContent(page.html, "description"));
  assert.equal(new Set(titles).size, pages.length);
  assert.equal(new Set(descriptions).size, pages.length);

  for (const page of pages) {
    assert.match(title(page.html), page.title);
    assert.ok(title(page.html).length >= 30 && title(page.html).length <= 70);
    assert.ok(metaContent(page.html, "description").length >= 110);
    assert.match(metaContent(page.html, "robots"), /index,follow/);
    assert.equal(canonical(page.html), page.canonical);
    assert.equal(propertyContent(page.html, "og:url"), page.canonical);
    assert.ok(propertyContent(page.html, "og:title"));
    assert.ok(propertyContent(page.html, "og:description"));
    assert.ok(propertyContent(page.html, "og:image"));
    assert.doesNotMatch(page.html, /<meta[^>]+name=["']keywords["']/i);
  }

  assert.match(home, /Everyone sees a <em>different truth\.<\/em>/);
  assert.match(home, /AI resolves everyone's moves into one shared world/);
  assert.match(home, /href="\/worlds"/);
  assert.match(home, /href="#how-it-works"/);
  assert.match(home, /home-seo\.js\?v=/);

  assert.equal((worlds.match(/href="\/worlds\/(?:caesar|sangtian)"/g) || []).length, 2);
  assert.match(worlds, /Play Solo or invite friends/);
  assert.match(caesar, /private roles/);
  assert.match(caesar, /Create a Multiplayer Room/);
  assert.match(sangtian, /political pressure/);
  assert.match(sangtian, /Create a Multiplayer Room/);
});

test("structured data describes the visible game, FAQ, world collection and individual worlds", async () => {
  const [home, worlds, caesar, sangtian] = await Promise.all([
    publicFile("home.html"),
    publicFile("worlds.html"),
    publicFile("worlds-caesar.html"),
    publicFile("worlds-sangtian.html")
  ]);

  const homeBlocks = jsonLdBlocks(home);
  const homeTypes = graphTypes(homeBlocks);
  assert.ok(homeTypes.includes("Organization"));
  assert.ok(homeTypes.includes("WebSite"));
  assert.ok(homeTypes.includes("VideoGame"));
  assert.ok(homeTypes.includes("FAQPage"));
  const faq = homeBlocks.flatMap((block) => block["@graph"] || [block]).find((entry) => entry["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, 10);
  assert.equal(new Set(faq.mainEntity.map((item) => item.name)).size, 10);

  const worldsBlock = jsonLdBlocks(worlds)[0];
  assert.equal(worldsBlock["@type"], "CollectionPage");
  assert.equal(worldsBlock.mainEntity["@type"], "ItemList");
  assert.equal(worldsBlock.mainEntity.itemListElement.length, 2);

  for (const html of [caesar, sangtian]) {
    const types = graphTypes(jsonLdBlocks(html));
    assert.ok(types.includes("VideoGame"));
    assert.ok(types.includes("BreadcrumbList"));
    assert.doesNotMatch(html, /aggregateRating|reviewCount|ratingValue/);
  }
});

test("private app routes are excluded while canonical public URLs are declared once", async () => {
  const [platform, robots, sitemap, llms, server, vercelText] = await Promise.all([
    publicFile("platform.html"),
    publicFile("robots.txt"),
    publicFile("sitemap.xml"),
    publicFile("llms.txt"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8")
  ]);
  const vercel = JSON.parse(vercelText);

  assert.match(metaContent(platform, "robots"), /noindex,nofollow,noarchive/);
  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /Sitemap: https:\/\/ourmanyworlds\.com\/sitemap\.xml/);

  const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(sitemapUrls, [
    "https://ourmanyworlds.com/",
    "https://ourmanyworlds.com/worlds",
    "https://ourmanyworlds.com/worlds/caesar",
    "https://ourmanyworlds.com/worlds/sangtian",
    "https://ourmanyworlds.com/credits"
  ]);
  assert.doesNotMatch(sitemap, /\/auth|\/account|\/game|\/rooms|\/role-select|\/join/);
  assert.match(llms, /AI shared-world social strategy game/);
  assert.match(llms, /Different goals, secrets, and limited points of view/);

  assert.equal(vercel.redirects.find((entry) => entry.source === "/home")?.destination, "/");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/")?.destination, "/home.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/worlds/caesar")?.destination, "/worlds-caesar.html");
  assert.equal(vercel.rewrites.find((entry) => entry.source === "/worlds/sangtian")?.destination, "/worlds-sangtian.html");
  assert.equal(
    vercel.headers.find((entry) => entry.source === "/rooms/:path*")?.headers?.find((header) => header.key === "X-Robots-Tag")?.value,
    "noindex, nofollow, noarchive"
  );

  assert.match(server, /"\.xml": "application\/xml; charset=utf-8"/);
  assert.match(server, /"\.txt": "text\/plain; charset=utf-8"/);
  assert.match(server, /\["\/worlds\/caesar", "\/worlds-caesar\.html"\]/);
  assert.match(server, /\["\/worlds\/sangtian", "\/worlds-sangtian\.html"\]/);
  assert.match(server, /"x-robots-tag": "noindex, nofollow, noarchive"/);
});

test("the post-render marketing layer keeps visible copy aligned with structured data", async () => {
  const script = await publicFile("home-seo.js");
  assert.match(script, /AI-POWERED SHARED WORLDS/);
  assert.match(script, /Everyone sees a <em>different truth/);
  assert.match(script, /Make Your Move/);
  assert.match(script, /Face the Consequences/);
  assert.match(script, /Do all players see the same information\?/);
  assert.equal((script.match(/question:/g) || []).length, 10);
  assert.match(script, /MutationObserver/);
});
