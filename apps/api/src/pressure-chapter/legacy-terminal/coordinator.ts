import { LegacyTerminalInputAdapterV1 } from "./adapter";
import type {
  LegacyNarrativePresentationV1,
  LegacyTerminalFinalizeResultV1,
} from "./contracts";
import {
  LEGACY_TERMINAL_ERROR_CODES as ERROR,
  failLegacyTerminal,
} from "./errors";
import type {
  LegacyNarrativeOutboxKickPortV1,
  LegacyNarrativePresentationWriterPortV1,
  LegacyTerminalAuthorityCommitterPortV1,
  LegacyTerminalSourceRepositoryPortV1,
} from "./ports";
import {
  validateLegacyNarrativePresentationV1,
  validateLegacyTerminalSourceSnapshotV1,
} from "./validation";

export class LegacyTerminalCoordinatorV1 {
  constructor(
    private readonly sourceRepository: LegacyTerminalSourceRepositoryPortV1,
    private readonly adapter: LegacyTerminalInputAdapterV1,
    private readonly authorityCommitter: LegacyTerminalAuthorityCommitterPortV1,
    private readonly outboxKick: LegacyNarrativeOutboxKickPortV1,
    private readonly presentationWriter: LegacyNarrativePresentationWriterPortV1,
  ) {}

  async finalize(input: {
    runId: string;
    idempotencyKey: string;
  }): Promise<LegacyTerminalFinalizeResultV1> {
    const loaded = await this.sourceRepository.load(input.runId);
    if (!loaded) failLegacyTerminal(ERROR.SOURCE_NOT_FOUND, input.runId);
    const snapshot = validateLegacyTerminalSourceSnapshotV1(loaded);
    if (snapshot.runId !== input.runId) {
      failLegacyTerminal(ERROR.INVALID_CONTRACT, "SOURCE_RUN_MISMATCH");
    }
    if (snapshot.kind === "HISTORICAL_COMPLETED") {
      return { status: "HISTORICAL_READ_ONLY", snapshot };
    }

    const command = this.adapter.compile({
      snapshot,
      idempotencyKey: input.idempotencyKey,
    });
    const committed = await this.authorityCommitter.commit(command);
    let narrativeStatus: "PENDING" | "FAILED_RETRYABLE" = "PENDING";
    try {
      await this.outboxKick.kick(committed.receipt.narrativeOutboxId);
    } catch {
      narrativeStatus = "FAILED_RETRYABLE";
    }
    return { ...committed, narrativeStatus };
  }

  async publishNarrative(
    value: LegacyNarrativePresentationV1,
  ): Promise<LegacyNarrativePresentationV1> {
    const presentation = validateLegacyNarrativePresentationV1(value);
    const authority = await this.authorityCommitter.readAuthority(presentation.runId);
    if (
      !authority
      || authority.receipt.sourceCommitHash !== presentation.sourceCommitHash
      || authority.receipt.narrativeOutboxId !== presentation.narrativeOutboxId
    ) failLegacyTerminal(ERROR.NARRATIVE_SOURCE_MISMATCH, presentation.runId);
    return this.presentationWriter.publish(presentation);
  }
}

