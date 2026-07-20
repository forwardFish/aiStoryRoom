import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Sangtian world preview matches the six playable roles and generated period artwork", async () => {
  const [source, css, html, definitionSource] = await Promise.all([
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.css", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.html", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/templates/config/sangtian/game.json", import.meta.url), "utf8")
  ]);
  const start = source.indexOf("function worldRoleCards");
  const end = source.indexOf("function roomRow", start);
  const preview = source.slice(start, end);
  const definition = JSON.parse(definitionSource);

  assert.deepEqual(definition.roles.map((role) => role.roleName), [
    "浙江总督",
    "浙江巡抚",
    "清流县令",
    "改桑书吏",
    "江南商会会首",
    "司礼监织造使"
  ]);
  assert.equal(
    definition.roles.every(
      (role) => role.canBeHumanControlled && role.portrait.startsWith("/assets/game/sangtian/generated/")
    ),
    true
  );
  assert.match(definition.catalog.heroCover, /^\/assets\/game\/sangtian\/background\.png(?:\?v=[a-z0-9]+)?$/);
  assert.equal(definition.catalog.cardCover, "/assets/game/sangtian/catalog-cover.png");
  assert.notEqual(definition.catalog.heroCover, definition.catalog.cardCover);
  assert.match(preview, /\(world\.roles \|\| \[\]\)\.map/);
  assert.match(preview, /role\.portrait/);
  assert.match(preview, /request\(`\/api\/v4\/worlds\/\$\{encodeURIComponent\(worldId\)\}`\)/);
  assert.match(preview, /worldDetailMarkup\(world\)/);
  assert.match(css, /\.role-preview\s*\{[^}]*repeat\(auto-fit,minmax\(210px,1fr\)\)/);
  assert.doesNotMatch(css, /body\s*\{\s*min-width:\s*1024px/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*\.world-hero\s*\{\s*grid-template-columns:1fr/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*\.room-main\s*\{\s*grid-template-columns:1fr/);
  assert.match(html, /platform\.js\?v=[^"']+/);
});
