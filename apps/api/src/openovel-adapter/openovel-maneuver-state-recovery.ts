import type { PrismaService } from "../prisma.service";
import {
  hydrateOpenNovelManeuverStateFromEvents,
  OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE,
  OPENOVEL_MANEUVER_RESULT_EVENT_TYPE,
} from "./openovel-maneuver-context";
import type { OpenNovelManeuverPackage } from "./openovel-maneuver-package";

export type RecoverableOpenNovelManeuverRun = {
  id: string;
  templateKey: string;
  stateJson: unknown;
  version: number;
};

/**
 * Rebuilds the authoritative maneuver read model from committed StoryEvents.
 * Callers that must remain zero-side-effect (Preview) pass persist=false and
 * use the returned stateJson locally. GET/projection paths may persist the
 * repaired mirror without bumping the public action version.
 */
export async function recoverOpenNovelManeuverRun<
  T extends RecoverableOpenNovelManeuverRun,
>(input: {
  prisma: PrismaService;
  run: T;
  turnNumber: number;
  maneuverPackage: OpenNovelManeuverPackage;
  persist?: boolean;
}) {
  const events = await input.prisma.storyEvent.findMany({
    where: {
      runId: input.run.id,
      type: {
        in: [
          OPENOVEL_MANEUVER_RESULT_EVENT_TYPE,
          OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE,
        ],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { type: true, payloadJson: true },
  });
  const hydrated = hydrateOpenNovelManeuverStateFromEvents({
    stateJson: input.run.stateJson,
    eventPayloads: events
      .filter((event) => event.type === OPENOVEL_MANEUVER_RESULT_EVENT_TYPE)
      .map((event) => event.payloadJson),
    consumptionPayloads: events
      .filter((event) => event.type === OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE)
      .map((event) => event.payloadJson),
    turnNumber: input.turnNumber,
    maneuverPackage: input.maneuverPackage,
  });
  let persisted = false;
  if (input.persist !== false && hydrated.needsPersistence) {
    const updated = await input.prisma.storyRun.updateMany({
      where: { id: input.run.id, version: input.run.version },
      data: { stateJson: hydrated.stateJson as any },
    });
    persisted = updated.count === 1;
  }
  return {
    run: {
      ...input.run,
      stateJson: hydrated.stateJson,
    } as T,
    state: hydrated.state,
    recoveredEventCount: hydrated.recoveredEventCount,
    recoveredConsumptionCount: hydrated.recoveredConsumptionCount,
    needsPersistence: hydrated.needsPersistence,
    persisted,
  };
}
