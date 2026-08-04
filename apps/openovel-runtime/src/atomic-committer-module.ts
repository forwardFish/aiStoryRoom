import {
  FileAtomicTurnRepository,
  type AtomicTurnCommitInput,
} from "./atomic-turn.js";
import type { WorkspacePaths } from "./paths.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type { OpenNovelOption, TurnResult } from "./types.js";

export interface AtomicCommitSession {
  restoreMaterializedViews(): ReturnType<FileAtomicTurnRepository["restoreMaterializedViews"]>;
  resultBySubmission(
    submissionId: string,
    expectedAction?: string,
  ): ReturnType<FileAtomicTurnRepository["resultBySubmission"]>;
  commit(input: AtomicTurnCommitInput): ReturnType<FileAtomicTurnRepository["commit"]>;
}

export interface AtomicCommitterModule {
  readonly moduleId: string;
  open(paths: WorkspacePaths): AtomicCommitSession;
  commitAuthored(session: AtomicCommitSession, input: AtomicTurnCommitInput): Promise<void>;
  commitLegacy(input: {
    workspace: FileStoryWorkspace;
    runId: string;
    turnId: string;
    action: string;
    result: TurnResult;
    selectedOption: OpenNovelOption | null;
  }): Promise<void>;
}

export class FileAtomicCommitter implements AtomicCommitterModule {
  readonly moduleId = "openovel.file-atomic-committer.v1";

  open(paths: WorkspacePaths): AtomicCommitSession {
    return new FileAtomicTurnRepository(paths);
  }

  async commitAuthored(session: AtomicCommitSession, input: AtomicTurnCommitInput) {
    await session.commit(input);
    await session.restoreMaterializedViews();
  }

  async commitLegacy(input: {
    workspace: FileStoryWorkspace;
    runId: string;
    turnId: string;
    action: string;
    result: TurnResult;
    selectedOption: OpenNovelOption | null;
  }) {
    await input.workspace.commitNarration(input.runId, {
      turnId: input.turnId,
      action: input.action,
      result: input.result,
      selectedOption: input.selectedOption,
    });
  }
}
