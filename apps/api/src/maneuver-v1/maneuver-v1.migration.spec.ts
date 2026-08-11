import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("the production PlayerAction constraint admits both bounded maneuver slots", async () => {
  const migration = await readFile(resolve(
    process.cwd(),
    "..",
    "..",
    "prisma",
    "migrations",
    "20260806060000_maneuver_v1_action_slots",
    "migration.sql",
  ), "utf8");

  assert.match(migration, /PlayerAction_action_slot_check/);
  assert.match(migration, /'MANEUVER_1'/);
  assert.match(migration, /'MANEUVER_2'/);
  for (const existingSlot of ["MAIN", "MANEUVER", "REACTION", "SYSTEM_ACTION"]) {
    assert.match(migration, new RegExp(`'${existingSlot}'`));
  }
  for (const existingPattern of ["TURN:%", "SOLO:%", "SOLO_CLARIFICATION:%"]) {
    assert.match(migration, new RegExp(existingPattern.replace("%", "%")));
  }
});

test("the production PlayerAction constraint admits targeted actions without losing existing visibilities", async () => {
  const migration = await readFile(resolve(
    process.cwd(),
    "..",
    "..",
    "prisma",
    "migrations",
    "20260806063000_maneuver_v1_visibility",
    "migration.sql",
  ), "utf8");

  assert.match(migration, /PlayerAction_visibility_check/);
  for (const visibility of ["PUBLIC", "OBSERVABLE", "LIMITED", "PRIVATE", "TARGETED"]) {
    assert.match(migration, new RegExp(`'${visibility}'`));
  }
});
