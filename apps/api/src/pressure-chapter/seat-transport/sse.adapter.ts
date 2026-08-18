import type {
  PressureSeatTransportSnapshotV1,
  PressureSeatTransportSseEventV1,
  ReadPressureSeatTransportQueryV1,
} from "./contracts";
import {
  assertPressureSeatTransportCursorScopeV1,
  decodePressureSeatTransportCursorV1,
  type PressureSeatTransportCursorPayloadV1,
} from "./cursor";
import {
  PRESSURE_SEAT_TRANSPORT_ERROR_CODES as ERROR,
  failPressureSeatTransport,
} from "./errors";
import type { PressureSeatTransportFacadeV1 } from "./seat-transport.facade";

export interface PressureSeatTransportSseOptionsV1 {
  afterCursor?: string | null;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Framework-neutral SSE source. It performs viewer-scoped reads only; authority
 * and presence writes are unreachable from this adapter.
 */
export async function* streamPressureSeatTransportV1(
  facade: Pick<PressureSeatTransportFacadeV1, "readSnapshot">,
  query: ReadPressureSeatTransportQueryV1,
  options: PressureSeatTransportSseOptionsV1 = {},
): AsyncGenerator<PressureSeatTransportSseEventV1> {
  const pollIntervalMs = positiveInterval(options.pollIntervalMs, 1_000);
  const heartbeatIntervalMs = positiveInterval(options.heartbeatIntervalMs, 15_000);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitFor;
  let lastCursor = options.afterCursor ?? null;
  let lastPosition: PressureSeatTransportCursorPayloadV1 | null = null;
  let lastHeartbeatAt = now();
  let firstSnapshot: PressureSeatTransportSnapshotV1 | null = null;

  while (!options.signal?.aborted) {
    const snapshot = await facade.readSnapshot({ ...query, cursor: lastCursor });
    firstSnapshot ??= snapshot;
    if (lastCursor) {
      assertPressureSeatTransportCursorScopeV1({
        cursor: lastCursor,
        runId: snapshot.runId,
        routeHash: snapshot.routeHash,
        viewerSeatId: snapshot.viewerSeatId,
      });
      lastPosition ??= decodePressureSeatTransportCursorV1(lastCursor);
    }
    const currentPosition = decodePressureSeatTransportCursorV1(snapshot.cursor);
    if (
      lastPosition
      && (
        currentPosition.lastDeliveredSequence < lastPosition.lastDeliveredSequence
        || currentPosition.narrativeDeliverySequence
          < lastPosition.narrativeDeliverySequence
      )
    ) {
      return failPressureSeatTransport(ERROR.CURSOR_INVALID, "SEQUENCE_ROLLBACK");
    }
    const hasAuthoritativeChange = !lastPosition
      || currentPosition.lastDeliveredSequence > lastPosition.lastDeliveredSequence
      || currentPosition.narrativeDeliverySequence
        > lastPosition.narrativeDeliverySequence
      || currentPosition.authorityHash !== lastPosition.authorityHash;
    for (const narrative of snapshot.narrativeEvents) {
      if (
        lastPosition
        && narrative.deliverySequence <= lastPosition.narrativeDeliverySequence
      ) continue;
      if (!narrative.cursor) {
        return failPressureSeatTransport(ERROR.CURSOR_INVALID, "NARRATIVE_CURSOR_MISSING");
      }
      lastCursor = narrative.cursor;
      lastPosition = decodePressureSeatTransportCursorV1(narrative.cursor);
      lastHeartbeatAt = now();
      yield { id: narrative.cursor, event: "narrative", data: narrative };
    }
    if (hasAuthoritativeChange) {
      lastCursor = snapshot.cursor;
      lastPosition = currentPosition;
      lastHeartbeatAt = now();
      yield { id: snapshot.cursor, event: "snapshot", data: snapshot };
    } else if (now() - lastHeartbeatAt >= heartbeatIntervalMs) {
      lastHeartbeatAt = now();
      yield {
        id: null,
        event: "heartbeat",
        data: {
          schemaVersion: "pressure_seat_transport_sse_heartbeat_v1",
          runId: firstSnapshot.runId,
          cursor: lastCursor,
        },
      };
    }
    if (!snapshot.delivery.hasMore) {
      await wait(pollIntervalMs, options.signal);
    }
  }
}

export function formatPressureSeatTransportSseEventV1(
  event: PressureSeatTransportSseEventV1,
): string {
  const id = event.id ? `id: ${event.id}\n` : "";
  return `${id}event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function positiveInterval(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

function waitFor(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timeout = setTimeout(done, delayMs);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}
