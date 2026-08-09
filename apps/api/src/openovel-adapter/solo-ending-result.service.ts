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
  type OpenNovelPublicRun,
} from "./openovel-runtime.client";
import {
  compileLegacyOpenNovelResult,
  compileOpenNovelResultV2,
  isRawOpenNovelResult,
  isSoloResultNotReadyError,
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
    const runtimeRun = await this.runtime.getRun(runId);
    assertAuthoritativeResultReady(run, payload, runtimeRun);
    const actions = await this.resolvedActions(runId, user.id);
    try {
      return compileOpenNovelResultV2({
        raw: payload,
        authoritativeEnding: runtimeRun.ending!,
        run,
        viewerUserId: user.id,
        actions,
        // The current runtime module advertises only the role already bound to
        // this completed run. Future roles must be exposed by an explicit
        // runtime capability before the change-role action can become enabled.
        supportedRoleKeys: [run.players[0]!.role!.roleKey],
        nextPart: null,
      });
    } catch (error) {
      if (isSoloResultNotReadyError(error)) throw resultNotReady(error.reason);
      throw error;
    }
  }

  /**
   * Historical completed runs can predate ending.json. Recover only that exact
   * fail-closed case. A completed run that has an Ending but lacks verified
   * causes is not historical fallback; it remains RESULT_NOT_READY.
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
    if (runtimeRun.ending) return null;

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

function assertAuthoritativeResultReady(
  run: SoloResultRunRecord,
  raw: RawOpenNovelResult,
  runtimeRun: OpenNovelPublicRun,
) {
  const role = run.players[0]?.role;
  const runtimeEnding = runtimeRun.ending;
  if (
    runtimeRun.runId !== run.id
    || runtimeRun.worldId !== run.templateKey
    || runtimeRun.roleId !== role?.roleKey
    || runtimeRun.status !== "COMPLETED"
    || runtimeRun.turnNumber !== 20
    || !runtimeEnding
  ) throw resultNotReady("RUNTIME_NOT_AUTHORITATIVELY_COMPLETED");
  if (
    raw.room.id !== run.id
    || raw.completedNodes !== 20
    || raw.ending.endingKey !== runtimeEnding.endingKey
    || raw.ending.scope !== runtimeEnding.scope
    || raw.ending.sourceTurnId !== runtimeEnding.sourceTurnId
    || raw.ending.sourceRevision !== runtimeEnding.sourceRevision
    || raw.ending.title !== runtimeEnding.title
    || raw.ending.finalSceneNarrative !== runtimeEnding.finalSceneNarrative
    || raw.ending.protagonistFate !== runtimeEnding.protagonistFate
    || JSON.stringify(raw.ending.aftermath) !== JSON.stringify(runtimeEnding.aftermath)
  ) throw resultNotReady("RESULT_ENDING_MISMATCH");
  if (
    runtimeEnding.sourceTurnId !== "T20"
    || runtimeEnding.sourceRevision !== 20
    || !new Set(["PART", "STORY"]).has(runtimeEnding.scope)
    || (run.templateKey === "sangtian" && runtimeEnding.scope !== "PART")
  ) throw resultNotReady("ENDING_SOURCE_NOT_READY");
}

function resultNotReady(reason: string) {
  return new ConflictException({
    code: "RESULT_NOT_READY",
    message: "The ending is available after authoritative part completion and cause projection.",
    reason,
  });
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
