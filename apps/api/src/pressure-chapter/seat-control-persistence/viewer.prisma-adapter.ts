import type { SeatIdV1 } from "@ai-story/shared";
import type { PressureGameViewerReaderPort, PressureGameViewerSourceV1 } from "../game-projection/contracts";
import {
  PRESSURE_LIVE_ADAPTER_ERROR_CODES as ERROR,
  failLiveAdapter,
} from "../live-adapters/errors";
import { SeatControlAudienceProjector } from "../seat-control/audience-projector";
import type {
  SeatControlAuthorityPort,
  SeatPresencePort,
  SeatPrivateProjectionPort,
} from "../seat-control/types";
import type {
  PressureSeatViewerMembershipReaderPortV1,
} from "./membership.prisma-adapter";

export interface PressureSeatViewerPresentationCatalogV1 {
  roleNames: Readonly<Record<string, string>>;
  resources: Readonly<Record<string, { label: string }>>;
  tokens: Readonly<Record<string, { label: string; description: string }>>;
}

export interface PressureSeatViewerPresentationCatalogPortV1 {
  readCatalog(input: {
    runId: string;
    seatId: SeatIdV1;
  }): Promise<PressureSeatViewerPresentationCatalogV1 | null>;
}

interface PrivateViewerResourceV1 {
  resourceId: string;
  value: number;
  displayValue: string;
}

interface PrivateViewerTokenV1 {
  tokenId: string;
  quantity: number;
  available: boolean;
}

interface PressureSeatGameViewerPrivatePayloadV1 {
  schemaVersion: "pressure_game_viewer_private_payload_v1";
  situation: {
    goal: string;
    risk: string;
    judgment: string;
  };
  resources: PrivateViewerResourceV1[];
  tokens: PrivateViewerTokenV1[];
}

export class PrismaPressureGameViewerReaderV1
implements PressureGameViewerReaderPort {
  private readonly projector: SeatControlAudienceProjector;

  constructor(
    private readonly memberships: PressureSeatViewerMembershipReaderPortV1,
    private readonly authority: SeatControlAuthorityPort,
    presence: SeatPresencePort,
    privateProjection: SeatPrivateProjectionPort,
    private readonly catalog: PressureSeatViewerPresentationCatalogPortV1,
  ) {
    this.projector = new SeatControlAudienceProjector(
      authority,
      presence,
      privateProjection,
    );
  }

  async readViewer(input: {
    runId: string;
    subjectId: string;
  }): Promise<PressureGameViewerSourceV1 | null> {
    const membership = await this.memberships.readSubjectMembership(input);
    if (!membership) return null;
    const snapshot = await this.authority.readSnapshot(input.runId);
    if (!snapshot) {
      return failLiveAdapter(
        ERROR.CONFIGURATION_REQUIRED,
        "SeatControlAuthorityPort",
        "SNAPSHOT_MISSING",
      );
    }

    const projected = await this.projector.project(input.runId, {
      kind: "HUMAN",
      humanControllerId: membership.humanControllerId,
    });
    if (
      projected.runId !== snapshot.runId
      || projected.sourceAuthorityHash !== snapshot.stateHash
      || projected.ownSeat.seatId !== membership.seatId
    ) {
      return failLiveAdapter(
        ERROR.PRIVATE_PROJECTION_UNAVAILABLE,
        "SeatControlAudienceProjector",
        "VIEWER_SCOPE_MISMATCH",
      );
    }
    const payload = decodePrivatePayload(projected.ownSeat.privatePayload);
    const catalog = await this.catalog.readCatalog({
      runId: input.runId,
      seatId: membership.seatId,
    });
    if (!catalog) {
      return failLiveAdapter(
        ERROR.CONFIGURATION_REQUIRED,
        "PressureSeatViewerPresentationCatalogPortV1",
        "MISSING_PRESENTATION_CATALOG",
      );
    }

    const roleName = catalog.roleNames[membership.seatId];
    if (!roleName?.trim()) {
      return failLiveAdapter(
        ERROR.CONFIGURATION_REQUIRED,
        "PressureSeatViewerPresentationCatalogV1.roleNames",
        membership.seatId,
      );
    }

    return {
      roomId: membership.roomId,
      runId: membership.runId,
      routeHash: snapshot.routeHash,
      subjectId: membership.subjectId,
      viewer: {
        seatId: membership.seatId,
        roleName,
        control: {
          mode: projected.ownSeat.controllerKind === "HUMAN"
            ? "HUMAN_ACTIVE"
            : "AI_ACTIVE",
          controlEpoch: projected.ownSeat.controlEpoch,
          canSubmit: projected.ownSeat.canSubmit,
          canReclaim: projected.ownSeat.canReclaim,
          submissionFenceToken: projected.ownSeat.submissionFenceToken,
          reclaimFenceToken: projected.ownSeat.reclaimFenceToken,
        },
      },
      situation: structuredClone(payload.situation),
      resources: payload.resources.map((resource) => {
        const meta = catalog.resources[resource.resourceId];
        if (!meta?.label.trim()) {
          return failLiveAdapter(
            ERROR.CONFIGURATION_REQUIRED,
            "PressureSeatViewerPresentationCatalogV1.resources",
            resource.resourceId,
          );
        }
        return {
          resourceId: resource.resourceId,
          label: meta.label,
          value: resource.value,
          displayValue: resource.displayValue,
        };
      }),
      tokens: payload.tokens.map((token) => {
        const meta = catalog.tokens[token.tokenId];
        if (!meta?.label.trim() || !meta.description.trim()) {
          return failLiveAdapter(
            ERROR.CONFIGURATION_REQUIRED,
            "PressureSeatViewerPresentationCatalogV1.tokens",
            token.tokenId,
          );
        }
        return {
          tokenId: token.tokenId,
          label: meta.label,
          description: meta.description,
          quantity: token.quantity,
          available: token.available,
        };
      }),
    };
  }
}

function decodePrivatePayload(
  payload: Record<string, unknown>,
): PressureSeatGameViewerPrivatePayloadV1 {
  const candidate = payload as Partial<PressureSeatGameViewerPrivatePayloadV1>;
  if (
    candidate.schemaVersion !== "pressure_game_viewer_private_payload_v1"
    || !candidate.situation
    || typeof candidate.situation.goal !== "string"
    || typeof candidate.situation.risk !== "string"
    || typeof candidate.situation.judgment !== "string"
    || !Array.isArray(candidate.resources)
    || !Array.isArray(candidate.tokens)
  ) {
    return failLiveAdapter(
      ERROR.PRIVATE_PROJECTION_UNAVAILABLE,
      "PressureSeatPrivateProjection.payload",
      "INVALID_VIEWER_PAYLOAD",
    );
  }
  return candidate as PressureSeatGameViewerPrivatePayloadV1;
}
