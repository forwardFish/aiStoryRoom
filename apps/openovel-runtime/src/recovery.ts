import type { FileStoryWorkspace } from "./workspace.js";

export async function recoverRuntimeRuns(
  workspace: FileStoryWorkspace,
  storykeeper: { kick(runId: string): Promise<void> | void },
) {
  const recovered: string[] = [];
  const interrupted: string[] = [];
  const failures: Array<{ runId: string; error: string }> = [];
  for (const runId of await workspace.listRuns()) {
    try {
      const metadata = await workspace.metadata(runId);
      if (metadata.status === "FOREGROUND_RUNNING" || metadata.status === "COMMITTING") {
        await workspace.updateMetadata(runId, {
          status: "FAILED",
          lastError: "RUNTIME_RESTART_INTERRUPTED",
        });
        await workspace.recordSceneEvent(runId, {
          type: "runtime_recovered",
          turnId: `T${String(metadata.turnNumber + 1).padStart(2, "0")}`,
          priorStatus: metadata.status,
          result: "MARKED_RETRYABLE",
        });
        interrupted.push(runId);
      }
      void Promise.resolve(storykeeper.kick(runId)).catch(() => {});
      recovered.push(runId);
    } catch (error) {
      failures.push({
        runId,
        error: String((error as Error).message || error).slice(0, 1_000),
      });
    }
  }
  return { recovered, interrupted, failures };
}
