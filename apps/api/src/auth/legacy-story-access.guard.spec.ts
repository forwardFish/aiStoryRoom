import assert from "node:assert/strict";
import { Reflector } from "@nestjs/core";
import { LegacyStoryAccessGuard } from "./legacy-story-access.guard";

const currentUser = { id: "u1", openid: "o1", email: "u1@example.test", emailVerifiedAt: new Date(), nickname: "One", authMethod: "PASSWORD", authIdentityId: null };

async function run() {
  const prisma = {
    storyRun: { findUnique: async ({ where }: any) => where.id === "room-owned" ? { ownerUserId: "u1", mode: "room", players: [{ userId: "u1" }] } : where.id === "solo-owned" ? { ownerUserId: "u1", mode: "single", players: [] } : where.id === "room-other" ? { ownerUserId: "u2", mode: "room", players: [{ userId: "u2" }] } : null },
    sceneNode: { findUnique: async () => null },
    chapter: { findUnique: async () => null }
  };
  const guard = new LegacyStoryAccessGuard(prisma as any, new Reflector());
  const priorUrl = process.env.DATABASE_URL;
  const priorStorage = process.env.MVP_STORY_STORAGE;
  process.env.DATABASE_URL = "postgresql://acceptance.invalid/db";
  delete process.env.MVP_STORY_STORAGE;
  try {
    assert.equal(await guard.canActivate(context({ runId: "solo-owned" }) as any), true);
    assert.equal(await guard.canActivate(context({ runId: "room-other" }, "/api/admin/story-runs/room-other") as any), true);
    await assert.rejects(() => guard.canActivate(context({ runId: "room-owned" }) as any), hasCode("ROOM_PROJECTION_REQUIRED"));
    await assert.rejects(() => guard.canActivate(context({ runId: "room-other" }) as any), hasCode("STORY_RESOURCE_NOT_FOUND"));
    await assert.rejects(() => guard.canActivate(context({ runId: "file-v4" }, "/api/v4/story-runs/file-v4") as any), hasCode("STORY_RESOURCE_NOT_FOUND"));
    process.env.MVP_STORY_STORAGE = "file";
    await assert.rejects(() => guard.canActivate(context({}, "/api/v4/story-runs") as any), hasCode("V4_FILE_STORAGE_DISABLED"));
  } finally {
    if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
    if (priorStorage === undefined) delete process.env.MVP_STORY_STORAGE; else process.env.MVP_STORY_STORAGE = priorStorage;
  }
  console.log("legacy StoryController room boundary: PASS");
}

function context(params: Record<string, string>, url = "/api/story-runs/value") {
  const request = { params, user: currentUser, originalUrl: url };
  return { getHandler: () => run, getClass: () => LegacyStoryAccessGuard, switchToHttp: () => ({ getRequest: () => request }) };
}
function hasCode(code: string) { return (error: any) => error?.getResponse?.()?.code === code; }
run().catch((error) => { console.error(error); process.exitCode = 1; });
