import assert from "node:assert/strict";
import test from "node:test";
import { PRESSURE_CHAPTER_SEAT_IDS_V1 } from "@ai-story/shared";
import type {
  PressureCanonicalRoleCatalogPort,
  PressureCanonicalRoleDefinitionV1,
} from "../production/run-shell";
import { PressureRunShellService } from "../production/run-shell";
import { PrismaPressureLobbyPersistenceAdapter } from "../production-prisma/lobby.prisma-adapter";
import { PrismaPressureRunShellWriterAdapter } from "../production-prisma/run-shell.prisma-adapter";
import { PressureProductionPrismaFake } from "../production-prisma/production-prisma.test-harness";
import { buildPressureRoomProjection } from "./projection";

const RUN_ID = "pressure-ready-authority-integration";
const OWNER_ID = "ready-owner";
const GUEST_ID = "ready-guest";

test("two committed Ready writes enable Start only in the host projection", async () => {
  const db = new PressureProductionPrismaFake();
  const shell = new PressureRunShellService(
    new ReadyAuthorityCatalog(),
    new PrismaPressureRunShellWriterAdapter(db.client),
  );
  const lobby = new PrismaPressureLobbyPersistenceAdapter(db.client);

  await shell.createLobbyDraft({
    runId: RUN_ID,
    templateId: "sangtian-template",
    ownerUserId: OWNER_ID,
    title: "Ready authority integration",
    inviteCode: "READY2",
    visibility: "public",
    participantMode: "MULTIPLAYER",
    humanAssignments: [],
    idempotencyKey: "create-ready-authority",
  });
  await lobby.join({
    runId: RUN_ID,
    userId: GUEST_ID,
    idempotencyKey: "join-ready-guest",
  });
  await lobby.claimCanonicalSeatReplacingAi({
    runId: RUN_ID,
    userId: OWNER_ID,
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    humanControllerId: OWNER_ID,
    idempotencyKey: "select-ready-owner",
  });
  await lobby.claimCanonicalSeatReplacingAi({
    runId: RUN_ID,
    userId: GUEST_ID,
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[1],
    humanControllerId: GUEST_ID,
    idempotencyKey: "select-ready-guest",
  });
  await Promise.all([
    lobby.setReady({
      runId: RUN_ID,
      userId: OWNER_ID,
      ready: true,
      idempotencyKey: "ready-owner-true",
    }),
    lobby.setReady({
      runId: RUN_ID,
      userId: GUEST_ID,
      ready: true,
      idempotencyKey: "ready-guest-true",
    }),
  ]);

  const status = await lobby.getRoomProjectionStatus({ runId: RUN_ID });
  assert(status);
  const run = db.runs[0]!;
  const projectedRoom = {
    ...run,
    inviteCode: run.inviteCode ?? null,
    updatedAt: new Date("2026-08-15T00:00:00.000Z"),
    createdAt: new Date("2026-08-15T00:00:00.000Z"),
    players: [],
    roles: db.roles,
  };
  const host = buildPressureRoomProjection({
    room: projectedRoom,
    lobby: status.lobby,
    start: status.start,
    viewerId: OWNER_ID,
  });
  const guest = buildPressureRoomProjection({
    room: projectedRoom,
    lobby: status.lobby,
    start: status.start,
    viewerId: GUEST_ID,
  });

  assert.equal(status.lobby.members.filter((member) => member.ready).length, 2);
  assert.equal(host.players.length, 2);
  assert.equal(host.readyHumanCount, 2);
  assert.equal(host.players.every((player) => player.ready), true);
  assert.equal(host.startEnabled, true);
  assert.equal(guest.readyHumanCount, 2);
  assert.equal(guest.players.find((player) => player.userId === GUEST_ID)?.ready, true);
  assert.equal(guest.startEnabled, false);
});

class ReadyAuthorityCatalog implements PressureCanonicalRoleCatalogPort {
  async loadCanonicalRoles(): Promise<readonly PressureCanonicalRoleDefinitionV1[]> {
    return PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      roleKey: seatId,
      roleName: `Role ${index + 1}`,
      identity: `Identity ${seatId}`,
      publicInfo: `Public ${seatId}`,
      personalGoal: `Goal ${seatId}`,
      currentState: `State ${seatId}`,
      abilityText: null,
      arcText: null,
      knownInfo: [`known-${seatId}`],
      cannotDo: [],
      sourceSeatId: `source-${seatId}`,
      initialActorId: `actor-${seatId}`,
      persistentObjectRefs: [],
    }));
  }
}
