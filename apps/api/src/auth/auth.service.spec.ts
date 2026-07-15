import assert from "node:assert/strict";
import { allowsBrowserAuthTokens } from "./auth.service";

const original = {
  nodeEnv: process.env.NODE_ENV,
  creemMode: process.env.CREEM_MODE,
  override: process.env.AUTH_ALLOW_BROWSER_VERIFICATION
};

try {
  process.env.NODE_ENV = "production";
  process.env.CREEM_MODE = "test";
  delete process.env.AUTH_ALLOW_BROWSER_VERIFICATION;
  assert.equal(allowsBrowserAuthTokens(), true, "hosted Creem test must support browser verification");

  process.env.CREEM_MODE = "prod";
  assert.equal(allowsBrowserAuthTokens(), false, "production payments must not expose auth tokens");

  process.env.AUTH_ALLOW_BROWSER_VERIFICATION = "true";
  assert.equal(allowsBrowserAuthTokens(), true, "an explicit sandbox override must be honored");

  process.env.AUTH_ALLOW_BROWSER_VERIFICATION = "false";
  process.env.CREEM_MODE = "test";
  assert.equal(allowsBrowserAuthTokens(), false, "an explicit production-safe override must win");

  console.log("auth browser-token environment assertions passed");
} finally {
  if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
  if (original.creemMode === undefined) delete process.env.CREEM_MODE; else process.env.CREEM_MODE = original.creemMode;
  if (original.override === undefined) delete process.env.AUTH_ALLOW_BROWSER_VERIFICATION; else process.env.AUTH_ALLOW_BROWSER_VERIFICATION = original.override;
}
