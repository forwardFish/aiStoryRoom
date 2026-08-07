import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getGameDefinition } from "@ai-story/templates";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import {
  checkMvpAiBudget,
  exhaustMvpAiBudget,
  recordMvpAiBudgetUse,
  type MvpAiBudget,
} from "../mvp-ai-budget";
import { createConfiguredMvpNarrativeProvider } from "../mvp-narrative-provider";
import { PrismaService } from "../prisma.service";
import {
  OPENOVEL_ENGINE_VERSION,
  OpenNovelRuntimeClient,
  type OpenNovelPublicRun,
} from "./openovel-runtime.client";
import {
  applyOpenNovelManeuverPlan,
  assertManeuverVersion,
  compileOpenNovelManeuverPlan,
  openNovelManeuverFingerprint,
  projectOpenNovelManeuvers,
  withOpenNovelManeuverState,
  type OpenNovelManeuverCommand,
  type OpenNovelManeuverGuardResult,
  type OpenNovelManeuverPlan,
  type OpenNovelManeuverResult,
  type OpenNovelManeuverState,
} from "./openovel-maneuver";
import type { OpenNovelManeuverPackage } from "./openovel-maneuver-package";
import { openNovelManeuverPackages } from "./openovel-maneuver-packages";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const MANEUVER_EVENT_TYPE = "openovel_maneuver_result";

type NarrativeResolution = {
  title: string;
  narrative: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  provider: string;
  tokenUsage: {
    attempts: number;
    inputTokens: number;
    outputTokens: number;
    costMinor: number;
    elapsedMs: number;
  };
  aiBudget: MvpAiBudget;
  errorMessage: string | null;
};

@Injectable()
export class OpenNovelManeuverService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OpenNovelRuntimeClient) private readonly runtime: OpenNovelRuntimeClient,
  ) {}

  async submit(
    user: AuthenticatedUser,
    runId: string,
    command: OpenNovelManeuverCommand,
  ) {
    const idempotencyKey = requiredIdempotency(command.idempotencyKey);
    const requestFingerprint = openNovelManeuverFingerprint(command);
    const dedupeKey = maneuverDedupeKey(runId, user.id, idempotencyKey);
    const existing = await this.prisma.storyEvent.findUnique({ where: { dedupeKey } });
    if (existing) {
      await this.authorizedRun(user, runId);
      return replayResponse(existing, requestFingerprint);
    }

    const [run, runtimeRun] = await Promise.all([
      this.authorizedRun(user, runId),
      this.runtime.getRun(runId),
    ]);
    const maneuverPackage = packageForRun(run.templateKey, runtimeRun.worldId);
    assertManeuverVersion(run.version, command.version);
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
    const planned = compileOpenNovelManeuverPlan({
      command,
      projection,
      game: getGameDefinition(run.templateKey),
      roleKey: role.roleKey,
      turnNumber: runtimeRun.turnNumber,
      maneuverPackage,
    });
    if (isGuardResult(planned)) return planned;

    const narrative = await resolveNarrative(
      planned,
      projection.state,
      runtimeRun,
      maneuverPackage,
    );
    const eventId = `ovl_maneuver_${randomUUID()}`;
    const createdAt = new Date();
    const applied = applyOpenNovelManeuverPlan({
      state: projection.state,
      plan: planned,
      result: {
        id: eventId,
        turnNumber: runtimeRun.turnNumber,
        title: narrative.title,
        narrative: narrative.narrative,
        idempotencyKey,
        requestFingerprint,
        createdAt: createdAt.toISOString(),
      },
      aiBudget: narrative.aiBudget,
    });
    const nextStateJson = withOpenNovelManeuverState(run.stateJson, applied.state);
    const versionAfter = run.version + 1;
    const payload = {
      ...applied.result,
      requestFingerprint,
      versionBefore: run.version,
      versionAfter,
      fallbackUsed: narrative.fallbackUsed,
      fallbackReason: narrative.fallbackReason,
      provider: narrative.provider,
      tokenUsage: narrative.tokenUsage,
      maneuverPackageVersion: maneuverPackage.packageVersion,
      maneuverWorldId: maneuverPackage.worldId,
    };

    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        const replay = await tx.storyEvent.findUnique({ where: { dedupeKey } });
        if (replay) return { replay };
        const updated = await tx.storyRun.updateMany({
          where: { id: runId, version: run.version },
          data: {
            stateJson: nextStateJson as any,
            version: versionAfter,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({
            code: "VERSION_CONFLICT",
            message: "story run version conflict",
            expectedVersion: run.version,
          });
        }
        const event = await tx.storyEvent.create({
          data: {
            id: eventId,
            runId,
            day: planned.usageDay,
            type: MANEUVER_EVENT_TYPE,
            messageType: "maneuver_result",
            roleKey: role.roleKey,
            visibility: "player_visible",
            payloadJson: payload as any,
            dedupeKey,
            createdAt,
          },
        });
        if (planned.needsAiNarrative) {
          await tx.aiTask.create({
            data: aiTaskData({
              runId,
              eventId,
              plan: planned,
              narrative,
              createdAt,
              maneuverPackage,
            }) as any,
          });
        }
        return { event };
      }, { maxWait: 10_000, timeout: 30_000 });

      if ("replay" in transactionResult) {
        return replayResponse(transactionResult.replay, requestFingerprint);
      }
    } catch (error) {
      const replay = await this.prisma.storyEvent.findUnique({ where: { dedupeKey } });
      if (replay) return replayResponse(replay, requestFingerprint);
      throw error;
    }

    return {
      accepted: true as const,
      replayed: false,
      maneuverVersion: versionAfter,
      resolution: {
        id: eventId,
        appliedWorldSequence: runtimeRun.turnNumber,
        resultNarrative: narrative.narrative,
        nextHook: "",
      },
      result: applied.result,
    };
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

async function resolveNarrative(
  plan: OpenNovelManeuverPlan,
  state: OpenNovelManeuverState,
  runtimeRun: OpenNovelPublicRun,
  maneuverPackage: OpenNovelManeuverPackage,
): Promise<NarrativeResolution> {
  const budget = structuredClone(state.aiBudget);
  const deterministic = {
    title: plan.title,
    narrative: plan.fallbackNarrative,
    fallbackUsed: false,
    fallbackReason: null,
    provider: "deterministic-rules",
    tokenUsage: {
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMinor: 0,
      elapsedMs: 0,
    },
    aiBudget: budget,
    errorMessage: null,
  };
  if (!plan.needsAiNarrative) return deterministic;

  const provider = createConfiguredMvpNarrativeProvider();
  if (!provider?.generateManeuverCandidate) {
    return {
      ...deterministic,
      fallbackUsed: true,
      fallbackReason: "provider_not_configured",
    };
  }

  const budgetCheck = checkMvpAiBudget(budget, provider.lastCall?.maxAttempts || 1);
  if (!budgetCheck.allowed) {
    const reason = budgetCheck.reason || "ai_budget_blocked";
    exhaustMvpAiBudget(budget, reason);
    return {
      ...deterministic,
      fallbackUsed: true,
      fallbackReason: reason,
      provider: provider.name,
      aiBudget: budget,
    };
  }

  const target = plan.targetRoleKey
    ? maneuverPackage.actor(plan.targetRoleKey)
    : null;
  const leverage = plan.consumedLeverageKey
    ? maneuverPackage.leverage(plan.consumedLeverageKey)
    : null;
  try {
    const candidate = await provider.generateManeuverCandidate({
      task: plan.maneuverType === "contact"
        ? "character_response"
        : "leverage_character_response",
      sceneKey: plan.sceneKey,
      maneuverType: plan.maneuverType,
      target: target ? {
        roleKey: target.roleKey,
        displayName: target.displayName,
        publicIdentity: target.publicIdentity,
      } : null,
      playerMessage: plan.maneuverType === "contact" ? plan.playerMessage : "",
      leverage: leverage ? {
        leverageKey: leverage.leverageKey,
        label: leverage.label,
        description: leverage.description,
      } : null,
      recentCanon: String(runtimeRun.recentCanon || "").slice(-2_000),
      immutableRuleResult: {
        statePatchKeys: Object.keys(plan.statePatch),
        factKeys: plan.factKeys,
        traces: plan.traces,
      },
    });
    const normalized = normalizeNarrative(
      candidate,
      plan,
      target?.displayName || "对方",
      leverage?.label || "",
      maneuverPackage.surfaces.consumedLeverageLabel,
    );
    const usage = recordMvpAiBudgetUse(budget, budgetCheck, provider.lastCall || {});
    return {
      ...normalized,
      fallbackUsed: false,
      fallbackReason: null,
      provider: provider.name,
      tokenUsage: {
        ...usage,
        elapsedMs: Math.max(0, Number(provider.lastCall?.elapsedMs || 0)),
      },
      aiBudget: budget,
      errorMessage: null,
    };
  } catch (error) {
    const usage = recordMvpAiBudgetUse(budget, budgetCheck, provider.lastCall || {});
    return {
      ...deterministic,
      fallbackUsed: true,
      fallbackReason: "provider_failed_or_invalid",
      provider: provider.name,
      tokenUsage: {
        ...usage,
        elapsedMs: Math.max(0, Number(provider.lastCall?.elapsedMs || 0)),
      },
      aiBudget: budget,
      errorMessage: String((error as Error)?.message || error || "maneuver_provider_failed").slice(0, 500),
    };
  }
}

function normalizeNarrative(
  candidate: unknown,
  plan: OpenNovelManeuverPlan,
  targetName: string,
  leverageLabel: string,
  consumedLeverageLabel: string,
) {
  const source = record(candidate);
  const title = clean(source.title, 120) || plan.title;
  const replyText = clean(source.replyText, 500);
  let narrative = clean(source.narrative, 1_500);
  if (!narrative && replyText) narrative = `${targetName}回应：“${replyText}”`;
  if (!narrative) throw new Error("maneuver narrative candidate empty");
  if (
    plan.maneuverType === "leverage"
    && leverageLabel
    && !narrative.includes(consumedLeverageLabel)
  ) {
    narrative = `${narrative}\n\n${consumedLeverageLabel}：${leverageLabel}`;
  }
  return { title, narrative };
}

function replayResponse(event: any, requestFingerprint: string) {
  const payload = record(event.payloadJson);
  if (String(payload.requestFingerprint || "") !== requestFingerprint) {
    throw new ConflictException({
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "同一幂等键不能用于不同主动谋划",
    });
  }
  return {
    accepted: true as const,
    replayed: true,
    maneuverVersion: Math.max(1, Number(payload.versionAfter || 1)),
    resolution: {
      id: event.id,
      appliedWorldSequence: Math.max(0, Number(payload.turnNumber || 0)),
      resultNarrative: String(payload.narrative || ""),
      nextHook: "",
    },
    result: payload as OpenNovelManeuverResult,
  };
}

function aiTaskData(input: {
  runId: string;
  eventId: string;
  plan: OpenNovelManeuverPlan;
  narrative: NarrativeResolution;
  createdAt: Date;
  maneuverPackage: OpenNovelManeuverPackage;
}) {
  const resultJson = {
    fallbackUsed: input.narrative.fallbackUsed,
    fallbackReason: input.narrative.fallbackReason,
    tokenUsage: input.narrative.tokenUsage,
    output: {
      title: input.narrative.title,
      narrative: input.narrative.narrative,
    },
  };
  return {
    runId: input.runId,
    eventId: input.eventId,
    taskType: "resolve_maneuver_narrative",
    modelType: input.narrative.provider,
    provider: input.narrative.provider,
    modelName: input.narrative.provider,
    status: input.narrative.fallbackUsed ? "fallback" : "completed",
    inputJson: {
      worldId: input.maneuverPackage.worldId,
      maneuverPackageVersion: input.maneuverPackage.packageVersion,
      sceneKey: input.plan.sceneKey,
      maneuverType: input.plan.maneuverType,
      targetRoleKey: input.plan.targetRoleKey,
      playerMessageLength: input.plan.playerMessage.length,
      consumedLeverageKey: input.plan.consumedLeverageKey,
    },
    resultJson,
    outputJson: resultJson,
    normalizedJson: resultJson,
    tokenUsageJson: input.narrative.tokenUsage,
    inputTokens: input.narrative.tokenUsage.inputTokens || null,
    outputTokens: input.narrative.tokenUsage.outputTokens || null,
    cost: input.narrative.tokenUsage.costMinor || null,
    startedAt: new Date(input.createdAt.getTime() - input.narrative.tokenUsage.elapsedMs),
    completedAt: input.createdAt,
    errorMessage: input.narrative.errorMessage,
  };
}

function packageForRun(templateKey: string, runtimeWorldId: string) {
  if (templateKey !== runtimeWorldId) {
    throw new ConflictException({
      code: "OPENOVEL_MANEUVER_WORLD_MISMATCH",
      message: "The product run and OpenNovel runtime disagree on the world package.",
      templateKey,
      runtimeWorldId,
    });
  }
  try {
    return openNovelManeuverPackages.require(templateKey);
  } catch {
    throw new ConflictException({
      code: "OPENOVEL_MANEUVER_PACKAGE_MISSING",
      message: "This OpenNovel world has no registered maneuver package.",
      worldId: templateKey,
    });
  }
}

function isGuardResult(
  value: OpenNovelManeuverPlan | OpenNovelManeuverGuardResult,
): value is OpenNovelManeuverGuardResult {
  return "accepted" in value && value.accepted === false;
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

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
