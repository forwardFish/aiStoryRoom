import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("account and admin pages expose the reviewed refund workflow", async () => {
  const [source, css, server, vercelSource] = await Promise.all([
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.css", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8")
  ]);
  assert.match(source, /\/api\/v4\/billing\/purchases/);
  assert.match(source, /\/api\/v4\/billing\/refund-requests/);
  assert.match(source, /Approve & submit/);
  assert.match(source, /credit reversal waits for the signed refund webhook/i);
  assert.match(source, /path === "\/admin\/refunds"/);
  assert.match(css, /\.admin-refund-card/);
  assert.match(server, /"\/admin\/refunds"/);
  assert.ok(JSON.parse(vercelSource).rewrites.some((entry) => entry.source === "/admin/refunds"));
});

test("result sharing is expiring, revocable, poster-enabled and publicly routed", async () => {
  const [source, css, server, vercelSource] = await Promise.all([
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.css", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8")
  ]);
  assert.match(source, /\/result\/shares/);
  assert.match(source, /expiresInDays/);
  assert.match(source, /method:"DELETE"/);
  assert.match(source, /buildResultPoster/);
  assert.match(source, /Loading recap…/);
  assert.match(source, /hydrateResult\(params\.get\("runId"\)\)\.then\(\(loaded\)/);
  assert.match(source, /shareButton\.disabled = false/);
  assert.match(source, /private goals, hidden intent, clues, raw actions and reasoning traces/i);
  assert.match(source, /https:\/\/wa\.me/);
  assert.match(source, /https:\/\/t\.me\/share\/url/);
  assert.match(source, /facebook\.com\/sharer/);
  assert.match(source, /x\.com\/intent\/post/);
  assert.match(source, /path === "\/shared\/result"/);
  assert.match(css, /\.public-result-frame/);
  assert.match(server, /"\/shared\/result"/);
  assert.ok(JSON.parse(vercelSource).rewrites.some((entry) => entry.source === "/shared/result"));
});
