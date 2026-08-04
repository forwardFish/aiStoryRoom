import assert from "node:assert/strict";
import test from "node:test";
import type { TurnDecisionCommandV2 } from "@ai-story/shared";
import { RoomsService } from "../rooms.service";
import { OPENOVEL_ENGINE_VERSION } from "./openovel-runtime.client";

const user = {
  id: "user-product-route",
  openid: "openid-product-route",
  email: null,
  emailVerifiedAt: null,
  nickname: "Player",
  authMethod: "PASSWORD" as const,
  authIdentityId: null,
};

test("Sangtian product create, game and decision routes use one OpenNovel authority", async () => {
  const calls: string[] = [];
  const runId = "solo_ovl_product_route";
  const openingProjection = {
    schemaVersion: "continuous_game_projection_v2",
    room: { id: runId, worldId: "sangtian", mode: "solo" },
    currentTurn: { id: "T01", revision: 0 },
  };
  const nextProjection = {
    ...openingProjection,
    worldSequence: 1,
    currentTurn: { id: "T02", revision: 1 },
  };
  const prisma: any = {
    storyRun: {
      findUnique: async () => ({ engineVersion: OPENOVEL_ENGINE_VERSION }),
      findMany: async () => assert.fail("resumeExisting=false must not search for another Solo run"),
    },
  };
  const forbidden = (name: string) => new Proxy({}, {
    get() {
      return () => assert.fail(`${name} must not run for an OpenNovel product turn`);
    },
  });
  const openNovel: any = {
    createProductRun: async (_user: unknown, input: any) => {
      calls.push("openovel:create");
      assert.deepEqual(input, {
        worldId: "sangtian",
        roleKey: "zhejiang_governor",
        idempotencyKey: "product-route-create-001",
      });
      return { id: runId, runId, roomId: runId, gameProjection: openingProjection };
    },
    game: async () => {
      calls.push("openovel:game");
      return openingProjection;
    },
    submitDecision: async (_user: unknown, actualRunId: string, turnId: string, command: TurnDecisionCommandV2) => {
      calls.push("openovel:decision");
      assert.equal(actualRunId, runId);
      assert.equal(turnId, "T01");
      assert.equal(command.candidateId, "G00_B");
      return { accepted: true, resolution: { id: "T01" }, gameProjection: nextProjection };
    },
  };
  const creditConsumption: any = {
    reserveCharge: async () => assert.fail("RoomsService must not reserve a second OpenNovel charge"),
    commitCharge: async () => assert.fail("RoomsService must not commit a second OpenNovel charge"),
  };
  const service = new RoomsService(
    prisma,
    forbidden("legacy story") as any,
    forbidden("outbox") as any,
    forbidden("access") as any,
    forbidden("credits") as any,
    forbidden("referrals") as any,
    forbidden("action windows") as any,
    forbidden("commands") as any,
    forbidden("continuous events") as any,
    forbidden("member projections") as any,
    forbidden("continuous story v2") as any,
    forbidden("solo story v2") as any,
    creditConsumption,
    forbidden("sponsorships") as any,
    openNovel,
  );

  const created: any = await service.createSolo(user, {
    worldId: "sangtian",
    roleKey: "zhejiang_governor",
    idempotencyKey: "product-route-create-001",
    resumeExisting: false,
  });
  assert.equal(created.runId, runId);
  assert.equal(created.gameProjection.schemaVersion, "continuous_game_projection_v2");

  const game = await service.game(user, runId);
  assert.equal(game, openingProjection);

  const decision = await service.submitTurnDecision(user, runId, "T01", {
    idempotencyKey: "product-route-turn-001",
    turnRevision: 0,
    controlEpoch: 1,
    candidateId: "G00_B",
    decisionForm: "STORY_CHOICE",
    intent: {
      objective: "先封档房，再暂缓签发",
      target: { type: "PUBLIC_FRAME", id: "scene:1", label: "当前局势" },
      method: "先封档房，再暂缓签发",
      leverageKeys: [],
      visibility: "PRIVATE",
      riskTolerance: "MEDIUM",
      fallback: null,
      condition: null,
    },
  });
  assert.equal(decision.accepted, true);
  assert.equal(decision.gameProjection, nextProjection);
  assert.deepEqual(calls, ["openovel:create", "openovel:game", "openovel:decision"]);
});
