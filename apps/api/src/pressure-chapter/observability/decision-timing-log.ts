export interface PressureDecisionTimingLogV1 {
  path: "SQL7" | "GENERIC_CONVERGENCE" | "HTTP";
  runId: string;
  chapterId: string;
  decisionPointId: string;
  outcome: string;
  failureCode: string | null;
  timings: Readonly<object>;
}

/** Internal diagnostics only. It never changes authority or player responses. */
export function logPressureDecisionTimingV1(
  input: Readonly<PressureDecisionTimingLogV1>,
): void {
  if (process.env.PRESSURE_DECISION_TIMING_LOG !== "1") return;
  console.error("Pressure decision timing", JSON.stringify(input));
}

export function pressureDecisionElapsedMsV1(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

export function pressureDecisionFailureCodeV1(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code).trim();
    if (code) return code;
  }
  return error instanceof Error && error.name.trim()
    ? error.name.trim()
    : "UNKNOWN";
}
