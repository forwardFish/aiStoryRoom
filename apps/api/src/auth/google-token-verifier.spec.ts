import assert from "node:assert/strict";
import test from "node:test";
import { GoogleTokenVerifier } from "./google-token-verifier";

const validPayload = () => ({
  iss: "https://accounts.google.com",
  aud: "google-client-id.test",
  sub: "google-subject-1",
  email: "Person@Gmail.com",
  email_verified: true,
  nonce: "nonce-1",
  exp: Math.floor(Date.now() / 1_000) + 300,
  name: "Google Person",
  picture: "https://lh3.googleusercontent.com/avatar"
});

test("Google token verification binds the official library to the configured audience", async () => {
  await withGoogleEnvironment(async () => {
    let receivedAudience = "";
    const verifier = verifierFor(validPayload(), (audience) => { receivedAudience = String(audience || ""); });
    const identity = await verifier.verify("signed-google-id-token");
    assert.equal(receivedAudience, "google-client-id.test");
    assert.deepEqual(identity, {
      subject: "google-subject-1",
      email: "person@gmail.com",
      emailVerified: true,
      hostedDomain: null,
      nonce: "nonce-1",
      name: "Google Person",
      picture: "https://lh3.googleusercontent.com/avatar"
    });
  });
});

test("Google token verification rejects invalid issuer, expiry, subject, nonce, and library failures", async () => {
  await withGoogleEnvironment(async () => {
    const cases = [
      { iss: "https://attacker.example" },
      { exp: Math.floor(Date.now() / 1_000) - 1 },
      { sub: "" },
      { nonce: "" },
      { email: "" }
    ];
    for (const override of cases) {
      await assert.rejects(() => verifierFor({ ...validPayload(), ...override }).verify("credential"), hasCode("INVALID_GOOGLE_CREDENTIAL"));
    }
    const verifier = new GoogleTokenVerifier();
    (verifier as any).client = { verifyIdToken: async () => { throw new Error("wrong audience or signature"); } };
    await assert.rejects(() => verifier.verify("credential"), hasCode("INVALID_GOOGLE_CREDENTIAL"));
  });
});

function verifierFor(payload: Record<string, unknown>, captureAudience: (audience: unknown) => void = () => {}) {
  const verifier = new GoogleTokenVerifier();
  (verifier as any).client = {
    verifyIdToken: async ({ audience }: { audience?: unknown }) => {
      captureAudience(audience);
      return { getPayload: () => payload };
    }
  };
  return verifier;
}

async function withGoogleEnvironment(run: () => Promise<void>) {
  const priorClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const priorEnabled = process.env.GOOGLE_AUTH_ENABLED;
  process.env.GOOGLE_WEB_CLIENT_ID = "google-client-id.test";
  process.env.GOOGLE_AUTH_ENABLED = "true";
  try { await run(); }
  finally {
    if (priorClientId === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID; else process.env.GOOGLE_WEB_CLIENT_ID = priorClientId;
    if (priorEnabled === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = priorEnabled;
  }
}

function hasCode(code: string) {
  return (error: any) => error?.getResponse?.()?.code === code;
}
