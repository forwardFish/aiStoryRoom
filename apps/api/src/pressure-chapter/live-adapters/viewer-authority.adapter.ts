import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  decodeSeatEnvelope,
  presenceKey,
  type PressureSeatSnapshotDelegateV1,
} from "../seat-control-persistence/envelope";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
  SeatPresenceRecordV1,
} from "../seat-control/types";
import {
  PRESSURE_LIVE_ADAPTER_ERROR_CODES as ERROR,
  failLiveAdapter,
} from "./errors";

const HUMAN_MODES = Object.freeze(["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"] as const);
const AI_MODES = Object.freeze(["AI_ACTIVE", "HUMAN_RECLAIM_PENDING"] as const);

export type CanonicalRoleControlModeV1 =
  | (typeof HUMAN_MODES)[number]
  | (typeof AI_MODES)[number];

export interface CanonicalSeatControlProjectionV1 {
  storedMode: CanonicalRoleControlModeV1;
  projectedMode: "HUMAN_ACTIVE" | "AI_ACTIVE";
  controlEpoch: number;
  canSubmit: boolean;
  canReclaim: boolean;
  /** Read-version evidence only. It is deliberately not a submission fence. */
  authorityVersionHash: string;
}

export interface CanonicalSeatViewerAuthorityV1 {
  schemaVersion: "pressure_canonical_seat_viewer_authority_v1";
  roomId: string;
  runId: string;
  routeHash: string;
  subjectId: string;
  playerId: string;
  roleId: string;
  seatId: SeatIdV1;
  roleName: string;
  presence: "ONLINE" | "DISCONNECTED";
  control: CanonicalSeatControlProjectionV1;
}

export interface CanonicalSeatViewerAuthorityReaderPortV1 {
  read(input: {
    runId: string;
    subjectId: string;
  }): Promise<CanonicalSeatViewerAuthorityV1 | null>;
  authorize(input: {
    runId: string;
    subjectId: string;
    expectedSeatId: SeatIdV1;
    expectedControlEpoch: number;
  }): Promise<CanonicalSeatViewerAuthorityV1>;
}

interface StoryPlayerAuthorityRowV1 {
  id: string;
  runId: string;
  userId: string | null;
  roleId: string | null;
  playerType: string;
  status: string;
  run: {
    id: string;
    pressureRouteSnapshot: { routeHash: string } | null;
  };
  role: {
    id: string;
    runId: string;
    roleKey: string;
    roleName: string;
  } | null;
}

export interface CanonicalViewerReadPrismaLikeV1 {
  pressureSeatControlSnapshot: PressureSeatSnapshotDelegateV1;
  storyPlayer: {
    findUnique(input: {
      where: { runId_userId: { runId: string; userId: string } };
      select: {
        id: true;
        runId: true;
        userId: true;
        roleId: true;
        playerType: true;
        status: true;
        run: {
          select: {
            id: true;
            pressureRouteSnapshot: { select: { routeHash: true } };
          };
        };
        role: {
          select: { id: true; runId: true; roleKey: true; roleName: true };
        };
      };
    }): Promise<StoryPlayerAuthorityRowV1 | null>;
  };
}

export interface PressureLiveClockV1 {
  now(): Date;
}

const SYSTEM_CLOCK: PressureLiveClockV1 = Object.freeze({ now: () => new Date() });

/**
 * Exact `(runId,userId)` membership lookup. The select shape can only reach
 * the viewer's own role/control/presence rows; it never reads the six-role set.
 */
export class PrismaCanonicalSeatViewerAuthorityReaderV1
implements CanonicalSeatViewerAuthorityReaderPortV1 {
  constructor(
    private readonly prisma: CanonicalViewerReadPrismaLikeV1,
    private readonly clock: PressureLiveClockV1 = SYSTEM_CLOCK,
  ) {}

  async read(input: {
    runId: string;
    subjectId: string;
  }): Promise<CanonicalSeatViewerAuthorityV1 | null> {
    if (!input.runId.trim() || !input.subjectId.trim()) {
      return failLiveAdapter(ERROR.SUBJECT_FORBIDDEN, "StoryPlayer", "EMPTY_SCOPE");
    }
    const row = await this.prisma.storyPlayer.findUnique({
      where: {
        runId_userId: { runId: input.runId, userId: input.subjectId },
      },
      select: viewerAuthoritySelect(input.runId),
    });
    if (!row) return null;
    const seatRow = await this.prisma.pressureSeatControlSnapshot.findUnique({
      where: { runId: input.runId },
    });
    if (!seatRow) {
      return failLiveAdapter(
        ERROR.AUTHORITY_NOT_FOUND,
        "PressureSeatControlSnapshot",
        input.runId,
      );
    }
    return decodeViewerAuthority(
      row,
      decodeSeatEnvelope(seatRow),
      input,
      this.clock.now(),
    );
  }

  async authorize(input: {
    runId: string;
    subjectId: string;
    expectedSeatId: SeatIdV1;
    expectedControlEpoch: number;
  }): Promise<CanonicalSeatViewerAuthorityV1> {
    const authority = await this.read(input);
    if (!authority) {
      return failLiveAdapter(ERROR.SUBJECT_FORBIDDEN, "StoryPlayer", input.subjectId);
    }
    if (authority.seatId !== input.expectedSeatId) {
      return failLiveAdapter(
        ERROR.SUBJECT_FORBIDDEN,
        "StoryRole.roleKey",
        `EXPECTED_${input.expectedSeatId}`,
      );
    }
    if (authority.control.controlEpoch !== input.expectedControlEpoch) {
      return failLiveAdapter(
        ERROR.STALE_CONTROL_EPOCH,
        "RoleControl.epoch",
        `EXPECTED_${input.expectedControlEpoch}_CURRENT_${authority.control.controlEpoch}`,
      );
    }
    return authority;
  }
}

type ViewerAuthoritySelectV1 = Parameters<
  CanonicalViewerReadPrismaLikeV1["storyPlayer"]["findUnique"]
>[0]["select"];

function viewerAuthoritySelect(runId: string): ViewerAuthoritySelectV1 {
  void runId;
  return {
    id: true,
    runId: true,
    userId: true,
    roleId: true,
    playerType: true,
    status: true,
    run: {
      select: {
        id: true,
        pressureRouteSnapshot: { select: { routeHash: true } },
      },
    },
    role: {
      select: { id: true, runId: true, roleKey: true, roleName: true },
    },
  };
}

function decodeViewerAuthority(
  row: StoryPlayerAuthorityRowV1,
  envelope: ReturnType<typeof decodeSeatEnvelope>,
  scope: { runId: string; subjectId: string },
  now: Date,
): CanonicalSeatViewerAuthorityV1 {
  if (
    row.runId !== scope.runId
    || row.run.id !== scope.runId
    || row.userId !== scope.subjectId
    || row.playerType !== "human"
    || row.status !== "active"
    || !row.role
    || row.role.runId !== scope.runId
    || row.roleId !== row.role.id
    || !row.run.pressureRouteSnapshot
  ) {
    return failLiveAdapter(ERROR.SUBJECT_FORBIDDEN, "StoryPlayer", "MEMBERSHIP_BINDING");
  }
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(row.role.roleKey as SeatIdV1)) {
    return failLiveAdapter(
      ERROR.SUBJECT_FORBIDDEN,
      "StoryRole.roleKey",
      `NON_CANONICAL_${row.role.roleKey}`,
    );
  }
  const seatId = row.role.roleKey as SeatIdV1;
  const snapshot = envelope.snapshot;
  assertSeatSnapshot(snapshot, scope.runId, row.run.pressureRouteSnapshot.routeHash);
  const matchingControls = snapshot.seatControls.filter((candidate) => candidate.seatId === seatId);
  if (matchingControls.length !== 1) {
    return failLiveAdapter(
      ERROR.AUTHORITY_AMBIGUOUS,
      "PressureSeatControlSnapshot.seatControls",
      `EXPECTED_ONE_GOT_${matchingControls.length}`,
    );
  }
  const control = matchingControls[0]!;
  if (
    control.originalHumanControllerId !== scope.subjectId
    || !Number.isSafeInteger(control.controlEpoch)
    || control.controlEpoch < 1
  ) {
    return failLiveAdapter(
      ERROR.AUTHORITY_MISMATCH,
      "PressureSeatControlSnapshot.seatControls",
      "VIEWER_BINDING",
    );
  }
  const storedMode = control.mode;
  const projectedMode = control.mode;
  const canSubmit = control.mode === "HUMAN_ACTIVE"
    && control.activeControllerId === scope.subjectId;
  const canReclaim = control.mode === "AI_ACTIVE"
    && snapshot.frozenPolicy.humanReclaimAllowed;
  const latestPresence = envelope.latestPresence[
    presenceKey(scope.runId, seatId, scope.subjectId)
  ] ?? null;
  validatePresence(latestPresence, scope, seatId);
  void now;
  return {
    schemaVersion: "pressure_canonical_seat_viewer_authority_v1",
    roomId: scope.runId,
    runId: scope.runId,
    routeHash: row.run.pressureRouteSnapshot.routeHash,
    subjectId: scope.subjectId,
    playerId: row.id,
    roleId: row.role.id,
    seatId,
    roleName: requiredText(row.role.roleName, "StoryRole.roleName"),
    presence: latestPresence?.status ?? "DISCONNECTED",
    control: {
      storedMode,
      projectedMode,
      controlEpoch: control.controlEpoch,
      canSubmit,
      canReclaim,
      authorityVersionHash: snapshot.stateHash,
    },
  };
}

function assertSeatSnapshot(
  snapshot: SeatControlSnapshotV1,
  runId: string,
  routeHash: string,
): void {
  const { stateHash, ...base } = snapshot;
  if (
    snapshot.runId !== runId
    || snapshot.routeHash !== routeHash
    || !/^[a-f0-9]{64}$/.test(stateHash)
    || sha256Canonical(base) !== stateHash
  ) {
    failLiveAdapter(
      ERROR.AUTHORITY_MISMATCH,
      "PressureSeatControlSnapshot",
      "RUN_ROUTE_OR_HASH",
    );
  }
}

function validatePresence(
  presence: SeatPresenceRecordV1 | null,
  scope: { runId: string; subjectId: string },
  seatId: SeatIdV1,
): void {
  if (!presence) return;
  const { recordHash, ...base } = presence;
  if (
    presence.runId !== scope.runId
    || presence.seatId !== seatId
    || presence.humanControllerId !== scope.subjectId
    || !Number.isSafeInteger(presence.signalSequence)
    || presence.signalSequence < 0
    || !["ONLINE", "DISCONNECTED"].includes(presence.status)
    || !/^[a-f0-9]{64}$/.test(recordHash)
    || sha256Canonical(base) !== recordHash
  ) {
    failLiveAdapter(
      ERROR.AUTHORITY_MISMATCH,
      "PressureSeatControlSnapshot.latestPresence",
      "VIEWER_BINDING_OR_HASH",
    );
  }
}

function requiredText(value: string, authority: string): string {
  if (!value.trim()) return failLiveAdapter(ERROR.RECORD_INVALID, authority, "EMPTY");
  return value;
}
