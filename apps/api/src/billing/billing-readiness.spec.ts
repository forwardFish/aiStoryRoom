import assert from "node:assert/strict";
import test from "node:test";
import { CreemClient, creemBaseUrl, creemConfigurationReadiness } from "./creem.client";

test("fails closed when the Creem environment is not explicit", () => {
  const readiness = creemConfigurationReadiness({ NODE_ENV: "production", CREEM_API_KEY: "configured", CREEM_WEBHOOK_SECRET: "configured" });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.mode, "invalid");
  assert.throws(() => creemBaseUrl({}), (error: any) => error?.response?.code === "CREEM_MODE_REQUIRED");
});

test("rejects Test checkout mode in production or an ambiguous runtime", () => {
  const readiness = creemConfigurationReadiness({
    NODE_ENV: "production",
    CREEM_MODE: "test",
    CREEM_API_KEY: "test-key",
    CREEM_WEBHOOK_SECRET: "test-webhook",
    CREEM_MOCK_MODE: "false"
  });
  assert.equal(readiness.ready, false);
  const ambiguous = creemConfigurationReadiness({
    CREEM_MODE: "test",
    CREEM_API_KEY: "test-key",
    CREEM_WEBHOOK_SECRET: "test-webhook"
  });
  assert.equal(ambiguous.ready, false);
  assert.equal(readiness.mode, "test");
  assert.equal(readiness.checkout.usingDefaultTestProducts, true);
  assert.equal(readiness.refund.adminReviewReady, false);
  assert.equal(readiness.refund.automaticSubmissionReady, false);
  assert.equal(readiness.closureReady, false);
  assert.throws(() => creemBaseUrl({ CREEM_MODE: "test" }), (error: any) => error?.response?.code === "CREEM_TEST_MODE_FORBIDDEN");
  assert.equal(creemBaseUrl({ NODE_ENV: "test", CREEM_MODE: "test" }), "https://test-api.creem.io/v1");
});

test("allows Test checkout mode outside production", () => {
  const readiness = creemConfigurationReadiness({
    NODE_ENV: "test",
    CREEM_MODE: "test",
    CREEM_API_KEY: "test-key",
    CREEM_WEBHOOK_SECRET: "test-webhook",
    CREEM_MOCK_MODE: "false"
  });
  assert.equal(readiness.ready, true);
});

test("mock checkout execution fails closed outside non-production Test mode", async () => {
  const keys = ["NODE_ENV", "CREEM_MODE", "CREEM_MOCK_MODE"] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const input = { productId: "product-test", successUrl: "http://localhost/credits/success", requestId: "request-test", metadata: {} };
  const client = new CreemClient();
  try {
    for (const environment of [
      { NODE_ENV: "production", CREEM_MODE: "test", CREEM_MOCK_MODE: "true" },
      { NODE_ENV: "development", CREEM_MODE: "live", CREEM_MOCK_MODE: "true" },
      { NODE_ENV: "", CREEM_MODE: "test", CREEM_MOCK_MODE: "true" },
      { NODE_ENV: "development", CREEM_MODE: "", CREEM_MOCK_MODE: "true" }
    ]) {
      Object.assign(process.env, environment);
      await assert.rejects(client.createCheckout(input), (error: any) => error?.response?.code === "CREEM_MOCK_MODE_FORBIDDEN");
    }
    Object.assign(process.env, { NODE_ENV: "development", CREEM_MODE: "test", CREEM_MOCK_MODE: "true" });
    const result = await client.createCheckout(input);
    assert.match(result.id, /^mock_checkout_/);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("requires explicit Live products and rejects mock mode outside its allowed runtime", () => {
  const incomplete = creemConfigurationReadiness({
    NODE_ENV: "production",
    CREEM_MODE: "live",
    CREEM_API_KEY: "live-key",
    CREEM_WEBHOOK_SECRET: "live-webhook"
  });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.checkout.productsConfigured, false);

  const mock = creemConfigurationReadiness({
    NODE_ENV: "production",
    CREEM_MODE: "live",
    CREEM_API_KEY: "live-key",
    CREEM_WEBHOOK_SECRET: "live-webhook",
    CREEM_PRODUCT_300_ID: "product-300",
    CREEM_PRODUCT_650_ID: "product-650",
    CREEM_MOCK_MODE: "true"
  });
  assert.equal(mock.ready, false);
  for (const nodeEnv of ["development", undefined]) {
    const invalidMock = creemConfigurationReadiness({
      NODE_ENV: nodeEnv,
      CREEM_MODE: "live",
      CREEM_API_KEY: "live-key",
      CREEM_WEBHOOK_SECRET: "live-webhook",
      CREEM_PRODUCT_300_ID: "product-300",
      CREEM_PRODUCT_650_ID: "product-650",
      CREEM_MOCK_MODE: "true"
    });
    assert.equal(invalidMock.ready, false);
  }
  assert.throws(() => creemBaseUrl({ CREEM_MODE: "production" }), (error: any) => error?.response?.code === "CREEM_MODE_REQUIRED");
});

test("distinguishes core payment readiness from full refund closure", () => {
  const readiness = creemConfigurationReadiness({
    NODE_ENV: "production",
    CREEM_MODE: "live",
    CREEM_API_KEY: "live-key",
    CREEM_WEBHOOK_SECRET: "live-webhook",
    CREEM_PRODUCT_300_ID: "product-300",
    CREEM_PRODUCT_650_ID: "product-650",
    CREEM_MOCK_MODE: "false",
    ADMIN_EMAILS: "admin@example.test",
    CREEM_REFUND_API_PATH: "/v1/transactions/{transactionId}/refund"
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.refund.adminReviewReady, true);
  assert.equal(readiness.refund.automaticSubmissionReady, true);
  assert.equal(readiness.closureReady, true);
});
