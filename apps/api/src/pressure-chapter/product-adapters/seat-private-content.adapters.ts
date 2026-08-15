import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type RunRouteSnapshotV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import type { PrismaService } from "../../prisma.service";
import { validateCommittedGenesis } from "../genesis";
import type {
  SeatControlSnapshotV1,
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
import { SANGTIAN_INITIAL_RESOURCES_BY_SEAT_V1 } from "../initial-player-state/sangtian-initial-player-state";

/**
 * Read-through projection for the currently authorized seat. It reads one
 * Genesis authority and never loads another seat's private payload.
 */
export class ContentBoundSeatPrivateProjectionPortV1
implements SeatPrivateProjectionPort {
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
      return compileSangtianSeatPrivateProjectionFromCapturedAuthoritiesV1({
        runId: input.runId,
        seatId: input.seatId,
        routeSnapshot: route.snapshot,
        seatAuthority: seatControl,
        world: genesis.record.snapshot.initialWorldState,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

/** Package-only compiler for callers that already captured all durable authorities. */
export function compileSangtianSeatPrivateProjectionFromCapturedAuthoritiesV1(input: Readonly<{
  runId: string;
  seatId: SeatIdV1;
  routeSnapshot: RunRouteSnapshotV1;
  seatAuthority: SeatControlSnapshotV1;
  world: WorldStateV1;
}>): SeatPrivateProjectionRecordV1 {
  assertSeat(input.seatId);
  assertPublishedTokenPolicyV1();
  const content = loadSangtianPressureChapterPackageV1();
  const resourceCatalog = compileResourceCatalogV1(
    SANGTIAN_INITIAL_RESOURCES_BY_SEAT_V1[input.seatId],
  );
  const knowledge = input.world.knowledgeBySeat[input.seatId];
  const seat = content.content.genesis.seats.find(
    (candidate) => candidate.seatId === input.seatId,
  );
  if (!knowledge || !seat) {
    return failPressureProductAdapterV1(
      ERROR.AUTHORITY_NOT_FOUND,
      "SeatPrivateProjection.seat",
      input.seatId,
    );
  }
  if (
    input.seatAuthority.runId !== input.runId
    || input.seatAuthority.routeHash !== input.routeSnapshot.routeHash
    || input.routeSnapshot.contentPackageVersion !== content.manifest.packageVersion
    || input.routeSnapshot.contentPackageSha256 !== content.manifest.contentSha256
    || knowledge.seatId !== input.seatId
  ) {
    return failPressureProductAdapterV1(
      ERROR.AUTHORITY_MISMATCH,
      "SeatPrivateProjection.content",
      "PACKAGE_OR_SEAT",
    );
  }
  const judgment = compilePlayerSafeSeatJudgmentV1(
    seat,
    content.content.genesis.objects,
  );
  const payload = {
    schemaVersion: "pressure_game_viewer_private_payload_v1" as const,
    situation: {
      goal: seat.institutionalMission,
      risk: content.content.genesis.pressure,
      judgment,
    },
    resources: resourceCatalog.resources.map((resource) => ({
      resourceId: resource.resourceId,
      value: resource.value,
      displayValue: resource.displayValue,
    })),
    tokens: [],
  };
  return {
    schemaVersion: "pressure_seat_private_projection_record_v1",
    runId: input.runId,
    seatId: input.seatId,
    sourceAuthorityHash: input.seatAuthority.stateHash,
    projectionVersion: resourceCatalog.projectionVersion,
    payload,
    payloadHash: sha256Canonical(payload),
  };
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
      return this.readCatalogFromRoute({
        routeSnapshot: route.snapshot,
        seatId: input.seatId,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** Package-only projection for callers that already captured the route authority. */
  readCatalogFromRoute(input: {
    routeSnapshot: Readonly<{
      contentPackageVersion: string;
      contentPackageSha256: string;
    }>;
    seatId: SeatIdV1;
  }): PressureSeatViewerPresentationCatalogV1 {
    assertSeat(input.seatId);
    if (
      input.routeSnapshot.contentPackageVersion !== this.content.manifest.packageVersion
      || input.routeSnapshot.contentPackageSha256 !== this.content.manifest.contentSha256
    ) {
      return failPressureProductAdapterV1(
        ERROR.AUTHORITY_MISMATCH,
        "SeatPresentationCatalog.content",
        "PACKAGE",
      );
    }
    const roleNames = Object.fromEntries(
      this.content.content.genesis.seats.map((seat) => [seat.seatId, seat.displayName]),
    );
    if (!roleNames[input.seatId]?.trim()) {
      return failPressureProductAdapterV1(
        ERROR.AUTHORITY_NOT_FOUND,
        "SeatPresentationCatalog.seat",
        input.seatId,
      );
    }
    const resourceCatalog = compileResourceCatalogV1(
      SANGTIAN_INITIAL_RESOURCES_BY_SEAT_V1[input.seatId],
    );
    return {
      roleNames: Object.freeze(roleNames),
      resources: resourceCatalog.presentation,
      tokens: Object.freeze({}),
    };
  }
}

function compilePlayerSafeSeatJudgmentV1(
  seat: Readonly<{ displayName: string; persistentObjectRefs: string[] }>,
  objects: ReadonlyArray<Readonly<{ objectId: string; name: string }>>,
): string {
  const objectNames = new Map(objects.map((object) => [object.objectId, object.name]));
  const names = seat.persistentObjectRefs.map((objectRef) => {
    const name = objectNames.get(objectRef);
    if (!name?.trim()) {
      return failPressureProductAdapterV1(
        ERROR.AUTHORITY_NOT_FOUND,
        "SeatPrivateProjection.persistentObject",
        objectRef,
      );
    }
    return name;
  });
  if (!names.length) {
    return failPressureProductAdapterV1(
      ERROR.RECORD_INVALID,
      "SeatPrivateProjection.persistentObjects",
      seat.displayName,
    );
  }
  return `当前可调用：${names.join("、")}。`;
}

function compileResourceCatalogV1(
  resources: ReadonlyArray<Readonly<{
    resourceId: string;
    label: string;
    value: number;
    displayValue: string;
  }>>,
) {
  const presentation = Object.freeze(Object.fromEntries(
    resources.map((resource) => [
      resource.resourceId,
      Object.freeze({ label: resource.label }),
    ]),
  ));
  const compiler = Object.freeze({
    schemaVersion: "sangtian_genesis_seat_private_projection_compiler_v1" as const,
    resources: resources.map((resource) => ({
      resourceId: resource.resourceId,
      label: resource.label,
      value: resource.value,
      displayValue: resource.displayValue,
    })),
    tokenPolicy: "NONE" as const,
  });
  return Object.freeze({
    resources,
    presentation,
    projectionVersion: `sangtian-genesis-seat-private-v1:${sha256Canonical(compiler)}`,
  });
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
