import {
  compileB0ChapterSettlementInputV1,
  compareCanonicalText,
  createB0ChapterSettlementCommandV1,
  isSha256,
  sealB0ChapterPolicyEvaluationV1,
  settleB0ChapterV1,
  type B0ChapterPolicyEvaluationDraftV1,
} from "@ai-story/shared";
import { adaptB0SettlementToCanonicalV1 } from "./b0-to-canonical.adapter";
import {
  assertChapterSettlementSourceReadyV1,
  buildAtomicChapterCommitRecordV1,
  computeChapterSettlementRequestFingerprintV1,
  validateAtomicChapterCommitRecordV1,
} from "./chapter-commit-record";
import {
  CHAPTER_SETTLEMENT_ERROR_CODES as ERROR,
  failChapterSettlement,
} from "./errors";
import type {
  AtomicChapterCommitRecordV1,
  AtomicChapterCommitterPort,
  ChapterSettlementSourcePort,
  ChapterSettlementSourceV1,
  ContentOwnedChapterPolicyPort,
  SettleChapterCommandV1,
  SettleChapterResultV1,
} from "./types";

const COMMAND_KEYS = [
  "authorityTrigger",
  "runId",
  "chapterRuntimeId",
  "idempotencyKey",
  "requestFingerprint",
] as const;

/**
 * Deterministic, side-effect-free settlement planning over already-read
 * authority inputs. Ports remain exclusively owned by the orchestrator.
 */
export function planChapterSettlementV1(input: Readonly<{
  command: Readonly<SettleChapterCommandV1>;
  source: Readonly<ChapterSettlementSourceV1>;
  policyEvaluation: Readonly<B0ChapterPolicyEvaluationDraftV1>;
}>): AtomicChapterCommitRecordV1 {
  const { command, source, b0Input } = prepareChapterSettlementPlanInputsV1(
    input.command,
    input.source,
  );
  const b0Evaluation = sealB0ChapterPolicyEvaluationV1(
    input.policyEvaluation,
  );
  const b0Command = createB0ChapterSettlementCommandV1({
    idempotencyKey: command.idempotencyKey,
    sealedInput: b0Input,
    evaluation: b0Evaluation,
  });
  const b0Result = settleB0ChapterV1(b0Command);
  const settlement = adaptB0SettlementToCanonicalV1(b0Input, b0Result);
  return buildAtomicChapterCommitRecordV1({
    command,
    source,
    settlement,
    b0SettlementId: b0Result.receipt.settlementId,
  });
}

/**
 * Thin application coordinator. It owns no repository primitive and gives the
 * content policy no write capability; all authority crosses commitOnce once.
 */
export class ChapterSettlementOrchestrator {
  constructor(
    private readonly sourcePort: ChapterSettlementSourcePort,
    private readonly contentPolicy: ContentOwnedChapterPolicyPort,
    private readonly atomicCommitter: AtomicChapterCommitterPort,
  ) {}

  async settle(
    rawCommand: SettleChapterCommandV1,
  ): Promise<SettleChapterResultV1> {
    const command = validateCommand(rawCommand);
    const key = {
      runId: command.runId,
      chapterRuntimeId: command.chapterRuntimeId,
    };

    // Durable commit receipt wins before source or policy lookup. Recovery
    // never reinterprets the current ledger, content package, or live flags.
    const existing = await this.atomicCommitter.readCommitted(key);
    if (existing) {
      return {
        status: "REPLAYED",
        record: this.assertMatchingCommitted(existing, command),
      };
    }

    const rawSource = await this.sourcePort.readSealedSource(key);
    if (!rawSource) {
      failChapterSettlement(
        ERROR.SOURCE_NOT_FOUND,
        "source",
        `${command.runId}:${command.chapterRuntimeId}`,
      );
    }
    return this.settlePrepared(command, rawSource);
  }

  /**
   * Fast production path for a source returned by the transaction that sealed
   * it.  commitOnce still owns the durable replay check and the complete W6
   * atomic write; this method only removes redundant read transactions.
   */
  async settlePrepared(
    rawCommand: SettleChapterCommandV1,
    rawSource: ChapterSettlementSourceV1,
  ): Promise<SettleChapterResultV1> {
    const { command, source, b0Input } = prepareChapterSettlementPlanInputsV1(
      rawCommand,
      rawSource,
    );
    const policyDraft = await this.contentPolicy.evaluateChapter({
      b0Input,
      baseWorldState: source.baseWorldState,
    });
    const candidate = planChapterSettlementV1({
      command,
      source,
      policyEvaluation: policyDraft,
    });
    const committed = await this.atomicCommitter.commitOnce(candidate);
    const record = this.assertMatchingCommitted(
      committed.record,
      command,
      candidate,
    );
    return {
      status: committed.status === "COMMITTED" ? "COMMITTED" : "REPLAYED",
      record,
    };
  }

  private assertMatchingCommitted(
    value: unknown,
    command: SettleChapterCommandV1,
    candidate?: AtomicChapterCommitRecordV1,
  ): AtomicChapterCommitRecordV1 {
    const record = validateAtomicChapterCommitRecordV1(value);
    if (
      record.runId !== command.runId ||
      record.chapterRuntimeId !== command.chapterRuntimeId
    ) {
      failChapterSettlement(
        ERROR.COMMITTED_RECORD_MISMATCH,
        "committedRecord",
        "COMMAND_CONTEXT_MISMATCH",
      );
    }
    if (
      record.idempotencyKey !== command.idempotencyKey ||
      record.requestFingerprint !== command.requestFingerprint
    ) {
      failChapterSettlement(
        ERROR.CHAPTER_SETTLEMENT_FINGERPRINT_MISMATCH,
        "committedRecord.requestFingerprint",
      );
    }
    if (candidate && record.atomicRecordHash !== candidate.atomicRecordHash) {
      failChapterSettlement(
        ERROR.COMMITTED_RECORD_MISMATCH,
        "atomicCommitter.commitOnce",
        "CANDIDATE_MISMATCH",
      );
    }
    return structuredClone(record);
  }
}

function prepareChapterSettlementPlanInputsV1(
  commandValue: unknown,
  sourceValue: unknown,
) {
  const command = validateCommand(commandValue);
  const source = assertChapterSettlementSourceReadyV1(sourceValue);
  if (
    source.sealedInput.runId !== command.runId ||
    source.sealedInput.chapterRuntimeId !== command.chapterRuntimeId
  ) {
    failChapterSettlement(
      ERROR.SOURCE_REFERENCE_MISMATCH,
      "source.sealedInput",
      "COMMAND_CONTEXT_MISMATCH",
    );
  }
  const expectedFingerprint = computeChapterSettlementRequestFingerprintV1({
    runId: command.runId,
    chapterRuntimeId: command.chapterRuntimeId,
    idempotencyKey: command.idempotencyKey,
    sealedInputHash: source.sealedInput.inputHash,
  });
  if (command.requestFingerprint !== expectedFingerprint) {
    failChapterSettlement(
      ERROR.REQUEST_FINGERPRINT_MISMATCH,
      "command.requestFingerprint",
      `EXPECTED_${expectedFingerprint}`,
    );
  }
  return {
    command,
    source,
    b0Input: compileB0ChapterSettlementInputV1({
      wireInput: source.sealedInput,
      settlementMaterial: source.settlementMaterial,
    }),
  };
}

function validateCommand(value: unknown): SettleChapterCommandV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("command", "OBJECT");
  }
  const command = value as Record<string, unknown>;
  const actual = Object.keys(command).sort(compareCanonicalText);
  const expected = [...COMMAND_KEYS].sort(compareCanonicalText);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid("command", `EXACT_KEYS_${expected.join(",")}`);
  }
  if (command.authorityTrigger !== "CHAPTER_CLOSE") {
    invalid("command.authorityTrigger", "EXPECTED_CHAPTER_CLOSE");
  }
  for (const field of ["runId", "chapterRuntimeId", "idempotencyKey"] as const) {
    if (typeof command[field] !== "string" || !command[field].trim()) {
      invalid(`command.${field}`, "NON_EMPTY_STRING");
    }
  }
  if (!isSha256(command.requestFingerprint)) {
    invalid("command.requestFingerprint", "SHA256_LOWER_HEX");
  }
  return command as unknown as SettleChapterCommandV1;
}

function invalid(path: string, detail: string): never {
  return failChapterSettlement(ERROR.INVALID_COMMAND, path, detail);
}
