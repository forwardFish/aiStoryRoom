import type {
  AEmotionInteractionEventPortV1,
  AEmotionViewerContextPortV1,
  AEmotionViewerProjectionPortV1,
} from "../a-emotion/ports";
import { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";
import { AEmotionViewerProjectorV1 } from "../a-emotion/projector";
import type { AEmotionInteractionJournalPortV1 } from "./contracts";

export class AEmotionAuthorityFeedPipelineV1 {
  constructor(
    readonly journal: AEmotionInteractionJournalPortV1,
    readonly projector: Pick<AEmotionViewerProjectorV1, "project">,
    readonly feed: Pick<AEmotionFeedServiceV1, "ingest" | "list" | "mark">,
  ) {}

  async ingest(input: {
    event: AEmotionInteractionEventPortV1;
    storyDay: number;
    viewer: AEmotionViewerContextPortV1;
    priorProjection?: AEmotionViewerProjectionPortV1 | null;
    priorAggregationKey?: string | null;
    now: string;
  }): Promise<{
    eventStatus: "COMMITTED" | "REPLAYED";
    projectionStatus: "SKIPPED" | "COMMITTED" | "REPLAYED";
    projection: AEmotionViewerProjectionPortV1 | null;
  }> {
    const persisted = await this.journal.append({
      event: input.event,
      storyDay: input.storyDay,
    });
    const projected = await this.projector.project({
      event: persisted.event,
      viewer: input.viewer,
      priorProjection: input.priorProjection ?? null,
      priorAggregationKey: input.priorAggregationKey ?? null,
    });
    if (!projected) {
      return {
        eventStatus: persisted.status,
        projectionStatus: "SKIPPED",
        projection: null,
      };
    }
    const ingested = await this.feed.ingest(projected, input.now);
    return {
      eventStatus: persisted.status,
      projectionStatus: ingested.status,
      projection: structuredClone(ingested.aggregate.projection),
    };
  }
}
