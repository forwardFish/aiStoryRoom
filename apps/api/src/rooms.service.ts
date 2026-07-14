import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { StoryService } from "./story.service";
import { StoryTaskOutboxService } from "./story-task-outbox.service";
import { StoryAccessService } from "./story-access/story-access.service";
import { CreditsService } from "./credits/credits.service";
import type { AuthenticatedUser } from "./auth/current-user.decorator";
import { Observable } from "rxjs";

const WORLD_TEMPLATES: Record<string, { templateId: string; minPlayers: number; maxPlayers: number }> = {
  sangtian: { templateId: "template_sangtian_001", minPlayers: 3, maxPlayers: 3 },
  caesar: { templateId: "template_caesar_001", minPlayers: 3, maxPlayers: 6 }
};

type RoomState = { room?: { worldId: string; readyUserIds: string[]; hostRoleLocked: boolean; minPlayers: number; createdAt: string } };
function roomState(value: unknown): RoomState { return value && typeof value === "object" && !Array.isArray(value) ? value as RoomState : {}; }

@Injectable()
export class RoomsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(StoryService) private readonly story: StoryService, @Inject(StoryTaskOutboxService) private readonly outbox: StoryTaskOutboxService, @Inject(StoryAccessService) private readonly access: StoryAccessService, @Inject(CreditsService) private readonly credits: CreditsService) {}

  async list(worldId?: string, user?: AuthenticatedUser) {
    if (worldId && !WORLD_TEMPLATES[worldId]) throw new BadRequestException({ code: "UNKNOWN_WORLD", message: "Unknown world" });
    const rooms = await this.prisma.storyRun.findMany({
      where: { mode: "room", visibility: "public", status: "waiting_players", ...(worldId ? { templateKey: worldId } : {}) },
      include: { players: { include: { user: true, role: true } }, roles: true, owner: true },
      orderBy: { updatedAt: "desc" }, take: 50
    });
    const openRooms = rooms.filter((room) => room.players.filter((player) => player.playerType === "human").length < room.maxPlayers);
    const mine = user ? await this.mine(user, worldId) : { rooms: [] };
    const publicProjection = (room: any) => {
      const projected = this.project(room, user?.id);
      return { ...projected, roles: projected.roles.map(({ personalGoal: _personalGoal, ...role }: any) => role) };
    };
    return { rooms: openRooms.map(publicProjection), myRooms: mine.rooms };
  }

  /** Rooms the authenticated player can reopen, continue, or inspect after completion. */
  async mine(user: AuthenticatedUser, worldId?: string) {
    if (worldId && !WORLD_TEMPLATES[worldId]) throw new BadRequestException({ code: "UNKNOWN_WORLD", message: "Unknown world" });
    const rooms = await this.prisma.storyRun.findMany({
      where: {
        mode: "room",
        status: { in: ["waiting_players", "playing", "chapter_generated"] },
        players: { some: { userId: user.id } },
        ...(worldId ? { templateKey: worldId } : {})
      },
      include: { players: { include: { user: true, role: true } }, roles: true, owner: true },
      orderBy: { updatedAt: "desc" }, take: 50
    });
    return {
      rooms: rooms.map((room) => {
        const projected = this.project(room, user.id);
        return { ...projected, roles: projected.roles.map((role: any) => role.claimedByCurrentUser ? role : { ...role, personalGoal: undefined }) };
      })
    };
  }

  async create(user: AuthenticatedUser, input: { worldId?: string; title?: string; visibility?: string; maxPlayers?: number }) {
    const worldId = String(input.worldId || "sangtian");
    const world = WORLD_TEMPLATES[worldId];
    if (!world) throw new BadRequestException({ code: "UNKNOWN_WORLD", message: "Only sangtian and caesar are playable worlds" });
    const maxPlayers = Math.max(world.minPlayers, Math.min(world.maxPlayers, Number(input.maxPlayers || world.maxPlayers)));
    const created = await this.story.createRun(user.openid, { templateId: world.templateId, mode: "room", maxPlayers, aiPlayerCount: 0, ownerAsPlayer: true });
    const state = { ...roomState(created.stateJson), room: { worldId, readyUserIds: [], hostRoleLocked: false, minPlayers: world.minPlayers, createdAt: new Date().toISOString() } };
    await this.prisma.storyRun.update({ where: { id: created.id }, data: { title: String(input.title || `${created.title}`).slice(0, 100), status: "waiting_players", templateKey: worldId, totalDays: 7, visibility: input.visibility === "private" ? "link" : "public", stateJson: state as any } });
    return this.get(user, created.id);
  }

  /** A private one-player run that uses the same seven-node engine as rooms. */
  async createSolo(user: AuthenticatedUser, input: { worldId?: string; roleKey?: string }) {
    const worldId = String(input.worldId || "caesar");
    const world = WORLD_TEMPLATES[worldId];
    if (!world) throw new BadRequestException({ code: "UNKNOWN_WORLD", message: "Unknown world" });
    const created = await this.story.createRun(user.openid, { templateId: world.templateId, mode: "room", maxPlayers: 1, aiPlayerCount: 0, ownerAsPlayer: true });
    const requestedRole = String(input.roleKey || (worldId === "caesar" ? "brutus" : "zhejiang_governor"));
    const role = created.roles.find((item: { roleKey: string }) => item.roleKey === requestedRole);
    if (!role) throw new BadRequestException({ code: "ROLE_NOT_FOUND", message: "That role is not available in this world" });
    await this.story.claimRole(user.openid, created.id, role.id);
    const state = { ...roomState(created.stateJson), room: { worldId, readyUserIds: [user.id], hostRoleLocked: true, minPlayers: 1, createdAt: new Date().toISOString(), solo: true } };
    await this.prisma.storyRun.update({ where: { id: created.id }, data: { title: `${created.title} · Solo`, templateKey: worldId, totalDays: 7, maxPlayers: 1, visibility: "private", stateJson: state as any } });
    return this.get(user, created.id);
  }

  async joinByCode(user: AuthenticatedUser, inviteCode: string) {
    const room = await this.prisma.storyRun.findUnique({ where: { inviteCode: String(inviteCode || "").trim().toUpperCase() } });
    if (!room || room.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (room.status !== "waiting_players") throw new ConflictException({ code: "ROOM_NOT_JOINABLE", message: "Room has already started" });
    const current = await this.prisma.storyPlayer.count({ where: { runId: room.id, playerType: "human" } });
    const alreadyJoined = await this.prisma.storyPlayer.findUnique({ where: { runId_userId: { runId: room.id, userId: user.id } } });
    if (!alreadyJoined && current >= room.maxPlayers) throw new ConflictException({ code: "ROOM_FULL", message: "Room is full" });
    await this.story.joinRun(user.openid, room.id);
    return this.get(user, room.id);
  }

  async get(user: AuthenticatedUser, roomId: string) {
    const room = await this.prisma.storyRun.findUnique({ where: { id: roomId }, include: { owner: true, players: { include: { user: true, role: true }, orderBy: { joinedAt: "asc" } }, roles: { orderBy: { createdAt: "asc" } } } });
    if (!room || room.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    const member = room.players.some((player) => player.userId === user.id) || room.ownerUserId === user.id;
    if (!member) throw new ForbiddenException({ code: "ROOM_ACCESS_DENIED", message: "Join this room before viewing its private state" });
    const projected = this.project(room, user.id);
    return { ...projected, roles: projected.roles.map((role: any) => role.claimedByCurrentUser ? role : { ...role, personalGoal: undefined }) };
  }

  async selectRole(user: AuthenticatedUser, roomId: string, roleId: string) {
    const room = await this.requireWaitingMember(user, roomId);
    const selected = room.roles.find((role) => role.id === roleId);
    if (!selected) throw new NotFoundException({ code: "ROLE_NOT_FOUND", message: "Role not found" });
    await this.prisma.$transaction(async (tx) => {
      const player = await tx.storyPlayer.findUnique({ where: { runId_userId: { runId: roomId, userId: user.id } } });
      if (!player) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Join room before selecting a role" });
      if (player.roleId && player.roleId !== roleId) await tx.storyRole.update({ where: { id: player.roleId }, data: { status: "available", isAiControlled: false } });
      const claimed = await tx.storyRole.updateMany({ where: { id: roleId, runId: roomId, OR: [{ status: "available" }, { players: { some: { userId: user.id } } }] }, data: { status: "claimed", isAiControlled: false } });
      if (claimed.count !== 1) throw new ConflictException({ code: "ROLE_ALREADY_TAKEN", message: "That role was just claimed by another player" });
      await tx.storyPlayer.update({ where: { runId_userId: { runId: roomId, userId: user.id } }, data: { roleId, lastActiveAt: new Date() } });
    });
    await this.clearReady(roomId, user.id);
    return this.get(user, roomId);
  }

  async lockHostRole(user: AuthenticatedUser, roomId: string) {
    const room = await this.requireWaitingMember(user, roomId);
    if (room.ownerUserId !== user.id) throw new ForbiddenException({ code: "HOST_REQUIRED", message: "Only the host can lock the first role" });
    const host = room.players.find((player) => player.userId === user.id);
    if (!host?.roleId) throw new BadRequestException({ code: "ROLE_REQUIRED", message: "Select a role before locking it" });
    const state = roomState(room.stateJson);
    state.room = { ...(state.room || { worldId: room.templateKey, readyUserIds: [], minPlayers: 3, createdAt: new Date().toISOString() }), hostRoleLocked: true };
    await this.prisma.storyRun.update({ where: { id: roomId }, data: { stateJson: state as any } });
    return this.get(user, roomId);
  }

  async ready(user: AuthenticatedUser, roomId: string, isReady = true) {
    // `ready` is a genuine multi-user write.  Read-modify-write on its JSON
    // state needs an optimistic version guard, otherwise simultaneous player
    // clicks can silently erase another player's ready flag.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const room = await this.requireWaitingMember(user, roomId);
      const player = room.players.find((item) => item.userId === user.id);
      if (!player?.roleId) throw new BadRequestException({ code: "ROLE_REQUIRED", message: "Select a role before marking ready" });
      const state = roomState(room.stateJson);
      const ready = new Set(state.room?.readyUserIds || []);
      if (isReady) ready.add(user.id); else ready.delete(user.id);
      state.room = { ...(state.room || { worldId: room.templateKey, hostRoleLocked: false, minPlayers: 3, createdAt: new Date().toISOString() }), readyUserIds: [...ready] };
      const updated = await this.prisma.storyRun.updateMany({ where: { id: roomId, version: room.version }, data: { stateJson: state as any, version: { increment: 1 } } });
      if (updated.count === 1) return this.get(user, roomId);
    }
    throw new ConflictException({ code: "ROOM_STATE_CONFLICT", message: "Room state changed; refresh and try again" });
  }

  async start(user: AuthenticatedUser, roomId: string) {
    const room = await this.requireWaitingMember(user, roomId);
    if (room.ownerUserId !== user.id) throw new ForbiddenException({ code: "HOST_REQUIRED", message: "Only the host can start the game" });
    const state = roomState(room.stateJson);
    const minimum = state.room?.minPlayers || WORLD_TEMPLATES[room.templateKey]?.minPlayers || 3;
    const humans = room.players.filter((player) => player.playerType === "human");
    const ready = new Set(state.room?.readyUserIds || []);
    if (!state.room?.hostRoleLocked) throw new BadRequestException({ code: "HOST_ROLE_NOT_LOCKED", message: "Host must lock a role first" });
    if (humans.length < minimum || humans.some((player) => !player.roleId || !player.userId || !ready.has(player.userId))) throw new BadRequestException({ code: "ROOM_NOT_READY", message: "All minimum players must select a role and be ready" });
    await this.prisma.storyRun.update({ where: { id: roomId }, data: { status: "playing", version: { increment: 1 } } });
    return this.get(user, roomId);
  }

  async close(user: AuthenticatedUser, roomId: string) {
    const room = await this.requireWaitingMember(user, roomId);
    if (room.ownerUserId !== user.id) throw new ForbiddenException({ code: "HOST_REQUIRED", message: "Only the host can close a waiting room" });
    await this.prisma.storyRun.update({ where: { id: roomId }, data: { status: "closed", version: { increment: 1 } } });
    return this.get(user, roomId);
  }

  async game(user: AuthenticatedUser, roomId: string) {
    const room = await this.get(user, roomId);
    if (room.status === "chapter_generated") return { room, completed: true, currentNode: null, submittedRoleIds: [], access: this.access.roomAccessState(room, 7) };
    if (room.status !== "playing" && room.status !== "resolving") throw new ConflictException({ code: "ROOM_NOT_STARTED", message: "The host has not started this room" });
    const currentNode = await this.story.currentNode(roomId);
    const actions = await this.story.nodeActions(currentNode.id);
    const access = this.access.roomAccessState(room, currentNode.nodeIndex);
    const balance = access.requiresUnlock ? await this.credits.getBalance(user.id) : undefined;
    return {
      room,
      completed: false,
      access: { ...access, balance: balance?.available },
      currentNode: {
        id: currentNode.id,
        nodeIndex: currentNode.nodeIndex,
        title: currentNode.title,
        publicNarration: currentNode.publicNarration,
        nodeGoal: currentNode.nodeGoal,
        actionOptions: currentNode.actionOptionsJson
      },
      submittedRoleIds: actions.filter((action: any) => action.status === "accepted").map((action: any) => action.roleId)
    };
  }

  async result(user: AuthenticatedUser, roomId: string) {
    const room = await this.get(user, roomId);
    if (room.status !== "chapter_generated") {
      throw new ConflictException({ code: "RESULT_NOT_READY", message: "The result is available after the seventh round is resolved" });
    }
    const state = await this.story.getRunState(roomId);
    const chapter = state.chapters.at(-1);
    const currentPlayer = room.players.find((player: { userId?: string | null; roleId?: string | null }) => player.userId === user.id);
    const role = room.roles.find((item: { id: string }) => item.id === currentPlayer?.roleId);
    return {
      room: { id: room.id, title: room.title, worldId: room.worldId, completedAt: state.run.updatedAt },
      chapter: chapter ? {
        title: chapter.title,
        content: chapter.content,
        highlights: Array.isArray(chapter.highlightsJson) ? chapter.highlightsJson.slice(0, 3) : []
      } : null,
      player: role ? { roleName: role.roleName, personalGoal: role.personalGoal } : null,
      completedNodes: state.run.completedNodeCount
    };
  }

  async submitGameAction(user: AuthenticatedUser, roomId: string, input: { actionType?: string; targetText?: string; method?: string; intent?: string; riskLevel?: string }) {
    const room = await this.requirePlayingMember(user, roomId);
    const player = room.players.find((item) => item.userId === user.id);
    if (!player?.roleId) throw new BadRequestException({ code: "ROLE_REQUIRED", message: "Select a role before submitting a game action" });
    const node = await this.story.currentNode(roomId);
    await this.access.ensureRoomRoundAccess(user, roomId, node.nodeIndex);
    const actionType = ["observe", "investigate", "negotiate", "support"].includes(String(input.actionType)) ? String(input.actionType) : "observe";
    const riskLevel = ["safe", "normal", "risky"].includes(String(input.riskLevel)) ? String(input.riskLevel) : "normal";
    const result = await this.story.submitAction(user.openid, node.id, {
      runId: roomId,
      roleId: player.roleId,
      actionType: actionType as any,
      targetText: String(input.targetText || node.title).slice(0, 240),
      method: String(input.method || "Provide a verifiable response to the current situation.").slice(0, 600),
      intent: String(input.intent || "Advance the shared investigation without taking another role's decision.").slice(0, 600),
      riskLevel: riskLevel as any
    });
    return { result, ...(await this.game(user, roomId)) };
  }

  async resolveGameNode(user: AuthenticatedUser, roomId: string) {
    const { node } = await this.requireResolvableNode(user, roomId);
    const resolution = await this.story.resolveNode(node.id);
    return { resolution, ...(await this.game(user, roomId)) };
  }

  async resolveGameNodeAsync(user: AuthenticatedUser, roomId: string) {
    const { room, node } = await this.requireResolvableNode(user, roomId);
    const task = await this.outbox.enqueueResolve(room.id, node.id);
    return { ...task, runVersion: room.version + (room.status === "playing" ? 1 : 0), roomStatus: "resolving" };
  }

  async resolutionTask(user: AuthenticatedUser, roomId: string, taskId: string) {
    // A final (seventh) resolution switches the run to chapter_generated
    // before the worker records the task as completed. Polling must remain
    // available across that transition so the client can safely navigate to
    // the result page instead of receiving a transient room-state error.
    await this.get(user, roomId);
    const task = await this.outbox.get(taskId);
    if (!task || task.runId !== roomId) throw new NotFoundException({ code: "TASK_NOT_FOUND", message: "Resolution task not found" });
    return task;
  }

  /** Member-scoped incremental events. Never include another player's actions or private projection. */
  async events(user: AuthenticatedUser, roomId: string, after?: string) {
    const room = await this.get(user, roomId);
    const cursor = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : undefined;
    const [run, notifications, task] = await Promise.all([
      this.prisma.storyRun.findUniqueOrThrow({ where: { id: roomId }, select: { version: true, updatedAt: true } }),
      this.prisma.notification.findMany({
        where: { runId: roomId, userId: user.id, ...(cursor ? { createdAt: { gt: cursor } } : {}) },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: { id: true, type: true, title: true, content: true, createdAt: true, isRead: true }
      }),
      this.prisma.storyTaskOutbox.findFirst({
        where: { runId: roomId, status: { in: ["pending", "running"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, attempt: true, updatedAt: true }
      })
    ]);
    return {
      room: { id: room.id, status: room.status, version: run.version, updatedAt: run.updatedAt },
      resolutionTask: task ? { taskId: task.id, status: task.status, attempt: task.attempt, updatedAt: task.updatedAt } : null,
      notifications,
      nextCursor: notifications.at(-1)?.createdAt.toISOString() || cursor?.toISOString() || new Date().toISOString()
    };
  }

  eventStream(user: AuthenticatedUser, roomId: string, after?: string) {
    return new Observable<{ data: object; id?: string }>((subscriber) => {
      let cursor = after;
      let running = false;
      const emit = async () => {
        if (running || subscriber.closed) return;
        running = true;
        try {
          const event = await this.events(user, roomId, cursor);
          cursor = event.nextCursor;
          subscriber.next({ data: event, id: cursor });
        } catch (error) {
          subscriber.error(error);
        } finally {
          running = false;
        }
      };
      void emit();
      const timer = setInterval(() => void emit(), 1_000);
      return () => clearInterval(timer);
    });
  }

  private async requireResolvableNode(user: AuthenticatedUser, roomId: string) {
    const room = await this.requirePlayingMember(user, roomId);
    if (room.ownerUserId !== user.id) throw new ForbiddenException({ code: "HOST_REQUIRED", message: "Only the host can resolve the shared round" });
    if (room.status === "resolving") {
      const existing = await this.prisma.storyTaskOutbox.findFirst({ where: { runId: roomId, status: { in: ["pending", "running"] } }, orderBy: { createdAt: "desc" } });
      if (existing) throw new ConflictException({ code: "RESOLUTION_IN_PROGRESS", message: "This round is already resolving", taskId: existing.id });
    }
    const node = await this.story.currentNode(roomId);
    const actions = await this.story.nodeActions(node.id);
    const humanRoleIds = room.players.filter((player) => player.playerType === "human" && player.roleId).map((player) => player.roleId as string);
    const submitted = new Set(actions.filter((action: any) => action.status === "accepted").map((action: any) => action.roleId));
    const missing = humanRoleIds.filter((roleId) => !submitted.has(roleId));
    if (missing.length) throw new ConflictException({ code: "WAITING_FOR_PLAYER_ACTIONS", message: "Every selected human role must submit an action before resolution", missingRoleIds: missing });
    return { room, node };
  }

  private async requireWaitingMember(user: AuthenticatedUser, roomId: string) {
    const room = await this.prisma.storyRun.findUnique({ where: { id: roomId }, include: { players: { include: { user: true, role: true } }, roles: true } });
    if (!room || room.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (room.status !== "waiting_players") throw new ConflictException({ code: "ROOM_NOT_WAITING", message: "Room is no longer accepting lobby changes" });
    if (!room.players.some((player) => player.userId === user.id)) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Join the room first" });
    return room;
  }

  private async requirePlayingMember(user: AuthenticatedUser, roomId: string) {
    const room = await this.prisma.storyRun.findUnique({ where: { id: roomId }, include: { players: { include: { user: true, role: true } }, roles: true } });
    if (!room || room.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (room.status !== "playing" && room.status !== "resolving" && room.status !== "chapter_generated") throw new ConflictException({ code: "ROOM_NOT_STARTED", message: "The host has not started this room" });
    if (!room.players.some((player) => player.userId === user.id)) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Join the room first" });
    return room;
  }

  private async clearReady(roomId: string, userId: string) {
    const room = await this.prisma.storyRun.findUniqueOrThrow({ where: { id: roomId } });
    const state = roomState(room.stateJson); const ready = new Set(state.room?.readyUserIds || []); ready.delete(userId);
    state.room = { ...(state.room || { worldId: room.templateKey, hostRoleLocked: false, minPlayers: 3, createdAt: new Date().toISOString() }), readyUserIds: [...ready] };
    await this.prisma.storyRun.update({ where: { id: roomId }, data: { stateJson: state as any } });
  }

  private project(room: any, viewerId?: string) {
    const state = roomState(room.stateJson); const ready = new Set(state.room?.readyUserIds || []);
    const nextAction = room.status === "waiting_players" ? "open" : room.status === "playing" || room.status === "resolving" ? "continue" : room.status === "chapter_generated" ? "view_result" : "none";
    return { id: room.id, title: room.title, worldId: room.templateKey, templateId: room.templateId, status: room.status, nextAction, inviteCode: room.inviteCode, code: room.inviteCode, visibility: room.visibility, maxPlayers: room.maxPlayers, minPlayers: state.room?.minPlayers || 3, ownerUserId: room.ownerUserId, isHost: room.ownerUserId === viewerId, hostRoleLocked: Boolean(state.room?.hostRoleLocked), accessLevel: room.accessLevel, freeDecisionsUsed: room.freeDecisionsUsed, readyUserIds: [...ready], players: room.players.map((player: any) => ({ id: player.id, userId: player.userId, nickname: player.user?.nickname || "Player", roleId: player.roleId, roleKey: player.role?.roleKey || null, roleName: player.role?.roleName || null, ready: Boolean(player.userId && ready.has(player.userId)), joinedAt: player.joinedAt })), roles: room.roles.map((role: any) => ({ id: role.id, roleKey: role.roleKey, roleName: role.roleName, identity: role.identity, publicInfo: role.publicInfo, personalGoal: role.personalGoal, status: role.status, isAiControlled: role.isAiControlled, claimedByCurrentUser: room.players.some((player: any) => player.roleId === role.id && player.userId === viewerId) })), updatedAt: room.updatedAt };
  }
}
