import type { GenesisAtomicCommitPort } from "../genesis";
import type { PressureGameViewerReaderPort } from "../game-projection/contracts";
import { mapCommittedGenesisToSeatControlAuthority } from "../seat-control/genesis-authority.adapter";
import type {
  CommittedSeatControlCommandV1,
  FrozenDefaultSourceProofV1,
  FrozenSeatControlPolicyReaderPort,
  FrozenSeatControlPolicyV1,
  FrozenDeadlineTakeoverProofV1,
  SeatControlAuthorityPort,
  SeatControlDecisionAuthorityPort,
  SeatControlGenesisAuthorityReaderPort,
  SeatControlGenesisAuthorityV1,
  SeatControlInitializePortResultV1,
  SeatControlSnapshotV1,
  SeatControlTransitionCommitV1,
  SeatControlTransitionPortResultV1,
  SeatDefaultDirectivePort,
  SeatDefaultDirectiveV1,
  SeatPresencePort,
  SeatPresenceRecordV1,
  SeatPrivateProjectionPort,
  SeatPrivateProjectionRecordV1,
} from "../seat-control/types";
import type { SeatIdV1 } from "@ai-story/shared";
import {
  PRESSURE_LIVE_ADAPTER_ERROR_CODES as ERROR,
  PressureLiveAdapterError,
} from "./errors";

/** Projects the already durable sequence-0 Genesis manifest; it never reads flags. */
export class CommittedGenesisSeatControlAuthorityReaderV1
implements SeatControlGenesisAuthorityReaderPort {
  constructor(
    private readonly genesis: Pick<GenesisAtomicCommitPort, "readCommitted">,
  ) {}

  async readGenesisAuthority(
    runId: string,
  ): Promise<SeatControlGenesisAuthorityV1 | null> {
    const committed = await this.genesis.readCommitted(runId);
    return committed ? mapCommittedGenesisToSeatControlAuthority(committed) : null;
  }
}

/**
 * Current Prisma has no atomic W7 snapshot/event/receipt/fence tables. This is
 * explicit production behavior, not an in-memory authority substitute.
 */
export class FailClosedSeatControlAuthorityPortV1
implements SeatControlAuthorityPort {
  readSnapshot(_runId: string): Promise<SeatControlSnapshotV1 | null> {
    return missing("SeatControlAuthorityPort");
  }

  readCommittedCommand(
    _runId: string,
    _idempotencyKey: string,
  ): Promise<CommittedSeatControlCommandV1 | null> {
    return missing("SeatControlAuthorityPort");
  }

  initializeOnce(
    _candidate: CommittedSeatControlCommandV1,
  ): Promise<SeatControlInitializePortResultV1> {
    return missing("SeatControlAuthorityPort");
  }

  commitTransition(
    _command: SeatControlTransitionCommitV1,
  ): Promise<SeatControlTransitionPortResultV1> {
    return missing("SeatControlAuthorityPort");
  }
}

/** Route/RoleAgentPolicy rows do not freeze all W7 policy hashes. */
export class FailClosedFrozenSeatControlPolicyReaderV1
implements FrozenSeatControlPolicyReaderPort {
  readFrozenPolicy(_runId: string): Promise<FrozenSeatControlPolicyV1 | null> {
    return missing("FrozenSeatControlPolicyReaderPort");
  }
}

/** PresenceSession cannot represent W7 idempotent status records/fingerprints. */
export class FailClosedSeatPresencePortV1 implements SeatPresencePort {
  record(_record: SeatPresenceRecordV1): Promise<{
    status: "APPLIED" | "REPLAYED" | "STALE";
    record: SeatPresenceRecordV1;
  }> {
    return missing("SeatPresencePort");
  }

  readForSeat(
    _runId: string,
    _seatId: SeatIdV1,
    _humanControllerId: string,
  ): Promise<SeatPresenceRecordV1 | null> {
    return missing("SeatPresencePort");
  }
}

/** No W7 directive/receipt row exists; RoleAgentPolicy is not this authority. */
export class FailClosedSeatDefaultDirectivePortV1
implements SeatDefaultDirectivePort {
  readCommitted(
    _runId: string,
    _idempotencyKey: string,
  ): Promise<SeatDefaultDirectiveV1 | null> {
    return missing("SeatDefaultDirectivePort");
  }

  commitOnce(_directive: SeatDefaultDirectiveV1): Promise<{
    status: "COMMITTED" | "REPLAYED";
    directive: SeatDefaultDirectiveV1;
  }> {
    return missing("SeatDefaultDirectivePort");
  }
}

/** Closed DecisionPoint/failure proof hashes have no persisted W7 proof row. */
export class FailClosedSeatControlDecisionAuthorityPortV1
implements SeatControlDecisionAuthorityPort {
  verifyFrozenDeadlineTakeover(_input: {
    proof: FrozenDeadlineTakeoverProofV1;
    authorityStateHash: string;
    frozenPolicyHash: string;
  }): Promise<boolean> {
    return missing("SeatControlDecisionAuthorityPort");
  }

  verifyFrozenDefaultSource(_input: {
    proof: FrozenDefaultSourceProofV1;
    authorityStateHash: string;
    frozenPolicyHash: string;
  }): Promise<boolean> {
    return missing("SeatControlDecisionAuthorityPort");
  }
}

/** StoryRole text/knownInfo has no versioned W7 private-payload contract. */
export class FailClosedSeatPrivateProjectionPortV1
implements SeatPrivateProjectionPort {
  readForSeat(_input: {
    runId: string;
    seatId: SeatIdV1;
    sourceAuthorityHash: string;
  }): Promise<SeatPrivateProjectionRecordV1> {
    return unavailable("SeatPrivateProjectionPort");
  }
}

/**
 * The game viewer source requires W7 private situation/resources/tokens plus
 * submission/reclaim fence tokens. Legacy RoleControl alone cannot supply it.
 */
export class FailClosedPressureGameViewerReaderV1
implements PressureGameViewerReaderPort {
  readViewer(_input: {
    runId: string;
    subjectId: string;
  }): ReturnType<PressureGameViewerReaderPort["readViewer"]> {
    return unavailable("PressureGameViewerReaderPort");
  }
}

function missing<T>(port: string): Promise<T> {
  return Promise.reject(
    new PressureLiveAdapterError(
      ERROR.CONFIGURATION_REQUIRED,
      port,
      "PERSISTED_AUTHORITY_MISSING",
    ),
  );
}

function unavailable<T>(port: string): Promise<T> {
  return Promise.reject(
    new PressureLiveAdapterError(
      ERROR.PRIVATE_PROJECTION_UNAVAILABLE,
      port,
      "PERSISTED_AUTHORITY_MISSING",
    ),
  );
}
