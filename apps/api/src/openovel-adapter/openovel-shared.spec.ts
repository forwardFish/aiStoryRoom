import assert from "node:assert/strict";
import test from "node:test";
import { OpenNovelSharedService } from "./openovel-shared.service";

const user = {
  id: "user-1",
  openid: "openid-1",
  email: null,
  emailVerifiedAt: null,
  nickname: "Player",
  authMethod: "PASSWORD" as const,
  authIdentityId: null,
};

const room = {
  id: "room-shared-1",
  mode: "room",
  ownerUserId: user.id,
  templateKey: "sangtian",
  players: [
    { userId: user.id, role: { roleKey: "zhejiang_governor" } },
    { userId: "user-2", role: { roleKey: "xunfu" } },
  ],
};

test("shared adapter initializes from database-controlled room roles and hides actor IDs", async () => {
  const calls: any[] = [];
  const service = new OpenNovelSharedService(
    { storyRun: { findUnique: async () => room } } as any,
    {
      createSharedRun: async (input: any) => {
        calls.push(input);
        return {
          schemaVersion: "openovel_shared_run_v1",
          runId: room.id,
          worldId: room.templateKey,
          actorIds: ["sangtian.actor.governor", "sangtian.actor.inspector"],
          stateRevision: 0,
          latestWorldTurnId: null,
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        };
      },
    } as any,
  );
  const result = await service.initialize(user, room.id);
  assert.deepEqual(calls[0].roleKeys, ["zhejiang_governor", "xunfu"]);
  assert.doesNotMatch(JSON.stringify(result), /actorIds|sangtian\.actor/u);
});

test("shared adapter derives the action actor from membership and redacts typed predicates", async () => {
  const calls: any[] = [];
  const service = new OpenNovelSharedService(
    { storyRun: { findUnique: async () => room } } as any,
    {
      submitSharedAction: async (input: any) => {
        calls.push(input);
        return {
          kind: "ACCEPTED",
          actionId: "sangtian.action.secret-id",
          worldTurnId: "turn-1",
          stateRevision: 1,
          projection: {
            stateRevision: 1,
            actorId: "sangtian.actor.governor",
            destinyQuestion: "如何维持局势？",
            privateFacts: [{ summary: "你知道密令的内容。", predicate: { type: "KNOWLEDGE.REVEALED_TO" } }],
            publicFacts: [{ summary: "公文已经形成。", eventId: "event-secret" }],
            inferableSignals: [],
            personalEchoes: [{ summary: "你的命令生效。", originActorId: "sangtian.actor.governor" }],
            crossPlayerEchoes: [],
            worldEchoes: [{ summary: "官场压力上升。" }],
            activeDestinyHooks: [{ hookId: "secret-hook", status: "ACTIVE" }],
          },
        };
      },
    } as any,
  );
  const result = await service.submitAction(user, room.id, {
    rawText: "暂缓签发。",
    expectedStateRevision: 0,
    idempotencyKey: "shared-key-0001",
    candidateId: "issue-order",
  });
  assert.equal(calls[0].roleKey, "zhejiang_governor");
  assert.equal(calls[0].candidateId, "issue-order");
  assert.equal("proposedCapabilityId" in calls[0], false);
  assert.equal(result.projection?.privateFacts[0].summary, "你知道密令的内容。");
  assert.doesNotMatch(JSON.stringify(result), /predicate|event-secret|secret-hook|sangtian\.actor|sangtian\.action/u);
});

test("shared destiny projection replaces internal node IDs before API delivery", async () => {
  const service = new OpenNovelSharedService(
    { storyRun: { findUnique: async () => room } } as any,
    {
      getSharedRoleView: async () => ({
        actorId: "sangtian.actor.governor",
        nodes: [
          { id: "sangtian.actor.governor", label: "浙江总督", type: "SELF", visibility: "KNOWN" },
          { id: "sangtian.actor.inspector", label: "浙江巡抚", type: "ACTOR", visibility: "PUBLIC" },
        ],
        edges: [{
          from: "sangtian.actor.governor",
          to: "sangtian.actor.inspector",
          label: "SUSPICION:1",
          visibility: "KNOWN",
        }],
      }),
    } as any,
  );
  const result = await service.destinyNet(user, room.id) as any;
  assert.match(result.nodes[0].id, /^view_[a-f0-9]{16}$/u);
  assert.equal(result.edges[0].from, result.nodes[0].id);
  assert.doesNotMatch(JSON.stringify(result), /sangtian\.actor/u);
});

test("shared adapter rejects a user who is not a room member", async () => {
  const service = new OpenNovelSharedService(
    { storyRun: { findUnique: async () => room } } as any,
    {} as any,
  );
  await assert.rejects(
    service.getRun({ ...user, id: "outsider" }, room.id),
    /Join this room first/u,
  );
});
