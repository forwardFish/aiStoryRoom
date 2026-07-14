import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Many Worlds 首页包含真实资源、完整内容分区和单人入口", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../public/home.html", import.meta.url), "utf8"),
    readFile(new URL("../public/home.js", import.meta.url), "utf8"),
    readFile(new URL("../public/home.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /home\.js\?v=/);
  assert.match(html, /Many Worlds/);
  assert.match(html, /Many Worlds \| AI-powered story rooms/);
  assert.doesNotMatch(html, /AI 故事局/);
  assert.match(script, /\/assets\/brand\/many-worlds-logo\.png/);
  assert.match(script, /Every situation/);
  assert.match(script, /AI-POWERED STORY ROOMS/);
  assert.match(script, /Sangtian Edict: The Jiajing Fiscal Crisis/);
  assert.match(script, /Worlds worth stepping into/);
  assert.match(script, /Not a story with branches/);
  assert.match(script, /How a world unfolds/);
  assert.match(script, /When the run ends/);
  assert.match(script, /World Credits/);
  assert.match(script, /50.*Bonus Credits/);
  assert.match(script, /100.*Credits \/ room/);
  assert.match(script, /300.*Credits.*\$7\.99/);
  assert.match(script, /650 Credits.*\$14\.99/);
  assert.match(script, /25.*Bonus Credits/);
  assert.match(script, /href="\/credits"/);
  assert.match(script, /href="\/credits#invite"/);
  assert.doesNotMatch(script, /credits\.html|#flow|#explore/);
  assert.doesNotMatch(script, /Many Worlds Plus/);
  assert.doesNotMatch(script, /\/ month/);
  assert.match(script, /class="faq-section mw-panel"/);
  assert.match(script, /class="faq-layout"/);
  assert.match(script, /Everything you need before the first decision/);
  assert.match(script, /How do World Credits unlock a room/);
  assert.match(script, /The first three decisions are free/);
  assert.match(script, /no per-turn charge after unlock/);
  assert.match(script, /Creating a room is free/);
  assert.match(script, /Purchased Credits never expire/);
  assert.match(script, /data-start-solo/);
  assert.equal((script.match(/title:/g) || []).length >= 8, true);
  assert.match(script, /function asset\(group, index\)/);
  assert.match(script, /worlds\.slice\(0, 6\)/);
  assert.match(script, /setInterval/);
  assert.match(script, /renderHeroCarousel/);
  assert.match(script, /hero-card/);
  assert.match(script, /asset\("bg"/);
  assert.match(script, /asset\("portrait"/);
  assert.match(script, /asset\("icon"/);
  assert.match(css, /\.mw-hero/);
  assert.match(css, /\.world-carousel/);
  assert.match(css, /\.faq-layout/);
  assert.match(css, /\.faq-content/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media/);
});
