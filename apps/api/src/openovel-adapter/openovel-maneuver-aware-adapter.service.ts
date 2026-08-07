import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { CreditConsumptionService } from "../credits/credit-consumption.service";
import { PrismaService } from "../prisma.service";
import { StoryService } from "../story.service";
import { hydrateOpenNovelManeuverStateFromEvents } from "./openovel-maneuver-context";
import { openNovelManeuverPackages } from "./openovel-maneuver-packages";
import { OpenNovelAdapterService } from "./openovel-adapter.service";
import { OpenNovelRuntimeClient } from "./openovel-runtime.client";

/**
 * Adds event-ledger recovery to the product adapter without moving story or
 * maneuver authority into the browser. The base adapter remains responsible
 * for the OpenNovel main-turn lifecycle.
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
        where: { runId, type: "openovel_maneuver_result" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { payloadJson: true },
      }),
    ]);
    const recovered = hydrateOpenNovelManeuverStateFromEvents({
      stateJson: run.stateJson,
      eventPayloads: events.map((event) => event.payloadJson),
      turnNumber: runtimeRun.turnNumber,
      maneuverPackage,
    });
    if (recovered.recoveredEventCount <= 0) return;
    // Do not bump the public maneuver version: this repairs a missing mirror
    // from an already-committed event and creates no new player action.
    await this.recoveryPrisma.storyRun.updateMany({
      where: { id: runId, version: run.version },
      data: { stateJson: recovered.stateJson as any },
    });
  }
}
