import { Body, Controller, Delete, Get, Header, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { ResultSharingService } from "./result-sharing.service";

@Controller("v4/rooms/:roomId/result/shares")
@UseGuards(AuthGuard)
export class ResultSharingController {
  constructor(@Inject(ResultSharingService) private readonly shares: ResultSharingService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Body() body: { expiresInDays?: number; channel?: string; includeRoleName?: boolean }) {
    return this.shares.create(user, roomId, body || {});
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string) {
    return this.shares.list(user, roomId);
  }

  @Delete(":shareId")
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("roomId") roomId: string, @Param("shareId") shareId: string) {
    return this.shares.revoke(user, roomId, shareId);
  }
}

@Controller("v4/public/results")
export class PublicResultSharingController {
  constructor(@Inject(ResultSharingService) private readonly shares: ResultSharingService) {}

  @Get(":token")
  @Header("Cache-Control", "no-store, private")
  @Header("X-Robots-Tag", "noindex, nofollow, noarchive")
  get(@Param("token") token: string) {
    return this.shares.publicResult(token);
  }
}
