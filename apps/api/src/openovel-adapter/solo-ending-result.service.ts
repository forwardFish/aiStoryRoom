import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import {
  OPENOVEL_ENGINE_VERSION,
  OpenNovelRuntimeClient,
} from "./openovel-runtime.client";
import {
  compileLegacyOpenNovelResult,
  compileOpenNovelResultV2,
  isRawOpenNovelResult,
  type RawOpenNovelResult,
  type SoloResultActionRecord,
  type SoloResultRunRecord,
} from "./solo-ending-result";

@Injectable()
export class SoloEndingResultService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OpenNovelRuntimeClient) private readonly runtime: OpenNovelRuntimeClient,
  ) {}

  async present(
    user: AuthenticatedUser,
    runId: string,
    payload: unknown,
  ): Promise<unknown> {
    if (!isRawOpenNovelResult(payload)) return payload;
    const run = await this.authorizedRun(user, runId);
    if (run.engineVersion !== OPENOVEL_ENGINE_VERSION) return payload;
    const actions = await this.resolvedActions(runId, user.id);
    return compileOpenNovelResultV2({
      raw: payload,
      run,
      viewerUserId: user.id,
      actions,
      // The current runtime module advertises only the role already bound to
      // this completed run. Future roles must be exposed by an explicit
      // runtime capability before the change-role action can become enabled.
      supportedRoleKeys: [run.players[0]!.role!.roleKey],
      nextPart: null,
    });
  }

  /**
   * Historical completed runs can predate ending.json. Recover only that exact
   * fail-closed case; permission, membership, runtime and unrelated 409 errors
   * continue to propagate unchanged.
   */
  async recoverCompletedLegacy(
    user: AuthenticatedUser,
    runId: string,
    error: unknown,
  ): Promise<unknown | null> {
    if (errorCode(error) !== "RESULT_NOT_READY") return null;
    const run = await this.authorizedRun(user, runId);
    if (run.engineVersion !== OPENOVEL_ENGINE_VERSION) return null;
    const runtimeRun = await this.runtime.getRun(runId);
    if (runtimeRun.status !== "COMPLETED") return null;

    if (runtimeRun.ending) {
      const actions = await this.resolvedActions(runId, user.id);
      const role = run.players[0]!.role!;
      const raw: RawOpenNovelResult = {
        room: {
          id: run.id,
          title: (run as any).title,
          worldId: run.templateKey,
          completedAt: runtimeRun.updatedAt,
        },
        player: {
          roleName: role.roleName,
          personalGoal: role.personalGoal,
          endingTitle: runtimeRun.ending.title,
          protagonistFate: runtimeRun.ending.protagonistFate,
        },
        ending: runtimeRun.ending,
        completedNodes: runtimeRun.turnNumber,
      };
      return compileOpenNovelResultV2({
        raw,
        run,
        viewerUserId: user.id,
        actions,
        supportedRoleKeys: [role.roleKey],
        nextPart: null,
      });
    }

    return compileLegacyOpenNovelResult({
      run,
      viewerUserId: user.id,
      completedNodes: runtimeRun.turnNumber,
      ending: null,
    });
  }

  private async authorizedRun(
    user: AuthenticatedUser,
    runId: string,
  ): Promise<SoloResultRunRecord & { title?: string }> {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: {
        players: {
          where: { userId: user.id },
          include: { role: true },
        },
      },
    });
    if (!run) {
      throw new NotFoundException({
        code: "OPENOVEL_RUN_NOT_FOUND",
        message: "Story run not found.",
      });
    }
    if (run.ownerUserId !== user.id || !run.players.some((player: any) => player.userId === user.id && player.role)) {
      throw new ForbiddenException({
        code: "OPENOVEL_RUN_ACCESS_DENIED",
        message: "This story belongs to another player.",
      });
    }
    if (run.engineVersion !== OPENOVEL_ENGINE_VERSION) {
      throw new ConflictException({
        code: "OPENOVEL_RUNTIME_MISMATCH",
        message: "This run does not use OpenNovel-First.",
      });
    }
    return run as unknown as SoloResultRunRecord & { title?: string };
  }

  private async resolvedActions(
    runId: string,
    userId: string,
  ): Promise<SoloResultActionRecord[]> {
    return this.prisma.playerAction.findMany({
      where: {
        runId,
        userId,
        status: "resolved",
        actorKind: "HUMAN",
      },
      orderBy: [{ resolvedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        runId: true,
        userId: true,
        status: true,
        method: true,
        immediateJson: true,
        resolvedJson: true,
        resolvedAt: true,
        createdAt: true,
      },
    }) as unknown as Promise<SoloResultActionRecord[]>;
  }
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  if ("getResponse" in error && typeof error.getResponse === "function") {
    const response = error.getResponse();
    if (response && typeof response === "object" && "code" in response) {
      return String((response as any).code || "");
    }
  }
  return "code" in error ? String((error as any).code || "") : "";
}
