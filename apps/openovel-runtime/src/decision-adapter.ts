import type { FileStoryWorkspace } from "./workspace.js";
import type { OpenNovelOption } from "./types.js";
import type { NarrativeTruthContext } from "./truth-review.js";
import type { AtomicTurnProjection } from "./atomic-turn.js";

export type PreparedAuthoredDecision = {
  selectedOption: OpenNovelOption | null;
  settledNarrative: string;
  sourceRef: string;
  storyComplete: boolean;
  protectedBlocks: Array<{
    blockId: string;
    sourceRefs: string[];
    text: string;
    immutable: true;
  }>;
  fallbackText: string;
  truthContext: NarrativeTruthContext;
  audit: Record<string, unknown>;
  payload: unknown;
};

export interface AuthoredDecisionAdapter {
  currentOptions(
    workspace: FileStoryWorkspace,
    runId: string,
  ): Promise<OpenNovelOption[] | null>;

  prepare(
    workspace: FileStoryWorkspace,
    input: {
      runId: string;
      turnNumber: number;
      action: string;
      selectedOption: OpenNovelOption | null;
    },
  ): Promise<PreparedAuthoredDecision | null>;

  commit(
    workspace: FileStoryWorkspace,
    runId: string,
    prepared: PreparedAuthoredDecision,
  ): Promise<void>;

  /** Build authoritative state before Canon advances. Generated prose is
   * never parsed to decide state; the runtime commits this projection and the
   * reviewed narrative behind one Head pointer. */
  projectCommit(
    workspace: FileStoryWorkspace,
    runId: string,
    prepared: PreparedAuthoredDecision,
  ): Promise<AtomicTurnProjection>;

  nextOptions(prepared: PreparedAuthoredDecision): OpenNovelOption[];
}
