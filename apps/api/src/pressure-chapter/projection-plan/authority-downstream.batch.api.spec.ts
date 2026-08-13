import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "authority-downstream.ts"), "utf8");

test("production downstream persistence exposes set-based narrative and outbox writes", () => {
  assert.match(source, /pressureNarrativeProjection\.createMany/u);
  assert.match(source, /pressureOutboxTask\.createMany/u);
  assert.match(source, /projections\.count !== projectionRows\.length/u);
  assert.match(source, /inserted\.count !== rows\.length/u);
});
