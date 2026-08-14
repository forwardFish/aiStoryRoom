import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  validateGenesisSnapshotV1,
  validateWorldStateV1,
  type GenesisSnapshotV1,
  type KnowledgeStateV1,
  type SeatArcStateV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterPackageV1 } from "./loader";
import type { LoadedSangtianPressureChapterPackageV1 } from "./types";

export interface CompileP0GenesisInputV1 {
  runId: string;
  routeHash: string;
  orchestrationPackageSha256: string;
  package?: LoadedSangtianPressureChapterPackageV1;
}

/** P0 establishes Genesis only and always leaves worldSequence at zero. */
export function compileP0GenesisSnapshotV1(
  input: CompileP0GenesisInputV1,
): GenesisSnapshotV1 {
  const loaded = input.package ?? loadSangtianPressureChapterPackageV1();
  const initialWorldState = compileInitialWorldState(loaded);
  const withoutHash = {
    schemaVersion: "sangtian_genesis_snapshot_v1" as const,
    runId: input.runId,
    nodeId: "P0" as const,
    sequence: 0 as const,
    routeHash: input.routeHash,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageSha256: input.orchestrationPackageSha256,
    initialWorldState,
  };
  return validateGenesisSnapshotV1({
    ...withoutHash,
    genesisHash: sha256Canonical(withoutHash),
  }, {
    runId: input.runId,
    routeHash: input.routeHash,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageSha256: input.orchestrationPackageSha256,
  });
}

export function compileInitialWorldState(
  loaded: LoadedSangtianPressureChapterPackageV1,
): WorldStateV1 {
  const genesis = loaded.content.genesis;
  const trackWithoutHash = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(
      genesis.tracks.map((track) => [track.trackId, track.initialValue]),
    ) as WorldStateV1["tracks"]["values"],
  };
  const knowledgeBySeat = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const source = genesis.knowledgeBySeat.find((item) => item.seatId === seatId)!;
    const withoutHash: Omit<KnowledgeStateV1, "stateHash"> = {
      seatId,
      knownFactRefs: [...source.knownFactRefs],
      secretRefs: [...source.secretRefs],
      disclosedToSeatIds: [],
    };
    return [seatId, { ...withoutHash, stateHash: sha256Canonical(withoutHash) }];
  })) as Record<SeatIdV1, KnowledgeStateV1>;
  const seatArcs = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const withoutHash: Omit<SeatArcStateV1, "stateHash"> = {
      seatId,
      arcStage: "P0_GENESIS",
      publicGoalProgress: 0,
      privateGoalProgress: 0,
      gainRefs: [],
      lossRefs: [],
      costRefs: [],
    };
    return [seatId, { ...withoutHash, stateHash: sha256Canonical(withoutHash) }];
  })) as Record<SeatIdV1, SeatArcStateV1>;
  const withoutHash: Omit<WorldStateV1, "stateHash"> = {
    schemaVersion: "sangtian_world_state_v1",
    worldSequence: 0,
    // `frozen.P0.LOCKED` is the runtime lifecycle fence, not an authored
    // story fact.  The accepted package supplies the historical facts while
    // the Genesis compiler owns this invariant so every production P0 enters
    // N1 from the same immutable baseline.
    factValues: {
      ...structuredClone(genesis.factValues),
      "frozen.P0.LOCKED": true,
    },
    resources: Object.fromEntries(
      genesis.resources.map((resource) => [resource.resourceId, resource.initialValue]),
    ),
    tracks: {
      ...trackWithoutHash,
      stateHash: sha256Canonical(trackWithoutHash),
    },
    objects: genesis.objects.map((item) => ({
      objectId: item.objectId,
      version: 1,
      stateCode: "P0_INITIAL",
      holderSeatId: item.initialHolderSeatId,
      quantity: null,
      tags: [item.sourceStatus],
      factRefs: [item.objectId],
    })).sort((left, right) => compareCanonicalText(left.objectId, right.objectId)),
    knowledgeBySeat,
    evidence: genesis.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      version: 1,
      status: "ACTIVE" as const,
      holderSeatIds: [...item.holderSeatIds],
      supportsFactRefs: [...item.supportsFactRefs],
      visibilityPolicyRef: item.visibilityPolicyRef,
    })).sort((left, right) => compareCanonicalText(left.evidenceId, right.evidenceId)),
    responsibilities: genesis.responsibilities.map((item) => ({
      responsibilityId: item.responsibilityId,
      subjectSeatId: item.subjectSeatId,
      sourceFactRefs: [...item.sourceFactRefs],
      level: item.level,
      status: "OPEN" as const,
    })).sort((left, right) => compareCanonicalText(left.responsibilityId, right.responsibilityId)),
    seatArcs,
  };
  return validateWorldStateV1({
    ...withoutHash,
    stateHash: sha256Canonical(withoutHash),
  });
}
