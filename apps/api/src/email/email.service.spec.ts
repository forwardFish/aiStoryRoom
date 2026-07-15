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
    sink: process.env.AUTH_MAIL_SINK_FILE,
    publicWebUrl: process.env.PUBLIC_WEB_URL
  };
  const directory = await mkdtemp(join(tmpdir(), "many-worlds-auth-mail-"));
  try {
    process.env.NODE_ENV = "development";
    process.env.EMAIL_PROVIDER = "file-sink";
    process.env.AUTH_MAIL_SINK_FILE = join(directory, "mail.ndjson");
    process.env.PUBLIC_WEB_URL = "http://localhost:5177";
    const development = new EmailService();
    assert.deepEqual(development.readiness(), { ready: true, provider: "file-sink" });
    await development.sendVerification({ email: "reader@example.test", token: "raw-token-must-only-appear-in-mail", returnTo: "/join?room=ROOM1&ref=REF1&channel=LINK", idempotencyKey: "email-test-1" });
    const sink = await readFile(process.env.AUTH_MAIL_SINK_FILE, "utf8");
    assert.match(sink, /mode=verify/);
    assert.match(sink, /returnTo=%2Fjoin%3Froom%3DROOM1%26ref%3DREF1%26channel%3DLINK/);

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
    restore("AUTH_MAIL_SINK_FILE", original.sink);
    restore("PUBLIC_WEB_URL", original.publicWebUrl);
  }
}

function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
function hasCode(code: string) { return (error: any) => error?.getResponse?.()?.code === code; }

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
