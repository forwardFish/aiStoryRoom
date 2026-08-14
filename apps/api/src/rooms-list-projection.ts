import { operationalMetrics } from "./observability/operational-metrics";

/**
 * Serializes room-list projection work across concurrent HTTP requests.
 *
 * Pressure room projections use interactive Prisma transactions. Keeping this
 * queue process-wide prevents list fan-out from consuming every connection in
 * the API pool and leaves capacity for authentication and lobby mutations.
 */
export class RoomListProjectionScheduler {
  private tail: Promise<void> = Promise.resolve();
  private queueDepth = 0;

  projectOrdered<TInput, TOutput>(
    inputs: readonly TInput[],
    project: (input: TInput, index: number) => Promise<TOutput>,
  ): Promise<TOutput[]> {
    const queuedAt = Date.now();
    this.queueDepth += 1;
    operationalMetrics.set("room_list_projection_queue_depth", {}, this.queueDepth);
    return this.runExclusive(async () => {
      this.queueDepth -= 1;
      operationalMetrics.set("room_list_projection_queue_depth", {}, this.queueDepth);
      operationalMetrics.set("room_list_projection_active", {}, 1);
      operationalMetrics.observeP95(
        "room_list_projection_queue_wait_ms_p95",
        {},
        Date.now() - queuedAt,
      );
      const startedAt = Date.now();
      try {
        const projected: TOutput[] = [];
        for (let index = 0; index < inputs.length; index += 1) {
          projected.push(await project(inputs[index]!, index));
        }
        operationalMetrics.increment("room_list_projection_total", { result: "success" });
        return projected;
      } catch (error) {
        operationalMetrics.increment("room_list_projection_total", { result: "failure" });
        throw error;
      } finally {
        operationalMetrics.set("room_list_projection_active", {}, 0);
        operationalMetrics.observeP95(
          "room_list_projection_duration_ms_p95",
          {},
          Date.now() - startedAt,
        );
      }
    });
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
