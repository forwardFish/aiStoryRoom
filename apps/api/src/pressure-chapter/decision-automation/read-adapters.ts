import { validateRunRouteSnapshotV1, type RunRouteSnapshotV1 } from "@ai-story/shared";
import { assertStoredRunRouteRecord } from "../run-router";
import type { StoredRunRouteReaderPort } from "../run-router/types";
import type { DecisionAutomationRouteReaderPortV1 } from "./contracts";

/** Lossless adapter over the existing immutable stored-route reader. */
export class DecisionAutomationStoredRouteReaderV1
implements DecisionAutomationRouteReaderPortV1 {
  constructor(
    private readonly routes: StoredRunRouteReaderPort,
  ) {}

  async readRoute(runId: string): Promise<RunRouteSnapshotV1 | null> {
    const stored = assertStoredRunRouteRecord(
      await this.routes.readStoredRoute(runId),
    );
    if (stored.runId !== runId) return null;
    return structuredClone(validateRunRouteSnapshotV1(stored.snapshot));
  }
}
