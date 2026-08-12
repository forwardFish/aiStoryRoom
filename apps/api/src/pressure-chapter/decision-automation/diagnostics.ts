import type {
  DecisionConvergenceDiagnosticsPortV1,
  DecisionConvergenceDiagnosticsV1,
} from "./contracts";

/** Internal structured diagnostics only; no payloads or fence values are logged. */
export class StructuredDecisionConvergenceDiagnosticsV1
implements DecisionConvergenceDiagnosticsPortV1 {
  record(metrics: Readonly<DecisionConvergenceDiagnosticsV1>): void {
    if (process.env.PRESSURE_CHAPTER_DIAGNOSTIC_ERRORS !== "1") return;
    console.error("Pressure decision convergence", structuredClone(metrics));
  }
}
