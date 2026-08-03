import path from "node:path";
import { safeRunId } from "./io.js";

export type WorkspacePaths = ReturnType<typeof workspacePaths>;

export function runtimeRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(
    String(env.OPENOVEL_WORKSPACE_ROOT || "").trim()
      || path.join(process.cwd(), ".runtime", "openovel-v1"),
  );
}

export function workspacePaths(root: string, rawRunId: string) {
  const runId = safeRunId(rawRunId);
  const runRoot = path.resolve(root, runId);
  const expectedParent = `${path.resolve(root)}${path.sep}`;
  if (!runRoot.startsWith(expectedParent)) throw new Error("workspace path escaped runtime root");
  const story = path.join(runRoot, "story");
  return {
    runId,
    root: runRoot,
    story,
    metadata: path.join(runRoot, "run.json"),
    head: path.join(runRoot, "head.json"),
    turnsDir: path.join(runRoot, "turns"),
    brief: path.join(story, "BRIEF.md"),
    canonDir: path.join(story, "canon"),
    chapters: path.join(story, "canon", "chapters.md"),
    chaptersRecent: path.join(story, "canon", "chapters.recent.md"),
    sceneLog: path.join(story, "canon", "scene_log.jsonl"),
    guidanceDir: path.join(story, "guidance"),
    foregroundTemplate: path.join(story, "guidance", "FG_template.md"),
    foregroundGuidance: path.join(story, "guidance", "FOREGROUND.md"),
    cardsManifest: path.join(story, "guidance", "cards.md"),
    cardsAutoManifest: path.join(story, "guidance", "cards.auto.md"),
    frontendDir: path.join(story, "frontend"),
    contextCardsDir: path.join(story, "context-cards"),
    directorDir: path.join(story, "director"),
    optionsGuidance: path.join(story, "director", "OPTIONS.md"),
    qualityLog: path.join(story, "director", "QUALITY.md"),
    arcLog: path.join(story, "director", "ARC.md"),
    memoryDir: path.join(story, "memory"),
    storyMemory: path.join(story, "memory", "MEMORY.md"),
    inboxDir: path.join(story, "inbox"),
    inboxQueue: path.join(story, "inbox", "queue.jsonl"),
    inboxState: path.join(story, "inbox", "state.json"),
    stateDir: path.join(story, "state"),
    currentOptions: path.join(story, "state", "current-options.json"),
    partOneState: path.join(story, "state", "part-one-state.json"),
    partOneEvents: path.join(story, "state", "part-one-events.jsonl"),
    jobs: path.join(story, "state", "jobs.json"),
    foregroundLock: path.join(story, "state", "foreground.lock"),
    storykeeperLock: path.join(story, "state", "storykeeper.lock"),
    mirrorLock: path.join(story, "state", "mirror.lock"),
    mirrorQueue: path.join(story, "state", "mirror-queue.jsonl"),
    mirrorState: path.join(story, "state", "mirror-state.json"),
    shadowAudit: path.join(story, "state", "shadow-audit.jsonl"),
    contextReport: path.join(story, "state", "context-report.json"),
    callsDir: path.join(story, "state", "model-calls"),
  };
}
