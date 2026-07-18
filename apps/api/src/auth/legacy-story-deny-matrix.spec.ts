import "reflect-metadata";
import assert from "node:assert/strict";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { StoryController } from "../story.controller";
import { AuthGuard } from "./auth.guard";
import type { AuthenticatedUser } from "./current-user.decorator";
import { LegacyStoryAccessGuard } from "./legacy-story-access.guard";
import { PUBLIC_ROUTE_METADATA } from "./public.decorator";

const users = {
  ownerA: user("owner-a"),
  memberA: user("member-a"),
  memberA2: user("member-a-2"),
  ownerB: user("owner-b"),
  memberB: user("member-b"),
  outsider: user("outsider")
};

const runs: Record<string, RunAccess> = {
  "room-a": runAccess("owner-a", "room", ["member-a", "member-a-2"]),
  "room-b": runAccess("owner-b", "room", ["member-b"]),
  "solo-a": runAccess("owner-a", "single", [])
};

const prisma = {
  storyRun: {
    findUnique: async ({ where }: any) => runs[String(where.id)] || null
  },
  sceneNode: {
    findUnique: async ({ where }: any) => {
      const run = where.id === "node-room-a" ? runs["room-a"] : where.id === "node-solo-a" ? runs["solo-a"] : null;
      return run ? { run } : null;
    }
  },
  chapter: {
    findUnique: async ({ where }: any) => {
      const run = where.id === "chapter-room-a" ? runs["room-a"] : where.id === "chapter-solo-a" ? runs["solo-a"] : null;
      return run ? { run } : null;
    }
  }
};

const protectedHandler = StoryController.prototype.getRun;

async function run() {
  verifyControllerGuardMetadata();

  const authGuard = new AuthGuard(prisma as any, new Reflector());
  const accessGuard = new LegacyStoryAccessGuard(prisma as any, new Reflector());
  const prior = snapshotEnvironment();
  process.env.DATABASE_URL = "postgresql://deny-matrix.invalid/db";
  delete process.env.DISABLE_PRISMA;
  delete process.env.MVP_STORY_STORAGE;

  let assertions = 0;
  try {
    const runTargets: Target[] = [
      target("legacy run", { runId: "room-a" }, "/api/story-runs/room-a"),
      target("legacy state", { runId: "room-a" }, "/api/story-runs/room-a/state"),
      target("legacy roles", { runId: "room-a" }, "/api/story-runs/room-a/roles"),
      target("legacy current node", { runId: "room-a" }, "/api/story-runs/room-a/current-node"),
      target("legacy node list", { runId: "room-a" }, "/api/story-runs/room-a/nodes"),
      target("legacy narrative", { runId: "room-a" }, "/api/story-runs/room-a/narrative-segments"),
      target("legacy chapter generation", { runId: "room-a" }, "/api/story-runs/room-a/generate-chapter", "POST"),
      target("legacy insight", { runId: "room-a" }, "/api/story-runs/room-a/insights"),
      target("v4 run", { runId: "room-a" }, "/api/v4/story-runs/room-a"),
      target("v4 messages", { runId: "room-a" }, "/api/v4/story-runs/room-a/messages"),
      target("v4 dashboard", { runId: "room-a" }, "/api/v4/story-runs/room-a/dashboard"),
      target("v4 decision", { runId: "room-a", messageId: "m1" }, "/api/v4/story-runs/room-a/messages/m1/decisions", "POST"),
      target("v4 critical response", { runId: "room-a", eventId: "e1" }, "/api/v4/story-runs/room-a/critical-events/e1/respond", "POST"),
      target("v4 defer", { runId: "room-a", messageId: "m1" }, "/api/v4/story-runs/room-a/messages/m1/defer", "POST"),
      target("v4 maneuver", { runId: "room-a" }, "/api/v4/story-runs/room-a/maneuvers", "POST"),
      target("v4 advance", { runId: "room-a" }, "/api/v4/story-runs/room-a/advance-day", "POST"),
      target("v4 finalize", { runId: "room-a" }, "/api/v4/story-runs/room-a/finalize", "POST")
    ];

    const rawTargets: Target[] = [
      target("raw node", { nodeId: "node-room-a" }, "/api/nodes/node-room-a"),
      target("raw actions read", { nodeId: "node-room-a" }, "/api/nodes/node-room-a/actions"),
      target("raw action write", { nodeId: "node-room-a" }, "/api/nodes/node-room-a/actions", "POST"),
      target("raw AI fill", { nodeId: "node-room-a" }, "/api/nodes/node-room-a/ai-fill-missing-actions", "POST"),
      target("raw resolve", { nodeId: "node-room-a" }, "/api/nodes/node-room-a/resolve", "POST"),
      target("raw resolution", { nodeId: "node-room-a" }, "/api/nodes/node-room-a/resolution"),
      target("raw chapter", { chapterId: "chapter-room-a" }, "/api/chapters/chapter-room-a"),
      target("raw chapter share", { chapterId: "chapter-room-a" }, "/api/chapters/chapter-room-a/share", "POST")
    ];

    for (const item of [...runTargets, ...rawTargets]) {
      await expectCode(() => authGuard.canActivate(context(item) as any), "AUTHENTICATION_REQUIRED", `${item.label}: anonymous`);
      assertions += 1;

      for (const roomMember of [users.ownerA, users.memberA, users.memberA2]) {
        await expectCode(() => accessGuard.canActivate(context(item, roomMember) as any), "ROOM_PROJECTION_REQUIRED", `${item.label}: same-room member`);
        assertions += 1;
      }

      await expectCode(() => accessGuard.canActivate(context(item, users.outsider) as any), "STORY_RESOURCE_NOT_FOUND", `${item.label}: non-member`);
      await expectCode(() => accessGuard.canActivate(context(item, users.memberB) as any), "STORY_RESOURCE_NOT_FOUND", `${item.label}: member of another room`);
      assertions += 2;
    }

    const soloTargets = [
      target("solo run", { runId: "solo-a" }, "/api/story-runs/solo-a"),
      target("solo insight", { runId: "solo-a" }, "/api/story-runs/solo-a/insights"),
      target("solo node", { nodeId: "node-solo-a" }, "/api/nodes/node-solo-a"),
      target("solo chapter", { chapterId: "chapter-solo-a" }, "/api/chapters/chapter-solo-a")
    ];
    for (const item of soloTargets) {
      assert.equal(await accessGuard.canActivate(context(item, users.ownerA) as any), true, `${item.label}: owner must retain access`);
      await expectCode(() => accessGuard.canActivate(context(item, users.outsider) as any), "STORY_RESOURCE_NOT_FOUND", `${item.label}: non-owner`);
      assertions += 2;
    }

    for (const item of [
      target("unknown run", { runId: "missing" }, "/api/story-runs/missing"),
      target("unknown node", { nodeId: "missing" }, "/api/nodes/missing"),
      target("unknown chapter", { chapterId: "missing" }, "/api/chapters/missing")
    ]) {
      await expectCode(() => accessGuard.canActivate(context(item, users.ownerA) as any), "STORY_RESOURCE_NOT_FOUND", item.label);
      assertions += 1;
    }

    process.env.MVP_STORY_STORAGE = "file";
    await expectCode(
      () => accessGuard.canActivate(context(target("file v4 create", {}, "/api/v4/story-runs", "POST"), users.ownerA) as any),
      "V4_FILE_STORAGE_DISABLED",
      "file-backed v4 collection"
    );
    await expectCode(
      () => accessGuard.canActivate(context(target("file v4 read", { runId: "file-only" }, "/api/v4/story-runs/file-only"), users.ownerA) as any),
      "V4_FILE_STORAGE_DISABLED",
      "file-backed v4 object"
    );
    assertions += 2;

    delete process.env.MVP_STORY_STORAGE;
    process.env.DISABLE_PRISMA = "true";
    await expectCode(
      () => accessGuard.canActivate(context(target("disabled prisma v4", {}, "/api/v4/story-runs", "POST"), users.ownerA) as any),
      "V4_FILE_STORAGE_DISABLED",
      "disabled-prisma v4"
    );
    await expectCode(
      () => accessGuard.canActivate(context(target("disabled prisma legacy", { runId: "room-a" }, "/api/story-runs/room-a"), users.ownerA) as any),
      "DATABASE_REQUIRED",
      "disabled-prisma legacy"
    );
    assertions += 2;

    verifyMultiplayerCreationBoundary();
    assertions += 2;

    console.log(JSON.stringify({
      status: "PASS_DENY_MATRIX",
      assertions,
      roomTargets: runTargets.length,
      rawTargets: rawTargets.length,
      actors: ["anonymous", "same-room-owner", "same-room-member", "second-same-room-member", "non-member", "member-of-another-room"],
      fileBackedV4: "FAIL_CLOSED"
    }, null, 2));
  } finally {
    restoreEnvironment(prior);
  }
}

function verifyControllerGuardMetadata() {
  const guards = Reflect.getMetadata(GUARDS_METADATA, StoryController) || [];
  assert.ok(guards.includes(AuthGuard), "StoryController must keep AuthGuard at class scope");
  assert.ok(guards.includes(LegacyStoryAccessGuard), "StoryController must keep LegacyStoryAccessGuard at class scope");

  const sensitiveHandlers = [
    "getRun",
    "getRunState",
    "getMvpRun",
    "getMvpMessages",
    "getMvpDashboard",
    "currentNode",
    "nodes",
    "node",
    "nodeActions",
    "resolution",
    "chapter",
    "insights"
  ] as const;
  for (const name of sensitiveHandlers) {
    assert.notEqual(Reflect.getMetadata(PUBLIC_ROUTE_METADATA, StoryController.prototype[name]), true, `${name} must not be public`);
  }
}

function verifyMultiplayerCreationBoundary() {
  let calls = 0;
  const controller = new StoryController({
    createMvpRun: () => { calls += 1; return { ok: true }; },
    createRun: () => { calls += 1; return { ok: true }; }
  } as any, {} as any, {} as any);

  assert.throws(
    () => controller.createMvpRun({ mode: "room" }),
    (error: any) => error?.getResponse?.()?.code === "ROOM_CREATE_REQUIRES_LOBBY"
  );
  assert.throws(
    () => controller.createRun(users.ownerA, { mode: "room" } as any),
    (error: any) => error?.getResponse?.()?.code === "ROOM_CREATE_REQUIRES_LOBBY"
  );
  assert.equal(calls, 0, "raw multiplayer create requests must not reach StoryService");
}

function context(item: Target, currentUser?: AuthenticatedUser) {
  const request: any = {
    params: item.params,
    path: item.url,
    originalUrl: item.url,
    method: item.method,
    headers: {},
    ...(currentUser ? { user: currentUser } : {})
  };
  return {
    getHandler: () => protectedHandler,
    getClass: () => StoryController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => undefined })
  };
}

async function expectCode(action: () => Promise<unknown>, code: string, label: string) {
  await assert.rejects(action, (error: any) => error?.getResponse?.()?.code === code, label);
}

function target(label: string, params: Record<string, string>, url: string, method = "GET"): Target {
  return { label, params, url, method };
}

function user(id: string): AuthenticatedUser {
  return { id, openid: `openid-${id}`, email: `${id}@example.test`, emailVerifiedAt: new Date(), nickname: id, authMethod: "PASSWORD", authIdentityId: null };
}

function runAccess(ownerUserId: string, mode: string, playerUserIds: string[]): RunAccess {
  return { ownerUserId, mode, players: playerUserIds.map((userId) => ({ userId })) };
}

function snapshotEnvironment() {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DISABLE_PRISMA: process.env.DISABLE_PRISMA,
    MVP_STORY_STORAGE: process.env.MVP_STORY_STORAGE
  };
}

function restoreEnvironment(values: ReturnType<typeof snapshotEnvironment>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

type RunAccess = { ownerUserId: string; mode: string; players: Array<{ userId: string | null }> };
type Target = { label: string; params: Record<string, string>; url: string; method: string };

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
