import type {
  SangtianFinaleInputV1,
  SangtianPressureFinaleDecisionV1,
} from "@ai-story/shared";
import type { GenericFinaleShadowCandidateV1 } from "@ai-story/templates";
import type {
  AuthorityFirstTerminalCommitResultV1,
  AuthorityFirstTerminalRecordV1,
} from "./types";

/** The sole authoritative writer. Its adapter must atomically persist every field. */
export interface AuthorityFirstTerminalCommitterPort {
  readCommitted(runId: string): Promise<unknown | null>;
  commitOnce(
    record: Readonly<AuthorityFirstTerminalRecordV1>,
  ): Promise<AuthorityFirstTerminalCommitResultV1>;
}

/** Post-commit worker wake-up only; the authoritative outbox row already exists. */
export interface NarrativeOutboxSignalPort {
  notifyCommitted(input: Readonly<{
    runId: string;
    authorityCommitHash: string;
    outboxDedupeKey: string;
    outboxHash: string;
  }>): Promise<void>;
}

/**
 * Read-only, no-write Generic boundary. It may compute a shadow candidate but
 * receives no committer, repository, result writer or mutation capability.
 */
export interface GenericFinaleShadowReadOnlyPort {
  evaluateShadow(input: Readonly<{
    finaleInput: SangtianFinaleInputV1;
    authoritativeDecision: SangtianPressureFinaleDecisionV1;
  }>): Promise<GenericFinaleShadowCandidateV1 | null>;
}
