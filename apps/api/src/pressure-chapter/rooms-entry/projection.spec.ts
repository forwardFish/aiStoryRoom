import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
} from "@ai-story/shared";
import type { PressureLobbyStatusV1 } from "../production";
import { buildPressureRoomProjection } from "./projection";

const SANGTIAN_PUBLIC_NAMES = [
  "浙江总督",
  "浙江巡抚",
  "清流县令",
  "改桑书吏",
  "江南商会会首",
  "司礼监织造使",
];

const SANGTIAN_PUBLIC_PORTRAITS = [
  "/assets/game/sangtian/generated/role-governor-scene-v1.png",
  "/assets/game/sangtian/generated/role-xunfu-scene-v1.png",
  "/assets/game/sangtian/generated/governor-scene-v1.png",
  "/assets/game/sangtian/generated/role-clerk-scene-v1.png",
  "/assets/game/sangtian/generated/role-merchant-scene-v1.png",
  "/assets/game/sangtian/generated/role-spy-scene-v1.png",
];

const SANGTIAN_PUBLIC_BY_SEAT = new Map([
  ["zhejiang_governor", ["浙江总督", SANGTIAN_PUBLIC_PORTRAITS[0]]],
  ["zhejiang_administration", ["浙江巡抚", SANGTIAN_PUBLIC_PORTRAITS[1]]],
  ["qingliu_law", ["清流县令", SANGTIAN_PUBLIC_PORTRAITS[2]]],
  ["cabinet_finance", ["改桑书吏", SANGTIAN_PUBLIC_PORTRAITS[3]]],
  ["jiangnan_merchant", ["江南商会会首", SANGTIAN_PUBLIC_PORTRAITS[4]]],
  ["sili_weaving", ["司礼监织造使", SANGTIAN_PUBLIC_PORTRAITS[5]]],
] as const);

function lobby(): PressureLobbyStatusV1 {
  return {
    schemaVersion: "pressure_lobby_status_v1" as const,
    runId: "completed-pressure-1",
    participantMode: "SOLO" as const,
    ownerUserId: "user-1",
    lifecycle: "PLAYING" as const,
    engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
    members: [{ userId: "user-1", joined: true, selectedSeatId: "cabinet_finance" as const, ready: true }],
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      seatId,
      roleKey: seatId,
      roleStatus: "claimed" as const,
      roleIsAiControlled: index !== 0,
      userId: index === 0 ? "user-1" : null,
      controllerId: index === 0 ? "user-1" : `ai-${seatId}`,
      controllerType: index === 0 ? "human" as const : "ai" as const,
      ready: true,
    })),
  };
}

test("completed Pressure room projection remains in Mine with view_result", () => {
  const projection = buildPressureRoomProjection({
    room: {
      id: "completed-pressure-1",
      title: "Completed Pressure",
      templateId: "sangtian-template",
      templateKey: "sangtian",
      status: "completed",
      visibility: "private",
      inviteCode: null,
      ownerUserId: "user-1",
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
      updatedAt: new Date("2026-08-12T00:00:00.000Z"),
      createdAt: new Date("2026-08-11T00:00:00.000Z"),
      players: [],
      roles: [],
    },
    lobby: lobby(),
    start: null,
    viewerId: "user-1",
  });

  assert.equal(projection.status, "completed");
  assert.equal(projection.nextAction, "view_result");
});

test("Pressure room projection never exposes another participant's account id", () => {
  const state = lobby();
  state.participantMode = "MULTIPLAYER";
  state.lifecycle = "WAITING_PLAYERS";
  state.members.push({
    userId: "user-2",
    joined: true,
    selectedSeatId: "zhejiang_governor",
    ready: true,
  });
  state.seats[0] = {
    ...state.seats[0]!,
    userId: "user-2",
    controllerId: "user-2",
    controllerType: "human",
  };

  const room = {
    id: "private-pressure-1",
    title: "Private Pressure",
    templateId: "sangtian-template",
    templateKey: "sangtian",
    status: "waiting_players",
    visibility: "private",
    inviteCode: "PRIVATE1",
    ownerUserId: "user-1",
    engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    updatedAt: new Date("2026-08-12T00:00:00.000Z"),
    createdAt: new Date("2026-08-11T00:00:00.000Z"),
    players: [],
    roles: [],
  };

  const guest = buildPressureRoomProjection({ room, lobby: state, start: null, viewerId: "user-2" });
  assert.equal(guest.ownerUserId, null);
  assert.deepEqual(guest.readyUserIds, ["user-2"]);
  assert.equal(
    guest.players.some((player) => "joinedUnseated" in player
      && player.userId === "user-2"
      && player.joinedUnseated === false),
    true,
  );
  assert.equal(guest.players.some((player) => player.userId === "user-1"), false);
  assert.equal(guest.players.some((player) => player.id.includes("user-1") || player.id.includes("user-2")), false);

  const owner = buildPressureRoomProjection({ room, lobby: state, start: null, viewerId: "user-1" });
  assert.equal(owner.ownerUserId, "user-1");
  assert.deepEqual(owner.readyUserIds, ["user-1"]);
  assert.equal(owner.players.some((player) => player.userId === "user-2"), false);

  const publicProjection = buildPressureRoomProjection({ room, lobby: state, start: null });
  assert.equal(publicProjection.ownerUserId, null);
  assert.deepEqual(publicProjection.readyUserIds, []);
  assert.equal(publicProjection.players.some((player) => player.userId !== null), false);
});

test("Pressure room roles use the same public characters without changing canonical seats", () => {
  const state = lobby();
  const projection = buildPressureRoomProjection({
    room: {
      id: "public-role-pressure-1",
      title: "Public role Pressure",
      templateId: "sangtian-template",
      templateKey: "sangtian",
      status: "playing",
      visibility: "private",
      inviteCode: null,
      ownerUserId: "user-1",
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
      updatedAt: new Date("2026-08-12T00:00:00.000Z"),
      createdAt: new Date("2026-08-11T00:00:00.000Z"),
      players: [],
      roles: [],
    },
    lobby: state,
    start: null,
    viewerId: "user-1",
  });

  assert.deepEqual(projection.roles.map((role) => role.roleKey), PRESSURE_CHAPTER_SEAT_IDS_V1);
  assert.deepEqual(
    projection.roles.map((role) => role.roleName),
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => SANGTIAN_PUBLIC_BY_SEAT.get(seatId)![0]),
  );
  assert.deepEqual(
    projection.roles.map((role) => role.portrait),
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => SANGTIAN_PUBLIC_BY_SEAT.get(seatId)![1]),
  );
  assert.deepEqual(projection.world.roles.map((role) => role.roleName), SANGTIAN_PUBLIC_NAMES);
  assert.deepEqual(projection.world.roles.map((role) => role.portrait), SANGTIAN_PUBLIC_PORTRAITS);
  assert.equal(
    projection.roles.some((role) => /(?:rank|shield|treasury|grain|crown)\.png$/u.test(role.portrait)),
    false,
  );
  assert.equal(
    projection.players.find((player) => player.userId === "user-1")?.roleName,
    "改桑书吏",
  );
  assert.equal(
    Boolean(projection.roles.find((role) => role.roleKey === "cabinet_finance")?.personalGoal?.length),
    true,
  );
  assert.equal(
    projection.roles
      .filter((role) => role.roleKey !== "cabinet_finance")
      .every((role) => role.personalGoal === undefined && role.knownInfo.length === 0),
    true,
  );
});
