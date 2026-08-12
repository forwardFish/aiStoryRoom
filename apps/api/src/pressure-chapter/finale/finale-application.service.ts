import {
  isSha256,
  isoTimestamp,
  type SangtianPressureFinaleDecisionV1,
} from "@ai-story/shared";
import {
  buildSangtianFinaleIdempotencyKeyV1,
  compareGenericFinaleShadowV1,
  evaluateSangtianPressureFinaleV1,
} from "@ai-story/templates";
import {
  TERMINAL_COMMIT_ERROR_CODES as ERROR,
  buildAuthorityFirstTerminalRecordV1,
  failTerminalCommit,
  validateAuthorityFirstTerminalRecordV1,
  type AuthorityFirstTerminalCommitterPort,
  type AuthorityFirstTerminalRecordV1,
  type FinalizePressureRunResultV1,
  type GenericFinaleShadowReadOnlyPort,
  type NarrativeOutboxSignalPort,
  type TerminalPostCommitStatusV1,
} from "../terminal-commit";
import { N7FrozenFinaleInputAssemblerV1 } from "./assembler";

export interface FinalizeN7PressureRunCommandV1 {
  runId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  /**
   * Optional compare-and-set expectation only. Finale time authority is the
   * N7 settlement committedAt sealed in the assembled source.
   */
  decidedAt?: string;
}

export class PressureFinaleApplicationServiceV1 {
  constructor(
    private readonly assembler: N7FrozenFinaleInputAssemblerV1,
    private readonly terminalCommitter: AuthorityFirstTerminalCommitterPort,
    private readonly narrativeOutboxSignal: NarrativeOutboxSignalPort,
    private readonly genericShadow: GenericFinaleShadowReadOnlyPort,
  ) {}

  async finalize(
    command: Readonly<FinalizeN7PressureRunCommandV1>,
  ): Promise<FinalizePressureRunResultV1> {
    validateCommand(command);
    const existing = await this.terminalCommitter.readCommitted(command.runId);
    if (existing !== null) {
      const record = this.assertReplay(existing, command);
      return {
        status: "REPLAYED",
        record,
        postCommit: notRunPostCommit(),
      };
    }

    const assembled = await this.assembler.assemble(command.runId);
    if (assembled.source.sourceFingerprint !== command.requestFingerprint) {
      failTerminalCommit(
        ERROR.SOURCE_FINGERPRINT_MISMATCH,
        "command.requestFingerprint",
        `EXPECTED_${assembled.source.sourceFingerprint}`,
      );
    }
    const authorityDecidedAt = assembled.source.terminalResultContext.completedAt;
    assertExpectedAuthorityTime(command.decidedAt, authorityDecidedAt);
    const evaluatorIdempotencyKey = buildSangtianFinaleIdempotencyKeyV1({
      inputHash: assembled.input.inputHash,
      policyHash: assembled.source.policy.policyHash,
      decidedAt: authorityDecidedAt,
    });
    const decision = evaluateSangtianPressureFinaleV1({
      input: assembled.input,
      policy: assembled.source.policy,
      decidedAt: authorityDecidedAt,
      idempotencyKey: evaluatorIdempotencyKey,
    });
    const candidate = buildAuthorityFirstTerminalRecordV1({
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: command.requestFingerprint,
      input: assembled.input,
      policy: assembled.source.policy,
      decision,
      terminalResultContext: assembled.source.terminalResultContext,
    });
    const persisted = await this.terminalCommitter.commitOnce(candidate);
    const record = this.assertCommittedCandidate(
      persisted.record,
      candidate,
      command,
    );
    if (persisted.status === "REPLAYED") {
      return { status: "REPLAYED", record, postCommit: notRunPostCommit() };
    }

    // Everything below this line is downstream of a successful authoritative
    // commit. Failures are reported, never thrown back into the transaction.
    const postCommit = await this.runPostCommit(record, assembled.input, decision);
    return { status: "COMMITTED", record, postCommit };
  }

  private assertReplay(
    value: unknown,
    command: Readonly<FinalizeN7PressureRunCommandV1>,
  ): AuthorityFirstTerminalRecordV1 {
    const record = validateAuthorityFirstTerminalRecordV1(value);
    if (record.runId !== command.runId) {
      failTerminalCommit(ERROR.COMMITTED_RECORD_MISMATCH, "committed.runId");
    }
    if (record.idempotencyKey !== command.idempotencyKey) {
      failTerminalCommit(
        ERROR.ALREADY_COMMITTED,
        "command.idempotencyKey",
        `COMMITTED_WITH_${record.idempotencyKey}`,
      );
    }
    if (record.requestFingerprint !== command.requestFingerprint) {
      failTerminalCommit(
        ERROR.IDEMPOTENCY_FINGERPRINT_MISMATCH,
        "command.requestFingerprint",
        `EXPECTED_${record.requestFingerprint}`,
      );
    }
    assertExpectedAuthorityTime(command.decidedAt, record.decision.decidedAt);
    return record;
  }

  private assertCommittedCandidate(
    value: unknown,
    candidate: AuthorityFirstTerminalRecordV1,
    command: Readonly<FinalizeN7PressureRunCommandV1>,
  ): AuthorityFirstTerminalRecordV1 {
    const record = this.assertReplay(value, command);
    if (record.atomicRecordHash !== candidate.atomicRecordHash) {
      failTerminalCommit(
        ERROR.COMMITTED_RECORD_MISMATCH,
        "terminalCommitter.commitOnce",
        `EXPECTED_${candidate.atomicRecordHash}`,
      );
    }
    return record;
  }

  private async runPostCommit(
    record: AuthorityFirstTerminalRecordV1,
    finaleInput: Parameters<typeof compareGenericFinaleShadowV1>[1] &
      Parameters<GenericFinaleShadowReadOnlyPort["evaluateShadow"]>[0]["finaleInput"],
    decision: SangtianPressureFinaleDecisionV1,
  ): Promise<TerminalPostCommitStatusV1> {
    let narrativeStatus: TerminalPostCommitStatusV1["narrativeOutboxSignal"] = "NOTIFIED";
    try {
      await this.narrativeOutboxSignal.notifyCommitted({
        runId: record.runId,
        authorityCommitHash: record.authorityCommitHash,
        outboxDedupeKey: record.narrativeOutbox.dedupeKey,
        outboxHash: record.narrativeOutbox.outboxHash,
      });
    } catch {
      narrativeStatus = "FAILED_RETRYABLE";
    }

    try {
      const candidate = await this.genericShadow.evaluateShadow({
        finaleInput: structuredClone(finaleInput),
        authoritativeDecision: structuredClone(decision),
      });
      if (candidate === null) {
        return {
          narrativeOutboxSignal: narrativeStatus,
          genericShadow: "NOT_RUN",
          shadowReport: null,
        };
      }
      const report = compareGenericFinaleShadowV1(decision, finaleInput, candidate);
      return {
        narrativeOutboxSignal: narrativeStatus,
        genericShadow: report.matches ? "MATCH" : "MISMATCH",
        shadowReport: report,
      };
    } catch {
      return {
        narrativeOutboxSignal: narrativeStatus,
        genericShadow: "FAILED_ISOLATED",
        shadowReport: null,
      };
    }
  }
}

function validateCommand(command: Readonly<FinalizeN7PressureRunCommandV1>): void {
  if (!command || typeof command !== "object") {
    failTerminalCommit(ERROR.INVALID_TRIGGER, "command", "OBJECT");
  }
  for (const field of ["runId", "idempotencyKey"] as const) {
    if (typeof command[field] !== "string" || !command[field].trim()) {
      failTerminalCommit(ERROR.INVALID_TRIGGER, `command.${field}`, "NON_EMPTY_STRING");
    }
  }
  if (!isSha256(command.requestFingerprint)) {
    failTerminalCommit(ERROR.INVALID_TRIGGER, "command.requestFingerprint", "SHA256");
  }
  if (command.decidedAt !== undefined) {
    isoTimestamp(command.decidedAt, "command.decidedAt");
  }
}

function assertExpectedAuthorityTime(
  expected: string | undefined,
  authority: string,
): void {
  if (expected !== undefined && expected !== authority) {
    failTerminalCommit(
      ERROR.INVALID_TRIGGER,
      "command.decidedAt",
      `EXPECTED_AUTHORITY_TIME_${authority}`,
    );
  }
}

function notRunPostCommit(): TerminalPostCommitStatusV1 {
  return {
    narrativeOutboxSignal: "NOT_RUN",
    genericShadow: "NOT_RUN",
    shadowReport: null,
  };
}
