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

test("World Credits script preserves safe action-metering return routing", () => {
  const script = read("js/credits.js");
  assert.match(script, /WORLD_UNLOCK/);
  assert.match(script, /RUN_CREATE/);
  assert.match(script, /PLAYER_RECLAIM/);
  assert.match(script, /authUrl\(key\)/);
  assert.match(script, /location\.assign\(authUrl\(key\)\)/);
  assert.match(script, /selectedPack && !getToken\(\)/);
  assert.match(script, /location\.replace\(authUrl\(selectedPack\)\)/);
  assert.match(script, /Your room link will be preserved/);
  assert.doesNotMatch(script, /requiredCredits/);
  assert.doesNotMatch(script, /\|\| 100/);
  assert.doesNotMatch(script, /You are unlocking/);
  assert.doesNotMatch(script, /Round \$\{/);
  assert.match(script, /canonicalReturn = intent === "WORLD_UNLOCK" && runId/);
  assert.match(script, /returnTo = intent !== "WALLET" \? safeRequestedReturn : "\/"/);
  assert.match(script, /PLAYER_ACTION: "Player action"/);
  assert.match(script, /RUN_SPONSORSHIP: "Run sponsorship"/);
  assert.match(script, /RUN_ALLOWANCE_USAGE: "Run allowance action"/);
  assert.match(script, /transactions\.allowanceUsages/);
  assert.match(script, /Charge \$\{shortId\(trace\.charge\.id\)\}/);
  assert.match(script, /document\.querySelectorAll\("\[data-return-link\], \[data-return-bottom\]"\)/);
  assert.doesNotMatch(script, /by\("\[data-return-link\]"\)\.href/);
  assert.match(script, /else \{\s*setContext\(\);\s*render\(\);\s*await Promise\.all/s);
  assert.match(script, /Return to story/);
});

test("all public disclosure entry points explain the active-action charging schedule", () => {
  const credits = read("credits.html");
  const home = read("home.js");
  const rooms = read("platform.js");
  const terms = read("legal/terms-of-service.md");
  for (const source of [credits, home, terms]) {
    assert.match(source, /20 (?:World )?Credits?/i);
    assert.match(source, /suggested action/i);
    assert.match(source, /custom (?:or complex )?action|custom action/i);
    assert.match(source, /AI(?:-controlled)? actions?|AI control/i);
  }
  assert.match(rooms, /runCreateCredits/);
  assert.match(rooms, /suggested action/i);
  assert.match(rooms, /custom action/i);
  assert.match(rooms, /AI-controlled actions/i);
  assert.match(credits, /Pay for successful story actions, not AI requests/);
  assert.match(credits, /legacy unlock policy/);
  assert.match(rooms, /Creating this Story Run uses \$\{runCreateCredits\} World Credits/);
  assert.match(rooms, /Create Room · \$\{runCreateCredits\} Credits/);
  assert.match(rooms, /This world uses its legacy unlock policy/);
  assert.match(rooms, /does not use the 20-Credit active-action fee/);
  assert.match(home, /Reading, AI-controlled actions, system progress, retries, and failed generations cost 0 Credits/);
  assert.match(terms, /becomes final only after the requested run or action is successfully published/);
  assert.match(terms, /not for the number of AI-provider calls, tokens, retries, or internal processing steps/);
});

test("success page delegates credit authority to checkout status polling", () => {
  const success = read("credits-success.html");
  const script = read("js/credits-success.js");
  assert.match(success, /We are adding your World Credits now/);
  assert.match(script, /v4\/billing\/checkouts/);
  assert.match(script, /status === \"PAID\"/);
  assert.doesNotMatch(script, /POST.*credits|grantCredits/);
});

test("payment status page hides the global header and renders centered success actions", () => {
  const page = read("credits-status.html");
  const script = read("js/credits-status.js");
  const styles = read("payment-status.css");
  const visibleMarkup = page.replace(/<!--[\s\S]*?-->/g, "");
  const paidBranch = script.slice(script.indexOf("if (isPaid)"), script.indexOf("} else if (isProcessing)"));

  assert.match(page, /Global payment-status header temporarily disabled/);
  assert.doesNotMatch(visibleMarkup, /<header\b/);
  assert.match(page, /payment-status\.css\?v=/);
  assert.match(paidBranch, /View World Credits/);
  assert.match(paidBranch, /Back to home/);
  assert.doesNotMatch(paidBranch, /Try again/);
  assert.match(styles, /display:\s*inline-flex\s*!important/);
  assert.match(styles, /align-items:\s*center/);
  assert.match(styles, /justify-content:\s*center/);
  assert.match(styles, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\)/);
});
