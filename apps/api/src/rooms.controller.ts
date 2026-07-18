import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Sse, UseGuards, type MessageEvent } from "@nestjs/common";
import type { Observable } from "rxjs";
import { AuthGuard } from "./auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "./auth/current-user.decorator";
import { RoomsService } from "./rooms.service";
import { PresenceHeartbeatRateLimitGuard } from "./api-transport";
import type { ControlCommandV1, HeartbeatCommandV1, LayoutCommandV1, SlotCommandV1 } from "@ai-story/shared";

@UseGuards(AuthGuard)
@Controller("v4/rooms")
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("worldId") worldId?: string) { return this.rooms.list(worldId, user); }
  @Get("mine") mine(@CurrentUser() user: AuthenticatedUser, @Query("worldId") worldId?: string) { return this.rooms.mine(user, worldId); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() body: { worldId?: string; title?: string; visibility?: string; maxPlayers?: number; idempotencyKey?: string }) { return this.rooms.create(user, body); }
  @Post("solo") createSolo(@CurrentUser() user: AuthenticatedUser, @Body() body: { worldId?: string; roleKey?: string; idempotencyKey?: string }) { return this.rooms.createSolo(user, body); }
  @Post("join-by-code") join(@CurrentUser() user: AuthenticatedUser, @Body() body: { inviteCode?: string; code?: string }) { return this.rooms.joinByCode(user, String(body.inviteCode || body.code || "")); }
  @Get(":roomId/game") game(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) { return this.rooms.game(user, roomId); }
  @Get(":roomId/result") result(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) { return this.rooms.result(user, roomId); }
  @Post(":roomId/game/action") action(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: { actionType?: string; targetText?: string; method?: string; intent?: string; riskLevel?: string }) { return this.rooms.submitGameAction(user, roomId, body); }
  @Post(":roomId/game/actions/main") main(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: SlotCommandV1) { return this.rooms.submitMain(user, roomId, body); }
  @Post(":roomId/game/actions/maneuver") maneuver(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: SlotCommandV1) { return this.rooms.submitManeuver(user, roomId, body); }
  @Post(":roomId/game/events/:eventId/reaction") reaction(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Param("eventId") eventId: string, @Body() body: SlotCommandV1) { return this.rooms.submitReaction(user, roomId, eventId, body); }
  @Post(":roomId/game/layout/done") done(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: LayoutCommandV1) { return this.rooms.layoutDone(user, roomId, body); }
  @Post(":roomId/game/layout/leave-stage") leaveStage(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: LayoutCommandV1) { return this.rooms.leaveStage(user, roomId, body); }
  @Post(":roomId/presence/heartbeat") @UseGuards(PresenceHeartbeatRateLimitGuard) heartbeat(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: HeartbeatCommandV1) { return this.rooms.heartbeat(user, roomId, body); }
  @Post(":roomId/game/control/handoff-to-ai") handoff(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: ControlCommandV1) { return this.rooms.handoffToAi(user, roomId, body); }
  @Post(":roomId/game/control/reclaim") reclaim(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: ControlCommandV1) { return this.rooms.reclaim(user, roomId, body); }
  @Post(":roomId/game/resolve") resolve(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) { return this.rooms.resolveGameNode(user, roomId); }
  @Post(":roomId/game/resolve-async") @HttpCode(202) resolveAsync(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) { return this.rooms.resolveGameNodeAsync(user, roomId); }
  @Get(":roomId/game/tasks/:taskId") task(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Param("taskId") taskId: string) { return this.rooms.resolutionTask(user, roomId, taskId); }
  @Get(":roomId/events") events(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Query("afterDeliverySequence") afterDeliverySequence?: string, @Query("after") legacyAfter?: string) { return this.rooms.events(user, roomId, afterDeliverySequence ?? legacyAfter); }
  @Sse(":roomId/events/stream") eventsStream(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Query("afterDeliverySequence") afterDeliverySequence?: string, @Query("after") legacyAfter?: string): Observable<MessageEvent> { return this.rooms.eventStream(user, roomId, afterDeliverySequence ?? legacyAfter); }
  @Get(":roomId") get(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) { return this.rooms.get(user, roomId); }
  @Post(":roomId/role") selectRole(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: { roleId?: string }) { return this.rooms.selectRole(user, roomId, String(body.roleId || "")); }
  @Post(":roomId/role/lock") lockRole(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) { return this.rooms.lockHostRole(user, roomId); }
  @Post(":roomId/ready") ready(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: { ready?: boolean }) { return this.rooms.ready(user, roomId, body.ready !== false); }
  @Post(":roomId/start") start(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) { return this.rooms.start(user, roomId); }
  @Post(":roomId/close") close(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) { return this.rooms.close(user, roomId); }
}
