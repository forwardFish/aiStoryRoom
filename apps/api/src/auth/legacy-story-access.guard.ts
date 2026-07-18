import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma.service";
import type { AuthenticatedUser } from "./current-user.decorator";
import { PUBLIC_ROUTE_METADATA } from "./public.decorator";

/**
 * Closes the historical raw StoryController path for room-backed runs.
 * Continuous and legacy room games must be read through RoomsController's
 * membership projections; SOLO resources remain available to their owner.
 */
@Injectable()
export class LegacyStoryAccessGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Reflector) private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_METADATA, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    const params = request.params || {};
    const requestPath = String(request.path || request.originalUrl || request.url || "").split("?", 1)[0];
    const isV4StoryRunRoute = /(?:^|\/)v4\/story-runs(?:\/|$)/.test(requestPath);
    const isAdminStoryRunRoute = /(?:^|\/)admin\/story-runs(?:\/|$)/.test(requestPath);
    const databaseAvailable = process.env.DISABLE_PRISMA !== "true" && Boolean(process.env.DATABASE_URL);
    const fileBackedV4 = process.env.MVP_STORY_STORAGE === "file" || !databaseAvailable;

    // Admin story-run routes have their own method-level AdminGuard. Applying
    // the member-only legacy projection guard first would reject legitimate
    // administrators who are not participants in the inspected run.
    if (isAdminStoryRunRoute) return true;

    // File-backed v4 records have no authenticated owner/member relation. They
    // must never be treated as an authorization fallback, including collection
    // POST routes that do not yet have a runId parameter.
    if (isV4StoryRunRoute && fileBackedV4) {
      throw new ServiceUnavailableException({
        code: "V4_FILE_STORAGE_DISABLED",
        message: "Database-backed ownership is required for v4 story runs"
      });
    }

    if (!params.runId && !params.nodeId && !params.chapterId) return true;

    if (!databaseAvailable) {
      throw new ServiceUnavailableException({ code: "DATABASE_REQUIRED", message: "Database-backed story access is unavailable" });
    }

    const run = params.runId
      ? await this.prisma.storyRun.findUnique({ where: { id: params.runId }, select: runAccessSelect })
      : params.nodeId
        ? (await this.prisma.sceneNode.findUnique({ where: { id: params.nodeId }, select: { run: { select: runAccessSelect } } }))?.run
        : (await this.prisma.chapter.findUnique({ where: { id: params.chapterId }, select: { run: { select: runAccessSelect } } }))?.run;

    // Unknown and file-only identifiers share the same response as an object
    // owned by another user. This avoids both ACL bypass and existence leaks.
    if (!run) throw resourceNotFound();
    const member = Boolean(user && (run.ownerUserId === user.id || run.players.some((player) => player.userId === user.id)));
    if (!member) throw resourceNotFound();
    if (run.mode === "room") {
      throw new ForbiddenException({ code: "ROOM_PROJECTION_REQUIRED", message: "Room games are available only through member projections" });
    }
    return true;
  }
}

const runAccessSelect = {
  ownerUserId: true,
  mode: true,
  players: { select: { userId: true } }
} as const;

function resourceNotFound() {
  return new NotFoundException({ code: "STORY_RESOURCE_NOT_FOUND", message: "Story resource not found" });
}
