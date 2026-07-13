import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("public");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("World Credits pages expose registration, verification, invitation and purchase states", () => {
  const credits = read("credits.html");
  assert.match(credits, /Create local test account/);
  assert.match(credits, /Claim 50 Bonus Credits/);
  assert.match(credits, /300 World Credits/);
  assert.match(credits, /650 World Credits/);
  assert.match(credits, /data-invite/);
  assert.match(credits, /Sharing alone does not grant credits/);
});

test("success page delegates credit authority to checkout status polling", () => {
  const success = read("credits-success.html");
  const script = read("js/credits-success.js");
  assert.match(success, /We are adding your World Credits now/);
  assert.match(script, /v4\/billing\/checkouts/);
  assert.match(script, /status === \"PAID\"/);
  assert.doesNotMatch(script, /POST.*credits|grantCredits/);
});
