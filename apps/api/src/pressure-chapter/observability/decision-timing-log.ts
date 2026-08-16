export interface PressureDecisionTimingLogV1 {
  path: "SQL7" | "GENERIC_CONVERGENCE" | "HTTP";
  runId: string;
  chapterId: string;
  decisionPointId: string;
  outcome: string;
  failureCode: string | null;
  timings: Readonly<object>;
}

export interface PressureDecisionFailureLogV1 {
  path: "HTTP";
  traceId: string;
  runId: string;
  chapterId: string;
  decisionPointId: string;
  stage: string;
  timings: Readonly<object>;
  error: Readonly<object>;
}

/** Internal diagnostics only. It never changes authority or player responses. */
export function logPressureDecisionTimingV1(
  input: Readonly<PressureDecisionTimingLogV1>,
): void {
  if (process.env.PRESSURE_DECISION_TIMING_LOG !== "1") return;
  console.error("Pressure decision timing", JSON.stringify(input));
}

/** Internal failure trace. It is never copied into the public HTTP response. */
export function logPressureDecisionFailureV1(
  input: Readonly<Omit<PressureDecisionFailureLogV1, "error"> & { error: unknown }>,
): void {
  if (process.env.PRESSURE_DECISION_TIMING_LOG !== "1") return;
  console.error("Pressure decision failure", JSON.stringify({
    ...input,
    error: pressureDecisionErrorDiagnosticV1(input.error),
  }));
}

export function pressureDecisionErrorDiagnosticV1(error: unknown): Readonly<object> {
  return diagnostic(error, new Set<unknown>(), 0);
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

function diagnostic(error: unknown, seen: Set<unknown>, depth: number): Readonly<object> {
  if (!error || typeof error !== "object") {
    return { name: typeof error, code: "UNKNOWN", message: bounded(String(error)) };
  }
  if (seen.has(error) || depth >= 3) {
    return { name: "CIRCULAR_OR_TRUNCATED", code: "UNKNOWN", message: "TRUNCATED" };
  }
  seen.add(error);
  const record = error as Record<string, unknown>;
  const result: Record<string, unknown> = {
    name: typeof record.name === "string" ? bounded(record.name, 120) : "UNKNOWN",
    code: typeof record.code === "string" ? bounded(record.code, 160) : "UNKNOWN",
    path: typeof record.path === "string" ? bounded(record.path, 160) : "UNKNOWN",
    message: typeof record.message === "string" ? bounded(record.message, 1_000) : "UNKNOWN",
  };
  if (record.details && typeof record.details === "object") {
    result.details = safeDetails(record.details as Record<string, unknown>);
  }
  if (record.cause !== undefined) {
    result.cause = diagnostic(record.cause, seen, depth + 1);
  }
  return result;
}

function safeDetails(details: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details).slice(0, 20)) {
    if (/token|secret|password|cookie|authorization/i.test(key)) {
      safe[key] = "[REDACTED]";
    } else if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      safe[key] = typeof value === "string" ? bounded(value, 500) : value;
    } else if (Array.isArray(value)) {
      safe[key] = value.slice(0, 12).map((item) => (
        item === null || ["number", "boolean"].includes(typeof item)
          ? item
          : bounded(String(item), 200)
      ));
    } else {
      safe[key] = "[OBJECT]";
    }
  }
  return safe;
}

function bounded(value: string, limit = 500): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, limit);
}
