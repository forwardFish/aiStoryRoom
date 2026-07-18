import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Join with Code uses an in-page accessible dialog instead of a suppressible prompt", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = source.indexOf("function openJoinCodeDialog(");
  const end = source.indexOf("async function hydrateRoom", start);
  const dialog = source.slice(start, end);
  const actionsStart = source.indexOf("const actions =");
  const actions = source.slice(actionsStart);

  assert.match(dialog, /document\.createElement\("dialog"\)/);
  assert.match(dialog, /name="inviteCode"/);
  assert.match(dialog, /Join Room/);
  assert.match(dialog, /\/api\/v4\/rooms\/join-by-code/);
  assert.match(dialog, /dialog\.showModal\(\)/);
  assert.match(dialog, /saveRoomDialogDraft\(\{ type: "join", code:/);
  assert.match(dialog, /input\.addEventListener\("input"/);
  assert.match(dialog, /dialog\.addEventListener\("cancel", \(\) => \{ clearRoomDialogDraft\(\); \}/);
  assert.match(dialog, /clearRoomDialogDraft\(\)/);
  assert.doesNotMatch(actions, /prompt\("Enter an invite code"\)/);
});
