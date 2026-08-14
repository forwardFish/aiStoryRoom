import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { PRESSURE_CHAPTER_ROUTE_V1 } from "@ai-story/shared";
import { PRESSURE_CHAPTER_HTTP_TOKENS } from "../http/contracts";
import { PrismaPressureChapterHttpAccessAdapterV1 } from "./access.adapter";
import { SystemPressureChapterHttpClockV1 } from "./clock.adapter";
import {
  createPressureChapterHttpProductionAdaptersV1,
  createPressureChapterHttpProductionProvidersV1,
} from "./factory";
import type {
  PressureChapterHttpProductionAccessRowV1,
  PressureChapterHttpProductionPrismaPortV1,
} from "./ports";

const ROOM_ID = "run-pressure-1";
const USER_ID = "user-human-1";

class FakePrisma implements PressureChapterHttpProductionPrismaPortV1 {
  rows: PressureChapterHttpProductionAccessRowV1[] = [canonicalAccessRow()];
  rawQueries: Prisma.Sql[] = [];
  transactionCalls = 0;

  async $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> {
    this.rawQueries.push(query);
    return structuredClone(this.rows) as T;
  }

  async $transaction(): Promise<never> {
    this.transactionCalls += 1;
    throw new Error("Transactions are forbidden for Pressure HTTP access authorization.");
  }
}

test("authorizes only the exact active human on the canonical pressure run with one raw query", async () => {
  const prisma = new FakePrisma();
  const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);

  assert.deepEqual(await access.authorize({
    roomId: ROOM_ID,
    subjectId: USER_ID,
    viewerId: USER_ID,
  }), {
    schemaVersion: "pressure_chapter_http_access_v1",
    roomId: ROOM_ID,
    runId: ROOM_ID,
    subjectId: USER_ID,
    viewerId: USER_ID,
  });

  assert.equal(prisma.rawQueries.length, 1);
  assert.equal(prisma.transactionCalls, 0);

  const { staticSql, renderedSql, values } = inspectSql(prisma.rawQueries[0]!);
  assert.match(staticSql, /FROM "StoryRun" AS run/);
  assert.match(staticSql, /INNER JOIN "PressureRunRouteSnapshot" AS route/);
  assert.match(staticSql, /FROM "StoryPlayer" AS candidate/);
  assert.match(staticSql, /COUNT\(\*\) OVER \(\)/);
  assert.match(staticSql, /membership\."candidateCount" = 1/);
  assert.match(staticSql, /run\."id"/);
  assert.match(staticSql, /run\."engineVersion"/);
  assert.match(staticSql, /run\."strategyVersion"/);
  assert.match(staticSql, /route\."runId"/);
  assert.match(staticSql, /route\."schemaVersion"/);
  assert.match(staticSql, /route\."engineVersion"/);
  assert.match(staticSql, /route\."strategyVersion"/);
  assert.match(staticSql, /route\."runtimeProfile"/);
  assert.match(staticSql, /membership\."runId"/);
  assert.match(staticSql, /membership\."userId"/);
  assert.match(staticSql, /membership\."playerType"/);
  assert.match(staticSql, /membership\."status"/);
  assert.match(staticSql, /LIMIT 2/);

  for (const sqlText of [staticSql, ...renderedSql]) {
    assert.equal(sqlText.includes(ROOM_ID), false);
    assert.equal(sqlText.includes(USER_ID), false);
  }
  assert.deepEqual(values, [
    ROOM_ID,
    USER_ID,
    "human",
    "active",
    ROOM_ID,
    PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    "pressure_run_route_snapshot_v1",
    PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
  ]);
});

test("fails closed before SQL for empty input or a different viewer", async () => {
  const cases = [
    { roomId: "", subjectId: USER_ID, viewerId: USER_ID },
    { roomId: "   ", subjectId: USER_ID, viewerId: USER_ID },
    { roomId: ROOM_ID, subjectId: "", viewerId: "" },
    { roomId: ROOM_ID, subjectId: "   ", viewerId: "   " },
    { roomId: ROOM_ID, subjectId: USER_ID, viewerId: "" },
    { roomId: ROOM_ID, subjectId: USER_ID, viewerId: "   " },
    { roomId: ROOM_ID, subjectId: USER_ID, viewerId: "user-peer-secret-target" },
  ];

  for (const input of cases) {
    const prisma = new FakePrisma();
    const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);
    assert.equal(await access.authorize(input), null);
    assert.equal(prisma.rawQueries.length, 0);
    assert.equal(prisma.transactionCalls, 0);
  }
});

test("accepts exactly one row and fails closed on zero or multiple rows", async () => {
  const cases: Array<{
    rows: PressureChapterHttpProductionAccessRowV1[];
    expectedRunId: string | null;
  }> = [
    { rows: [], expectedRunId: null },
    { rows: [canonicalAccessRow()], expectedRunId: ROOM_ID },
    { rows: [canonicalAccessRow(), canonicalAccessRow()], expectedRunId: null },
    {
      rows: [
        canonicalAccessRow(),
        canonicalAccessRow({
          membershipPlayerType: "ai",
          membershipStatus: "inactive",
        }),
      ],
      expectedRunId: null,
    },
  ];

  for (const { rows, expectedRunId } of cases) {
    const prisma = new FakePrisma();
    prisma.rows = structuredClone(rows);
    const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);

    const result = await access.authorize({
      roomId: ROOM_ID,
      subjectId: USER_ID,
      viewerId: USER_ID,
    });
    assert.equal(result?.runId ?? null, expectedRunId);
    assert.equal(prisma.rawQueries.length, 1);
    assert.equal(prisma.transactionCalls, 0);
  }
});

test("fails closed for every noncanonical run or route binding", async () => {
  const invalidRows: PressureChapterHttpProductionAccessRowV1[] = [
    canonicalAccessRow({ runId: "another-run" }),
    canonicalAccessRow({ runEngineVersion: "legacy_v1" }),
    canonicalAccessRow({ runStrategyVersion: "legacy_v1" }),
    canonicalAccessRow({ routeRunId: "another-run" }),
    canonicalAccessRow({ routeSchemaVersion: "unknown_route_schema" }),
    canonicalAccessRow({ routeEngineVersion: "legacy_v1" }),
    canonicalAccessRow({ routeStrategyVersion: "legacy_v1" }),
    canonicalAccessRow({ routeRuntimeProfile: "LEGACY_OR_UNKNOWN" }),
  ];

  for (const row of invalidRows) {
    const prisma = new FakePrisma();
    prisma.rows = [row];
    const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);
    assert.equal(await access.authorize({
      roomId: ROOM_ID,
      subjectId: USER_ID,
      viewerId: USER_ID,
    }), null);
    assert.equal(prisma.rawQueries.length, 1);
  }
});

test("fails closed for a missing, cross-run, nonhuman, inactive, or wrong-user membership", async () => {
  const invalidRows: PressureChapterHttpProductionAccessRowV1[] = [
    canonicalAccessRow({ membershipRunId: "another-run" }),
    canonicalAccessRow({ membershipUserId: null }),
    canonicalAccessRow({ membershipUserId: "user-peer-secret-target" }),
    canonicalAccessRow({ membershipPlayerType: "ai" }),
    canonicalAccessRow({ membershipStatus: "inactive" }),
  ];

  for (const rows of [
    [],
    ...invalidRows.map((row) => [row]),
  ] satisfies PressureChapterHttpProductionAccessRowV1[][]) {
    const prisma = new FakePrisma();
    prisma.rows = rows;
    const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);
    assert.equal(await access.authorize({
      roomId: ROOM_ID,
      subjectId: USER_ID,
      viewerId: USER_ID,
    }), null);
    assert.equal(prisma.rawQueries.length, 1);
  }
});

test("factory exposes production access/clock adapters and Nest token providers", () => {
  const prisma = new FakePrisma();
  const adapters = createPressureChapterHttpProductionAdaptersV1(prisma);
  assert.ok(adapters.access instanceof PrismaPressureChapterHttpAccessAdapterV1);
  assert.ok(adapters.clock instanceof SystemPressureChapterHttpClockV1);

  const prismaToken = Symbol("PrismaService");
  const providers = createPressureChapterHttpProductionProvidersV1(prismaToken);
  assert.equal(providers.length, 2);
  assert.equal((providers[0] as { provide: symbol }).provide, PRESSURE_CHAPTER_HTTP_TOKENS.ACCESS);
  assert.equal((providers[1] as { provide: symbol }).provide, PRESSURE_CHAPTER_HTTP_TOKENS.CLOCK);
});

test("system clock returns Unix epoch milliseconds from Date.now", () => {
  const before = Date.now();
  const actual = new SystemPressureChapterHttpClockV1().nowMs();
  const after = Date.now();
  assert.ok(actual >= before && actual <= after);
});

function canonicalAccessRow(
  overrides: Partial<PressureChapterHttpProductionAccessRowV1> = {},
): PressureChapterHttpProductionAccessRowV1 {
  return {
    runId: ROOM_ID,
    runEngineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    runStrategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    routeRunId: ROOM_ID,
    routeSchemaVersion: "pressure_run_route_snapshot_v1",
    routeEngineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    routeStrategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    routeRuntimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
    membershipRunId: ROOM_ID,
    membershipUserId: USER_ID,
    membershipPlayerType: "human",
    membershipStatus: "active",
    ...overrides,
  };
}

function inspectSql(query: Prisma.Sql): {
  staticSql: string;
  renderedSql: string[];
  values: unknown[];
} {
  assert.notEqual(typeof query, "string");
  const sql = query as unknown as {
    strings?: readonly string[];
    values?: readonly unknown[];
    sql?: unknown;
    text?: unknown;
  };
  assert.ok(Array.isArray(sql.strings));
  assert.ok(Array.isArray(sql.values));

  const strings = sql.strings as readonly string[];
  const values = sql.values as readonly unknown[];
  return {
    staticSql: strings.join("?"),
    renderedSql: [sql.sql, sql.text].filter(
      (value): value is string => typeof value === "string",
    ),
    values: [...values],
  };
}
