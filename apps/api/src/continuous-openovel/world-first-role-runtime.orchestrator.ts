import type { ModelCallBudgetKindV1, RoleNarrativeOutputV1 } from "@ai-story/shared";
import { ModelCallBudget } from "./model-call-budget";

export type ConfirmedWorldCommit = {
  resolutionId: string;
  appliedWorldSequence: number;
};

export type WorldFirstNarrativeResult = {
  world: ConfirmedWorldCommit;
  runtime: RoleNarrativeOutputV1 | null;
  runtimeStatus: "PUBLISHED" | "SKIPPED_UNAFFECTED" | "FAILED_AFTER_WORLD_COMMIT";
  runtimeError?: unknown;
};

/**
 * Enforces the authority boundary independently of transport and persistence:
 * the world commit completes before role prose starts, and a runtime failure
 * is returned as post-commit state rather than rolling the world back.
 */
export async function commitWorldThenInvokeRoleRuntime(input: {
  budgetKind: ModelCallBudgetKindV1;
  commitWorld: () => Promise<ConfirmedWorldCommit>;
  invokeRoleRuntime: (world: ConfirmedWorldCommit) => Promise<RoleNarrativeOutputV1>;
}): Promise<WorldFirstNarrativeResult> {
  const world = await input.commitWorld();
  if (input.budgetKind === "UNAFFECTED") return { world, runtime: null, runtimeStatus: "SKIPPED_UNAFFECTED" };
  try {
    const runtime = await input.invokeRoleRuntime(world);
    if (runtime.appliedWorldSequence !== world.appliedWorldSequence) throw new Error("ROLE_RUNTIME_STALE_SEQUENCE");
    new ModelCallBudget(input.budgetKind).chargeUsage(runtime.usage);
    return { world, runtime, runtimeStatus: "PUBLISHED" };
  } catch (runtimeError) {
    return { world, runtime: null, runtimeStatus: "FAILED_AFTER_WORLD_COMMIT", runtimeError };
  }
}
