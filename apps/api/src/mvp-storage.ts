import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { MvpStoryEvent, MvpView } from "./mvp-types";

interface StoredMvpRun {
  schemaVersion: 1;
  state: Omit<MvpView, "events">;
  events: MvpStoryEvent[];
}

export interface MvpStoryStorage {
  create(view: MvpView): Promise<void>;
  load(runId: string): Promise<MvpView>;
  save(view: MvpView, expectedVersion: number): Promise<void>;
  recordAiTask?(task: {
    runId: string;
    eventId: string;
    taskType: string;
    status: string;
    provider: string;
    inputJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    errorMessage?: string;
  }): Promise<void>;
}

/**
 * Durable local storage for the v4 MVP. Each run is a self-contained event stream
 * plus its latest materialized view. Writes use temp-file + rename and a lock file,
 * so a process restart never leaves a partially written run.
 *
 * Set MVP_STORY_DATA_DIR to a mounted volume in production. The default deliberately
 * lives outside the repository so runtime data cannot be committed accidentally.
 */
export class FileMvpStoryStorage implements MvpStoryStorage {
  readonly rootDir: string;

  constructor(rootDir = process.env.MVP_STORY_DATA_DIR || join(tmpdir(), "ai-story-room", "mvp-story-runs")) {
    this.rootDir = rootDir;
  }

  async create(view: MvpView) {
    await this.withLock(view.run.id, async () => {
      const path = this.runPath(view.run.id);
      try {
        await readFile(path, "utf8");
        throw new ConflictException("mvp story run already exists");
      } catch (error: any) {
        if (error instanceof ConflictException) throw error;
        if (error?.code !== "ENOENT") throw error;
      }
      await this.atomicWrite(path, this.pack(view));
    });
  }

  async load(runId: string) {
    const stored = await this.readStored(runId);
    return this.unpack(stored);
  }

  async save(view: MvpView, expectedVersion: number) {
    await this.withLock(view.run.id, async () => {
      const stored = await this.readStored(view.run.id);
      if (stored.state.run.version !== expectedVersion) {
        throw new ConflictException({
          code: "VERSION_CONFLICT",
          message: "story run version conflict",
          expectedVersion,
          currentVersion: stored.state.run.version
        });
      }
      if (view.run.version !== expectedVersion + 1) {
        throw new ConflictException("story run mutation must increment version exactly once");
      }
      await this.atomicWrite(this.runPath(view.run.id), this.pack(view));
    });
  }

  private pack(view: MvpView): StoredMvpRun {
    const { events, ...state } = structuredClone(view);
    return { schemaVersion: 1, state, events };
  }

  private unpack(stored: StoredMvpRun): MvpView {
    return structuredClone({ ...stored.state, events: stored.events });
  }

  private async readStored(runId: string): Promise<StoredMvpRun> {
    try {
      const raw = await readFile(this.runPath(runId), "utf8");
      const parsed = JSON.parse(raw) as StoredMvpRun;
      if (parsed?.schemaVersion !== 1 || !parsed.state?.run || !Array.isArray(parsed.events)) {
        throw new Error("invalid mvp story storage payload");
      }
      return parsed;
    } catch (error: any) {
      if (error?.code === "ENOENT") throw new NotFoundException("mvp story run not found");
      throw error;
    }
  }

  private runPath(runId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new NotFoundException("mvp story run not found");
    return join(this.rootDir, `${runId}.json`);
  }

  private lockPath(runId: string) {
    return join(this.rootDir, `${runId}.lock`);
  }

  private async withLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.rootDir, { recursive: true });
    const lockPath = this.lockPath(runId);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        handle = await open(lockPath, "wx");
        break;
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
        const lockAge = await stat(lockPath).then((value) => Date.now() - value.mtimeMs).catch(() => 0);
        if (lockAge > 30_000) {
          await rm(lockPath, { force: true }).catch(() => undefined);
          continue;
        }
        if (attempt === 99) throw new ConflictException("story run is busy; retry the request");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      return await operation();
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }

  private async atomicWrite(path: string, value: StoredMvpRun) {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
  }
}

export class MemoryMvpStoryStorage implements MvpStoryStorage {
  private readonly records = new Map<string, MvpView>();

  async create(view: MvpView) {
    if (this.records.has(view.run.id)) throw new ConflictException("mvp story run already exists");
    this.records.set(view.run.id, structuredClone(view));
  }

  async load(runId: string) {
    const view = this.records.get(runId);
    if (!view) throw new NotFoundException("mvp story run not found");
    return structuredClone(view);
  }

  async save(view: MvpView, expectedVersion: number) {
    const stored = this.records.get(view.run.id);
    if (!stored) throw new NotFoundException("mvp story run not found");
    if (stored.run.version !== expectedVersion) {
      throw new ConflictException({
        code: "VERSION_CONFLICT",
        message: "story run version conflict",
        expectedVersion,
        currentVersion: stored.run.version
      });
    }
    if (view.run.version !== expectedVersion + 1) throw new ConflictException("story run mutation must increment version exactly once");
    this.records.set(view.run.id, structuredClone(view));
  }
}
