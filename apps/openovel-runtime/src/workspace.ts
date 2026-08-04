import path from "node:path";
import { randomUUID } from "node:crypto";
import { open, readdir, rename, stat, unlink } from "node:fs/promises";
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
import type { MaterializedTurnView } from "./atomic-turn.js";
import type { WorkspaceRunSeeder } from "./workspace-seeder.js";
import {
  OPENOVEL_RUNTIME_MODE,
  type ModelCallStage,
  type MirrorEnvelope,
  type MirrorEvent,
  type OpenNovelOption,
  type ProviderRequest,
  type ProviderResult,
  type RunMetadata,
  type RuntimeWarning,
  type SceneEvent,
  type StorykeeperInboxItem,
  type TurnResult,
} from "./types.js";

export class FileStoryWorkspace {
  constructor(
    readonly root: string,
    readonly projectRoot: string,
    readonly upstreamCommit: string,
    private readonly runSeeder: WorkspaceRunSeeder,
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
    if (!this.runSeeder.supports(input)) throw new Error("OPENOVEL_WORLD_ROLE_UNSUPPORTED");
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
    const seeded = await this.runSeeder.seed(paths, metadata, this.projectRoot);
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

  async acquireForegroundLease(
    runId: string,
    ttlMs = foregroundLeaseTtl(),
  ): Promise<() => Promise<void>> {
    const paths = this.paths(runId);
    return this.acquireWorkspaceLease(
      runId,
      paths.foregroundLock,
      "RUN_FOREGROUND_BUSY",
      ttlMs,
    );
  }

  async acquireStorykeeperLease(
    runId: string,
    ttlMs = storykeeperLeaseTtl(),
  ): Promise<() => Promise<void>> {
    const paths = this.paths(runId);
    return this.acquireWorkspaceLease(
      runId,
      paths.storykeeperLock,
      "RUN_STORYKEEPER_BUSY",
      ttlMs,
    );
  }

  async acquireMirrorLease(
    runId: string,
    ttlMs = mirrorLeaseTtl(),
  ): Promise<() => Promise<void>> {
    const paths = this.paths(runId);
    return this.acquireWorkspaceLease(
      runId,
      paths.mirrorLock,
      "RUN_MIRROR_BUSY",
      ttlMs,
    );
  }

  private async acquireWorkspaceLease(
    runId: string,
    lockPath: string,
    busyCode: string,
    ttlMs: number,
  ): Promise<() => Promise<void>> {
    const token = randomUUID();
    const safeTtlMs = Math.max(30_000, Math.min(ttlMs, 30 * 60_000));
    await this.metadata(runId);
    await ensureDir(path.dirname(lockPath));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(JSON.stringify(leaseRecord(token, safeTtlMs)), "utf8");
        } finally {
          await handle.close();
        }
        let heartbeatTask = Promise.resolve();
        const heartbeat = setInterval(() => {
          heartbeatTask = heartbeatTask
            .then(() => this.refreshWorkspaceLease(lockPath, token, safeTtlMs))
            .catch(() => {});
        }, Math.max(10_000, Math.floor(safeTtlMs / 3)));
        heartbeat.unref();
        return async () => {
          clearInterval(heartbeat);
          await heartbeatTask;
          const current = await readJson<WorkspaceLeaseRecord | null>(lockPath, null);
          if (current?.token !== token) return;
          await unlink(lockPath).catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!await workspaceLeaseExpired(lockPath, safeTtlMs)) {
          throw new Error(busyCode);
        }
        const stalePath = `${lockPath}.stale.${token}`;
        try {
          await rename(lockPath, stalePath);
          await unlink(stalePath).catch(() => {});
        } catch (renameError) {
          const code = (renameError as NodeJS.ErrnoException).code;
          if (!["ENOENT", "EEXIST", "EPERM"].includes(String(code))) throw renameError;
        }
      }
    }
    throw new Error(busyCode);
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
    stage: ModelCallStage,
    request: ProviderRequest,
    result?: ProviderResult,
    error?: unknown,
    attempt = 1,
  ) {
    const paths = this.paths(runId);
    const suffix = attempt > 1 ? `.${String(attempt).padStart(2, "0")}` : "";
    await writeJsonAtomic(path.join(paths.callsDir, `${turnId}.${stage}${suffix}.json`), {
      turnId,
      stage,
      attempt,
      capturedAt: new Date().toISOString(),
      request: {
        ...request,
        onDelta: undefined,
      },
      result: result || null,
      error: error ? String((error as Error).message || error) : null,
    });
  }

  async nextModelCallAttempt(
    runId: string,
    turnId: string,
    stage: ProviderRequest["profile"],
  ) {
    const escapedTurn = turnId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedStage = stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escapedTurn}\\.${escapedStage}(?:\\.(\\d+))?\\.json$`);
    const entries = await readdir(this.paths(runId).callsDir).catch(() => []);
    let highest = 0;
    for (const entry of entries) {
      const match = entry.match(pattern);
      if (!match) continue;
      highest = Math.max(highest, match[1] ? Number(match[1]) : 1);
    }
    return highest + 1;
  }

  async latestCommittedForegroundTurn(runId: string) {
    const lines = (await readText(this.paths(runId).sceneLog, ""))
      .split(/\r?\n/)
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const event = JSON.parse(lines[index]) as Record<string, unknown>;
        if (
          event.type === "foreground_turn"
          && typeof event.turnId === "string"
          && typeof event.action === "string"
          && typeof event.narration === "string"
        ) {
          return {
            turnId: event.turnId,
            action: event.action,
            narration: event.narration,
          };
        }
      } catch {
        // A damaged audit line must not hide an earlier valid committed turn.
      }
    }
    return null;
  }

  async commitNarration(
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
      causalDelta: input.result.causalDelta,
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

  async atomicNarrationViews(
    runId: string,
    input: {
      turnId: string;
      action: string;
      result: TurnResult;
      selectedOption: OpenNovelOption | null;
      contextNarration?: string;
      shadowClaims?: unknown[];
    },
  ): Promise<MaterializedTurnView[]> {
    const paths = this.paths(runId);
    const currentCanon = await readText(paths.chapters, "");
    const chapter = [
      `**读者选择**：${input.action}`,
      "",
      input.result.narration.trim(),
    ].join("\n");
    const contextNarration = String(
      input.contextNarration || input.result.narration,
    ).trim();
    const currentContextCanon = await readText(paths.chaptersContext, currentCanon);
    const contextChapter = [
      `**读者选择**：${input.action}`,
      "",
      contextNarration,
    ].join("\n");
    const existingShadowClaims = parseJsonLines(await readText(paths.shadowClaims, ""));
    const shadowClaims = [
      ...existingShadowClaims,
      ...(input.shadowClaims || []),
    ];
    const sceneEvents = parseJsonLines(await readText(paths.sceneLog, ""));
    sceneEvents.push(this.event("foreground_turn", {
      turnId: input.turnId,
      action: input.action,
      selectedOption: input.selectedOption,
      narration: input.result.narration,
      causalDelta: input.result.causalDelta,
      warnings: input.result.warnings,
      committedAt: input.result.committedAt,
    }));
    sceneEvents.push(this.event("turn_committed", {
      turnId: input.turnId,
      turnNumber: input.result.turnNumber,
    }));
    const metadata = await this.metadata(runId);
    const committedMetadata: RunMetadata = {
      ...metadata,
      turnNumber: input.result.turnNumber,
      status: "READY",
      lastError: undefined,
      updatedAt: input.result.committedAt,
    };
    return [
      {
        relativePath: relativeRunPath(paths, paths.chapters),
        format: "text",
        value: `${currentCanon.trimEnd()}\n\n${chapter}\n`.trimStart(),
      },
      {
        relativePath: relativeRunPath(paths, paths.chaptersRecent),
        format: "text",
        value: `${input.result.narration.trim()}\n`,
      },
      {
        relativePath: relativeRunPath(paths, paths.chaptersContext),
        format: "text",
        value: `${currentContextCanon.trimEnd()}\n\n${contextChapter}\n`.trimStart(),
      },
      {
        relativePath: relativeRunPath(paths, paths.chaptersContextRecent),
        format: "text",
        value: `${contextNarration}\n`,
      },
      {
        relativePath: relativeRunPath(paths, paths.shadowClaims),
        format: "jsonl",
        value: shadowClaims,
      },
      {
        relativePath: relativeRunPath(paths, paths.sceneLog),
        format: "jsonl",
        restoreMode: "APPEND_ONLY",
        value: sceneEvents,
      },
      {
        relativePath: relativeRunPath(paths, paths.metadata),
        format: "json",
        value: committedMetadata,
      },
      {
        relativePath: relativeRunPath(paths, paths.currentOptions),
        format: "json",
        value: input.result.options,
      },
    ];
  }

  async publishTurnOptions(
    runId: string,
    input: {
      turnId: string;
      options: OpenNovelOption[];
      framing: string;
      tension: string;
      storyComplete: boolean;
      warnings: RuntimeWarning[];
      completedAt: string;
    },
  ) {
    const paths = this.paths(runId);
    await writeJsonAtomic(paths.currentOptions, input.options);
    await appendJsonl(paths.sceneLog, this.event("foreground_options", {
      turnId: input.turnId,
      options: input.options,
      framing: input.framing,
      tension: input.tension,
      storyComplete: input.storyComplete,
      warnings: input.warnings,
      completedAt: input.completedAt,
    }));
  }

  async enqueueStorykeeper(runId: string, item: StorykeeperInboxItem) {
    await appendJsonl(this.paths(runId).inboxQueue, item);
  }

  async enqueueMirror(event: MirrorEvent) {
    const envelope: MirrorEnvelope = {
      ...event,
      id: `mirror_${Date.now()}_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    await appendJsonl(this.paths(event.runId).mirrorQueue, envelope);
    return envelope;
  }

  async mirrorOutbox(runId: string) {
    const paths = this.paths(runId);
    const lines = (await readText(paths.mirrorQueue, "")).split(/\r?\n/).filter(Boolean);
    const items = lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as MirrorEnvelope];
      } catch {
        return [];
      }
    });
    const state = await readJson<{ processed: string[]; failures: Record<string, string> }>(
      paths.mirrorState,
      { processed: [], failures: {} },
    );
    return { items, state };
  }

  async markMirror(
    runId: string,
    itemId: string,
    result: { processed: boolean; error?: string },
  ) {
    const { state } = await this.mirrorOutbox(runId);
    const processed = new Set(state.processed);
    const failures = { ...state.failures };
    if (result.processed) {
      processed.add(itemId);
      delete failures[itemId];
    } else if (result.error) {
      failures[itemId] = result.error.slice(0, 1_000);
    }
    await writeJsonAtomic(this.paths(runId).mirrorState, {
      processed: [...processed],
      failures,
      updatedAt: new Date().toISOString(),
    });
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
    const state = await readJson<{
      processed: string[];
      failures: Record<string, string>;
      attempts?: Record<string, number>;
      deadLetters?: Record<string, string>;
    }>(
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
    const attempts = { ...(state.attempts || {}) };
    const deadLetters = { ...(state.deadLetters || {}) };
    if (result.processed) {
      processed.add(itemId);
      delete failures[itemId];
      delete attempts[itemId];
      delete deadLetters[itemId];
    } else if (result.error) {
      failures[itemId] = result.error.slice(0, 1000);
      attempts[itemId] = (attempts[itemId] || (state.failures[itemId] ? 1 : 0)) + 1;
    }
    await writeJsonAtomic(this.paths(runId).inboxState, {
      processed: [...processed],
      failures,
      attempts,
      deadLetters,
      updatedAt: new Date().toISOString(),
    });
  }

  async deadLetterInbox(runId: string, itemId: string, error: string) {
    const { state } = await this.inbox(runId);
    const processed = new Set(state.processed);
    processed.add(itemId);
    await writeJsonAtomic(this.paths(runId).inboxState, {
      processed: [...processed],
      failures: { ...state.failures, [itemId]: error.slice(0, 1_000) },
      attempts: { ...(state.attempts || {}) },
      deadLetters: {
        ...(state.deadLetters || {}),
        [itemId]: error.slice(0, 1_000),
      },
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

  private async refreshWorkspaceLease(
    lockPath: string,
    token: string,
    ttlMs: number,
  ) {
    let handle;
    try {
      handle = await open(lockPath, "r+");
      const text = await handle.readFile("utf8");
      let current: WorkspaceLeaseRecord | null = null;
      try {
        current = JSON.parse(text) as WorkspaceLeaseRecord;
      } catch {
        return;
      }
      if (current?.token !== token) return;
      const updated = JSON.stringify(leaseRecord(token, ttlMs));
      await handle.truncate(0);
      await handle.write(updated, 0, "utf8");
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      await handle?.close();
    }
  }
}

type WorkspaceLeaseRecord = {
  token: string;
  ownerPid: number;
  acquiredAt: string;
  expiresAt: string;
};

function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function relativeRunPath(paths: WorkspacePaths, target: string) {
  const relative = path.relative(paths.root, target).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    throw new Error("ATOMIC_ARTIFACT_PATH_INVALID");
  }
  return relative;
}

function leaseRecord(token: string, ttlMs: number): WorkspaceLeaseRecord {
  const now = Date.now();
  return {
    token,
    ownerPid: process.pid,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

function foregroundLeaseTtl() {
  const configured = Number(process.env.OPENOVEL_FOREGROUND_LEASE_TTL_MS || 0);
  return Number.isFinite(configured) && configured > 0 ? configured : 120_000;
}

function storykeeperLeaseTtl() {
  const configured = Number(process.env.OPENOVEL_STORYKEEPER_LEASE_TTL_MS || 0);
  return Number.isFinite(configured) && configured > 0 ? configured : 600_000;
}

function mirrorLeaseTtl() {
  const configured = Number(process.env.OPENOVEL_MIRROR_LEASE_TTL_MS || 0);
  return Number.isFinite(configured) && configured > 0 ? configured : 120_000;
}

async function workspaceLeaseExpired(lockPath: string, ttlMs: number) {
  const current = await readJson<WorkspaceLeaseRecord | null>(lockPath, null);
  const expiresAt = Date.parse(String(current?.expiresAt || ""));
  if (Number.isFinite(expiresAt)) return expiresAt <= Date.now();
  try {
    const details = await stat(lockPath);
    return details.mtimeMs + ttlMs <= Date.now();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
