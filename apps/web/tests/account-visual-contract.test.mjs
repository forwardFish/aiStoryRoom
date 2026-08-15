import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("account visual polish preserves the account content and purchase table contract", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.css", import.meta.url), "utf8")
  ]);

  for (const text of [
    "My Account",
    "View your profile and purchase history.",
    "Purchases &amp; refunds",
    "Add Credits",
    "World Credits",
    "Checking balance…",
    "Balance unavailable",
    "Order number",
    "Purchase date",
    "World Credits",
    "Amount",
    "Payment status",
    "Refund status",
    "Action",
    "Edit profile",
    "Log out"
  ]) assert.ok(source.includes(text), `missing preserved account content: ${text}`);

  assert.match(source, /class="account-purchase-table"/);
  assert.match(source, /data-account-credit-balance/);
  assert.match(source, /request\("\/api\/v4\/credits\/balance"\)/);
  assert.match(source, /"retry-credit-balance"/);
  assert.match(css, /\.account-avatar[^{]*\{[^}]*width:92px;[^}]*height:92px;/s);
  assert.match(css, /\.account-credit-balance[^{]*\{[^}]*border:1px solid #ded3ff;/s);
  assert.match(css, /\.account-profile-card[^{]*\{[^}]*grid-template-columns:120px minmax\(0,1fr\) minmax\(188px,240px\) auto;/s);
});
