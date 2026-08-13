import type { SeatIdV1 } from "@ai-story/shared";
import type { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";
import type { AEmotionFeedRepositoryPortV1 } from "../a-emotion/ports";
import type { PressureChapterHttpDeliveryPort } from "../http";

class PressureDeliveryCommandError extends Error {
  readonly code = "PRESSURE_DELIVERY_COMMAND_REJECTED";
  readonly path = "body.eventId";
}

/**
 * Authenticated viewer-scoped delivery mutation. It deliberately reloads the
 * latest aggregate before writing, so a stale projection, a cross-viewer event
 * id, or a non-modal event can never manufacture MODAL_SHOWN authority.
 */
export class AEmotionHttpDeliveryAdapterV1
  implements PressureChapterHttpDeliveryPort {
  constructor(
    private readonly repository: Pick<AEmotionFeedRepositoryPortV1, "listAggregates">,
    private readonly feed: Pick<AEmotionFeedServiceV1, "mark">,
  ) {}

  async mark(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    command: {
      eventId: string;
      projectionVersion: number;
      operation: "SEEN" | "MODAL_SHOWN";
      idempotencyKey: string;
    };
    occurredAt: string;
  }): Promise<void> {
    const aggregates = await this.repository.listAggregates({
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
    });
    const aggregate = aggregates.find((candidate) => (
      candidate.projection.eventId === input.command.eventId
      && candidate.projection.projectionVersion === input.command.projectionVersion
    ));
    if (
      !aggregate
      || aggregate.roomId !== input.roomId
      || aggregate.runId !== input.runId
      || aggregate.viewerSeatId !== input.viewerSeatId
      || aggregate.latestEventId !== input.command.eventId
    ) {
      throw new PressureDeliveryCommandError();
    }
    if (input.command.operation === "MODAL_SHOWN") {
      const modal = aggregate.projection.keyModal;
      if (!modal || modal.sourceEventId !== input.command.eventId) {
        throw new PressureDeliveryCommandError();
      }
    }
    await this.feed.mark({
      eventId: input.command.eventId,
      projectionVersion: input.command.projectionVersion,
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
      operation: input.command.operation,
      occurredAt: input.occurredAt,
      idempotencyKey: input.command.idempotencyKey,
    });
  }
}
