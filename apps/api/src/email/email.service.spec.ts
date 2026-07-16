import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmailService } from "./email.service";

async function run() {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    provider: process.env.EMAIL_PROVIDER,
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    replyTo: process.env.EMAIL_REPLY_TO,
    sink: process.env.AUTH_MAIL_SINK_FILE,
    publicWebUrl: process.env.PUBLIC_WEB_URL,
    verifyTtl: process.env.EMAIL_VERIFY_TTL_MINUTES,
    resetTtl: process.env.PASSWORD_RESET_TTL_MINUTES
  };
  const directory = await mkdtemp(join(tmpdir(), "many-worlds-auth-mail-"));
  try {
    process.env.NODE_ENV = "development";
    process.env.EMAIL_PROVIDER = "file-sink";
    process.env.AUTH_MAIL_SINK_FILE = join(directory, "mail.ndjson");
    process.env.PUBLIC_WEB_URL = "http://localhost:5177";
    process.env.EMAIL_REPLY_TO = "support@ourmanyworlds.com";
    process.env.EMAIL_VERIFY_TTL_MINUTES = "30";
    process.env.PASSWORD_RESET_TTL_MINUTES = "15";
    const development = new EmailService();
    assert.deepEqual(development.readiness(), { ready: true, provider: "file-sink" });
    await development.sendVerification({ email: "reader@example.test", token: "raw-token-must-only-appear-in-mail", returnTo: "/join?room=ROOM1&ref=REF1&channel=LINK", idempotencyKey: "email-test-1" });
    const sink = await readFile(process.env.AUTH_MAIL_SINK_FILE, "utf8");
    assert.match(sink, /mode=verify/);
    assert.match(sink, /returnTo=%2Fjoin%3Froom%3DROOM1%26ref%3DREF1%26channel%3DLINK/);
    await development.sendPasswordReset({ email: "reader@example.test", token: "reset-token", idempotencyKey: "email-test-reset" });
    const resetSink = await readFile(process.env.AUTH_MAIL_SINK_FILE, "utf8");
    assert.match(resetSink, /\/reset-password\?token=reset-token/);
    assert.doesNotMatch(resetSink, /\/auth\?mode=reset/);
    const messages = resetSink.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(messages.length, 2);
    const [verification, passwordReset] = messages;
    assert.equal(verification.subject, "Verify your email address | Many Worlds");
    assert.match(verification.text, /Verify email address:/);
    assert.match(verification.text, /expires in 30 minutes/);
    assert.match(verification.html, /<!doctype html>/i);
    assert.match(verification.html, /Official account message/);
    assert.match(verification.html, /ACCOUNT VERIFICATION/);
    assert.match(verification.html, /Verify email address/);
    assert.match(verification.html, />MW<\/div>/);
    assert.match(verification.html, /support@ourmanyworlds\.com/);
    assert.match(verification.html, /Privacy Policy/);
    assert.match(verification.html, /Terms of Service/);
    assert.equal(passwordReset.subject, "Reset your password | Many Worlds");
    assert.match(passwordReset.text, /Reset password:/);
    assert.match(passwordReset.text, /expires in 15 minutes/);
    assert.match(passwordReset.html, /ACCOUNT SECURITY/);
    assert.match(passwordReset.html, /your password will remain unchanged/);
    for (const message of messages) {
      assert.doesNotMatch(message.html, /<script\b|<form\b/i);
      assert.match(message.html, /role=\"presentation\"/);
      assert.match(message.html, /If the button does not work/);
      assert.match(message.text, /Many Worlds will never ask you to send your password or this secure link/);
    }

    process.env.NODE_ENV = "production";
    process.env.EMAIL_PROVIDER = "resend";
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const productionWithoutProvider = new EmailService();
    assert.equal(productionWithoutProvider.readiness().ready, false);
    await assert.rejects(() => productionWithoutProvider.sendPasswordReset({ email: "reader@example.test", token: "unavailable-token", idempotencyKey: "email-test-2" }), hasCode("EMAIL_PROVIDER_NOT_READY"));
    console.log("email file-sink delivery and production readiness assertions passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
    restore("NODE_ENV", original.nodeEnv);
    restore("EMAIL_PROVIDER", original.provider);
    restore("RESEND_API_KEY", original.key);
    restore("EMAIL_FROM", original.from);
    restore("EMAIL_REPLY_TO", original.replyTo);
    restore("AUTH_MAIL_SINK_FILE", original.sink);
    restore("PUBLIC_WEB_URL", original.publicWebUrl);
    restore("EMAIL_VERIFY_TTL_MINUTES", original.verifyTtl);
    restore("PASSWORD_RESET_TTL_MINUTES", original.resetTtl);
  }
}

function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
function hasCode(code: string) { return (error: any) => error?.getResponse?.()?.code === code; }

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
