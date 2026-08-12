import {
  validateOpenNovelNarrativeProjectionJobV1,
  type OpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";
import {
  applyLegacyCanonMutations,
  computeLegacyCanonHash,
  computeLegacyEndingHash,
  legacyTerminalHash,
} from "./canonical";
import type {
  LegacyNarrativePresentationV1,
  LegacyTerminalAuthorityReadModelV1,
  LegacyTerminalCommitOutcomeV1,
  LegacyTerminalSourceSnapshotV1,
  ValidatedLegacyTerminalCommitCommandV1,
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
  validateLegacyTerminalCommitCommandV1,
  validateLegacyTerminalSourceSnapshotV1,
} from "./validation";

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface StoredAuthorityV1 {
  commandFingerprint: string;
  model: LegacyTerminalAuthorityReadModelV1;
}

/** Deterministic transactional fixture; production persistence is a separate wiring owner. */
export class InMemoryLegacyTerminalStoreV1 implements
  LegacyTerminalSourceRepositoryPortV1,
  LegacyTerminalAuthorityCommitterPortV1,
  LegacyNarrativePresentationWriterPortV1 {
  private readonly sources = new Map<string, LegacyTerminalSourceSnapshotV1>();
  private readonly authorities = new Map<string, StoredAuthorityV1>();
  private readonly idempotency = new Map<string, { commandFingerprint: string; runId: string }>();
  private readonly presentations = new Map<string, LegacyNarrativePresentationV1>();
  authorityTransactions = 0;
  authorityWrites = 0;
  presentationWrites = 0;
  failBeforeCommitOnce = false;

  setSource(snapshot: LegacyTerminalSourceSnapshotV1): void {
    const validated = validateLegacyTerminalSourceSnapshotV1(snapshot);
    this.sources.set(validated.runId, clone(validated));
  }

  async load(runId: string): Promise<LegacyTerminalSourceSnapshotV1 | null> {
    return clone(this.sources.get(runId) ?? null);
  }

  async commit(raw: ValidatedLegacyTerminalCommitCommandV1): Promise<LegacyTerminalCommitOutcomeV1> {
    const command = validateLegacyTerminalCommitCommandV1(raw);
    const receipt = this.idempotency.get(command.idempotencyKey);
    if (receipt) {
      if (receipt.commandFingerprint !== command.commandFingerprint) {
        failLegacyTerminal(ERROR.FINGERPRINT_MISMATCH, command.idempotencyKey);
      }
      const stored = this.authorities.get(receipt.runId);
      if (!stored) failLegacyTerminal(ERROR.STATE_CONFLICT, `${receipt.runId}:MISSING_AUTHORITY`);
      return this.outcome("REPLAYED", stored.model);
    }

    const existing = this.authorities.get(command.runId);
    if (existing) {
      if (existing.commandFingerprint !== command.commandFingerprint) {
        failLegacyTerminal(ERROR.STATE_CONFLICT, `${command.runId}:ALREADY_COMMITTED`);
      }
      return this.outcome("REPLAYED", existing.model);
    }

    const source = this.sources.get(command.runId);
    if (!source || source.kind !== "UNFINISHED_T20") {
      failLegacyTerminal(ERROR.STATE_CONFLICT, `${command.runId}:SOURCE_NOT_ACTIVE`);
    }
    const validatedSource = validateLegacyTerminalSourceSnapshotV1(source);
    if (validatedSource.kind !== "UNFINISHED_T20") {
      failLegacyTerminal(ERROR.STATE_CONFLICT, `${command.runId}:SOURCE_COMPLETED`);
    }
    if (
      validatedSource.runtimeTerminalState !== command.expectedRuntimeTerminalState
      || validatedSource.terminalInput.settledStateHash !== command.expectedStateHash
      || validatedSource.terminalInput.canonBeforeHash !== command.expectedCanonHash
      || validatedSource.terminalInput.inputHash !== command.inputHash
    ) failLegacyTerminal(ERROR.STATE_CONFLICT, `${command.runId}:CAS_MISMATCH`);

    const canon = applyLegacyCanonMutations(
      validatedSource.material.canonBefore,
      command.canonMutations,
    );
    if (computeLegacyCanonHash(canon) !== command.canonAfterHash) {
      failLegacyTerminal(ERROR.HASH_MISMATCH, `${command.runId}:CANON_AFTER`);
    }
    if (this.failBeforeCommitOnce) {
      this.failBeforeCommitOnce = false;
      throw new Error("LEGACY_TERMINAL_INJECTED_PRECOMMIT_FAILURE");
    }

    const runtimeTerminalState = command.authoritativeEnding.scope === "PART"
      ? "PART_COMPLETE" as const
      : "STORY_COMPLETE" as const;
    const endingHash = computeLegacyEndingHash(command.authoritativeEnding);
    const commitManifestHash = legacyTerminalHash("legacy-terminal/commit-manifest/v1", {
      runId: command.runId,
      runtimeTerminalState,
      inputHash: command.inputHash,
      endingHash,
      canonHash: command.canonAfterHash,
      structuredResultHash: command.structuredResultHash,
      narrativeOutboxFingerprint: command.narrativeOutboxFingerprint,
      commandFingerprint: command.commandFingerprint,
    });
    const sourceCommitHash = legacyTerminalHash("legacy-terminal/source-commit/v1", {
      runId: command.runId,
      commitManifestHash,
    });
    const narrativeOutboxId = `legacy-terminal-outbox:${sourceCommitHash.slice(0, 32)}`;
    const narrativeOutboxJob: OpenNovelNarrativeProjectionJobV1 = validateOpenNovelNarrativeProjectionJobV1({
      schemaVersion: "openovel_narrative_projection_job_v1",
      jobId: narrativeOutboxId,
      runId: command.runId,
      audience: { ...command.narrativeOutbox.audience },
      sourceRuntimeProfile: command.narrativeOutbox.sourceRuntimeProfile,
      projectionKind: command.narrativeOutbox.projectionKind,
      sourceAuthority: command.narrativeOutbox.sourceAuthority,
      sourceId: command.narrativeOutbox.sourceId,
      sourceCommitHash,
      sourceContentHash: command.narrativeOutbox.sourceContentHash,
      allowedFactIds: [...command.narrativeOutbox.allowedFactIds],
      allowedObjectVersionIds: [...command.narrativeOutbox.allowedObjectVersionIds],
      allowedKnowledgeIds: [...command.narrativeOutbox.allowedKnowledgeIds],
      narrativeProfileVersion: command.narrativeOutbox.narrativeProfileVersion,
      idempotencyKey: command.narrativeOutbox.idempotencyKey,
    });
    const terminalReceipt = {
      schemaVersion: "legacy_terminal_commit_receipt_v1" as const,
      runId: command.runId,
      runtimeTerminalState,
      inputHash: command.inputHash,
      endingHash,
      canonHash: command.canonAfterHash,
      structuredResultHash: command.structuredResultHash,
      sourceCommitHash,
      narrativeOutboxId,
      commitManifestHash,
    };
    const model: LegacyTerminalAuthorityReadModelV1 = {
      receipt: terminalReceipt,
      authoritativeEnding: clone(command.authoritativeEnding),
      canon: clone(canon),
      structuredResult: clone(command.structuredResult),
      narrativeOutboxJob: clone(narrativeOutboxJob),
    };

    // One atomic visibility point for Ending, Canon, Result, receipt and outbox.
    this.authorityTransactions += 1;
    this.authorities.set(command.runId, {
      commandFingerprint: command.commandFingerprint,
      model: clone(model),
    });
    this.idempotency.set(command.idempotencyKey, {
      commandFingerprint: command.commandFingerprint,
      runId: command.runId,
    });
    this.authorityWrites += 5;
    return this.outcome("COMMITTED", model);
  }

  async readAuthority(runId: string): Promise<LegacyTerminalAuthorityReadModelV1 | null> {
    return clone(this.authorities.get(runId)?.model ?? null);
  }

  async publish(raw: LegacyNarrativePresentationV1): Promise<LegacyNarrativePresentationV1> {
    const presentation = validateLegacyNarrativePresentationV1(raw);
    const authority = this.authorities.get(presentation.runId)?.model;
    if (
      !authority
      || authority.receipt.sourceCommitHash !== presentation.sourceCommitHash
      || authority.receipt.narrativeOutboxId !== presentation.narrativeOutboxId
    ) failLegacyTerminal(ERROR.NARRATIVE_SOURCE_MISMATCH, presentation.runId);
    const current = this.presentations.get(presentation.runId);
    if (current) {
      if (current.revision === presentation.revision && current.presentationHash === presentation.presentationHash) {
        return clone(current);
      }
      if (
        presentation.revision <= current.revision
        || (current.status === "PUBLISHED" && presentation.status !== "PUBLISHED")
      ) failLegacyTerminal(ERROR.NARRATIVE_REVISION_STALE, presentation.runId);
    }
    this.presentations.set(presentation.runId, clone(presentation));
    this.presentationWrites += 1;
    return clone(presentation);
  }

  readPresentation(runId: string): LegacyNarrativePresentationV1 | null {
    return clone(this.presentations.get(runId) ?? null);
  }

  private outcome(
    status: "COMMITTED" | "REPLAYED",
    model: LegacyTerminalAuthorityReadModelV1,
  ): LegacyTerminalCommitOutcomeV1 {
    return {
      status,
      receipt: clone(model.receipt),
      authoritativeEnding: clone(model.authoritativeEnding),
      canon: clone(model.canon),
      structuredResult: clone(model.structuredResult),
      narrativeOutboxJob: clone(model.narrativeOutboxJob),
    };
  }
}

export class RecordingLegacyNarrativeOutboxKickV1 implements LegacyNarrativeOutboxKickPortV1 {
  readonly kicked: string[] = [];
  failuresRemaining = 0;

  async kick(narrativeOutboxId: string): Promise<void> {
    this.kicked.push(narrativeOutboxId);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("LEGACY_NARRATIVE_KICK_FAILED");
    }
  }
}

