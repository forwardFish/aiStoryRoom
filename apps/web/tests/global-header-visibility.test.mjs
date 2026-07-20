import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readPublic = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
const withoutHtmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, "");

test("platform product pages render the standard page header", async () => {
  const source = await readPublic("platform.js");
  const shell = source.slice(source.indexOf("function appShell"), source.indexOf("function currentRoomPlayer"));

  assert.match(source, /function standardHeaderBackHref\(\)/);
  assert.match(source, /function standardPageHeader\(\)/);
  assert.match(source, /function renderStandardPage\(content\)[\s\S]*root\.innerHTML = `\$\{standardPageHeader\(\)\}\$\{content\}`/);
  assert.match(shell, /renderStandardPage\(content\)/);
  assert.doesNotMatch(source, /function header\(active = ""\)|roomWaitingHeader/);
});

test("Credits uses the standard page header while payment status stays focused", async () => {
  const [credits, status] = await Promise.all([
    readPublic("credits.html"),
    readPublic("credits-status.html")
  ]);

  assert.match(withoutHtmlComments(credits), /<standard-page-header back-href="\/" dynamic-return>/);
  assert.match(credits, /\/standard-page-header\.js/);
  assert.doesNotMatch(withoutHtmlComments(credits), /<header class="mw-header credits-header">/);
  assert.match(status, /Global payment-status header temporarily disabled/);
  assert.doesNotMatch(withoutHtmlComments(status), /standard-page-header|<header class="mw-header credits-header">/);
});

test("role selection shares the standard header while legal pages keep their dedicated shell", async () => {
  const [roles, roleView, legal] = await Promise.all([
    readPublic("role-select.html"),
    readPublic("room-role-selection-view.js"),
    readPublic("legal.js")
  ]);

  assert.match(roles, /<standard-page-header back-href="\/">/);
  assert.match(roles, /\/standard-page-header\.js/);
  assert.doesNotMatch(roleView, /mw-room-brand|mw-room-back|mw-header|role-header/);
  assert.match(legal, /function navigation\(pathname\)/);
  assert.match(legal, /<header class="legal-header">/);
  assert.match(legal, /Our Many Worlds/);
});
