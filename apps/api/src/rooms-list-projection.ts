/**
 * Serializes room-list projection work across concurrent HTTP requests.
 *
 * Pressure room projections use interactive Prisma transactions. Keeping this
 * queue process-wide prevents list fan-out from consuming every connection in
 * the API pool and leaves capacity for authentication and lobby mutations.
 */
export class RoomListProjectionScheduler {
  private tail: Promise<void> = Promise.resolve();

  projectOrdered<TInput, TOutput>(
    inputs: readonly TInput[],
    project: (input: TInput, index: number) => Promise<TOutput>,
  ): Promise<TOutput[]> {
    return this.runExclusive(async () => {
      const projected: TOutput[] = [];
      for (let index = 0; index < inputs.length; index += 1) {
        projected.push(await project(inputs[index]!, index));
      }
      return projected;
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
