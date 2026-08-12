import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  LEGACY_ROOM_ROLE_TO_PRESSURE_SEAT_REGISTRY_V1,
  resolvePressureSeatAtEntryBoundaryV1,
} from "./legacy-role-seat-registry";
import {
  PRESSURE_LOBBY_WRITE_CAPABILITY_V1,
  PressureProductionBridgeService,
  type JoinPressureLobbyCommandV1,
  type LeavePressureLobbyCommandV1,
  type PressureLobbyMutationResultV1,
  type PressureLobbyPersistencePortV1,
  type PressureLobbyStatusV1,
  type PressureStartStatusV1,
  type SelectPressureSeatCommandV1,
  type SetPressureReadyCommandV1,
} from "./production-bridge";
import {
  PRESSURE_RUN_SHELL_WRITE_CAPABILITY_V1,
  PressureRunShellService,
  SangtianPressureCanonicalRoleCatalogAdapter,
  type PressureRunShellCandidateV1,
  type PressureRunShellWriterPort,
} from "./run-shell";
import type { PressureStartLifecycleCoordinator } from "./start-lifecycle";

class RecordingShellWriter implements PressureRunShellWriterPort {
  readonly capability = PRESSURE_RUN_SHELL_WRITE_CAPABILITY_V1;
  readonly records = new Map<string, PressureRunShellCandidateV1>();

  async createOnce(candidate: Readonly<PressureRunShellCandidateV1>) {
    const existing = this.records.get(candidate.room.runId);
    if (existing) {
      return { status: "EXISTING" as const, shell: structuredClone(existing) };
    }
    const stored = structuredClone(candidate);
    this.records.set(candidate.room.runId, stored);
    return { status: "CREATED" as const, shell: structuredClone(stored) };
  }
}

class AtomicPlaceholderLobby implements PressureLobbyPersistencePortV1 {
  readonly capability = PRESSURE_LOBBY_WRITE_CAPABILITY_V1;
  private readonly runs = new Map<
    string,
    {
      participantMode: "SOLO" | "MULTIPLAYER";
      ownerUserId: string;
      lifecycle: PressureLobbyStatusV1["lifecycle"];
      members: Map<string, { ready: boolean }>;
      seats: Map<
        SeatIdV1,
        { userId: string | null; controllerId: string; controllerType: "human" | "ai" }
      >;
    }
  >();

  register(shell: PressureRunShellCandidateV1): void {
    this.runs.set(shell.room.runId, {
      participantMode: shell.room.participantMode,
      ownerUserId: shell.room.ownerUserId,
      lifecycle: "WAITING_PLAYERS",
      members: new Map(
        shell.lifecycle.lobby.joinedUserIds.map((userId) => [
          userId,
          { ready: false },
        ]),
      ),
      seats: new Map(
        shell.players.map((player) => [
          player.seatId,
          {
            userId: player.userId,
            controllerId: player.controllerId,
            controllerType: player.playerType,
          },
        ]),
      ),
    });
  }

  async isPressureRun(runId: string): Promise<boolean> {
    return this.runs.has(runId);
  }

  async getLobbyStatus(query: { runId: string }): Promise<PressureLobbyStatusV1 | null> {
    const run = this.runs.get(query.runId);
    return run ? this.status(query.runId, run) : null;
  }

  async getStartStatus(runId: string): Promise<PressureStartStatusV1 | null> {
    if (!this.runs.has(runId)) return null;
    return {
      schemaVersion: "pressure_start_status_v1",
      runId,
      phase: "NOT_STARTED",
      completedStages: [],
      frozenHumanSeatSetHash: null,
      routeHash: null,
      genesisHash: null,
      seatControlStateHash: null,
      n1ChapterHash: null,
      lastFailure: null,
    };
  }

  async join(
    command: Readonly<JoinPressureLobbyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1> {
    const run = this.requireRun(command.runId);
    const existed = run.members.has(command.userId);
    run.members.set(command.userId, run.members.get(command.userId) ?? { ready: false });
    return this.result(command.runId, run, existed);
  }

  async claimCanonicalSeatReplacingAi(
    command: Readonly<Omit<SelectPressureSeatCommandV1, "roleKey"> & { seatId: SeatIdV1 }>,
  ): Promise<PressureLobbyMutationResultV1> {
    const run = this.requireRun(command.runId);
    if (!run.members.has(command.userId)) throw new Error("MEMBERSHIP_REQUIRED");
    const target = run.seats.get(command.seatId)!;
    if (target.controllerType === "human" && target.userId !== command.userId) {
      throw new Error("ROLE_ALREADY_TAKEN");
    }
    if (target.controllerType === "human" && target.userId === command.userId) {
      return this.result(command.runId, run, true);
    }

    // This synchronous mutation block models the required one-transaction CAS.
    for (const [seatId, current] of run.seats) {
      if (current.userId === command.userId) {
        run.seats.set(seatId, this.aiSlot(command.runId, seatId));
      }
    }
    run.seats.set(command.seatId, {
      userId: command.userId,
      controllerId: command.humanControllerId,
      controllerType: "human",
    });
    return this.result(command.runId, run, false);
  }

  async setReady(
    command: Readonly<SetPressureReadyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1> {
    const run = this.requireRun(command.runId);
    const member = run.members.get(command.userId);
    if (!member) throw new Error("MEMBERSHIP_REQUIRED");
    const existed = member.ready === command.ready;
    member.ready = command.ready;
    return this.result(command.runId, run, existed);
  }

  async leaveAndRestoreAi(
    command: Readonly<LeavePressureLobbyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1> {
    const run = this.requireRun(command.runId);
    const existed = !run.members.has(command.userId);
    for (const [seatId, current] of run.seats) {
      if (current.userId === command.userId) {
        run.seats.set(seatId, this.aiSlot(command.runId, seatId));
      }
    }
    run.members.delete(command.userId);
    return this.result(command.runId, run, existed);
  }

  private requireRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error("NOT_PRESSURE_RUN");
    return run;
  }

  private result(
    runId: string,
    run: ReturnType<AtomicPlaceholderLobby["requireRun"]>,
    existing: boolean,
  ): PressureLobbyMutationResultV1 {
    return {
      status: existing ? "EXISTING" : "UPDATED",
      lobby: this.status(runId, run),
    };
  }

  private status(
    runId: string,
    run: ReturnType<AtomicPlaceholderLobby["requireRun"]>,
  ): PressureLobbyStatusV1 {
    return {
      schemaVersion: "pressure_lobby_status_v1",
      runId,
      participantMode: run.participantMode,
      ownerUserId: run.ownerUserId,
      lifecycle: run.lifecycle,
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
      runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
      members: [...run.members].map(([userId, member]) => ({
        userId,
        joined: true,
        selectedSeatId:
          [...run.seats].find(([, seat]) => seat.userId === userId)?.[0] ?? null,
        ready: member.ready,
      })),
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
        const seat = run.seats.get(seatId)!;
        return {
          seatId,
          roleKey: seatId,
          roleStatus: "claimed",
          roleIsAiControlled: seat.controllerType === "ai",
          userId: seat.userId,
          controllerId: seat.controllerId,
          controllerType: seat.controllerType,
          ready: seat.userId ? (run.members.get(seat.userId)?.ready ?? false) : true,
        };
      }),
    };
  }

  private aiSlot(runId: string, seatId: SeatIdV1) {
    return {
      userId: null,
      controllerId: `ai:${runId}:${seatId}`,
      controllerType: "ai" as const,
    };
  }
}

const shellCommand = (
  runId: string,
  participantMode: "SOLO" | "MULTIPLAYER",
  humanCount: number,
) => ({
  runId,
  templateId: "sangtian-template",
  ownerUserId: "owner-1",
  title: "Pressure lobby",
  inviteCode: `invite-${runId}`,
  visibility: "link" as const,
  participantMode,
  humanAssignments: Array.from({ length: humanCount }, (_, index) => {
    const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[
      index % PRESSURE_CHAPTER_SEAT_IDS_V1.length
    ];
    return {
      seatId,
      userId:
        participantMode === "SOLO" && index === 0
          ? "owner-1"
          : `human-${index}`,
      humanControllerId: `controller-${index}`,
    };
  }),
  idempotencyKey: `shell-${runId}`,
});

test("legacy mapping registry is deeply frozen and unresolved aliases fail closed", () => {
  assert.equal(Object.isFrozen(LEGACY_ROOM_ROLE_TO_PRESSURE_SEAT_REGISTRY_V1), true);
  assert.equal(Object.isFrozen(LEGACY_ROOM_ROLE_TO_PRESSURE_SEAT_REGISTRY_V1.entries), true);
  assert.deepEqual(
    LEGACY_ROOM_ROLE_TO_PRESSURE_SEAT_REGISTRY_V1.acceptedSeatIds,
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
  assert.equal(
    resolvePressureSeatAtEntryBoundaryV1("cabinet_finance"),
    "cabinet_finance",
  );
  assert.equal(
    resolvePressureSeatAtEntryBoundaryV1("zhejiang_governor"),
    "zhejiang_governor",
  );
  assert.throws(
    () => resolvePressureSeatAtEntryBoundaryV1("clerk"),
    /PRESSURE_LEGACY_ROLE_MAPPING_REQUIRED:legacy-room-role:clerk:/,
  );
  assert.throws(
    () => resolvePressureSeatAtEntryBoundaryV1("made-up-role"),
    /PRESSURE_LEGACY_ROLE_MAPPING_INVALID:roleKey:UNKNOWN:/,
  );
});

test("real accepted catalog creates exactly six canonical Solo roles and 1+5 controllers", async () => {
  const writer = new RecordingShellWriter();
  const service = new PressureRunShellService(
    new SangtianPressureCanonicalRoleCatalogAdapter(),
    writer,
  );
  const result = await service.create(shellCommand("solo-shell", "SOLO", 1));

  assert.deepEqual(
    result.shell.roles.map((role) => role.roleKey),
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
  assert.deepEqual(
    result.shell.players.map((player) => player.roleKey),
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
  assert.equal(result.shell.players.filter((player) => player.playerType === "human").length, 1);
  assert.equal(result.shell.players.filter((player) => player.playerType === "ai").length, 5);
  assert.equal(result.shell.lifecycle.routeFreeze, "UNFROZEN");
  assert.equal(result.shell.lifecycle.start.phase, "NOT_STARTED");
  assert.deepEqual(result.shell.lifecycle.lobby.readyUserIds, ["owner-1"]);
  assert.equal(result.shell.roles.every((role) => role.hiddenSecret === null), true);
  const serialized = JSON.stringify(result.shell);
  for (const forbidden of [
    "ChapterSandbox",
    "SceneNode",
    "WorldStateSnapshot",
    "NarrativeSegment",
    "NarrativeEntry",
    "ActorThread",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("shell cardinalities distinguish open lobby from authoritative start topology", async () => {
  const service = new PressureRunShellService(
    new SangtianPressureCanonicalRoleCatalogAdapter(),
    new RecordingShellWriter(),
  );

  await assert.rejects(service.create(shellCommand("solo-zero", "SOLO", 0)), /SOLO_EXACTLY_ONE/);
  await assert.rejects(service.create(shellCommand("solo-two", "SOLO", 2)), /SOLO_EXACTLY_ONE/);
  await assert.rejects(service.create(shellCommand("mp-one", "MULTIPLAYER", 1)), /MULTIPLAYER_TWO_TO_SIX/);
  await service.create(shellCommand("mp-two", "MULTIPLAYER", 2));
  await service.create(shellCommand("mp-six", "MULTIPLAYER", 6));
  await assert.rejects(service.create(shellCommand("mp-seven", "MULTIPLAYER", 7)), /MULTIPLAYER_TWO_TO_SIX/);

  const draft = await service.createLobbyDraft(shellCommand("mp-open", "MULTIPLAYER", 0));
  assert.equal(draft.shell.players.length, 6);
  assert.equal(draft.shell.players.every((player) => player.playerType === "ai"), true);
  assert.equal(draft.shell.roles.every((role) => role.status === "claimed" && role.isAiControlled), true);
  assert.deepEqual(draft.shell.lifecycle.lobby.joinedUserIds, ["owner-1"]);
  await assert.rejects(
    service.createLobbyDraft(shellCommand("mp-open-seven", "MULTIPLAYER", 7)),
    /MULTIPLAYER_LOBBY_ZERO_TO_SIX/,
  );
});

test("bridge claim atomically replaces AI, restores AI on change/leave, and rejects a concurrent loser", async () => {
  const writer = new RecordingShellWriter();
  const shell = new PressureRunShellService(
    new SangtianPressureCanonicalRoleCatalogAdapter(),
    writer,
  );
  const lobby = new AtomicPlaceholderLobby();
  const unusedStart = {
    start: async () => assert.fail("start is not part of this lobby test"),
  } as unknown as PressureStartLifecycleCoordinator;
  const bridge = new PressureProductionBridgeService(shell, lobby, unusedStart);
  const created = await bridge.createLobby({
    runId: "bridge-lobby",
    templateId: "sangtian-template",
    ownerUserId: "owner-1",
    title: "Bridge lobby",
    inviteCode: "bridge-code",
    visibility: "link",
    idempotencyKey: "bridge-create",
  });
  lobby.register(created.shell);

  await bridge.join({ runId: "bridge-lobby", userId: "user-a", idempotencyKey: "join-a" });
  await bridge.join({ runId: "bridge-lobby", userId: "user-b", idempotencyKey: "join-b" });
  await bridge.selectRole({
    runId: "bridge-lobby",
    userId: "user-a",
    roleKey: "cabinet_finance",
    humanControllerId: "controller-a",
    idempotencyKey: "claim-a-1",
  });
  const changed = await bridge.selectRole({
    runId: "bridge-lobby",
    userId: "user-a",
    roleKey: "jiangnan_merchant",
    humanControllerId: "controller-a",
    idempotencyKey: "claim-a-2",
  });
  assert.equal(changed.lobby.seats.find((seat) => seat.seatId === "cabinet_finance")?.controllerType, "ai");
  assert.equal(changed.lobby.seats.find((seat) => seat.seatId === "jiangnan_merchant")?.userId, "user-a");

  const contested = await Promise.allSettled([
    bridge.selectRole({
      runId: "bridge-lobby",
      userId: "user-a",
      roleKey: "qingliu_law",
      humanControllerId: "controller-a",
      idempotencyKey: "race-a",
    }),
    bridge.selectRole({
      runId: "bridge-lobby",
      userId: "user-b",
      roleKey: "qingliu_law",
      humanControllerId: "controller-b",
      idempotencyKey: "race-b",
    }),
  ]);
  assert.equal(contested.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(contested.filter((result) => result.status === "rejected").length, 1);
  const afterRace = await bridge.getStatus({ runId: "bridge-lobby" });
  assert.ok(afterRace);
  assert.equal(afterRace.seats.length, 6);
  assert.equal(new Set(afterRace.seats.map((seat) => seat.seatId)).size, 6);
  assert.equal(afterRace.seats.filter((seat) => seat.seatId === "qingliu_law" && seat.controllerType === "human").length, 1);

  const winner = afterRace.seats.find((seat) => seat.seatId === "qingliu_law")?.userId;
  assert.ok(winner);
  const left = await bridge.leave({
    runId: "bridge-lobby",
    userId: winner,
    idempotencyKey: "leave-winner",
  });
  assert.equal(left.lobby.seats.find((seat) => seat.seatId === "qingliu_law")?.controllerType, "ai");
  assert.equal(left.lobby.members.some((member) => member.userId === winner), false);

  await assert.rejects(
    bridge.selectRole({
      runId: "bridge-lobby",
      userId: "user-b",
      roleKey: "clerk",
      humanControllerId: "controller-b",
      idempotencyKey: "legacy-clerk",
    }),
    /PRESSURE_LEGACY_ROLE_MAPPING_REQUIRED/,
  );
});
