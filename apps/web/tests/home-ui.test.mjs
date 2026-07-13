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
  assert.match(script, /Every situation/);
  assert.match(script, /Worlds worth stepping into/);
  assert.match(script, /Not a story with branches/);
  assert.match(script, /How a world unfolds/);
  assert.match(script, /When the world ends/);
  assert.match(script, /data-start-solo/);
  assert.equal((script.match(/title:/g) || []).length >= 8, true);
  assert.match(script, /function asset\(group, index\)/);
  assert.match(script, /asset\("bg"/);
  assert.match(script, /asset\("portrait"/);
  assert.match(script, /asset\("icon"/);
  assert.match(css, /\.mw-hero/);
  assert.match(css, /\.world-carousel/);
  assert.match(css, /@media/);
});
