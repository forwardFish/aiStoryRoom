import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { getGameDefinition } from "@ai-story/templates";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import {
  assertManeuverVersion,
  compileOpenNovelManeuverPlan,
  openNovelManeuverFingerprint,
  projectOpenNovelManeuvers,
  type OpenNovelManeuverCommand,
  type OpenNovelManeuverGuardResult,
  type OpenNovelManeuverPlan,
  type OpenNovelManeuverProjection,
} from "./openovel-maneuver";
import type { OpenNovelManeuverPackage } from "./openovel-maneuver-package";
import {
  issueOpenNovelManeuverPreview,
  normalizePreviewCommand,
  verifyOpenNovelManeuverPreview,
  type OpenNovelManeuverPreviewCard,
} from "./openovel-maneuver-preview";
import { openNovelManeuverPackages } from "./openovel-maneuver-packages";
import { recoverOpenNovelManeuverRun } from "./openovel-maneuver-state-recovery";
import { OpenNovelManeuverService } from "./openovel-maneuver.service";
import {
  OPENOVEL_ENGINE_VERSION,
  OpenNovelRuntimeClient,
  type OpenNovelPublicRun,
} from "./openovel-runtime.client";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

type PreviewRunContext = {
  run: any;
  runtimeRun: OpenNovelPublicRun;
  role: any;
  maneuverPackage: OpenNovelManeuverPackage;
  projection: OpenNovelManeuverProjection;
};

@Injectable()
export class OpenNovelManeuverPreviewService {
  private readonly inFlightConfirms = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OpenNovelRuntimeClient) private readonly runtime: OpenNovelRuntimeClient,
    @Inject(OpenNovelManeuverService) private readonly maneuvers: OpenNovelManeuverService,
  ) {}

  async preview(
    user: AuthenticatedUser,
    runId: string,
    rawCommand: OpenNovelManeuverCommand,
  ) {
    const idempotencyKey = requiredIdempotency(rawCommand.idempotencyKey);
    const context = await this.loadContext(user, runId);
    assertManeuverVersion(context.run.version, rawCommand.version);
    const command = normalizePreviewCommand(
      rawCommand,
      context.run.version,
      idempotencyKey,
    );
    const requestFingerprint = openNovelManeuverFingerprint(command);
    const planned = this.compile(context, command);
    if (isGuardResult(planned)) return planned;

    const issued = issueOpenNovelManeuverPreview({
      runId,
      userId: user.id,
      worldId: context.maneuverPackage.worldId,
      roleKey: context.role.roleKey,
      expectedVersion: context.run.version,
      expectedTurnNumber: context.runtimeRun.turnNumber,
      sceneKey: context.projection.state.sceneKey,
      idempotencyKey,
      requestFingerprint,
      command,
    });
    return {
      accepted: true as const,
      previewed: true as const,
      maneuverVersion: context.run.version,
      previewToken: issued.previewToken,
      preview: previewCard(
        context.maneuverPackage,
        planned,
        command,
        issued.payload.previewId,
        issued.payload.expiresAt,
      ),
    };
  }

  /**
   * Execute one player maneuver as a single product action. The existing
   * signed plan is kept as an internal validation boundary, but it is never
   * exposed as a player-facing preview or a second confirmation step.
   */
  async submit(
    user: AuthenticatedUser,
    runId: string,
    rawCommand: OpenNovelManeuverCommand,
  ) {
    const planned = await this.preview(user, runId, rawCommand);
    if (planned.accepted === false) return planned;
    return this.confirm(user, runId, planned.previewToken);
  }

  async confirm(
    user: AuthenticatedUser,
    runId: string,
    previewToken: unknown,
  ) {
    let payload;
    try {
      payload = verifyOpenNovelManeuverPreview(previewToken);
    } catch (error) {
      throw previewException(error);
    }
    if (payload.runId !== runId || payload.userId !== user.id) {
      throw new ForbiddenException({
        code: "MANEUVER_PREVIEW_OWNER_MISMATCH",
        message: "This maneuver preview belongs to another run or player.",
      });
    }
    if (openNovelManeuverFingerprint(payload.command) !== payload.requestFingerprint) {
      throw new BadRequestException({
        code: "MANEUVER_PREVIEW_TOKEN_TAMPERED",
        message: "The maneuver preview payload no longer matches its signature.",
      });
    }

    const confirmationKey = `${runId}:${user.id}:${payload.idempotencyKey}`;
    const inFlight = this.inFlightConfirms.get(confirmationKey);
    if (inFlight) return inFlight;

    // A committed event is authoritative even if its original HTTP response
    // was lost. Replay it before checking the now-advanced run version.
    const committed = await this.prisma.storyEvent.findUnique({
      where: { dedupeKey: maneuverDedupeKey(runId, user.id, payload.idempotencyKey) },
    });
    if (committed) {
      return this.maneuvers.submit(user, runId, payload.command);
    }

    const context = await this.loadContext(user, runId);
    assertManeuverVersion(context.run.version, payload.expectedVersion);
    if (
      context.runtimeRun.turnNumber !== payload.expectedTurnNumber
      || context.maneuverPackage.worldId !== payload.worldId
      || context.role.roleKey !== payload.roleKey
      || context.projection.state.sceneKey !== payload.sceneKey
    ) {
      throw new ConflictException({
        code: "MANEUVER_PREVIEW_STALE",
        message: "The story context changed after preview. Create a new preview.",
        currentVersion: context.run.version,
        currentTurnNumber: context.runtimeRun.turnNumber,
        currentSceneKey: context.projection.state.sceneKey,
      });
    }
    const planned = this.compile(context, payload.command);
    if (isGuardResult(planned)) return planned;

    // Two requests can both pass the first check while awaiting PostgreSQL and
    // runtime reads. This second check has no await before set(), so one API
    // process executes exactly one logical submit for the same preview key.
    const lateInFlight = this.inFlightConfirms.get(confirmationKey);
    if (lateInFlight) return lateInFlight;
    const confirmation = this.maneuvers.submit(user, runId, payload.command)
      .finally(() => this.inFlightConfirms.delete(confirmationKey));
    this.inFlightConfirms.set(confirmationKey, confirmation);
    return confirmation;
  }

  private compile(
    context: PreviewRunContext,
    command: OpenNovelManeuverCommand,
  ) {
    return compileOpenNovelManeuverPlan({
      command,
      projection: context.projection,
      game: getGameDefinition(context.run.templateKey),
      roleKey: context.role.roleKey,
      turnNumber: context.runtimeRun.turnNumber,
      maneuverPackage: context.maneuverPackage,
    });
  }

  private async loadContext(
    user: AuthenticatedUser,
    runId: string,
  ): Promise<PreviewRunContext> {
    const [storedRun, runtimeRun] = await Promise.all([
      this.authorizedRun(user, runId),
      this.runtime.getRun(runId),
    ]);
    if (storedRun.templateKey !== runtimeRun.worldId) {
      throw new ConflictException({
        code: "OPENOVEL_MANEUVER_WORLD_MISMATCH",
        message: "The product run and OpenNovel runtime disagree on the world package.",
      });
    }
    const maneuverPackage = openNovelManeuverPackages.get(storedRun.templateKey);
    if (!maneuverPackage) {
      throw new ConflictException({
        code: "OPENOVEL_MANEUVER_PACKAGE_MISSING",
        message: "This OpenNovel world has no registered maneuver package.",
      });
    }
    // Preview must remain zero-side-effect. Recover the event-ledger state in
    // memory so validation is authoritative even if the client did not GET
    // /game first; the confirmed action transaction persists the next state.
    const recovered = await recoverOpenNovelManeuverRun({
      prisma: this.prisma,
      run: storedRun,
      turnNumber: runtimeRun.turnNumber,
      maneuverPackage,
      persist: false,
    });
    const run = recovered.run;
    const role = run.players[0]?.role;
    if (!role) {
      throw new ForbiddenException({
        code: "OPENOVEL_ROLE_REQUIRED",
        message: "The player must control the selected Solo role.",
      });
    }
    const projection = projectOpenNovelManeuvers({
      stateJson: run.stateJson,
      turnNumber: runtimeRun.turnNumber,
      runtimeStatus: runtimeRun.status,
      mainDecisionOpen: runtimeRun.status !== "COMPLETED" && runtimeRun.options.length > 0,
      canHumanAct: runtimeRun.status !== "COMPLETED",
      maneuverPackage,
    });
    return { run, runtimeRun, role, maneuverPackage, projection };
  }

  private async authorizedRun(user: AuthenticatedUser, runId: string) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: {
        players: { where: { userId: user.id }, include: { role: true } },
      },
    });
    if (!run) {
      throw new NotFoundException({
        code: "OPENOVEL_RUN_NOT_FOUND",
        message: "Story run not found.",
      });
    }
    if (run.ownerUserId !== user.id || !run.players.some((item) => item.userId === user.id)) {
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
    return run;
  }
}

function previewCard(
  maneuverPackage: OpenNovelManeuverPackage,
  plan: OpenNovelManeuverPlan,
  command: OpenNovelManeuverCommand,
  previewId: string,
  expiresAt: string,
): OpenNovelManeuverPreviewCard {
  const target = plan.targetRoleKey
    ? maneuverPackage.actor(plan.targetRoleKey)
    : null;
  const leverage = plan.consumedLeverageKey
    ? maneuverPackage.leverage(plan.consumedLeverageKey)
    : null;
  const investigation = maneuverPackage
    .scene(plan.sceneKey)
    ?.investigations.find((item) => item.intentKey === String(command.intentKey || ""));
  const title = plan.maneuverType === "contact"
    ? `准备与${target?.displayName || "当前人物"}交谈`
    : plan.maneuverType === "investigate"
      ? `准备调查“${investigation?.title || "当前事项"}”`
      : plan.maneuverType === "leverage"
        ? `准备使用“${leverage?.label || "当前筹码"}”`
        : "准备执行自拟谋划";
  const summary = plan.maneuverType === "contact"
    ? String(command.messageText || "")
    : plan.maneuverType === "investigate"
      ? investigation?.summary || "确认后开始这项调查。"
      : plan.maneuverType === "leverage"
        ? leverage?.description || "确认后该筹码将被消耗。"
        : String(command.customText || "");
  const confirmLabel = plan.maneuverType === "contact"
    ? `确认发送给${target?.displayName || "该人物"}`
    : plan.maneuverType === "investigate"
      ? "确认开始调查"
      : plan.maneuverType === "leverage"
        ? `确认使用并消耗“${leverage?.label || "筹码"}”`
        : "确认执行谋划";
  return {
    previewId,
    maneuverType: plan.maneuverType,
    decisionForm: plan.decisionForm,
    sceneKey: plan.sceneKey,
    usageDay: plan.usageDay,
    title,
    summary,
    targetLabel: target?.displayName || null,
    costLabel: "确认后消耗 1 次主动谋划；预演不会写入世界、不会调用模型。",
    confirmLabel,
    expiresAt,
  };
}

function maneuverDedupeKey(runId: string, userId: string, idempotencyKey: string) {
  return `openovel-maneuver:${runId}:${userId}:${idempotencyKey}`;
}

function requiredIdempotency(value: unknown) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new BadRequestException({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "A stable idempotencyKey of 8–160 characters is required.",
    });
  }
  return key;
}

function isGuardResult(
  value: OpenNovelManeuverPlan | OpenNovelManeuverGuardResult,
): value is OpenNovelManeuverGuardResult {
  return "accepted" in value && value.accepted === false;
}

function previewException(error: unknown) {
  const code = String((error as any)?.code || (error as Error)?.message || "MANEUVER_PREVIEW_TOKEN_INVALID");
  if (code === "MANEUVER_PREVIEW_EXPIRED") {
    return new ConflictException({ code, message: "The maneuver preview expired. Create a new preview." });
  }
  return new BadRequestException({ code, message: "The maneuver preview token is invalid or was modified." });
}
