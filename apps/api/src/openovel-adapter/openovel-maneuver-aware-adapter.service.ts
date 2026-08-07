import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { CreditConsumptionService } from "../credits/credit-consumption.service";
import { PrismaService } from "../prisma.service";
import { StoryService } from "../story.service";
import {
  hydrateOpenNovelManeuverStateFromEvents,
  OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE,
  OPENOVEL_MANEUVER_RESULT_EVENT_TYPE,
} from "./openovel-maneuver-context";
import { ensureOpenNovelManeuverState } from "./openovel-maneuver";
import type { OpenNovelManeuverPackage } from "./openovel-maneuver-package";
import { openNovelManeuverPackages } from "./openovel-maneuver-packages";
import { OpenNovelAdapterService } from "./openovel-adapter.service";
import { OpenNovelRuntimeClient } from "./openovel-runtime.client";

/**
 * Adds event-ledger recovery and ending projection to the product adapter
 * without moving story or maneuver authority into the browser.
 */
@Injectable()
export class OpenNovelManeuverAwareAdapterService extends OpenNovelAdapterService {
  constructor(
    @Inject(PrismaService) private readonly recoveryPrisma: PrismaService,
    @Inject(StoryService) story: StoryService,
    @Inject(CreditConsumptionService) credits: CreditConsumptionService,
    @Inject(OpenNovelRuntimeClient) private readonly recoveryRuntime: OpenNovelRuntimeClient,
  ) {
    super(recoveryPrisma, story, credits, recoveryRuntime);
  }

  override async game(user: AuthenticatedUser, runId: string) {
    await this.recoverManeuverState(user, runId);
    return super.game(user, runId);
  }

  override async getRun(user: AuthenticatedUser, runId: string) {
    await this.recoverManeuverState(user, runId);
    return super.getRun(user, runId);
  }

  override async result(user: AuthenticatedUser, runId: string) {
    await this.recoverManeuverState(user, runId);
    const base: any = await super.result(user, runId);
    const [run, runtimeRun] = await Promise.all([
      this.recoveryPrisma.storyRun.findUnique({
        where: { id: runId },
        select: { templateKey: true, stateJson: true },
      }),
      this.recoveryRuntime.getRun(runId),
    ]);
    if (!run) return base;
    const maneuverPackage = openNovelManeuverPackages.get(run.templateKey);
    if (!maneuverPackage) return base;
    const state = ensureOpenNovelManeuverState(
      run.stateJson,
      runtimeRun.turnNumber,
      maneuverPackage,
    );
    const maneuverAftermath = endingManeuverAftermath(state.results, maneuverPackage);
    if (!maneuverAftermath.length) return base;
    const ending = {
      ...base.ending,
      aftermath: unique([
        ...array(base.ending?.aftermath).map(String),
        ...maneuverAftermath,
      ]),
    };
    return {
      ...base,
      ending,
      chapter: {
        ...base.chapter,
        content: [
          ending.finalSceneNarrative,
          ending.protagonistFate ? `主角命运：${ending.protagonistFate}` : "",
          ...ending.aftermath,
        ].filter(Boolean).join("\n\n"),
      },
    };
  }

  private async recoverManeuverState(user: AuthenticatedUser, runId: string) {
    const run = await this.recoveryPrisma.storyRun.findUnique({
      where: { id: runId },
      select: {
        ownerUserId: true,
        templateKey: true,
        engineVersion: true,
        stateJson: true,
        version: true,
        players: {
          where: { userId: user.id },
          select: { userId: true },
        },
      },
    });
    if (!run || run.ownerUserId !== user.id || !run.players.length) return;
    if (run.engineVersion !== "openovel_v1") return;
    const maneuverPackage = openNovelManeuverPackages.get(run.templateKey);
    if (!maneuverPackage) return;
    const [runtimeRun, events] = await Promise.all([
      this.recoveryRuntime.getRun(runId),
      this.recoveryPrisma.storyEvent.findMany({
        where: {
          runId,
          type: {
            in: [
              OPENOVEL_MANEUVER_RESULT_EVENT_TYPE,
              OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE,
            ],
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { type: true, payloadJson: true },
      }),
    ]);
    const recovered = hydrateOpenNovelManeuverStateFromEvents({
      stateJson: run.stateJson,
      eventPayloads: events
        .filter((event) => event.type === OPENOVEL_MANEUVER_RESULT_EVENT_TYPE)
        .map((event) => event.payloadJson),
      consumptionPayloads: events
        .filter((event) => event.type === OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE)
        .map((event) => event.payloadJson),
      turnNumber: runtimeRun.turnNumber,
      maneuverPackage,
    });
    if (!recovered.needsPersistence) return;
    // Do not bump the public maneuver version: this repairs a missing or
    // incomplete mirror from already-committed events and creates no action.
    await this.recoveryPrisma.storyRun.updateMany({
      where: { id: runId, version: run.version },
      data: { stateJson: recovered.stateJson as any },
    });
  }
}

function endingManeuverAftermath(
  results: ReturnType<typeof ensureOpenNovelManeuverState>["results"],
  maneuverPackage: OpenNovelManeuverPackage,
) {
  return [...results]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-6)
    .map((result) => {
      const typeLabel = ({
        CONVERSATION: "人物交谈",
        INVESTIGATION: "派遣调查",
        LEVERAGE: "使用筹码",
        CUSTOM_PLAN: "自拟谋划",
      } as const)[result.decisionForm];
      const target = result.targetRoleKey
        ? maneuverPackage.actor(result.targetRoleKey)?.displayName || "相关人物"
        : "";
      const leverage = result.consumedLeverageKey
        ? maneuverPackage.leverage(result.consumedLeverageKey)?.label || result.consumedLeverageKey
        : "";
      const prefix = result.decisionForm === "CONVERSATION" && target
        ? `${typeLabel}·${target}`
        : result.decisionForm === "LEVERAGE" && leverage
          ? `${typeLabel}·${leverage}`
          : typeLabel;
      return `${prefix}：${compact(result.title, 90)}。${compact(result.narrative, 220)}`;
    });
}

function compact(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}
