import assert from "node:assert/strict";
import test from "node:test";
import { getPaymentReturnOrigin } from "./billing.service";

test("uses the canonical production web origin for Creem return URLs", () => {
  assert.equal(getPaymentReturnOrigin({ NODE_ENV: "production", PUBLIC_WEB_URL: "https://ourmanyworlds.com/" }), "https://ourmanyworlds.com");
});

test("supports a dedicated payment return origin without accepting paths", () => {
  assert.equal(
    getPaymentReturnOrigin({ NODE_ENV: "production", PUBLIC_WEB_URL: "https://wrong.example", PAYMENT_RETURN_ORIGIN: "https://ourmanyworlds.com" }),
    "https://ourmanyworlds.com"
  );
  assert.throws(
    () => getPaymentReturnOrigin({ NODE_ENV: "production", PAYMENT_RETURN_ORIGIN: "https://ourmanyworlds.com/credits/status" }),
    (error: any) => error?.response?.code === "PAYMENT_RETURN_ORIGIN_INVALID"
  );
});

test("fails closed when a production return origin is missing or insecure", () => {
  assert.throws(
    () => getPaymentReturnOrigin({ NODE_ENV: "production" }),
    (error: any) => error?.response?.code === "PAYMENT_RETURN_ORIGIN_REQUIRED"
  );
  assert.throws(
    () => getPaymentReturnOrigin({ NODE_ENV: "production", PUBLIC_WEB_URL: "http://ourmanyworlds.com" }),
    (error: any) => error?.response?.code === "PAYMENT_RETURN_ORIGIN_INVALID"
  );
});

test("keeps a localhost fallback only outside production", () => {
  assert.equal(getPaymentReturnOrigin({ NODE_ENV: "development" }), "http://localhost:3000");
});
