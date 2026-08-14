import assert from "node:assert/strict";
import test from "node:test";
import { prismaPoolTimeoutCode, roomMetricOperation } from "./api-transport";

test("critical room routes map to bounded metric labels", () => {
  assert.equal(roomMetricOperation("GET", "/api/v4/rooms?worldId=sangtian"), "list");
  assert.equal(roomMetricOperation("POST", "/api/v4/rooms"), "create");
  assert.equal(roomMetricOperation("POST", "/api/v4/rooms/run-secret/role"), "select_role");
  assert.equal(roomMetricOperation("GET", "/api/v4/rooms/run-secret"), null);
});

test("Prisma pool and transaction acquisition failures are classified without exposing messages", () => {
  assert.equal(prismaPoolTimeoutCode({ code: "P2024" }), "P2024");
  assert.equal(
    prismaPoolTimeoutCode(new Error("Timed out fetching a new connection from the connection pool")),
    "POOL_ACQUIRE_TIMEOUT",
  );
  assert.equal(
    prismaPoolTimeoutCode(new Error("Transaction API error: Unable to start a transaction in the given time")),
    "TRANSACTION_START_TIMEOUT",
  );
  assert.equal(prismaPoolTimeoutCode(new Error("unrelated")), null);
});
