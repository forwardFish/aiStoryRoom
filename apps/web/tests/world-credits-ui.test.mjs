import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("public");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("World Credits page exposes a wallet balance, two real packs, rewards and secure checkout", () => {
  const credits = read("credits.html");
  assert.doesNotMatch(credits, /Sign in to purchase|Sign in or create account/);
  assert.doesNotMatch(credits, /data-signed-out/);
  assert.match(credits, /data-unlock-context/);
  assert.match(credits, /data-pack="credits_300"/);
  assert.match(credits, /data-pack="credits_650"/);
  assert.match(credits, /<strong>300<\/strong><span class="pack-unit">World Credits<\/span>/);
  assert.match(credits, /<strong>650<\/strong><span class="pack-unit">World Credits<\/span>/);
  assert.match(credits, /class="credits-reward-panel"/);
  assert.match(credits, /\$7\.99/);
  assert.match(credits, /\$14\.99/);
  assert.match(credits, /Best value/);
  assert.match(credits, /New account reward/);
  assert.match(credits, /\+50 World Credits/);
  assert.match(credits, /Referral reward/);
  assert.match(credits, /\+25 World Credits/);
  assert.match(credits, /eligible referral/);
  assert.match(credits, /Exact Credit cost shown before you confirm any use/);
  assert.match(credits, /data-confirm-purchase/);
  assert.match(credits, /secure Creem checkout/);
  assert.doesNotMatch(credits, /Best for this room/i);
  assert.doesNotMatch(credits, /Purchased Credits never expire/i);
  assert.doesNotMatch(credits, /Bonus Credits expire/i);
  assert.doesNotMatch(credits, /90 days/i);
  assert.doesNotMatch(credits, /two qualified/i);
  assert.doesNotMatch(credits, /100 Credits/i);
});

test("World Credits script preserves room return routing without advertising an unconfirmed room price", () => {
  const script = read("js/credits.js");
  assert.match(script, /WORLD_UNLOCK/);
  assert.match(script, /authUrl\(key\)/);
  assert.match(script, /location\.assign\(authUrl\(key\)\)/);
  assert.match(script, /selectedPack && !getToken\(\)/);
  assert.match(script, /location\.replace\(authUrl\(selectedPack\)\)/);
  assert.match(script, /Your room link will be preserved/);
  assert.doesNotMatch(script, /requiredCredits/);
  assert.doesNotMatch(script, /\|\| 100/);
  assert.doesNotMatch(script, /You are unlocking/);
  assert.doesNotMatch(script, /Round \$\{/);
});

test("success page delegates credit authority to checkout status polling", () => {
  const success = read("credits-success.html");
  const script = read("js/credits-success.js");
  assert.match(success, /We are adding your World Credits now/);
  assert.match(script, /v4\/billing\/checkouts/);
  assert.match(script, /status === \"PAID\"/);
  assert.doesNotMatch(script, /POST.*credits|grantCredits/);
});
