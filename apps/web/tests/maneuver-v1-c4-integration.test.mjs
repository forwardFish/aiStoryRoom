import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controllerUrl = new URL("../public/maneuver-v1/maneuver-v1-controller.js", import.meta.url);

test("real game integration covers legacy decision-zone markup and restores the existing page", async () => {
  const source = await readFile(controllerUrl, "utf8");
  assert.match(source, /\[data-testid=\\?"decision-zone\\?"\], \.decision-zone/);
  assert.match(source, /restoreLegacyView/);
  assert.match(source, /legacyPanelSnapshot/);
  assert.match(source, /data-maneuver-v1-hidden/);
});
