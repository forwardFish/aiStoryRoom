import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCausalDelta } from "../src/causal-context.js";
import {
  validateSurfaceIntegrity,
} from "../src/surface-integrity.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(currentDir, "..", "src");

test("P03 active Canon path does not import legacy lexical gates or a story adapter", async () => {
  const runtime = await readFile(path.join(sourceDir, "runtime.ts"), "utf8");
  const foreground = await readFile(path.join(sourceDir, "foreground.ts"), "utf8");
  const active = `${runtime}\n${foreground}`;

  for (const forbiddenImport of [
    "./durable-truth-gate.js",
    "./surface-guard.js",
    "./causal-delta.js",
    "./sangtian-decisions.js",
  ]) {
    assert.doesNotMatch(active, new RegExp(escapeRegExp(forbiddenImport)));
  }
  assert.doesNotMatch(runtime, /worldId\s*(?:===|!==|==|!=)/u);
  assert.doesNotMatch(runtime, /sangtian|caesar|桑田|凯撒|总督|巡抚|县册/iu);
});

test("P03 causal context copies typed authorization without classifying prose", () => {
  const delta = buildCausalDelta({
    turnId: "T01",
    action: "Keep the present course and wait for a reply.",
    selectedOption: {
      id: "fixture.option.one",
      label: "Keep the present course.",
      effect: {
        intent: "Keep the present course.",
        stateHints: [{
          key: "fixture.state.one",
          op: "set",
          value: true,
          presentThisTurn: true,
          surfaceAnchor: "The chosen course remains in force.",
        }],
      },
    },
  });

  assert.equal(delta.immediateIntent, "Keep the present course.");
  assert.deepEqual(delta.requiredNarrativeFacts, [
    "The chosen course remains in force.",
  ]);
  assert.equal(delta.protagonistScope, "bounded-action");
});

test("P03 Surface Guard rejects broken output but never decides story truth", () => {
  assert.equal(validateSurfaceIntegrity("").reason, "NARRATION_EMPTY");
  assert.equal(
    validateSurfaceIntegrity('{"stateRevision":2}').reason,
    "NARRATION_STRUCTURED_OUTPUT",
  );
  assert.equal(
    validateSurfaceIntegrity("He signed nothing. An aide carried the case to the door.").ok,
    true,
  );
  assert.equal(
    validateSurfaceIntegrity("他没有落印。侍从把匣子捧到门边。另一人提出派员随行。 ").ok,
    true,
  );
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
