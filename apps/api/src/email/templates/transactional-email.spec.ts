import assert from "node:assert/strict";
import test from "node:test";
import { resetPasswordTemplate } from "./reset-password";
import { buildTransactionalEmail } from "./transactional-email";
import { verifyEmailTemplate } from "./verify-email";

test("all current transactional emails use the official Many Worlds design system", () => {
  const templates = [
    verifyEmailTemplate("https://ourmanyworlds.com/auth?mode=verify&token=verification-token", 30, "support@ourmanyworlds.com"),
    resetPasswordTemplate("https://ourmanyworlds.com/reset-password?token=reset-token", 15, "support@ourmanyworlds.com")
  ];

  for (const template of templates) {
    assert.match(template.subject, /\| Many Worlds$/);
    assert.match(template.html, /^<!doctype html>/i);
    assert.match(template.html, /Official account message/);
    assert.match(template.html, />MW<\/div>/);
    assert.match(template.html, /Many Worlds will never ask you/);
    assert.match(template.html, /If the button does not work/);
    assert.match(template.html, /support@ourmanyworlds\.com/);
    assert.match(template.html, /@media only screen and \(max-width: 620px\)/);
    assert.match(template.html, /display:inline-block;width:100%/);
    assert.match(template.text, /^MANY WORLDS\n/);
    assert.match(template.text, /SECURITY NOTICE:/);
    assert.doesNotMatch(template.html, /<script\b|<form\b|javascript:/i);
  }
});

test("transactional email layout rejects unsafe action protocols", () => {
  assert.throws(() => buildTransactionalEmail({
    subject: "Unsafe | Many Worlds",
    preheader: "Unsafe link test",
    eyebrow: "ACCOUNT SECURITY",
    title: "Unsafe link",
    introduction: "This message should never render.",
    actionLabel: "Continue",
    actionUrl: "javascript:alert(1)",
    followUp: "No follow up.",
    securityNotice: "Do not use this link."
  }), /must use http or https/);
});

test("transactional email layout escapes dynamic copy and uses a safe support fallback", () => {
  const template = buildTransactionalEmail({
    subject: "Security <notice> | Many Worlds",
    preheader: "Preview <unsafe>",
    eyebrow: "ACCOUNT SECURITY",
    title: "Review <account>",
    introduction: "Never render <script>alert(1)</script>.",
    actionLabel: "Continue safely",
    actionUrl: "https://ourmanyworlds.com/auth?token=safe-token",
    followUp: "Continue after review.",
    securityNotice: "This link is private.",
    supportEmail: "not-an-email"
  });

  assert.doesNotMatch(template.html, /<script>alert/);
  assert.match(template.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(template.html, /support@ourmanyworlds\.com/);
  assert.match(template.html, /Security &lt;notice&gt;/);
});
