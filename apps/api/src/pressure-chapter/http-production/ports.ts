export interface PressureChapterHttpProductionRouteRowV1 {
  runId: string;
  schemaVersion: string;
  engineVersion: string;
  strategyVersion: string;
  runtimeProfile: string;
}

export interface PressureChapterHttpProductionRunRowV1 {
  id: string;
  engineVersion: string;
  strategyVersion: string;
  pressureRouteSnapshot: PressureChapterHttpProductionRouteRowV1 | null;
}

export interface PressureChapterHttpProductionMembershipRowV1 {
  runId: string;
  userId: string | null;
  playerType: string;
  status: string;
}

/**
 * Deliberately read-only and narrower than PrismaService. In particular, this
 * capability cannot select another seat's role, secret, or private projection.
 */
export interface PressureChapterHttpProductionPrismaPortV1 {
  storyRun: {
    findUnique(input: {
      where: { id: string };
      select: {
        id: true;
        engineVersion: true;
        strategyVersion: true;
        pressureRouteSnapshot: {
          select: {
            runId: true;
            schemaVersion: true;
            engineVersion: true;
            strategyVersion: true;
            runtimeProfile: true;
          };
        };
      };
    }): Promise<PressureChapterHttpProductionRunRowV1 | null>;
  };
  storyPlayer: {
    findUnique(input: {
      where: { runId_userId: { runId: string; userId: string } };
      select: {
        runId: true;
        userId: true;
        playerType: true;
        status: true;
      };
    }): Promise<PressureChapterHttpProductionMembershipRowV1 | null>;
  };
}
