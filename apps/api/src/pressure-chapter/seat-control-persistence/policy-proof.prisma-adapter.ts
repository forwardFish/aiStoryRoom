import { sha256Canonical } from "@ai-story/shared";
import {
  assertStoredRunRouteRecord,
  type StoredRunRouteRecordV1,
} from "../run-router";
import type {
  FrozenDefaultSourceProofV1,
  FrozenDeadlineTakeoverProofV1,
  FrozenSeatControlPolicyReaderPort,
  FrozenSeatControlPolicyV1,
  SeatControlDecisionAuthorityPort,
} from "../seat-control/types";
import {
  decodeSeatEnvelope,
  proofKey,
  type PressureSeatSnapshotPrismaV1,
} from "./envelope";

export interface PressureSeatPolicyProofPrismaLikeV1
extends PressureSeatSnapshotPrismaV1 {
  pressureRunRouteSnapshot: {
    findUnique(input: {
      where: { runId: string };
      select: { routeJson: true };
    }): Promise<{ routeJson: unknown } | null>;
  };
}

export class PrismaFrozenSeatControlPolicyReaderV1
implements FrozenSeatControlPolicyReaderPort {
  constructor(private readonly prisma: PressureSeatPolicyProofPrismaLikeV1) {}

  async readFrozenPolicy(runId: string): Promise<FrozenSeatControlPolicyV1 | null> {
    const row = await this.prisma.pressureSeatControlSnapshot.findUnique({
      where: { runId },
    });
    if (row) {
      return structuredClone(decodeSeatEnvelope(row).snapshot.frozenPolicy);
    }

    // Initialization cannot read its policy from PressureSeatControlSnapshot:
    // that row is the result of initialization. Derive the first immutable
    // policy from the already-frozen, lossless Run Route authority instead.
    const routeRow = await this.prisma.pressureRunRouteSnapshot.findUnique({
      where: { runId },
      select: { routeJson: true },
    });
    if (!routeRow) return null;
    const route = assertStoredRunRouteRecord(
      routeRow.routeJson as StoredRunRouteRecordV1,
    );
    if (route.runId !== runId) return null;
    return buildFrozenSeatControlPolicyFromRouteV1(route);
  }
}

export function buildFrozenSeatControlPolicyFromRouteV1(
  route: Readonly<StoredRunRouteRecordV1>,
): FrozenSeatControlPolicyV1 {
  const snapshot = route.snapshot;
  const sharedBinding = {
    schemaVersion: "pressure_seat_control_policy_binding_v1" as const,
    routeHash: snapshot.routeHash,
    runtimeContractVersion: snapshot.runtimeContractVersion,
    runtimeContractSha256: snapshot.runtimeContractSha256,
    controlTopologyVersion: snapshot.controlTopologyVersion,
  };
  const takeover = {
    ...sharedBinding,
    policyKind: "FROZEN_DEADLINE_TAKEOVER" as const,
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
  };
  const deterministicDefault = {
    ...sharedBinding,
    policyKind: "DETERMINISTIC_DEFAULT_PASS" as const,
    contentPackageVersion: snapshot.contentPackageVersion,
    contentPackageSha256: snapshot.contentPackageSha256,
  };
  const base = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "pressure-seat-control-policy-1.0.0",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "pressure.seat.deadline-takeover.v1",
    takeoverDeadlinePolicyHash: sha256Canonical(takeover),
    deterministicDefaultPolicyRef: "pressure.seat.deterministic-default.v1",
    deterministicDefaultPolicyHash: sha256Canonical(deterministicDefault),
    humanReclaimAllowed: true,
  };
  return { ...base, policyHash: sha256Canonical(base) };
}

export class PrismaSeatControlDecisionAuthorityPortV1
implements SeatControlDecisionAuthorityPort {
  constructor(private readonly prisma: PressureSeatPolicyProofPrismaLikeV1) {}

  async verifyFrozenDeadlineTakeover(input: {
    proof: FrozenDeadlineTakeoverProofV1;
    authorityStateHash: string;
    frozenPolicyHash: string;
  }): Promise<boolean> {
    return this.verify("DEADLINE_TAKEOVER", input);
  }

  async verifyFrozenDefaultSource(input: {
    proof: FrozenDefaultSourceProofV1;
    authorityStateHash: string;
    frozenPolicyHash: string;
  }): Promise<boolean> {
    return this.verify("DEFAULT_SOURCE", input);
  }

  private async verify(
    kind: "DEADLINE_TAKEOVER" | "DEFAULT_SOURCE",
    input: {
      proof: FrozenDeadlineTakeoverProofV1 | FrozenDefaultSourceProofV1;
      authorityStateHash: string;
      frozenPolicyHash: string;
    },
  ): Promise<boolean> {
    const row = await this.prisma.pressureSeatControlSnapshot.findUnique({
      where: { runId: input.proof.runId },
    });
    if (!row) return false;
    const stored = decodeSeatEnvelope(row).proofs[proofKey(kind, input.proof.proofHash)];
    return stored?.proofKind === kind
      && stored.authorityStateHash === input.authorityStateHash
      && stored.frozenPolicyHash === input.frozenPolicyHash
      && sha256Canonical(stored.proof) === sha256Canonical(input.proof);
  }
}
