import type { GenesisAtomicCommitPort } from "../genesis";
import {
  CommittedGenesisSeatControlAuthorityReaderV1,
} from "../live-adapters/seat-control.adapters";
import type { PrismaService } from "../../prisma.service";
import {
  PrismaSeatControlAuthorityPortV1,
  type PressureSeatAuthorityPrismaLikeV1,
} from "./authority.prisma-adapter";
import {
  PrismaPressureSeatViewerMembershipReaderV1,
  type PressureSeatMembershipReadPrismaLikeV1,
} from "./membership.prisma-adapter";
import {
  PrismaFrozenSeatControlPolicyReaderV1,
  PrismaSeatControlDecisionAuthorityPortV1,
  type PressureSeatPolicyProofPrismaLikeV1,
} from "./policy-proof.prisma-adapter";
import {
  PrismaSeatDefaultDirectivePortV1,
  PrismaSeatPresencePortV1,
  PrismaSeatPrivateProjectionPortV1,
  type PressureSeatAuxPrismaLikeV1,
} from "./presence-default-private.prisma-adapter";
import {
  PrismaPressureGameViewerReaderV1,
  type PressureSeatViewerPresentationCatalogPortV1,
} from "./viewer.prisma-adapter";

export interface PressureSeatControlPersistenceDependenciesV1 {
  prisma: PrismaService &
    PressureSeatAuthorityPrismaLikeV1 &
    PressureSeatMembershipReadPrismaLikeV1 &
    PressureSeatPolicyProofPrismaLikeV1 &
    PressureSeatAuxPrismaLikeV1;
  genesis: Pick<GenesisAtomicCommitPort, "readCommitted">;
  presentationCatalog: PressureSeatViewerPresentationCatalogPortV1;
}

export function createPressureSeatControlPersistenceAdaptersV1(
  dependencies: PressureSeatControlPersistenceDependenciesV1,
) {
  const authority = new PrismaSeatControlAuthorityPortV1(dependencies.prisma);
  const presence = new PrismaSeatPresencePortV1(dependencies.prisma);
  const privateProjection = new PrismaSeatPrivateProjectionPortV1(dependencies.prisma);
  const memberships = new PrismaPressureSeatViewerMembershipReaderV1(
    dependencies.prisma,
  );
  return {
    authority,
    genesis: new CommittedGenesisSeatControlAuthorityReaderV1(
      dependencies.genesis,
    ),
    policies: new PrismaFrozenSeatControlPolicyReaderV1(dependencies.prisma),
    defaults: new PrismaSeatDefaultDirectivePortV1(dependencies.prisma),
    decisionAuthority: new PrismaSeatControlDecisionAuthorityPortV1(
      dependencies.prisma,
    ),
    presence,
    privateProjection,
    memberships,
    viewer: new PrismaPressureGameViewerReaderV1(
      memberships,
      authority,
      presence,
      privateProjection,
      dependencies.presentationCatalog,
    ),
  };
}
