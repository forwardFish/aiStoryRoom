import type { SeatIdV1 } from "@ai-story/shared";
import type {
  AEmotionCardActionPortV1,
  AEmotionFeedRepositoryPortV1,
} from "../a-emotion/ports";
import type {
  PressureResponseEventAuthorityPortV1,
  PressureResponseEventAuthorityV1,
} from "./decision-command.compiler";
import type { PressureChapterHttpResponseAcknowledgerPort } from "../http";

/**
 * Read-only bridge from committed viewer aggregates to decision compilation.
 * It exposes no delivery mutation, trigger, modal, settlement or Provider
 * capability. A stale event id cannot select an older aggregate version.
 */
export class AEmotionResponseEventAuthorityAdapterV1
implements PressureResponseEventAuthorityPortV1 {
  constructor(private readonly repository: AEmotionFeedRepositoryPortV1) {}

  async readCurrent(input: Readonly<{
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    sourceEventId: string;
  }>): Promise<PressureResponseEventAuthorityV1 | null> {
    const aggregates = await this.repository.listAggregates({
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
    });
    const matches = aggregates.filter((aggregate) => (
      aggregate.roomId === input.roomId
      && aggregate.runId === input.runId
      && aggregate.viewerSeatId === input.viewerSeatId
      && aggregate.latestEventId === input.sourceEventId
      && aggregate.projection.eventId === input.sourceEventId
      && aggregate.projection.roomId === input.roomId
      && aggregate.projection.runId === input.runId
      && aggregate.projection.viewerSeatId === input.viewerSeatId
      && aggregate.projection.projectionVersion === aggregate.projectionVersion
    ));
    if (matches.length !== 1) return null;
    const aggregate = matches[0]!;
    const delivery = await this.repository.readDelivery({
      eventId: aggregate.latestEventId,
      projectionVersion: aggregate.projectionVersion,
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
    });
    if (!delivery) return null;
    if (
      delivery.eventId !== aggregate.latestEventId
      || delivery.projectionVersion !== aggregate.projectionVersion
      || delivery.roomId !== input.roomId
      || delivery.runId !== input.runId
      || delivery.viewerSeatId !== input.viewerSeatId
    ) return null;
    return {
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
      sourceEventId: aggregate.latestEventId,
      projectionVersion: aggregate.projectionVersion,
      projectionHash: aggregate.projection.projectionHash,
      disclosure: aggregate.projection.disclosure,
      responseOptions: aggregate.projection.responseOptions.map(
        (option: AEmotionCardActionPortV1) => ({
          code: option.code,
          preferredEntry: option.preferredEntry,
          consumesManeuverOnSubmit: option.consumesManeuverOnSubmit,
        }),
      ),
      acknowledged: delivery.acknowledgedAt !== null,
      resolved: delivery.resolvedAt !== null,
    };
  }
}

/**
 * Server-side acknowledgement bridge for an explicit response submission.
 * It first reuses the fail-closed current-authority read, then mutates only the
 * existing viewer delivery row. The compiler rereads authority after this and
 * remains the sole source of canonical responseToEventId/action validation.
 */
export class AEmotionResponseEventAcknowledgerAdapterV1
implements PressureChapterHttpResponseAcknowledgerPort {
  constructor(
    private readonly authority: Pick<AEmotionResponseEventAuthorityAdapterV1, "readCurrent">,
    private readonly feed: Readonly<{
      mark(input: {
        eventId: string;
        projectionVersion: number;
        roomId: string;
        runId: string;
        viewerSeatId: SeatIdV1;
        operation: "ACKNOWLEDGED";
        occurredAt: string;
      }): Promise<unknown>;
    }>,
  ) {}

  async acknowledgeCurrent(input: Readonly<{
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    sourceEventId: string;
    responseActionCode: string;
    occurredAt: string;
  }>): Promise<boolean> {
    const source = await this.authority.readCurrent(input);
    if (
      source === null
      || source.resolved
      || !source.responseOptions.some((option) => option.code === input.responseActionCode)
    ) return false;
    if (source.acknowledged) return true;
    await this.feed.mark({
      eventId: source.sourceEventId,
      projectionVersion: source.projectionVersion,
      roomId: source.roomId,
      runId: source.runId,
      viewerSeatId: source.viewerSeatId,
      operation: "ACKNOWLEDGED",
      occurredAt: input.occurredAt,
    });
    return true;
  }
}
