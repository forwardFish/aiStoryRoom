import { HttpException, HttpStatus } from "@nestjs/common";
import { MODEL_CALL_BUDGET_SCHEMA_VERSION, type ModelCallBudgetKindV1, type ModelCallBudgetV1, type RoleRuntimeUsageV1 } from "@ai-story/shared";

export const MODEL_CALL_HARD_LIMITS: Readonly<Record<ModelCallBudgetKindV1, number>> = Object.freeze({
  NORMAL: 3,
  AI_TARGET: 4,
  CONVERGENCE: 6,
  UNAFFECTED: 0
});

export class ModelCallBudget {
  private consumed = 0;

  constructor(readonly kind: ModelCallBudgetKindV1) {}

  charge(count: number) {
    const normalized = Number.isInteger(count) && count >= 0 ? count : Number.POSITIVE_INFINITY;
    if (this.consumed + normalized > MODEL_CALL_HARD_LIMITS[this.kind]) {
      throw new HttpException({
        code: "OPENOVEL_MODEL_CALL_BUDGET_EXCEEDED",
        message: `Model-call budget ${this.kind} exceeded`,
        hardLimit: MODEL_CALL_HARD_LIMITS[this.kind],
        attempted: this.consumed + normalized
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.consumed += normalized;
    return this.snapshot();
  }

  chargeUsage(usage: Pick<RoleRuntimeUsageV1, "narratorCalls" | "optionsCalls" | "storykeeperCalls">) {
    return this.charge(usage.narratorCalls + usage.optionsCalls + usage.storykeeperCalls);
  }

  snapshot(): ModelCallBudgetV1 {
    return { schemaVersion: MODEL_CALL_BUDGET_SCHEMA_VERSION, kind: this.kind, hardLimit: MODEL_CALL_HARD_LIMITS[this.kind], consumed: this.consumed };
  }
}
