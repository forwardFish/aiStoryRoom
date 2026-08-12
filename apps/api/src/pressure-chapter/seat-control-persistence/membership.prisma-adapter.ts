import { PRESSURE_CHAPTER_SEAT_IDS_V1, type SeatIdV1 } from "@ai-story/shared";
import {
  PRESSURE_LIVE_ADAPTER_ERROR_CODES as ERROR,
  failLiveAdapter,
} from "../live-adapters/errors";

export interface PressureSeatViewerMembershipV1 {
  roomId: string;
  runId: string;
  subjectId: string;
  seatId: SeatIdV1;
  humanControllerId: string;
}

export interface PressureSeatViewerMembershipReaderPortV1 {
  readSubjectMembership(input: {
    runId: string;
    subjectId: string;
  }): Promise<PressureSeatViewerMembershipV1 | null>;
}

interface StoryPlayerMembershipRowV1 {
  id: string;
  runId: string;
  userId: string | null;
  playerType: string;
  status: string;
  role: {
    roleKey: string;
  } | null;
}

export interface PressureSeatMembershipReadPrismaLikeV1 {
  storyPlayer: {
    findUnique(input: {
      where: { runId_userId: { runId: string; userId: string } };
      select: {
        id: true;
        runId: true;
        userId: true;
        playerType: true;
        status: true;
        role: {
          select: {
            roleKey: true;
          };
        };
      };
    }): Promise<StoryPlayerMembershipRowV1 | null>;
  };
}

export class PrismaPressureSeatViewerMembershipReaderV1
implements PressureSeatViewerMembershipReaderPortV1 {
  constructor(
    private readonly prisma: PressureSeatMembershipReadPrismaLikeV1,
  ) {}

  async readSubjectMembership(input: {
    runId: string;
    subjectId: string;
  }): Promise<PressureSeatViewerMembershipV1 | null> {
    if (!input.runId.trim() || !input.subjectId.trim()) {
      return failLiveAdapter(ERROR.SUBJECT_FORBIDDEN, "StoryPlayer", "EMPTY_SCOPE");
    }
    const row = await this.prisma.storyPlayer.findUnique({
      where: {
        runId_userId: {
          runId: input.runId,
          userId: input.subjectId,
        },
      },
      select: {
        id: true,
        runId: true,
        userId: true,
        playerType: true,
        status: true,
        role: {
          select: {
            roleKey: true,
          },
        },
      },
    });
    if (!row) return null;
    if (
      row.runId !== input.runId
      || row.userId !== input.subjectId
      || row.playerType !== "human"
      || row.status !== "active"
      || !row.role
      || !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(row.role.roleKey as SeatIdV1)
    ) {
      return failLiveAdapter(ERROR.SUBJECT_FORBIDDEN, "StoryPlayer", "MEMBERSHIP_BINDING");
    }
    return {
      roomId: input.runId,
      runId: input.runId,
      subjectId: input.subjectId,
      seatId: row.role.roleKey as SeatIdV1,
      // Seat Control is initialized with the authenticated user's stable id
      // as its humanControllerId. StoryPlayer.id is only the membership-row
      // identity and must never be used as the controller authority.
      humanControllerId: row.userId,
    };
  }
}
