import { PressureKernelError } from "./errors";
import type { PressureRuntimePhase, PressureRuntimeState } from "./types";

const NORMAL_TRANSITIONS: Record<Exclude<PressureRuntimePhase, "FAILED_RECOVERABLE" | "COMPLETED">, readonly PressureRuntimePhase[]> = {
  P0_PROJECTING: ["PREPARE_OPEN"],
  PREPARE_OPEN: ["PREPARE_LOCKED"],
  PREPARE_LOCKED: ["PREPARE_RESOLVING"],
  PREPARE_RESOLVING: ["COMMIT_OPEN"],
  COMMIT_OPEN: ["COMMIT_LOCKED"],
  COMMIT_LOCKED: ["REACTION_OPEN", "SETTLING"],
  REACTION_OPEN: ["SETTLING"],
  SETTLING: ["FROZEN"],
  FROZEN: ["PROJECTING"],
  PROJECTING: ["PREPARE_OPEN", "FINALE_COMPUTING"],
  FINALE_COMPUTING: ["COMPLETED"],
};

export function pressurePhaseTargets(phase: PressureRuntimePhase): readonly PressureRuntimePhase[] {
  if (phase === "FAILED_RECOVERABLE") return [];
  if (phase === "COMPLETED") return [];
  return NORMAL_TRANSITIONS[phase];
}

export function assertPressurePhaseTransition(
  from: PressureRuntimePhase,
  to: PressureRuntimePhase,
  resumePhase?: PressureRuntimeState["resumePhase"],
): void {
  if (from === "COMPLETED") {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", `COMPLETED cannot transition to ${to}`);
  }
  if (to === "FAILED_RECOVERABLE") {
    if (from === "FAILED_RECOVERABLE") {
      throw new PressureKernelError("NODE_PHASE_MISMATCH", "FAILED_RECOVERABLE cannot re-enter itself");
    }
    return;
  }
  if (from === "FAILED_RECOVERABLE") {
    if (!resumePhase || to !== resumePhase) {
      throw new PressureKernelError(
        "NODE_PHASE_MISMATCH",
        `Recovery must resume ${String(resumePhase)}, received ${to}`,
      );
    }
    return;
  }
  if (!pressurePhaseTargets(from).includes(to)) {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", `Illegal phase transition ${from} -> ${to}`);
  }
}
