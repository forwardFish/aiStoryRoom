import assert from "node:assert/strict";
import {
  PRESSURE_SQL7_COMMIT_MAX_APPLICATION_SQL_V1,
  PRESSURE_SQL7_COMMIT_QUERY_LABELS_V1,
  PressureSql7CommitErrorV1,
} from "./commit-contract";
import { PressureSql7ApplicationQueryCounterV1 } from "./prisma-commit";

async function main(): Promise<void> {
  const counter = new PressureSql7ApplicationQueryCounterV1();
  for (const label of PRESSURE_SQL7_COMMIT_QUERY_LABELS_V1) {
    assert.equal(await counter.execute(label, async () => label), label);
  }
  assert.deepEqual(counter.snapshot(), {
    applicationSqlCount: 6,
    maxApplicationSql: PRESSURE_SQL7_COMMIT_MAX_APPLICATION_SQL_V1,
    labels: PRESSURE_SQL7_COMMIT_QUERY_LABELS_V1,
    actualApplicationSqlCount: null,
    verifiedByPrismaQueryEvents: false,
  });
  await assert.rejects(
    () => counter.execute("OUTBOX_TASKS", async () => undefined),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "QUERY_BUDGET_EXCEEDED",
  );
  console.log("pressure SQL7 query budget: PASS");
}

void main();
