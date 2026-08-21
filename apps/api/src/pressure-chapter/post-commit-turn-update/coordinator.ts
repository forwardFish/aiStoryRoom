import { isSha256, sha256Canonical } from "@ai-story/shared";
import type { PressureChapterGameProjectionV1 } from "../game-projection/contracts";
import type {
  PressurePostCommitTurnReceiptV1,
  PressurePostCommitTurnUpdatePortV1,
  PressurePostCommitTurnUpdateV1,
} from "./contracts";

type EntryV1 = {
  receipt: PressurePostCommitTurnReceiptV1;
  subjectId: string;
  startedAtMs: number;
  expiresAtMs: number;
  status: "PENDING" | "STREAMING" | "READY" | "FAILED";
  sceneText: string | null;
  projection: PressureChapterGameProjectionV1 | null;
};

export class PressurePostCommitTurnUpdateCoordinatorV1
implements PressurePostCommitTurnUpdatePortV1 {
  private readonly entries = new Map<string, EntryV1>();

  constructor(
    private readonly options: Readonly<{
      nowMs?: () => number;
      schedule?: (task: () => void) => void;
      ttlMs?: number;
      maxEntries?: number;
    }> = {},
  ) {}

  start(
    input: Parameters<PressurePostCommitTurnUpdatePortV1["start"]>[0],
  ): PressurePostCommitTurnReceiptV1 {
    this.cleanup();
    const updateKey = sha256Canonical({
      runId: required(input.runId, "runId"),
      subjectId: required(input.subjectId, "subjectId"),
      idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
      chapterRuntimeId: required(input.chapterRuntimeId, "chapterRuntimeId"),
      savedActionId: required(input.savedActionId, "savedActionId"),
    });
    const existing = this.entries.get(updateKey);
    if (existing) return structuredClone(existing.receipt);
    const receipt: PressurePostCommitTurnReceiptV1 = Object.freeze({
      schemaVersion: "pressure_post_commit_turn_receipt_v1",
      updateKey,
      runId: input.runId,
      chapterRuntimeId: input.chapterRuntimeId,
      chapterId: input.chapterId,
      viewerSeatId: input.viewerSeatId,
      savedActionId: input.savedActionId,
      nextBeatId: input.nextBeatId,
      nextDecisionPointId: input.nextDecisionPointId,
      status: "ACTION_SAVED",
    });
    const entry: EntryV1 = {
      receipt,
      subjectId: input.subjectId,
      startedAtMs: this.nowMs(),
      expiresAtMs: this.nowMs() + this.ttlMs(),
      status: "PENDING",
      sceneText: null,
      projection: null,
    };
    this.entries.set(updateKey, entry);
    this.trim();
    this.schedule()(() => {
      const publishSceneText = (sceneText: string) => {
        const current = this.entries.get(updateKey);
        const text = typeof sceneText === "string" ? sceneText.trim() : "";
        if (
          !current
          || current.subjectId !== input.subjectId
          || current.status === "READY"
          || current.status === "FAILED"
          || !text
          || text.length < (current.sceneText?.length ?? 0)
        ) return;
        current.status = "STREAMING";
        current.sceneText = text;
      };
      void input.load(publishSceneText).then((projection) => {
        const current = this.entries.get(updateKey);
        if (!current || current.subjectId !== input.subjectId) return;
        if (
          projection.runId !== input.runId
          || projection.viewer.seatId !== input.viewerSeatId
        ) {
          current.status = "FAILED";
          current.projection = null;
          return;
        }
        current.status = "READY";
        current.sceneText = null;
        current.projection = structuredClone(projection);
        logCompletion(current, "READY", this.nowMs());
      }).catch(() => {
        const current = this.entries.get(updateKey);
        if (!current || current.subjectId !== input.subjectId) return;
        current.status = "FAILED";
        current.sceneText = null;
        current.projection = null;
        logCompletion(current, "FAILED", this.nowMs());
      });
    });
    return structuredClone(receipt);
  }

  read(
    input: Parameters<PressurePostCommitTurnUpdatePortV1["read"]>[0],
  ): PressurePostCommitTurnUpdateV1 {
    this.cleanup();
    const updateKey = required(input.updateKey, "updateKey");
    if (!isSha256(updateKey)) return update(input, "EXPIRED", null);
    const entry = this.entries.get(updateKey);
    if (
      !entry
      || entry.receipt.runId !== input.runId
      || entry.receipt.chapterRuntimeId !== input.chapterRuntimeId
      || entry.subjectId !== input.subjectId
    ) return update(input, "EXPIRED", null);
    return update(
      input,
      entry.status,
      entry.status === "READY" ? entry.projection : null,
      entry.status === "STREAMING" ? entry.sceneText : null,
    );
  }

  private cleanup(): void {
    const nowMs = this.nowMs();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) this.entries.delete(key);
    }
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries()) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) return;
      this.entries.delete(oldest);
    }
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? Date.now();
  }

  private ttlMs(): number {
    return Math.max(30_000, this.options.ttlMs ?? 120_000);
  }

  private maxEntries(): number {
    return Math.max(10, this.options.maxEntries ?? 200);
  }

  private schedule(): (task: () => void) => void {
    return this.options.schedule ?? ((task) => setTimeout(task, 0));
  }
}

function update(
  input: Readonly<{ runId: string; updateKey: string; chapterRuntimeId: string }>,
  status: PressurePostCommitTurnUpdateV1["status"],
  projection: PressureChapterGameProjectionV1 | null,
  sceneText: string | null = null,
): PressurePostCommitTurnUpdateV1 {
  return Object.freeze({
    schemaVersion: "pressure_post_commit_turn_update_v1",
    updateKey: input.updateKey,
    runId: input.runId,
    chapterRuntimeId: input.chapterRuntimeId,
    status,
    sceneText,
    projection: projection ? structuredClone(projection) : null,
  });
}

function required(value: string, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`PRESSURE_POST_COMMIT_TURN_UPDATE_INVALID:${path}`);
  }
  return value.trim();
}

function logCompletion(
  entry: EntryV1,
  status: "READY" | "FAILED",
  completedAtMs: number,
): void {
  try {
    console.error("Pressure post-commit turn update", JSON.stringify({
      runId: entry.receipt.runId,
      chapterId: entry.receipt.chapterId,
      nextBeatId: entry.receipt.nextBeatId,
      status,
      backgroundProjectionMs: Math.max(0, completedAtMs - entry.startedAtMs),
    }));
  } catch {}
}
