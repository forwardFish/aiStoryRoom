import type {
  FrozenRunRouteV1,
  SangtianPressureResultV1,
  SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "./errors";
import type {
  PressureResultReadModelSourceV1,
  ResultViewerContextV1,
  StoredPressureNarrativeV1,
} from "./ports";

export interface ViewerSafePressureProjectionV1 {
  envelopeMetadata: {
    roomId: string;
    runId: string;
    worldId: "sangtian";
    frozenRoute: FrozenRunRouteV1;
    resultContractRegistryVersion: string;
    payloadSchemaVersion: string;
    presentationSchemaVersion: string;
    rendererKey: string;
    authoritativeResultStatus: "FINALIZED";
    runtimeTerminalState: "FINALE_FROZEN";
    sourceCommitHash: string;
    decisionHash: string;
  };
  room: SangtianPressureResultV1["room"];
  route: SangtianPressureResultV1["route"];
  worldOutcome: SangtianPressureResultV1["worldOutcome"];
  tracks: SangtianPressureResultV1["tracks"];
  viewerSeat: SangtianPressureResultV1["viewerSeat"];
  visibleOutcomes: SangtianPressureResultV1["visibleOutcomes"];
  reveal: SangtianPressureResultV1["reveal"];
  narrative: Omit<StoredPressureNarrativeV1, "seatId">;
  replayHint: string;
  decisionHash: string;
}

/**
 * The only six-seat-to-viewer projection in the Result read path. Its return
 * type has no slot where another seat's verdict, gains, losses or private ACL
 * metadata can be represented.
 */
export class PressureResultAudienceProjectorV1 {
  project(
    source: Readonly<PressureResultReadModelSourceV1>,
    viewer: Readonly<ResultViewerContextV1>,
  ): ViewerSafePressureProjectionV1 {
    const authority = source.authority;
    if (viewer.runId !== authority.runId) {
      failPressureResultRead(ERROR.RESULT_AUDIENCE_VIOLATION, "viewer.runId", "SOURCE_MISMATCH");
    }
    const seat = authority.seatOutcomes.find((candidate) => candidate.seatId === viewer.seatId);
    const narrative = source.narratives.find((candidate) => candidate.seatId === viewer.seatId);
    if (!seat || !narrative) {
      failPressureResultRead(ERROR.RESULT_AUDIENCE_VIOLATION, "viewer.seatId", "SEAT_RESULT_MISSING");
    }

    const allowedImpacts = new Set(viewer.authorizedImpactIds);
    const visibleOutcomes = authority.impacts
      .filter(
        (impact) =>
          impact.visibility === "PUBLIC" ||
          (allowedImpacts.has(impact.outcomeId) &&
            impact.authorizedSeatIds.includes(viewer.seatId)),
      )
      .map(({ kind, outcomeId, title, summary, sourceRefs }) => ({
        kind,
        outcomeId,
        title,
        summary,
        sourceRefs: [...sourceRefs],
      }));

    const allowedReveals = new Set(viewer.authorizedRevealIds);
    const reveals = authority.reveals.filter(
      (candidate) =>
        allowedReveals.has(candidate.revealId) &&
        candidate.authorizedSeatIds.includes(viewer.seatId),
    );
    if (reveals.length > 1) {
      failPressureResultRead(
        ERROR.RESULT_AUDIENCE_VIOLATION,
        "resultSnapshot.reveals",
        "MULTIPLE_VIEWER_REVEALS",
      );
    }
    const reveal = reveals[0]
      ? {
          title: reveals[0].title,
          text: reveals[0].text,
          sourceRefs: [...reveals[0].sourceRefs],
        }
      : null;

    const safe: ViewerSafePressureProjectionV1 = {
      envelopeMetadata: {
        roomId: authority.roomId,
        runId: authority.runId,
        worldId: authority.worldId,
        frozenRoute: structuredClone(authority.frozenRoute),
        resultContractRegistryVersion: authority.resultContractRegistryVersion,
        payloadSchemaVersion: authority.payloadSchemaVersion,
        presentationSchemaVersion: authority.presentationSchemaVersion,
        rendererKey: authority.rendererKey,
        authoritativeResultStatus: "FINALIZED",
        runtimeTerminalState: "FINALE_FROZEN",
        sourceCommitHash: authority.sourceCommitHash,
        decisionHash: authority.decisionHash,
      },
      room: {
        roomId: authority.roomId,
        runId: authority.runId,
        worldId: authority.worldId,
        participantMode: authority.participantMode,
        completedAt: authority.completedAt,
      },
      route: {
        engineVersion: authority.frozenRoute.engineVersion,
        strategyVersion: authority.frozenRoute.strategyVersion,
        runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
        endgamePolicyVersion: authority.frozenRoute.endgamePolicyVersion,
        contentPackageVersion: authority.contentPackageVersion,
        contentPackageSha256: authority.contentPackageSha256,
      },
      // sourceRuleRef is server-side authority evidence, not part of the public
      // SangtianPressureResultV1 worldOutcome wire contract.
      worldOutcome: {
        outcomeId: authority.worldOutcome.outcomeId,
        title: authority.worldOutcome.title,
        verdictLine: authority.worldOutcome.verdictLine,
        summary: authority.worldOutcome.summary,
      },
      tracks: structuredClone(authority.tracks),
      viewerSeat: structuredClone(seat),
      visibleOutcomes,
      reveal,
      narrative: {
        status: narrative.status,
        text: narrative.text,
        contentHash: narrative.contentHash,
        sourceCommitHash: narrative.sourceCommitHash,
        sourceDecisionHash: narrative.sourceDecisionHash,
      },
      replayHint: authority.replayHint,
      decisionHash: authority.decisionHash,
    };
    return structuredClone(safe);
  }
}

export function isSeatAuthorizedForImpact(
  seatId: SeatIdV1,
  authorizedSeatIds: readonly SeatIdV1[],
): boolean {
  return authorizedSeatIds.includes(seatId);
}
