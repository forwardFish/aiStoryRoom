import assert from "node:assert/strict";
import test from "node:test";
import { ResultSharingService } from "./result-sharing.service";

const user: any = { id: "user_1", email: "player@example.test" };

function harness(options: { revokedAt?: Date | null; expiresAt?: Date; status?: string } = {}) {
  const created: any[] = [];
  const share = {
    id: "share_1",
    scene: "result",
    runId: "run_1",
    shareUserId: "user_1",
    includeRoleName: true,
    expiresAt: options.expiresAt || new Date(Date.now() + 60_000),
    revokedAt: options.revokedAt || null,
    run: { id: "run_1", status: options.status || "chapter_generated", title: "A public room", templateKey: "caesar", updatedAt: new Date(), completedNodeCount: 7 },
    chapter: { id: "chapter_1", title: "A safe ending", highlightsJson: ["Contact secret@example.com", "Open https://private.example/path", { text: "A public turning point" }] }
  };
  const prisma: any = {
    storyRun: { findUnique: async () => ({ id: "run_1", ownerUserId: "owner", status: "chapter_generated", players: [{ id: "player_1", roleId: "role_1" }], chapters: [{ id: "chapter_1" }] }) },
    shareToken: {
      create: async ({ data }: any) => { created.push(data); return { id: "share_1", createdAt: new Date(), expiresAt: data.expiresAt, channel: data.channel, includeRoleName: data.includeRoleName }; },
      findMany: async () => [],
      findUnique: async () => share,
      update: async () => share,
      updateMany: async () => ({ count: 1 })
    },
    storyPlayer: { findFirst: async () => ({ role: { roleName: "Consul" } }) }
  };
  return { service: new ResultSharingService(prisma), created };
}

test("creates an expiring result share without persisting the bearer token", async () => {
  const previousOrigin = process.env.PUBLIC_WEB_URL;
  process.env.PUBLIC_WEB_URL = "http://localhost:3000";
  try {
    const { service, created } = harness();
    const result: any = await service.create(user, "run_1", { expiresInDays: 7, includeRoleName: true, channel: "LINK" });
    assert.match(result.url, /^http:\/\/localhost:3000\/shared\/result\?token=/);
    assert.match(result.qrDataUrl, /^data:image\/png;base64,/);
    assert.equal(created.length, 1);
    assert.equal(created[0].token, undefined);
    assert.match(created[0].tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(created[0].tokenPrefix.length, 8);
    assert.equal(result.security.rawTokenStored, false);
  } finally {
    if (previousOrigin === undefined) delete process.env.PUBLIC_WEB_URL;
    else process.env.PUBLIC_WEB_URL = previousOrigin;
  }
});

test("public result is a strict projection and redacts contact details", async () => {
  const { service } = harness();
  const result: any = await service.publicResult("A".repeat(43));
  assert.equal(result.room.completedNodes, 7);
  assert.equal(result.recap.roleName, "Consul");
  assert.match(result.recap.highlights[0], /private email removed/);
  assert.match(result.recap.highlights[1], /private link removed/);
  assert.equal("content" in result.recap, false);
  assert.equal("players" in result, false);
  assert.ok(result.redacted.includes("private goals"));
});

test("revoked and expired result links fail closed", async () => {
  const revoked = harness({ revokedAt: new Date() });
  await assert.rejects(revoked.service.publicResult("B".repeat(43)), (error: any) => error?.response?.code === "SHARE_REVOKED");
  const expired = harness({ expiresAt: new Date(Date.now() - 1) });
  await assert.rejects(expired.service.publicResult("C".repeat(43)), (error: any) => error?.response?.code === "SHARE_EXPIRED");
});
