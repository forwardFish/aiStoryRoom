import {
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import { SEAT_CONTROL_ERROR_CODES as ERROR, failSeatControl } from "./errors";
import type {
  OwnSeatControlProjectionV1,
  SeatAuthorityRecordV1,
  SeatControlAuthorityPort,
  SeatControlSnapshotV1,
  SeatPresencePort,
  SeatPrivateProjectionPort,
  SeatPrivateViewV1,
  SeatProjectionViewerV1,
} from "./types";

/**
 * Seat-scoped audience boundary. The private port is deliberately incapable of
 * returning an all-seat payload, so Provider/API adapters cannot accidentally
 * serialize another seat's knowledge, covert facts, controller IDs, or fences.
 */
export class SeatControlAudienceProjector {
  constructor(
    private readonly authority: SeatControlAuthorityPort,
    private readonly presence: SeatPresencePort,
    private readonly privateProjection: SeatPrivateProjectionPort,
  ) {}

  async project(
    runId: string,
    viewer: SeatProjectionViewerV1,
  ): Promise<SeatPrivateViewV1> {
    const snapshot = await this.authority.readSnapshot(runId);
    if (!snapshot) failSeatControl(ERROR.RUN_NOT_INITIALIZED, runId);
    assertSnapshotHash(snapshot);
    const seat = authorizeViewer(snapshot, viewer);
    const privateRecord = await this.privateProjection.readForSeat({
      runId,
      seatId: seat.seatId,
      sourceAuthorityHash: snapshot.stateHash,
    });
    if (
      privateRecord.schemaVersion !==
        "pressure_seat_private_projection_record_v1" ||
      privateRecord.runId !== runId ||
      privateRecord.seatId !== seat.seatId ||
      privateRecord.sourceAuthorityHash !== snapshot.stateHash ||
      typeof privateRecord.projectionVersion !== "string" ||
      privateRecord.projectionVersion.trim().length === 0 ||
      !isSha256(privateRecord.payloadHash) ||
      sha256Canonical(privateRecord.payload) !== privateRecord.payloadHash
    ) {
      failSeatControl(ERROR.PRIVATE_PROJECTION_INVALID, seat.seatId);
    }

    const presenceRecord =
      viewer.kind === "HUMAN" && seat.originalHumanControllerId
        ? await this.presence.readForSeat(
            runId,
            seat.seatId,
            viewer.humanControllerId,
          )
        : null;
    const viewerIsActive =
      viewer.kind === "ACTIVE_SEAT_CONTROLLER" ||
      (seat.mode === "HUMAN_ACTIVE" &&
        seat.activeControllerId === viewer.humanControllerId);
    const ownSeat: OwnSeatControlProjectionV1 = {
      seatId: seat.seatId,
      controllerKind: seat.mode === "HUMAN_ACTIVE" ? "HUMAN" : "AI",
      controlEpoch: seat.controlEpoch,
      canSubmit: viewerIsActive,
      canReclaim:
        viewer.kind === "HUMAN" &&
        seat.mode === "AI_ACTIVE" &&
        snapshot.frozenPolicy.humanReclaimAllowed,
      submissionFenceToken: viewerIsActive ? seat.submissionFenceToken : null,
      reclaimFenceToken:
        viewer.kind === "HUMAN" && seat.mode === "AI_ACTIVE"
          ? seat.reclaimFenceToken
          : null,
      presence: presenceRecord?.status ?? null,
      privateProjectionVersion: privateRecord.projectionVersion,
      privatePayload: structuredClone(privateRecord.payload),
      privatePayloadHash: privateRecord.payloadHash,
    };
    const publicSeats = snapshot.seatControls
      .map((control) => ({
        seatId: control.seatId,
        controllerKind:
          control.mode === "HUMAN_ACTIVE" ? ("HUMAN" as const) : ("AI" as const),
        controlEpoch: control.controlEpoch,
      }))
      .sort((left, right) => compareCanonicalText(left.seatId, right.seatId));
    const base = {
      schemaVersion: "pressure_seat_private_view_v1" as const,
      runId,
      participantMode: snapshot.participantMode,
      publicSeats,
      ownSeat,
      sourceAuthorityHash: snapshot.stateHash,
    };
    return { ...base, viewHash: sha256Canonical(base) };
  }
}

function authorizeViewer(
  snapshot: SeatControlSnapshotV1,
  viewer: SeatProjectionViewerV1,
): SeatAuthorityRecordV1 {
  if (viewer.kind === "HUMAN") {
    if (
      typeof viewer.humanControllerId !== "string" ||
      viewer.humanControllerId.trim().length === 0
    ) {
      failSeatControl(ERROR.CONTROLLER_FORBIDDEN, "EMPTY_HUMAN_VIEWER");
    }
    const seat = snapshot.seatControls.find(
      (control) =>
        control.originalHumanControllerId === viewer.humanControllerId,
    );
    if (!seat) failSeatControl(ERROR.CONTROLLER_FORBIDDEN, "HUMAN_VIEWER");
    return seat;
  }

  const seat = snapshot.seatControls.find(
    (control) => control.seatId === viewer.seatId,
  );
  if (
    !seat ||
    seat.activeControllerId !== viewer.controllerId ||
    seat.controlEpoch !== viewer.controlEpoch ||
    seat.submissionFenceToken !== viewer.submissionFenceToken
  ) {
    failSeatControl(ERROR.CONTROLLER_FORBIDDEN, "ACTIVE_CONTROLLER_VIEWER");
  }
  return seat;
}

function assertSnapshotHash(snapshot: SeatControlSnapshotV1): void {
  if (!isSha256(snapshot.stateHash)) {
    failSeatControl(ERROR.PORT_RESULT_INVALID, "SNAPSHOT_STATE_HASH");
  }
  const { stateHash, ...base } = snapshot;
  if (sha256Canonical(base) !== stateHash) {
    failSeatControl(ERROR.PORT_RESULT_INVALID, "SNAPSHOT_HASH_MISMATCH");
  }
}
