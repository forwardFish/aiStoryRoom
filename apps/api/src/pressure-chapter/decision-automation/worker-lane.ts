import type {
  DecisionAutomationDrainResultV1,
  DecisionAutomationStepResultV1,
} from "./contracts";
import type { PressureDecisionAutomationServiceV1 } from "./service";

/**
 * Direct WorkerRuntime lane adapter. It owns no timer and no data; ProductRoot
 * may pass this object as a PressureWorkerLanePortV1 without changing the
 * decision service or widening its authority surface.
 */
export class PressureDecisionAutomationWorkerLaneV1 {
  constructor(
    private readonly service: Pick<
      PressureDecisionAutomationServiceV1,
      "tick" | "drain"
    >,
  ) {}

  tick(workerId: string): Promise<DecisionAutomationStepResultV1> {
    return this.service.tick(workerId);
  }

  drain(workerId: string, limit: number): Promise<DecisionAutomationDrainResultV1> {
    return this.service.drain(workerId, limit);
  }
}
