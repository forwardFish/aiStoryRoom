import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import type { PrismaService } from "../../prisma.service";
import { validateCommittedGenesis } from "../genesis";
import type {
  SeatPrivateProjectionPort,
  SeatPrivateProjectionRecordV1,
} from "../seat-control";
import type {
  PressureSeatViewerPresentationCatalogPortV1,
  PressureSeatViewerPresentationCatalogV1,
} from "../seat-control-persistence";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";
import { readPinnedPressureRouteV1 } from "./route-authority";
import {
  decodeSeatEnvelope,
  type PressureSeatSnapshotDelegateV1,
} from "../seat-control-persistence/envelope";

const RESOURCE_PRESENTATION_V1 = Object.freeze({
  "resource.credit": Object.freeze({ label: "信用" }),
  "resource.grain": Object.freeze({ label: "粮食" }),
  "resource.troops": Object.freeze({ label: "兵力" }),
});
const RESOURCE_IDS_V1 = Object.freeze(Object.keys(RESOURCE_PRESENTATION_V1).sort(compareCanonicalText));
const PRIVATE_PROJECTION_COMPILER_V1 = Object.freeze({
  schemaVersion: "sangtian_genesis_seat_private_projection_compiler_v1" as const,
  resources: RESOURCE_PRESENTATION_V1,
  tokenPolicy: "NONE" as const,
});
const PRIVATE_PROJECTION_VERSION_V1 =
  `sangtian-genesis-seat-private-v1:${sha256Canonical(PRIVATE_PROJECTION_COMPILER_V1)}`;

/**
 * Read-through projection for the currently authorized seat. It reads one
 * Genesis authority and never loads another seat's private payload.
 */
export class ContentBoundSeatPrivateProjectionPortV1
implements SeatPrivateProjectionPort {
  private readonly content = loadSangtianPressureChapterPackageV1();

  constructor(private readonly prisma: PrismaService) {
    assertPublishedTokenPolicyV1();
  }

  async readForSeat(input: {
    runId: string;
    seatId: SeatIdV1;
    sourceAuthorityHash: string;
  }): Promise<SeatPrivateProjectionRecordV1> {
    assertSeat(input.seatId);
    if (!/^[a-f0-9]{64}$/.test(input.sourceAuthorityHash)) {
      return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "sourceAuthorityHash");
    }
    return this.prisma.$transaction(async (tx) => {
      const route = await readPinnedPressureRouteV1(tx, input.runId);
      const [seatControlRow, genesisRow] = await Promise.all([
        (tx.pressureSeatControlSnapshot as unknown as PressureSeatSnapshotDelegateV1).findUnique({
          where: { runId: input.runId },
        }),
        tx.pressureGenesisCommit.findUnique({
          where: { runId: input.runId },
          select: { runId: true, commitManifestJson: true },
        }),
      ]);
      if (!seatControlRow || !genesisRow) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_NOT_FOUND, "SeatPrivateProjection.authority", input.runId);
      }
      const seatControl = decodeSeatEnvelope(seatControlRow).snapshot;
      let genesis;
      try {
        genesis = validateCommittedGenesis(
          genesisRow.commitManifestJson as unknown as Parameters<typeof validateCommittedGenesis>[0],
        );
      } catch (cause) {
        return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "PressureGenesisCommit.commitManifestJson", String(cause));
      }
      if (
        seatControl.runId !== input.runId
        || seatControl.routeHash !== route.snapshot.routeHash
        || seatControl.stateHash !== input.sourceAuthorityHash
        || genesisRow.runId !== input.runId
        || genesis.record.runId !== input.runId
        || genesis.record.commit.routeHash !== route.snapshot.routeHash
        || genesis.record.snapshot.genesisHash !== seatControl.genesisHash
      ) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "SeatPrivateProjection.authority", "ROUTE_GENESIS_CONTROL");
      }
      const world = genesis.record.snapshot.initialWorldState;
      const knowledge = world.knowledgeBySeat[input.seatId];
      const seat = this.content.content.genesis.seats.find((candidate) => candidate.seatId === input.seatId);
      if (!knowledge || !seat) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_NOT_FOUND, "SeatPrivateProjection.seat", input.seatId);
      }
      if (
        route.snapshot.contentPackageVersion !== this.content.manifest.packageVersion
        || route.snapshot.contentPackageSha256 !== this.content.manifest.contentSha256
        || knowledge.seatId !== input.seatId
      ) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "SeatPrivateProjection.content", "PACKAGE_OR_SEAT");
      }
      const resourceKeys = Object.keys(world.resources).sort(compareCanonicalText);
      if (sha256Canonical(resourceKeys) !== sha256Canonical(RESOURCE_IDS_V1)) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "SeatPrivateProjection.resources", "UNPUBLISHED_RESOURCE_CATALOG");
      }
      const payload = {
        schemaVersion: "pressure_game_viewer_private_payload_v1" as const,
        situation: {
          goal: seat.institutionalMission,
          risk: this.content.content.genesis.pressure,
          judgment: [...knowledge.knownFactRefs].sort(compareCanonicalText).join("；"),
        },
        resources: RESOURCE_IDS_V1.map((resourceId) => {
          const value = world.resources[resourceId];
          if (!Number.isFinite(value)) {
            return failPressureProductAdapterV1(ERROR.RECORD_INVALID, `WorldState.resources.${resourceId}`);
          }
          return { resourceId, value, displayValue: String(value) };
        }),
        tokens: [],
      };
      return {
        schemaVersion: "pressure_seat_private_projection_record_v1",
        runId: input.runId,
        seatId: input.seatId,
        sourceAuthorityHash: input.sourceAuthorityHash,
        projectionVersion: PRIVATE_PROJECTION_VERSION_V1,
        payload,
        payloadHash: sha256Canonical(payload),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

/** Frozen labels for the exact content-bound viewer payload above. */
export class SangtianFrozenSeatPresentationCatalogV1
implements PressureSeatViewerPresentationCatalogPortV1 {
  private readonly content = loadSangtianPressureChapterPackageV1();

  constructor(private readonly prisma: PrismaService) {
    assertPublishedTokenPolicyV1();
  }

  async readCatalog(input: {
    runId: string;
    seatId: SeatIdV1;
  }): Promise<PressureSeatViewerPresentationCatalogV1 | null> {
    assertSeat(input.seatId);
    return this.prisma.$transaction(async (tx) => {
      const route = await readPinnedPressureRouteV1(tx, input.runId);
      if (
        route.snapshot.contentPackageVersion !== this.content.manifest.packageVersion
        || route.snapshot.contentPackageSha256 !== this.content.manifest.contentSha256
      ) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "SeatPresentationCatalog.content", "PACKAGE");
      }
      const roleNames = Object.fromEntries(
        this.content.content.genesis.seats.map((seat) => [seat.seatId, seat.displayName]),
      );
      if (!roleNames[input.seatId]?.trim()) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_NOT_FOUND, "SeatPresentationCatalog.seat", input.seatId);
      }
      return {
        roleNames: Object.freeze(roleNames),
        resources: RESOURCE_PRESENTATION_V1,
        tokens: Object.freeze({}),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function assertSeat(seatId: SeatIdV1): void {
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId)) {
    failPressureProductAdapterV1(ERROR.RECORD_INVALID, "seatId");
  }
}

function assertPublishedTokenPolicyV1(): void {
  const release = loadPublishedSangtianActionReleaseV1();
  const resourcePolicy = release.policy.resourcePolicy;
  if (
    !resourcePolicy
    || typeof resourcePolicy !== "object"
    || Array.isArray(resourcePolicy)
    || (resourcePolicy as { mode?: unknown }).mode !== "NONE"
  ) {
    failPressureProductAdapterV1(
      ERROR.AUTHORITY_MISMATCH,
      "release.actionEffectPolicy.resourcePolicy",
      "EXPECTED_NONE",
    );
  }
}
