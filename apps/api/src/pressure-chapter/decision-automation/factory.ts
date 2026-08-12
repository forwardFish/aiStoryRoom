import { SangtianServerDecisionWorkingIntentCompilerV1 } from "../integration/decision-command.compiler";
import {
  PrismaPreparedAutomationActionSubmissionV1,
  type PreparedAutomationPrismaClientV1,
} from "../persistence/prepared-automation-action.prisma-adapter";
import type {
  DecisionAutomationConfigV1,
  DecisionAutomationOrchestratorReaderPortV1,
  DecisionAutomationRouteReaderPortV1,
  DecisionAutomationSeatAuthorityReaderPortV1,
  DecisionConvergenceDependenciesV1,
} from "./contracts";
import { PressureAiDecisionCommandCompilerV1 } from "./compiler";
import { PressureDecisionConvergenceServiceV1 } from "./convergence.service";
import { PublishedSangtianAiDecisionPolicyAdapterV1 } from "./content-policy.adapter";
import { StructuredDecisionConvergenceDiagnosticsV1 } from "./diagnostics";
import {
  createPrismaActivePressureDecisionScannerV1,
  type PrismaActivePressureDecisionScannerV1,
} from "./prisma-scanner";
import {
  createPrismaDecisionConvergenceSnapshotReaderV1,
} from "./prisma-snapshot";
import { PressureDecisionAutomationWorkerLaneV1 } from "./worker-lane";

export interface PressureDecisionAutomationProductionInputV1
extends Omit<
  DecisionConvergenceDependenciesV1,
  "scanner" | "snapshots" | "compiler" | "policy" | "preparedActions" | "diagnostics"
> {
  prisma: unknown;
  /** Deprecated discovery/read seams accepted for source compatibility only. */
  routes?: DecisionAutomationRouteReaderPortV1;
  orchestrators?: DecisionAutomationOrchestratorReaderPortV1;
  working?: unknown;
  seats?: DecisionAutomationSeatAuthorityReaderPortV1;
  config?: Partial<DecisionAutomationConfigV1>;
  aiPolicyOptions?: Readonly<{ releaseRoot?: string }>;
}

export interface PressureDecisionAutomationProductionBundleV1 {
  scanner: PrismaActivePressureDecisionScannerV1;
  policy: PublishedSangtianAiDecisionPolicyAdapterV1;
  compiler: PressureAiDecisionCommandCompilerV1;
  service: PressureDecisionConvergenceServiceV1;
  workerLane: PressureDecisionAutomationWorkerLaneV1;
}

/**
 * One production convergence object graph is shared by HTTP and recovery.
 * Published policy loading is local and hash-verified; no model capability is
 * accepted by this factory.
 */
export function createPressureDecisionAutomationProductionV1(
  input: PressureDecisionAutomationProductionInputV1,
): PressureDecisionAutomationProductionBundleV1 {
  const scanner = createPrismaActivePressureDecisionScannerV1(input.prisma);
  const snapshots = createPrismaDecisionConvergenceSnapshotReaderV1(input.prisma);
  const policy = new PublishedSangtianAiDecisionPolicyAdapterV1(
    input.aiPolicyOptions,
  );
  const compiler = new PressureAiDecisionCommandCompilerV1(
    new SangtianServerDecisionWorkingIntentCompilerV1(),
  );
  const preparedActions = new PrismaPreparedAutomationActionSubmissionV1(
    input.prisma as PreparedAutomationPrismaClientV1,
  );
  const diagnostics = new StructuredDecisionConvergenceDiagnosticsV1();
  const service = new PressureDecisionConvergenceServiceV1({
    scanner,
    snapshots,
    content: input.content,
    policy,
    compiler,
    preparedActions,
    runtime: input.runtime,
    deadlineDefaults: input.deadlineDefaults,
    diagnostics,
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
