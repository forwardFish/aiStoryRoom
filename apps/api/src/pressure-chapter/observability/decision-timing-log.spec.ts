import assert from "node:assert/strict";
import test from "node:test";
import {
  logPressureDecisionFailureV1,
  pressureDecisionErrorDiagnosticV1,
} from "./decision-timing-log";

test("failure diagnostics preserve stage-owning details and redact secrets", () => {
  const cause = Object.assign(new Error("database constraint failed\nsecond line"), {
    code: "P2028",
    details: {
      path: "submit.authority",
      detail: "STALE_OR_NOT_AUTHORIZED",
      authorizationToken: "must-not-leak",
    },
  });
  const outer = Object.assign(new Error("snapshot failed"), {
    code: "PRESSURE_DECISION_AUTOMATION_PORT_RESULT_INVALID",
    details: { runId: "run-1" },
    cause,
  });

  const diagnostic = pressureDecisionErrorDiagnosticV1(outer) as any;
  assert.equal(diagnostic.code, "PRESSURE_DECISION_AUTOMATION_PORT_RESULT_INVALID");
  assert.equal(diagnostic.details.runId, "run-1");
  assert.equal(diagnostic.cause.code, "P2028");
  assert.equal(diagnostic.cause.details.detail, "STALE_OR_NOT_AUTHORIZED");
  assert.equal(diagnostic.cause.details.authorizationToken, "[REDACTED]");
  assert.equal(diagnostic.cause.message, "database constraint failed second line");
});

test("failure logger prints one structured trace only when explicitly enabled", () => {
  const previous = process.env.PRESSURE_DECISION_TIMING_LOG;
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    delete process.env.PRESSURE_DECISION_TIMING_LOG;
    logPressureDecisionFailureV1(fixture());
    assert.equal(calls.length, 0);

    process.env.PRESSURE_DECISION_TIMING_LOG = "1";
    logPressureDecisionFailureV1(fixture());
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], "Pressure decision failure");
    const payload = JSON.parse(String(calls[0]?.[1]));
    assert.equal(payload.traceId, "trace-1");
    assert.equal(payload.stage, "CONVERGENCE");
    assert.equal(payload.timings.commandCompileMs, 12);
    assert.equal(payload.error.code, "BROKEN_PORT");
  } finally {
    console.error = original;
    if (previous === undefined) delete process.env.PRESSURE_DECISION_TIMING_LOG;
    else process.env.PRESSURE_DECISION_TIMING_LOG = previous;
  }
});

function fixture() {
  return {
    path: "HTTP" as const,
    traceId: "trace-1",
    runId: "run-1",
    chapterId: "N1",
    decisionPointId: "N1.d1",
    stage: "CONVERGENCE",
    timings: { commandCompileMs: 12 },
    error: Object.assign(new Error("broken"), { code: "BROKEN_PORT" }),
  };
}
