import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  appendJsonl,
  appendText,
  ensureDir,
  exists,
  readJson,
  readText,
  safeRunId,
  writeAtomic,
  writeJsonAtomic,
} from "./io.js";
import { composeForeground, getStorySnapshot } from "./foreground.js";
import { workspacePaths, type WorkspacePaths } from "./paths.js";
import { seedSangtianWorkspace } from "./sangtian-workspace.js";
import {
  OPENOVEL_RUNTIME_MODE,
  type OpenNovelOption,
  type ProviderRequest,
  type ProviderResult,
  type RunMetadata,
  type SceneEvent,
  type StorykeeperInboxItem,
  type TurnResult,
} from "./types.js";

export class FileStoryWorkspace {
  constructor(
    readonly root: string,
    readonly projectRoot: string,
    readonly upstreamCommit: string,
    readonly packageVersion = "openovel-v1.0.0",
  ) {}

  paths(runId: string) {
    return workspacePaths(this.root, runId);
  }

  async createRun(input: {
    runId: string;
    worldId: string;
    roleId: string;
    storyPackageVersion?: string;
    openingVersion?: string;
  }) {
    const runId = safeRunId(input.runId);
    const paths = this.paths(runId);
    if (await exists(paths.metadata)) {
      const current = await this.metadata(runId);
      if (current.worldId !== input.worldId || current.roleId !== input.roleId) {
        throw new Error("runId already belongs to another story or role");
      }
      return this.readPublicRun(runId);
    }
    if (input.worldId !== "sangtian" || input.roleId !== "zhejiang_governor") {
      throw new Error("OPENOVEL_V1 currently supports sangtian / zhejiang_governor only");
    }
    await this.ensureLayout(paths);
    const now = new Date().toISOString();
    const metadata: RunMetadata = {
      runId,
      worldId: input.worldId,
      roleId: input.roleId,
      runtimeMode: OPENOVEL_RUNTIME_MODE,
      storyPackageVersion: input.storyPackageVersion || "current",
      openingVersion: input.openingVersion || "current",
      upstreamCommit: this.upstreamCommit,
      packageVersion: this.packageVersion,
      createdAt: now,
      updatedAt: now,
      turnNumber: 0,
      status: "READY",
    };
    await writeJsonAtomic(paths.metadata, metadata);
    const seeded = await seedSangtianWorkspace(paths, metadata, this.projectRoot);
    await appendJsonl(paths.sceneLog, this.event("opening_committed", {
      turnId: "G00",
      runtimeMode: OPENOVEL_RUNTIME_MODE,
      openingVersion: metadata.openingVersion,
      options: seeded.openingOptions,
    }));
    await composeForeground(paths);
    return this.readPublicRun(runId);
  }

  async metadata(runId: string) {
    const metadata = await readJson<RunMetadata | null>(this.paths(runId).metadata, null);
    if (!metadata) throw new Error(`Run not found: ${runId}`);
    return metadata;
  }

  async updateMetadata(runId: string, patch: Partial<RunMetadata>) {
    const current = await this.metadata(runId);
    const next = {
      ...current,
      ...patch,
      runId: current.runId,
      worldId: current.worldId,
      roleId: current.roleId,
      runtimeMode: OPENOVEL_RUNTIME_MODE,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.paths(runId).metadata, next);
    return next;
  }

  async snapshot(runId: string) {
    return getStorySnapshot(this.paths(runId));
  }

  async recordSceneEvent(
    runId: string,
    event: { type: string; turnId?: string; [key: string]: unknown },
  ) {
    const recorded = this.event(event.type, event);
    await appendJsonl(this.paths(runId).sceneLog, recorded);
    return recorded;
  }

  async recordModelCall(
    runId: string,
    turnId: string,
    stage: ProviderRequest["profile"],
    request: ProviderRequest,
    result?: ProviderResult,
    error?: unknown,
  ) {
    const paths = this.paths(runId);
    await writeJsonAtomic(path.join(paths.callsDir, `${turnId}.${stage}.json`), {
      turnId,
      stage,
      capturedAt: new Date().toISOString(),
      request: {
        ...request,
        onDelta: undefined,
      },
      result: result || null,
      error: error ? String((error as Error).message || error) : null,
    });
  }

  async commitTurn(
    runId: string,
    input: {
      turnId: string;
      action: string;
      result: TurnResult;
      selectedOption: OpenNovelOption | null;
    },
  ) {
    const paths = this.paths(runId);
    const chapter = [
      `**读者选择**：${input.action}`,
      "",
      input.result.narration.trim(),
    ].join("\n");
    await appendText(paths.chapters, `\n\n${chapter}\n`);
    await writeAtomic(paths.chaptersRecent, `${input.result.narration.trim()}\n`);
    await appendJsonl(paths.sceneLog, this.event("foreground_turn", {
      turnId: input.turnId,
      action: input.action,
      selectedOption: input.selectedOption,
      narration: input.result.narration,
      options: input.result.options,
      tension: input.result.tension,
      warnings: input.result.warnings,
      committedAt: input.result.committedAt,
    }));
    await appendJsonl(paths.sceneLog, this.event("turn_committed", {
      turnId: input.turnId,
      turnNumber: input.result.turnNumber,
    }));
    await writeJsonAtomic(paths.currentOptions, input.result.options);
    await this.updateMetadata(runId, {
      turnNumber: input.result.turnNumber,
      status: "READY",
      lastError: undefined,
    });
  }

  async enqueueStorykeeper(runId: string, item: StorykeeperInboxItem) {
    await appendJsonl(this.paths(runId).inboxQueue, item);
  }

  async inbox(runId: string) {
    const paths = this.paths(runId);
    const lines = (await readText(paths.inboxQueue, "")).split(/\r?\n/).filter(Boolean);
    const items = lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as StorykeeperInboxItem];
      } catch {
        return [];
      }
    });
    const state = await readJson<{ processed: string[]; failures: Record<string, string> }>(
      paths.inboxState,
      { processed: [], failures: {} },
    );
    return { items, state };
  }

  async markInbox(
    runId: string,
    itemId: string,
    result: { processed: boolean; error?: string },
  ) {
    const { state } = await this.inbox(runId);
    const processed = new Set(state.processed);
    const failures = { ...state.failures };
    if (result.processed) {
      processed.add(itemId);
      delete failures[itemId];
    } else if (result.error) {
      failures[itemId] = result.error.slice(0, 1000);
    }
    await writeJsonAtomic(this.paths(runId).inboxState, {
      processed: [...processed],
      failures,
      updatedAt: new Date().toISOString(),
    });
  }

  async writeJobState(runId: string, value: unknown) {
    await writeJsonAtomic(this.paths(runId).jobs, value);
  }

  async recordShadowAudit(runId: string, audit: Record<string, unknown>) {
    await appendJsonl(this.paths(runId).shadowAudit, audit);
  }

  async appendQuality(runId: string, text: string) {
    if (text.trim()) await appendText(this.paths(runId).qualityLog, `\n\n${text.trim()}\n`);
  }

  async readPublicRun(runId: string) {
    const paths = this.paths(runId);
    const metadata = await this.metadata(runId);
    const options = await readJson<OpenNovelOption[]>(paths.currentOptions, []);
    return {
      runId,
      worldId: metadata.worldId,
      roleId: metadata.roleId,
      runtimeMode: metadata.runtimeMode,
      turnNumber: metadata.turnNumber,
      status: metadata.status,
      canon: await readText(paths.chapters, ""),
      recentCanon: await readText(paths.chaptersRecent, ""),
      options: options.map(({ effect: _hidden, ...visible }) => visible),
      jobs: await readJson(paths.jobs, {}),
      updatedAt: metadata.updatedAt,
    };
  }

  async listRuns() {
    await ensureDir(this.root);
    const entries = await readdir(this.root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  private async ensureLayout(paths: WorkspacePaths) {
    await Promise.all([
      ensureDir(paths.canonDir),
      ensureDir(paths.guidanceDir),
      ensureDir(paths.frontendDir),
      ensureDir(paths.contextCardsDir),
      ensureDir(paths.directorDir),
      ensureDir(paths.memoryDir),
      ensureDir(paths.inboxDir),
      ensureDir(paths.stateDir),
      ensureDir(paths.callsDir),
    ]);
  }

  private event(type: string, extra: Record<string, unknown>): SceneEvent {
    return {
      id: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      type,
      ...extra,
    };
  }
}
