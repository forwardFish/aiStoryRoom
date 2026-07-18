import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readPublic = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
const withoutHtmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, "");

test("platform pages render the shared header only behind a room waiting lobby", async () => {
  const source = await readPublic("platform.js");
  const shell = source.slice(source.indexOf("function appShell"), source.indexOf("function currentRoomPlayer"));

  assert.match(source, /function header\(active = ""\)/);
  assert.match(shell, /const roomWaitingHeader = path\.startsWith\("\/rooms\/"\) \? header\("rooms"\) : ""/);
  assert.match(shell, /root\.innerHTML = `\$\{roomWaitingHeader\}\$\{content\}`/);
  assert.doesNotMatch(shell, /header\(active \|\|/);
});

test("Credits renders its brand header while payment status stays focused", async () => {
  const [credits, status] = await Promise.all([
    readPublic("credits.html"),
    readPublic("credits-status.html")
  ]);

  assert.match(withoutHtmlComments(credits), /<header class="mw-header credits-header">/);
  assert.match(withoutHtmlComments(credits), /Our Many Worlds/);
  assert.match(status, /Global payment-status header temporarily disabled/);
  assert.doesNotMatch(withoutHtmlComments(status), /<header class="mw-header credits-header">/);
});

test("shared role selection and legal pages do not mount global headers", async () => {
  const [roles, roleView, legal] = await Promise.all([
    readPublic("role-select.js"),
    readPublic("room-role-selection-view.js"),
    readPublic("legal.js")
  ]);

  assert.match(roles, /renderRoomSelectionPage/);
  assert.doesNotMatch(roles, /renderHeader/);
  assert.doesNotMatch(roleView, /mw-header|role-header/);
  assert.match(legal, /function navigation\(pathname\)/);
  assert.match(legal, /<header class="legal-header">/);
  assert.match(legal, /Our Many Worlds/);
});
