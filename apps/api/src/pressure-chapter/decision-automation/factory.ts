import { SangtianServerDecisionWorkingIntentCompilerV1 } from "../integration/decision-command.compiler";
import type {
  DecisionAutomationConfigV1,
  DecisionAutomationDependenciesV1,
} from "./contracts";
import { PressureAiDecisionCommandCompilerV1 } from "./compiler";
import { PublishedSangtianAiDecisionPolicyAdapterV1 } from "./content-policy.adapter";
import {
  createPrismaActivePressureDecisionScannerV1,
  type PrismaActivePressureDecisionScannerV1,
} from "./prisma-scanner";
import { PressureDecisionAutomationServiceV1 } from "./service";
import { PressureDecisionAutomationWorkerLaneV1 } from "./worker-lane";

export interface PressureDecisionAutomationProductionInputV1
extends Omit<DecisionAutomationDependenciesV1, "scanner" | "compiler" | "policy"> {
  prisma: unknown;
  config?: Partial<DecisionAutomationConfigV1>;
  aiPolicyOptions?: Readonly<{ releaseRoot?: string }>;
}

export interface PressureDecisionAutomationProductionBundleV1 {
  scanner: PrismaActivePressureDecisionScannerV1;
  policy: PublishedSangtianAiDecisionPolicyAdapterV1;
  compiler: PressureAiDecisionCommandCompilerV1;
  service: PressureDecisionAutomationServiceV1;
  workerLane: PressureDecisionAutomationWorkerLaneV1;
}

/**
 * Production composition. The content-owned published policy is loaded and
 * verified during construction; missing/tampered artifacts fail startup and
 * there is deliberately no caller-supplied or no-op policy.
 */
export function createPressureDecisionAutomationProductionV1(
  input: PressureDecisionAutomationProductionInputV1,
): PressureDecisionAutomationProductionBundleV1 {
  const scanner = createPrismaActivePressureDecisionScannerV1(input.prisma);
  const policy = new PublishedSangtianAiDecisionPolicyAdapterV1(
    input.aiPolicyOptions,
  );
  const compiler = new PressureAiDecisionCommandCompilerV1(
    new SangtianServerDecisionWorkingIntentCompilerV1(),
  );
  const service = new PressureDecisionAutomationServiceV1({
    scanner,
    routes: input.routes,
    orchestrators: input.orchestrators,
    working: input.working,
    seats: input.seats,
    content: input.content,
    policy,
    compiler,
    runtime: input.runtime,
    deadlineDefaults: input.deadlineDefaults,
    clock: input.clock,
  }, input.config);
  return {
    scanner,
    policy,
    compiler,
    service,
    workerLane: new PressureDecisionAutomationWorkerLaneV1(service),
  };
}
