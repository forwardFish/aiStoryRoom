import type {
  LegacyCreationPolicyResolutionV1,
  LegacyNarrativePresentationV1,
  LegacyT20CreationIntentV1,
  LegacyTerminalAuthorityReadModelV1,
  LegacyTerminalCommitOutcomeV1,
  LegacyTerminalSourceSnapshotV1,
  ValidatedLegacyTerminalCommitCommandV1,
} from "./contracts";

export interface LegacyTerminalSourceRepositoryPortV1 {
  load(runId: string): Promise<LegacyTerminalSourceSnapshotV1 | null>;
}

export interface LegacyTerminalAuthorityCommitterPortV1 {
  commit(command: ValidatedLegacyTerminalCommitCommandV1): Promise<LegacyTerminalCommitOutcomeV1>;
  readAuthority(runId: string): Promise<LegacyTerminalAuthorityReadModelV1 | null>;
}

/** Optional queue wake-up after the authority transaction has committed. */
export interface LegacyNarrativeOutboxKickPortV1 {
  kick(narrativeOutboxId: string): Promise<void>;
}

/** Presentation-only write capability; it has no authority mutation method. */
export interface LegacyNarrativePresentationWriterPortV1 {
  publish(presentation: LegacyNarrativePresentationV1): Promise<LegacyNarrativePresentationV1>;
}

export interface LegacyT20CreationPolicyGuardPortV1 {
  resolve(intent: LegacyT20CreationIntentV1): LegacyCreationPolicyResolutionV1;
}

