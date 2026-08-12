import { sha256Canonical, type SeatIdV1 } from "@ai-story/shared";
import type {
  AEmotionAggregateRecordV1,
  AEmotionProjectionRecordV1,
  AEmotionViewerProjectionPortV1,
} from "./ports";

/** First projection of a causal aggregate. Later authorized disclosure events
 * advance the same aggregate monotonically to version 2, 3, ... . */
export const A_EMOTION_PROJECTION_VERSION_V1 = 1 as const;

export function aEmotionAggregationKey(input: {
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  eventId: string;
}): string {
  return JSON.stringify([
    input.roomId,
    input.runId,
    input.viewerSeatId,
    input.eventId,
  ]);
}

export function aEmotionProjectionIdempotencyKey(input: {
  eventId: string;
  viewerSeatId: SeatIdV1;
}): string {
  return `projection:${input.eventId}:${input.viewerSeatId}`;
}

export function computeAEmotionProjectionHashV1(
  projection: AEmotionViewerProjectionPortV1,
): string {
  const { projectionHash: _ignored, ...body } = projection;
  return sha256Canonical(body);
}

export function hasValidAEmotionProjectionHashV1(
  projection: AEmotionViewerProjectionPortV1,
): boolean {
  return projection.projectionHash === computeAEmotionProjectionHashV1(projection);
}

export function isAEmotionProjectionIdentityV1(
  record: AEmotionProjectionRecordV1,
): boolean {
  const projection = record.projection;
  const root = parseAEmotionAggregationKeyV1(record.aggregationKey);
  return Number.isSafeInteger(projection.projectionVersion)
    && projection.projectionVersion >= A_EMOTION_PROJECTION_VERSION_V1
    && record.latestEventId === projection.eventId
    && root !== null
    && root.roomId === projection.roomId
    && root.runId === projection.runId
    && root.viewerSeatId === projection.viewerSeatId
    && (projection.projectionVersion !== 1 || root.rootEventId === projection.eventId)
    && record.idempotencyKey === aEmotionProjectionIdempotencyKey({
      eventId: projection.eventId,
      viewerSeatId: projection.viewerSeatId,
    });
}

export function isSameAEmotionProjectionV1(input: {
  stored: AEmotionAggregateRecordV1;
  incoming: AEmotionProjectionRecordV1;
}): boolean {
  const { stored, incoming } = input;
  return stored.aggregationKey === incoming.aggregationKey
    && stored.roomId === incoming.projection.roomId
    && stored.runId === incoming.projection.runId
    && stored.viewerSeatId === incoming.projection.viewerSeatId
    && stored.stageId === incoming.stageId
    && stored.sharedObjectId === incoming.sharedObjectId
    && stored.eventFamily === incoming.eventFamily
    && stored.latestEventId === incoming.latestEventId
    && stored.projectionVersion === incoming.projection.projectionVersion
    && stored.projection.projectionVersion === incoming.projection.projectionVersion
    && stored.projection.projectionHash === incoming.projection.projectionHash
    && hasValidAEmotionProjectionHashV1(stored.projection)
    && hasValidAEmotionProjectionHashV1(incoming.projection);
}

export function parseAEmotionAggregationKeyV1(value: string): {
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  rootEventId: string;
} | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed)
      || parsed.length !== 4
      || parsed.some((item) => typeof item !== "string" || !item.trim())
    ) return null;
    return {
      roomId: parsed[0] as string,
      runId: parsed[1] as string,
      viewerSeatId: parsed[2] as SeatIdV1,
      rootEventId: parsed[3] as string,
    };
  } catch {
    return null;
  }
}
