import { canonicalJson, contentTreeHash, sha256Bytes } from "./canonical";
import type {
  PressureSpineArtifactRecord,
  PressureSpineFileMap,
  PressureSpineManifestLock,
  PressureSpineRuntimeIndex,
  PressureSpineValidationOptions,
} from "./types";
import {
  PRESSURE_SPINE_IMPORTER_VERSION,
  PRESSURE_SPINE_SOURCE_DIRECTORY,
} from "./types";
import { assertPressureSpinePackage, pressureSpineInternal } from "./validator";

const { decode, asRec, asArr, asStr, strArr } = pressureSpineInternal;

export type BuildPressureSpineInput = {
  files: PressureSpineFileMap;
  worldId: string;
  runtimeProfile: string;
  registeredPackageVersion: string;
  sourcePackageSha256: string;
  sourcePackageByteSize: number;
  sourcePackageArchivePath: string;
  expectedSourceSha256: string;
  expectedSourceLineCount: number;
  sourceText?: string;
  legacyStrategyLocks: Record<string, string>;
  validation?: Pick<PressureSpineValidationOptions, "expectedNodeIds" | "expectedSeatCount">;
};

function json(files: PressureSpineFileMap, filePath: string): Record<string, unknown> {
  const bytes = files.get(filePath);
  if (!bytes) throw new Error(`CONTENT_REQUIRED_FILE_INVALID:${filePath}`);
  return JSON.parse(decode(bytes, filePath)) as Record<string, unknown>;
}

function jsonl(files: PressureSpineFileMap, filePath: string): Record<string, unknown>[] {
  const bytes = files.get(filePath);
  if (!bytes) throw new Error(`CONTENT_REQUIRED_FILE_INVALID:${filePath}`);
  return decode(bytes, filePath)
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const uniqueSorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort();

export function buildPressureSpineRuntimeIndex(input: BuildPressureSpineInput): PressureSpineRuntimeIndex {
  const report = assertPressureSpinePackage(input.files, {
    expectedSourceSha256: input.expectedSourceSha256,
    expectedSourceLineCount: input.expectedSourceLineCount,
    expectedNodeIds: input.validation?.expectedNodeIds,
    expectedSeatCount: input.validation?.expectedSeatCount,
    sourceText: input.sourceText,
    validateInventory: true,
    requireNativeAuditPass: true,
  });
  const manifest = json(input.files, "manifest.json");
  const seats = asArr(json(input.files, "global/seats.json").seats)
    .map(asRec)
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const actors = asArr(json(input.files, "global/actors.json").actors)
    .map(asRec)
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const objects = asArr(json(input.files, "global/objects.json").objects)
    .map(asRec)
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const handoffs = asArr(json(input.files, "global/knowledge-and-handoffs.json").handoffs)
    .map(asRec)
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const finale = json(input.files, "finale/ending-rules.json");
  const nodeIds = strArr(manifest.nodes);

  const claimIds: string[] = [];
  const adaptationDecisionIds: string[] = [];
  const sceneIds: string[] = [];
  const branchIds: string[] = [];
  const frozenResultIds: string[] = [];
  const openingProjectionIds: string[] = [];
  const objectVersionIds: string[] = [];
  const dialogueSeedIds: string[] = [];
  const nodes: PressureSpineRuntimeIndex["nodes"] = [];

  for (const nodeId of nodeIds) {
    const node = json(input.files, `nodes/${nodeId}/node.json`);
    const flow = json(input.files, `nodes/${nodeId}/scene-flow.json`);
    const seatContent = json(input.files, `nodes/${nodeId}/seat-content.json`);
    const settlement = json(input.files, `nodes/${nodeId}/settlement.json`);
    const adaptations = json(input.files, `nodes/${nodeId}/adaptations.json`);
    const claims = jsonl(input.files, `nodes/${nodeId}/source-evidence.jsonl`);

    claimIds.push(...claims.map((claim) => asStr(claim.claimId)));
    adaptationDecisionIds.push(
      ...asArr(adaptations.adaptations).map(asRec).map((item) => asStr(item?.adaptationDecisionId)),
    );

    const scenes = asArr(flow.scenes)
      .map(asRec)
      .filter((value): value is Record<string, unknown> => Boolean(value));
    sceneIds.push(...scenes.map((scene) => asStr(scene.sceneId)));
    for (const scene of scenes) {
      for (const variant of asArr(scene.openingProjectionVariants)
        .map(asRec)
        .filter((value): value is Record<string, unknown> => Boolean(value))) {
        openingProjectionIds.push(asStr(variant.openingProjectionId));
      }
    }

    for (const seat of asArr(seatContent.seats)
      .map(asRec)
      .filter((value): value is Record<string, unknown> => Boolean(value))) {
      for (const dialogue of asArr(seat.dialogueSeeds)
        .map(asRec)
        .filter((value): value is Record<string, unknown> => Boolean(value))) {
        dialogueSeedIds.push(asStr(dialogue.dialogueSeedId));
      }
    }

    const branches = asArr(settlement.branches)
      .map(asRec)
      .filter((value): value is Record<string, unknown> => Boolean(value));
    branchIds.push(...branches.map((branch) => asStr(branch.branchId)));
    frozenResultIds.push(...branches.map((branch) => asStr(branch.frozenResultId)));
    for (const branch of branches) {
      for (const outcome of asArr(branch.objectOutcomes)
        .map(asRec)
        .filter((value): value is Record<string, unknown> => Boolean(value))) {
        objectVersionIds.push(asStr(outcome.versionId));
      }
    }

    const budget = asRec(node.actionBudget) || {};
    nodes.push({
      nodeId,
      sequence: Number(node.sequence),
      nextNodeId: typeof node.nextNodeId === "string" ? node.nextNodeId : null,
      actionBudget: {
        preparePerSeat: Number(budget.preparePerSeat || 0),
        commitPerSeat: Number(budget.commitPerSeat || 0),
        reactionPerSeat: Number(budget.reactionPerSeat || 0),
      },
      contestedObjectIds: uniqueSorted([
        ...strArr(node.contestedObjectIds),
        ...strArr(node.secondaryObjectIds),
      ]),
      branchIds: uniqueSorted(branches.map((branch) => asStr(branch.branchId))),
      frozenResultIds: uniqueSorted(branches.map((branch) => asStr(branch.frozenResultId))),
      openingProjectionIds: uniqueSorted(
        scenes.flatMap((scene) =>
          asArr(scene.openingProjectionVariants)
            .map(asRec)
            .map((variant) => asStr(variant?.openingProjectionId)),
        ),
      ),
      files: {
        node: `source/nodes/${nodeId}/node.json`,
        sceneFlow: `source/nodes/${nodeId}/scene-flow.json`,
        seatContent: `source/nodes/${nodeId}/seat-content.json`,
        npcDefaults: `source/nodes/${nodeId}/npc-defaults.json`,
        settlement: `source/nodes/${nodeId}/settlement.json`,
        sourceEvidence: `source/nodes/${nodeId}/source-evidence.jsonl`,
        adaptations: `source/nodes/${nodeId}/adaptations.json`,
      },
    });
  }

  return {
    schemaVersion: "pressure_spine_runtime_index_v1",
    worldId: input.worldId,
    runtimeProfile: input.runtimeProfile,
    registeredPackageVersion: input.registeredPackageVersion,
    packageId: asStr(manifest.packageId),
    packageVersion: asStr(manifest.packageVersion),
    sourceSha256: asStr(manifest.sourceSha256).toUpperCase(),
    nodeIds: [...nodeIds],
    seatIds: seats.map((seat) => asStr(seat.seatId)),
    roleKeys: seats.map((seat) => asStr(seat.roleKey)),
    actorIds: uniqueSorted(actors.map((actor) => asStr(actor.actorId))),
    objectIds: uniqueSorted(objects.map((object) => asStr(object.objectId))),
    claimIds: uniqueSorted(claimIds),
    adaptationDecisionIds: uniqueSorted(adaptationDecisionIds),
    sceneIds: uniqueSorted(sceneIds),
    handoffIds: uniqueSorted(handoffs.map((handoff) => asStr(handoff.handoffId))),
    branchIds: uniqueSorted(branchIds),
    frozenResultIds: uniqueSorted(frozenResultIds),
    openingProjectionIds: uniqueSorted(openingProjectionIds),
    objectVersionIds: uniqueSorted(objectVersionIds),
    dialogueSeedIds: uniqueSorted(dialogueSeedIds),
    nodes: nodes.sort((left, right) => left.sequence - right.sequence),
    finale: {
      worldTrackIds: strArr(finale.worldTracks),
      seatVerdictSeatIds: uniqueSorted(
        asArr(finale.seatVerdicts).map(asRec).map((item) => asStr(item?.seatId)),
      ),
      inputRule: asStr(finale.inputRule),
    },
    counts: { ...report.counts },
  };
}

export function buildPressureSpineManifestLock(
  input: BuildPressureSpineInput,
  index: PressureSpineRuntimeIndex,
): PressureSpineManifestLock {
  const manifest = json(input.files, "manifest.json");
  const artifactIndex: PressureSpineArtifactRecord[] = [...input.files]
    .map(([filePath, bytes]) => ({
      path: `${PRESSURE_SPINE_SOURCE_DIRECTORY}/${filePath}`,
      byteSize: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    schemaVersion: "pressure_spine_manifest_lock_v1",
    worldId: input.worldId,
    runtimeProfile: input.runtimeProfile,
    registeredPackageVersion: input.registeredPackageVersion,
    packageId: asStr(manifest.packageId),
    packageVersion: asStr(manifest.packageVersion),
    sourcePackageSha256: input.sourcePackageSha256.toUpperCase(),
    sourcePackageByteSize: input.sourcePackageByteSize,
    sourcePackageArchivePath: input.sourcePackageArchivePath,
    sourceSha256: asStr(manifest.sourceSha256).toUpperCase(),
    sourceLineCount: Number(manifest.sourceLineCount),
    contentTreeSha256: contentTreeHash(artifactIndex),
    runtimeIndexSha256: sha256Bytes(canonicalJson(index)),
    importerVersion: PRESSURE_SPINE_IMPORTER_VERSION,
    artifactIndex,
    legacyStrategyLocks: Object.fromEntries(
      Object.entries(input.legacyStrategyLocks).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}
