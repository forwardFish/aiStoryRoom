import assert from "node:assert/strict";
import test from "node:test";
import { PRESSURE_CHAPTER_ROUTE_V1 } from "@ai-story/shared";
import { PRESSURE_CHAPTER_HTTP_TOKENS } from "../http/contracts";
import { PrismaPressureChapterHttpAccessAdapterV1 } from "./access.adapter";
import { SystemPressureChapterHttpClockV1 } from "./clock.adapter";
import {
  createPressureChapterHttpProductionAdaptersV1,
  createPressureChapterHttpProductionProvidersV1,
} from "./factory";
import type {
  PressureChapterHttpProductionMembershipRowV1,
  PressureChapterHttpProductionPrismaPortV1,
  PressureChapterHttpProductionRunRowV1,
} from "./ports";

const ROOM_ID = "run-pressure-1";
const USER_ID = "user-human-1";

class FakePrisma implements PressureChapterHttpProductionPrismaPortV1 {
  run: PressureChapterHttpProductionRunRowV1 | null = canonicalRun();
  membership: PressureChapterHttpProductionMembershipRowV1 | null = {
    runId: ROOM_ID,
    userId: USER_ID,
    playerType: "human",
    status: "active",
  };
  runReads: unknown[] = [];
  membershipReads: unknown[] = [];

  storyRun = {
    findUnique: async (input: Parameters<
      PressureChapterHttpProductionPrismaPortV1["storyRun"]["findUnique"]
    >[0]) => {
      this.runReads.push(structuredClone(input));
      return structuredClone(this.run);
    },
  };

  storyPlayer = {
    findUnique: async (input: Parameters<
      PressureChapterHttpProductionPrismaPortV1["storyPlayer"]["findUnique"]
    >[0]) => {
      this.membershipReads.push(structuredClone(input));
      return structuredClone(this.membership);
    },
  };
}

test("authorizes only the exact active human StoryPlayer on the canonical pressure run", async () => {
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

  assert.deepEqual(prisma.runReads, [{
    where: { id: ROOM_ID },
    select: {
      id: true,
      engineVersion: true,
      strategyVersion: true,
      pressureRouteSnapshot: {
        select: {
          runId: true,
          schemaVersion: true,
          engineVersion: true,
          strategyVersion: true,
          runtimeProfile: true,
        },
      },
    },
  }]);
  assert.deepEqual(prisma.membershipReads, [{
    where: { runId_userId: { runId: ROOM_ID, userId: USER_ID } },
    select: {
      runId: true,
      userId: true,
      playerType: true,
      status: true,
    },
  }]);
});

test("fails closed before any read when subjectId and viewerId are not the same user", async () => {
  const prisma = new FakePrisma();
  const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);

  assert.equal(await access.authorize({
    roomId: ROOM_ID,
    subjectId: USER_ID,
    viewerId: "user-peer-secret-target",
  }), null);
  assert.equal(prisma.runReads.length, 0);
  assert.equal(prisma.membershipReads.length, 0);
});

test("fails closed on an invalid or non-pressure route before reading membership", async () => {
  const prisma = new FakePrisma();
  prisma.run!.pressureRouteSnapshot!.runtimeProfile = "LEGACY_OR_UNKNOWN";
  const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);

  assert.equal(await access.authorize({
    roomId: ROOM_ID,
    subjectId: USER_ID,
    viewerId: USER_ID,
  }), null);
  assert.equal(prisma.membershipReads.length, 0);
});

test("fails closed for a nonmember", async () => {
  const prisma = new FakePrisma();
  prisma.membership = null;
  const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);

  assert.equal(await access.authorize({
    roomId: ROOM_ID,
    subjectId: USER_ID,
    viewerId: USER_ID,
  }), null);
});

test("fails closed for a deactivated AI row bound to the supplied user", async () => {
  const prisma = new FakePrisma();
  prisma.membership = {
    runId: ROOM_ID,
    userId: USER_ID,
    playerType: "ai",
    status: "inactive",
  };
  const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);

  assert.equal(await access.authorize({
    roomId: ROOM_ID,
    subjectId: USER_ID,
    viewerId: USER_ID,
  }), null);
});

test("fails closed when StoryRun, route, or membership room binding mismatches", async () => {
  for (const mutate of [
    (prisma: FakePrisma) => { prisma.run!.id = "another-run"; },
    (prisma: FakePrisma) => { prisma.run!.pressureRouteSnapshot!.runId = "another-run"; },
    (prisma: FakePrisma) => { prisma.membership!.runId = "another-run"; },
  ]) {
    const prisma = new FakePrisma();
    mutate(prisma);
    const access = new PrismaPressureChapterHttpAccessAdapterV1(prisma);
    assert.equal(await access.authorize({
      roomId: ROOM_ID,
      subjectId: USER_ID,
      viewerId: USER_ID,
    }), null);
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

function canonicalRun(): PressureChapterHttpProductionRunRowV1 {
  return {
    id: ROOM_ID,
    engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    pressureRouteSnapshot: {
      runId: ROOM_ID,
      schemaVersion: "pressure_run_route_snapshot_v1",
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
      runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
    },
  };
}
