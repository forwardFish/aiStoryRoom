import assert from "node:assert/strict";
import test from "node:test";
import { RoomListProjectionScheduler } from "./rooms-list-projection";

test("room list projections are ordered and globally serialized", async () => {
  const scheduler = new RoomListProjectionScheduler();
  let active = 0;
  let maximumActive = 0;
  const visited: string[] = [];
  const project = async (value: string) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    visited.push(value);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value.toUpperCase();
  };

  const [first, second] = await Promise.all([
    scheduler.projectOrdered(["a", "b"], project),
    scheduler.projectOrdered(["c", "d"], project),
  ]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(visited, ["a", "b", "c", "d"]);
  assert.deepEqual(first, ["A", "B"]);
  assert.deepEqual(second, ["C", "D"]);
});

test("a failed list projection does not poison the shared queue", async () => {
  const scheduler = new RoomListProjectionScheduler();
  await assert.rejects(
    () => scheduler.projectOrdered(["broken"], async () => {
      throw new Error("projection failed");
    }),
    /projection failed/,
  );

  const recovered = await scheduler.projectOrdered([2, 3], async (value) => value * 2);
  assert.deepEqual(recovered, [4, 6]);
});
