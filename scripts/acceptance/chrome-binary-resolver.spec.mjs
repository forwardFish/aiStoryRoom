import assert from "node:assert/strict";
import test from "node:test";
import {
  createLegacyWhichChromeExecFileSync,
  installLegacyWhichChromeResolver,
  resolveChromeBinary,
} from "./chrome-binary-resolver.mjs";

test("uses an existing absolute CHROME_BIN without invoking a locator", () => {
  let calls = 0;
  const expected = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const result = resolveChromeBinary({
    platform: "win32",
    env: { CHROME_BIN: expected },
    existsSync: (candidate) => candidate === expected,
    execFileSync: () => { calls += 1; throw new Error("should not run"); },
  });
  assert.equal(result, expected);
  assert.equal(calls, 0);
});

test("uses a standard Windows Chrome install path", () => {
  const expected = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const result = resolveChromeBinary({
    platform: "win32",
    env: { ProgramFiles: "C:\\Program Files" },
    existsSync: (candidate) => candidate === expected,
    execFileSync: () => { throw new Error("should not run"); },
  });
  assert.equal(result, expected);
});

test("uses a standard Windows Edge install path", () => {
  const expected = "C:\\LocalAppData\\Microsoft\\Edge\\Application\\msedge.exe";
  const result = resolveChromeBinary({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\LocalAppData" },
    existsSync: (candidate) => candidate === expected,
    execFileSync: () => { throw new Error("should not run"); },
  });
  assert.equal(result, expected);
});

test("falls back to where.exe on Windows", () => {
  const expected = "D:\\Browsers\\chrome.exe";
  const calls = [];
  const result = resolveChromeBinary({
    platform: "win32",
    env: { CHROME_BIN: "chrome-canary.exe" },
    existsSync: (candidate) => candidate === expected,
    execFileSync: (command, args) => {
      calls.push([command, args]);
      if (command === "where.exe" && args[0] === "chrome-canary.exe") return `${expected}\r\n`;
      throw new Error("not found");
    },
  });
  assert.equal(result, expected);
  assert.deepEqual(calls[0], ["where.exe", ["chrome-canary.exe"]]);
});

test("uses command -v before which on Unix", () => {
  const calls = [];
  const result = resolveChromeBinary({
    platform: "linux",
    env: {},
    existsSync: (candidate) => candidate === "/usr/bin/chromium",
    execFileSync: (command, args) => {
      calls.push([command, args]);
      if (command === "sh" && args.at(-1) === "chromium") return "/usr/bin/chromium\n";
      throw new Error("not found");
    },
  });
  assert.equal(result, "/usr/bin/chromium");
  assert.ok(calls.some(([command]) => command === "sh"));
});

test("falls back to which on Unix", () => {
  const calls = [];
  const result = resolveChromeBinary({
    platform: "linux",
    env: { CHROME_BIN: "custom-chrome" },
    existsSync: (candidate) => candidate === "/opt/bin/custom-chrome",
    execFileSync: (command, args) => {
      calls.push([command, args]);
      if (command === "sh") throw new Error("command unavailable");
      if (command === "which" && args[0] === "custom-chrome") return "/opt/bin/custom-chrome\n";
      throw new Error("not found");
    },
  });
  assert.equal(result, "/opt/bin/custom-chrome");
  assert.deepEqual(calls.slice(0, 2).map(([command]) => command), ["sh", "which"]);
});

test("throws when no real browser is available", () => {
  assert.throws(() => resolveChromeBinary({
    platform: "linux",
    env: {},
    existsSync: () => false,
    execFileSync: () => { throw new Error("not found"); },
  }), /A real Chrome\/Chromium binary is required/);
});

test("legacy adapter resolves only once and delegates unrelated commands", () => {
  let resolutions = 0;
  const delegated = [];
  const compat = createLegacyWhichChromeExecFileSync(
    () => { resolutions += 1; return "/usr/bin/chromium"; },
    (...args) => { delegated.push(args); return "delegated"; },
  );
  assert.equal(compat("which", ["google-chrome"], { encoding: "utf8" }), "/usr/bin/chromium\n");
  assert.deepEqual(compat("which", ["chromium"]), Buffer.from("/usr/bin/chromium\n"));
  assert.equal(compat("where.exe", ["chrome.exe"], { encoding: "utf8" }), "delegated");
  assert.equal(resolutions, 1);
  assert.equal(delegated.length, 1);
});

test("installed legacy adapter is visible to later named imports and restores cleanly", async () => {
  const binary = "/usr/bin/chromium";
  const restore = installLegacyWhichChromeResolver(() => binary);
  try {
    const module = await import(`data:text/javascript,${encodeURIComponent(`
      import { execFileSync } from "node:child_process";
      export const located = execFileSync("which", ["google-chrome"], { encoding: "utf8" }).trim();
    `)}#${Date.now()}`);
    assert.equal(module.located, binary);
  } finally {
    restore();
  }
});

test("resolves the browser installed in the current execution environment", () => {
  const binary = resolveChromeBinary();
  assert.ok(binary);
});
