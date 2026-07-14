import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("public");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("World Credits page exposes signed-out, contextual purchase and secure checkout states", () => {
  const credits = read("credits.html");
  assert.match(credits, /Sign in or create account/);
  assert.match(credits, /data-unlock-context/);
  assert.match(credits, /data-pack="credits_300"/);
  assert.match(credits, /data-pack="credits_650"/);
  assert.match(credits, /data-confirm-purchase/);
  assert.match(credits, /secure Creem checkout/);
});

test("success page delegates credit authority to checkout status polling", () => {
  const success = read("credits-success.html");
  const script = read("js/credits-success.js");
  assert.match(success, /We are adding your World Credits now/);
  assert.match(script, /v4\/billing\/checkouts/);
  assert.match(script, /status === \"PAID\"/);
  assert.doesNotMatch(script, /POST.*credits|grantCredits/);
});
