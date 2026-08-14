import { operationalMetrics } from "./observability/operational-metrics";

/**
 * Serializes room-list projection work across concurrent HTTP requests.
 *
 * Pressure room projections use interactive Prisma transactions. Keeping this
 * scheduler process-wide prevents list fan-out from consuming every connection
 * in the API pool and leaves capacity for authentication and lobby mutations.
 */
export class RoomListProjectionScheduler {
  private readonly waiting: Array<() => void> = [];
  private active = 0;
  private queueDepth = 0;

  constructor(private readonly concurrency = 1) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new Error("ROOM_LIST_PROJECTION_CONCURRENCY_INVALID");
    }
  }

  projectOrdered<TInput, TOutput>(
    inputs: readonly TInput[],
    project: (input: TInput, index: number) => Promise<TOutput>,
  ): Promise<TOutput[]> {
    const startedAt = Date.now();
    return Promise.all(inputs.map((input, index) => this.schedule(() => project(input, index))))
      .then((projected) => {
        operationalMetrics.increment("room_list_projection_total", { result: "success" });
        return projected;
      }, (error) => {
        operationalMetrics.increment("room_list_projection_total", { result: "failure" });
        throw error;
      })
      .finally(() => {
        operationalMetrics.observeP95(
          "room_list_projection_duration_ms_p95",
          {},
          Date.now() - startedAt,
        );
      });
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const queuedAt = Date.now();
    this.queueDepth += 1;
    operationalMetrics.set("room_list_projection_queue_depth", {}, this.queueDepth);
    return new Promise<T>((resolve, reject) => {
      this.waiting.push(() => {
        this.queueDepth -= 1;
        this.active += 1;
        operationalMetrics.set("room_list_projection_queue_depth", {}, this.queueDepth);
        operationalMetrics.set("room_list_projection_active", {}, this.active);
        operationalMetrics.observeP95(
          "room_list_projection_queue_wait_ms_p95",
          {},
          Date.now() - queuedAt,
        );
        Promise.resolve().then(operation).then(resolve, reject).finally(() => {
          this.active -= 1;
          operationalMetrics.set("room_list_projection_active", {}, this.active);
          this.drain();
        });
      });
      this.drain();
    });
  }

  private drain() {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      this.waiting.shift()!();
    }
  }
}

export function roomListProjectionConcurrencyForPool(
  connectionLimit: number,
  reservedConnections = 2,
) {
  if (!Number.isSafeInteger(connectionLimit) || connectionLimit < 1) {
    throw new Error("ROOM_LIST_PROJECTION_POOL_LIMIT_INVALID");
  }
  if (!Number.isSafeInteger(reservedConnections) || reservedConnections < 0) {
    throw new Error("ROOM_LIST_PROJECTION_RESERVE_INVALID");
  }
  return Math.max(1, connectionLimit - reservedConnections);
}

export function uniqueRoomRowsForProjection<T extends { id: string }>(
  mine: readonly T[],
  publicRooms: readonly T[],
): T[] {
  const rows = new Map<string, T>();
  for (const room of [...mine, ...publicRooms]) {
    if (!rows.has(room.id)) rows.set(room.id, room);
  }
  return [...rows.values()];
}
