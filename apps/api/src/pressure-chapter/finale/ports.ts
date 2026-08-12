import type {
  CausalEdgeV1,
  FrozenChapterBundleV1,
  FrozenFinalePolicyV1,
  TerminalResultContextV1,
  WorldStateV1,
} from "@ai-story/shared";

export interface N7FrozenFinaleSourceV1 {
  schemaVersion: "n7_frozen_finale_source_v1";
  runId: string;
  triggerKind: "N7_FROZEN";
  terminalChapterId: "N7";
  terminalWorldSequence: 7;
  routeHash: string;
  runSeed: string;
  genesisHash: string;
  frozenChapterBundles: FrozenChapterBundleV1[];
  finalWorldState: WorldStateV1;
  causalEdges: CausalEdgeV1[];
  policy: FrozenFinalePolicyV1;
  terminalResultContext: TerminalResultContextV1;
  sourceFingerprint: string;
}

/** A future W1 repository adapter supplies one consistent N7-frozen snapshot. */
export interface N7FrozenFinaleSourceReaderPort {
  readN7FrozenSource(runId: string): Promise<unknown | null>;
}
