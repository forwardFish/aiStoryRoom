import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const publicUrl = new URL("../public/", import.meta.url);

test("Play Solo delegates creation and resume behavior to role selection", async () => {
  const platform = await readFile(new URL("platform.js", publicUrl), "utf8");
  const start = platform.indexOf("function startSoloFromWorld");
  const end = platform.indexOf("function openStartConfirmation", start);
  const soloFlow = platform.slice(start, end);
  assert.match(soloFlow, /location\.assign\(`\/role-select\?story=\$\{encodeURIComponent\(worldId\)\}`\)/);
  assert.doesNotMatch(soloFlow, /\/api\/v4\/rooms\/solo|resumeExisting|openSoloRunChoiceDialog|request\(/);
});
