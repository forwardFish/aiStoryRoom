import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared mutation guard drops duplicate clicks until the first request settles", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = source.indexOf("const pendingMutations");
  const end = source.indexOf("function pendingMutationKey", start);
  const guardSource = source.slice(start, end);
  const runMutationOnce = Function(`${guardSource}; return runMutationOnce;`)();
  let finish;
  let calls = 0;
  const button = {
    disabled: false,
    textContent: "Ready",
    isConnected: true,
    setAttribute() {},
    removeAttribute() {}
  };
  const operation = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };

  const first = runMutationOnce("room:one:ready", button, "Saving…", operation);
  const duplicate = await runMutationOnce("room:one:ready", button, "Saving…", operation);
  assert.equal(duplicate, undefined);
  assert.equal(calls, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Saving…");

  finish();
  await first;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Ready");
});

test("room mutation buttons all use the shared pending guard", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  assert.ok((source.match(/runMutationOnce\(/g) || []).length >= 7);
  for (const key of ["join-room:", "create-room:", "join-open-room:", ":select-role", ":ready", ":start"]) {
    assert.ok(source.includes(key), `${key} must have a pending mutation key`);
  }
});
