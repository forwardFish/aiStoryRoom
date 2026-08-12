import test from "node:test";
import assert from "node:assert/strict";
import { hashWithoutField, sha256Canonical } from "@ai-story/shared";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as PERSISTENCE_ERROR,
  PressurePersistenceError,
} from "../persistence/errors";
import { PrismaProgressOutboxRepositoryV1 } from "./prisma-adapter";
import { PressureProgressOutboxWorkerV1 } from "./progress-outbox.service";
import type {
  ProgressComputeFinaleResultV1,
  ProgressOpenChapterResultV1,
  ProgressOutboxClockPortV1,
  ProgressOutboxStoredTaskV1,
  RuntimeProgressFinalePortV1,
  RuntimeProgressOpenChapterPortV1,
} from "./ports";

test("repository does not consume Genesis N1 rows", async () => {
  const harness = new ProgressOutboxHarness();
  harness.insertRow(makeGenesisN1Row());
  const repo = new PrismaProgressOutboxRepositoryV1(harness.client);

  const claim = await repo.claimNext({ workerId: "worker-a", nowMs: harness.nowMs, leaseMs: 30_000 });

  assert.deepEqual(claim, { kind: "EMPTY" });
  assert.equal(harness.rows[0]?.status, "PENDING");
});

test("worker drains N2-N7 in order and finale last", async () => {
  const harness = new ProgressOutboxHarness();
  for (const chapterId of ["N2", "N3", "N4", "N5", "N6", "N7"] as const) {
    harness.insertRow(makeChapterFrozenRow(chapterId));
  }
  harness.insertRow(makeFinaleRow("runtime-n7"));
  const repo = new PrismaProgressOutboxRepositoryV1(harness.client);
  const openCalls: string[] = [];
  const finaleCalls: string[] = [];
  const worker = new PressureProgressOutboxWorkerV1(
    repo,
    {
      openNextChapter: async ({ handoff }) => {
        openCalls.push(handoff.targetChapterId);
        return {
          status: "OPENED",
          chapterId: handoff.targetChapterId,
          chapterRuntimeId: `runtime-${handoff.targetChapterId.toLowerCase()}`,
        } satisfies ProgressOpenChapterResultV1;
      },
    },
    {
      computeFinale: async ({ handoff }) => {
        finaleCalls.push(handoff.terminalChapterRuntimeId);
        return {
          status: "COMMITTED",
          runId: handoff.runId,
          authorityCommitHash: digest(`finale:${handoff.runId}`),
        } satisfies ProgressComputeFinaleResultV1;
      },
    },
    new FixedClock(harness.nowMs),
    { leaseMs: 30_000, baseRetryMs: 1_000, maxRetryMs: 60_000 },
  );

  const drained = await worker.drain("worker-a", 8);

  assert.deepEqual(openCalls, ["N2", "N3", "N4", "N5", "N6", "N7"]);
  assert.deepEqual(finaleCalls, ["runtime-n7"]);
  assert.equal(drained.stoppedBecause, "IDLE");
  assert.deepEqual(
    drained.results.map((item) => item.kind),
    ["ACKNOWLEDGED", "ACKNOWLEDGED", "ACKNOWLEDGED", "ACKNOWLEDGED", "ACKNOWLEDGED", "ACKNOWLEDGED", "ACKNOWLEDGED", "IDLE"],
  );
  assert.ok(harness.rows.every((row) => row.status === "COMPLETED" && row.checkpoint === "ACKNOWLEDGED"));
});

test("COMPUTE_FINALE dispatches exactly one finale handoff", async () => {
  const harness = new ProgressOutboxHarness();
  harness.insertRow(makeFinaleRow("runtime-n7"));
  const repo = new PrismaProgressOutboxRepositoryV1(harness.client);
  let calls = 0;
  const worker = new PressureProgressOutboxWorkerV1(
    repo,
    {
      openNextChapter: async () => {
        throw new Error("should not open chapter");
      },
    },
    {
      computeFinale: async ({ handoff }) => {
        calls += 1;
        return {
          status: "COMMITTED",
          runId: handoff.runId,
          authorityCommitHash: digest("finale-authority"),
        };
      },
    },
    new FixedClock(harness.nowMs),
    { leaseMs: 30_000, baseRetryMs: 1_000, maxRetryMs: 60_000 },
  );

  const result = await worker.tick("worker-a");

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    kind: "ACKNOWLEDGED",
    outboxId: harness.rows[0]!.id,
    taskType: "COMPUTE_FINALE",
    effect: "COMMITTED",
  });
});

test("claim-before-open crash replays after lease expiry and opens once", async () => {
  const harness = new ProgressOutboxHarness();
  harness.insertRow(makeChapterFrozenRow("N2"));
  const repo = new PrismaProgressOutboxRepositoryV1(harness.client);

  const claimed = await repo.claimNext({ workerId: "worker-a", nowMs: harness.nowMs, leaseMs: 10 });
  assert.equal(claimed.kind, "CLAIMED");
  harness.nowMs += 20;

  let calls = 0;
  const worker = new PressureProgressOutboxWorkerV1(
    repo,
    {
      openNextChapter: async ({ handoff }) => {
        calls += 1;
        return {
          status: "OPENED",
          chapterId: handoff.targetChapterId,
          chapterRuntimeId: "runtime-n2",
        };
      },
    },
    {
      computeFinale: async () => {
        throw new Error("should not finalize");
      },
    },
    new FixedClock(harness.nowMs),
    { leaseMs: 10, baseRetryMs: 1_000, maxRetryMs: 60_000 },
  );

  const result = await worker.tick("worker-b");

  assert.equal(calls, 1);
  assert.equal(result.kind, "ACKNOWLEDGED");
  assert.equal(harness.rows[0]!.status, "COMPLETED");
});

test("open-before-ack crash replays the same chapter and does not duplicate it", async () => {
  const harness = new ProgressOutboxHarness();
  harness.insertRow(makeChapterFrozenRow("N2"));
  const repo = new PrismaProgressOutboxRepositoryV1(harness.client);
  const idempotentRuntime = new IdempotentOpenRuntime();

  const claimed = await repo.claimNext({ workerId: "worker-a", nowMs: harness.nowMs, leaseMs: 10 });
  assert.equal(claimed.kind, "CLAIMED");
  const task = parseStoredOpenTask((claimed as Extract<typeof claimed, { kind: "CLAIMED" }>).task);
  const first = await idempotentRuntime.openNextChapter({
    handoff: task,
    workerId: "worker-a",
    nowMs: harness.nowMs,
  });
  assert.equal(first.status, "OPENED");

  harness.nowMs += 20;
  const worker = new PressureProgressOutboxWorkerV1(
    repo,
    idempotentRuntime,
    {
      computeFinale: async () => {
        throw new Error("should not finalize");
      },
    },
    new FixedClock(harness.nowMs),
    { leaseMs: 10, baseRetryMs: 1_000, maxRetryMs: 60_000 },
  );

  const result = await worker.tick("worker-b");

  assert.equal(result.kind, "ACKNOWLEDGED");
  assert.equal(idempotentRuntime.opens.size, 1);
  assert.equal(idempotentRuntime.replays, 1);
});

test("tampered payload is dead-lettered without calling runtime", async () => {
  const harness = new ProgressOutboxHarness();
  const row = makeChapterFrozenRow("N2");
  row.payloadHash = digest("tampered");
  harness.insertRow(row);
  const repo = new PrismaProgressOutboxRepositoryV1(harness.client);
  let called = false;
  const worker = new PressureProgressOutboxWorkerV1(
    repo,
    {
      openNextChapter: async () => {
        called = true;
        throw new Error("should not run");
      },
    },
    {
      computeFinale: async () => {
        called = true;
        throw new Error("should not run");
      },
    },
    new FixedClock(harness.nowMs),
    { leaseMs: 30_000, baseRetryMs: 1_000, maxRetryMs: 60_000 },
  );

  const result = await worker.tick("worker-a");

  assert.equal(called, false);
  assert.equal(result.kind, "DEAD_LETTERED");
  assert.equal(harness.rows[0]!.status, "DEAD_LETTER");
});

test("acknowledge lease loss is surfaced", async () => {
  const harness = new ProgressOutboxHarness();
  harness.insertRow(makeChapterFrozenRow("N2"));
  const repo = new PrismaProgressOutboxRepositoryV1(harness.client);
  const worker = new PressureProgressOutboxWorkerV1(
    repo,
    {
      openNextChapter: async ({ handoff }) => {
        harness.rows[0]!.leaseVersion += 1;
        return {
          status: "OPENED",
          chapterId: handoff.targetChapterId,
          chapterRuntimeId: "runtime-n2",
        };
      },
    },
    {
      computeFinale: async () => {
        throw new Error("should not finalize");
      },
    },
    new FixedClock(harness.nowMs),
    { leaseMs: 30_000, baseRetryMs: 1_000, maxRetryMs: 60_000 },
  );

  await assert.rejects(
    () => worker.tick("worker-a"),
    (error: unknown) =>
      error instanceof PressurePersistenceError
      && error.code === PERSISTENCE_ERROR.OUTBOX_LEASE_LOST,
  );
});

test("only one consumer claims the same row", async () => {
  const harness = new ProgressOutboxHarness();
  harness.insertRow(makeChapterFrozenRow("N2"));
  const repo = new PrismaProgressOutboxRepositoryV1(harness.client);

  const [first, second] = await Promise.all([
    repo.claimNext({ workerId: "worker-a", nowMs: harness.nowMs, leaseMs: 30_000 }),
    repo.claimNext({ workerId: "worker-b", nowMs: harness.nowMs, leaseMs: 30_000 }),
  ]);

  const claimed = [first, second].filter((item) => item.kind === "CLAIMED");
  assert.equal(claimed.length, 1);
  assert.ok([first.kind, second.kind].includes("BUSY"));
});

class FixedClock implements ProgressOutboxClockPortV1 {
  constructor(private readonly value: number) {}
  nowMs(): number {
    return this.value;
  }
}

class IdempotentOpenRuntime implements RuntimeProgressOpenChapterPortV1 {
  public readonly opens = new Map<string, string>();
  public replays = 0;

  async openNextChapter({ handoff }: Parameters<RuntimeProgressOpenChapterPortV1["openNextChapter"]>[0]) {
    const key = `${handoff.runId}:${handoff.targetChapterId}:${handoff.sourceBundleHash}`;
    const existing = this.opens.get(key);
    if (existing) {
      this.replays += 1;
      return {
        status: "REPLAYED" as const,
        chapterId: handoff.targetChapterId,
        chapterRuntimeId: existing,
      };
    }
    const runtimeId = `runtime-${handoff.targetChapterId.toLowerCase()}`;
    this.opens.set(key, runtimeId);
    return {
      status: "OPENED" as const,
      chapterId: handoff.targetChapterId,
      chapterRuntimeId: runtimeId,
    };
  }
}

type HarnessRow = {
  id: string;
  runId: string;
  taskType: string;
  dedupeKey: string;
  sourceAuthority: string;
  sourceId: string;
  sourceCommitHash: string;
  payloadJson: unknown;
  payloadHash: string;
  status: string;
  checkpoint: string;
  attempt: number;
  maxAttempts: number;
  availableAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseVersion: number;
  createdAt: Date;
  lastError: string | null;
  completedAt: Date | null;
};

type InsertableRow =
  | ReturnType<typeof makeGenesisN1Row>
  | ReturnType<typeof makeChapterFrozenRow>
  | ReturnType<typeof makeFinaleRow>;

class ProgressOutboxHarness {
  public nowMs = Date.parse("2026-08-11T00:00:00.000Z");
  public readonly rows: HarnessRow[] = [];
  private tail = Promise.resolve();

  readonly client = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>) => {
      let release!: () => void;
      const previous = this.tail;
      this.tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await operation(this.tx);
      } finally {
        release();
      }
    },
  };

  readonly tx = {
    pressureOutboxTask: {
      findFirst: async ({ where, orderBy, select }: any) => {
        const filtered = this.rows.filter((row) => matches(row, where));
        const sorted = [...filtered].sort(compareRows(orderBy));
        const row = sorted[0] ?? null;
        return row ? project(row, select) : null;
      },
      findUnique: async ({ where, select }: any) => {
        const row = this.rows.find((candidate) => matches(candidate, where)) ?? null;
        return row ? project(row, select) : null;
      },
      findUniqueOrThrow: async ({ where, select }: any) => {
        const row = this.rows.find((candidate) => matches(candidate, where));
        if (!row) throw new Error("ROW_NOT_FOUND");
        return project(row, select);
      },
      updateMany: async ({ where, data }: any) => {
        const rows = this.rows.filter((row) => matches(row, where));
        for (const row of rows) applyData(row, data);
        return { count: rows.length };
      },
    },
  };

  insertRow(row: InsertableRow) {
    this.rows.push({
      ...row,
      status: row.status,
      checkpoint: "PERSISTED",
      attempt: 0,
      maxAttempts: 5,
      availableAt: new Date(this.nowMs),
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseVersion: 0,
      createdAt: new Date(this.nowMs + this.rows.length),
      lastError: null,
      completedAt: null,
    });
  }
}

function makeGenesisN1Row() {
  const payload = {
    schemaVersion: "pressure_open_chapter_task_v1",
    runId: "run-1",
    chapterId: "N1",
    genesisHash: digest("genesis"),
    sourceCommitHash: digest("genesis-commit"),
  };
  return {
    id: "outbox-genesis",
    runId: "run-1",
    taskType: "OPEN_CHAPTER",
    dedupeKey: "open_chapter:run-1:N1:genesis",
    sourceAuthority: "GENESIS_FROZEN",
    sourceId: digest("genesis"),
    sourceCommitHash: digest("genesis-commit"),
    payloadJson: payload,
    payloadHash: sha256Canonical(payload),
    status: "PENDING",
  };
}

function makeChapterFrozenRow(chapterId: "N2" | "N3" | "N4" | "N5" | "N6" | "N7") {
  const chapterRuntimeId = `runtime-${Number(chapterId.slice(1)) - 1}`;
  const sourceBundleHash = digest(`bundle:${chapterRuntimeId}`);
  const payload = {
    schemaVersion: "pressure_chapter_handoff_outbox_v1",
    taskType: "OPEN_CHAPTER" as const,
    status: "PENDING" as const,
    dedupeKey: `handoff:${chapterRuntimeId}:${chapterId}`,
    runId: "run-1",
    chapterRuntimeId,
    sourceRootEventId: `event:${chapterRuntimeId}`,
    sourceRootEventHash: digest(`event:${chapterRuntimeId}`),
    sourceBundleHash,
    target: { kind: "NEXT_CHAPTER" as const, chapterId },
    outboxHash: "",
  };
  payload.outboxHash = hashWithoutField(
    payload as unknown as Record<string, unknown>,
    "outboxHash",
  );
  return {
    id: `outbox:${chapterId}`,
    runId: "run-1",
    taskType: "OPEN_CHAPTER",
    dedupeKey: payload.dedupeKey,
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: sourceBundleHash,
    sourceCommitHash: digest(`commit:${chapterRuntimeId}`),
    payloadJson: payload,
    payloadHash: payload.outboxHash,
    status: "PENDING",
  };
}

function makeFinaleRow(chapterRuntimeId: string) {
  const sourceBundleHash = digest(`bundle:${chapterRuntimeId}`);
  const payload = {
    schemaVersion: "pressure_chapter_handoff_outbox_v1",
    taskType: "COMPUTE_FINALE" as const,
    status: "PENDING" as const,
    dedupeKey: `handoff:${chapterRuntimeId}:finale`,
    runId: "run-1",
    chapterRuntimeId,
    sourceRootEventId: `event:${chapterRuntimeId}`,
    sourceRootEventHash: digest(`event:${chapterRuntimeId}`),
    sourceBundleHash,
    target: { kind: "FINALE" as const, chapterId: null },
    outboxHash: "",
  };
  payload.outboxHash = hashWithoutField(
    payload as unknown as Record<string, unknown>,
    "outboxHash",
  );
  return {
    id: "outbox:finale",
    runId: "run-1",
    taskType: "COMPUTE_FINALE",
    dedupeKey: payload.dedupeKey,
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: sourceBundleHash,
    sourceCommitHash: digest(`commit:${chapterRuntimeId}`),
    payloadJson: payload,
    payloadHash: payload.outboxHash,
    status: "PENDING",
  };
}

function parseStoredOpenTask(task: ProgressOutboxStoredTaskV1) {
  const payload = task.payloadJson as any;
  return {
    sourceAuthority: "CHAPTER_FROZEN" as const,
    runId: task.runId,
    previousChapterRuntimeId: payload.chapterRuntimeId,
    outboxDedupeKey: task.dedupeKey,
    sourceBundleHash: task.sourceId,
    sourceCommitHash: task.sourceCommitHash,
    targetChapterId: payload.target.chapterId,
  };
}

function digest(value: string): string {
  return sha256Canonical({ value });
}

function compareRows(orderBy: Array<Record<string, "asc" | "desc">> | undefined) {
  const criteria = orderBy ?? [];
  return (left: HarnessRow, right: HarnessRow) => {
    for (const clause of criteria) {
      const [field, direction] = Object.entries(clause)[0]!;
      const leftValue = left[field as keyof HarnessRow] as Date | string | number | null;
      const rightValue = right[field as keyof HarnessRow] as Date | string | number | null;
      const leftKey = leftValue instanceof Date ? leftValue.getTime() : leftValue ?? "";
      const rightKey = rightValue instanceof Date ? rightValue.getTime() : rightValue ?? "";
      if (leftKey < rightKey) return direction === "asc" ? -1 : 1;
      if (leftKey > rightKey) return direction === "asc" ? 1 : -1;
    }
    return 0;
  };
}

function project<T extends object>(row: HarnessRow, select: Record<string, true> | undefined): T {
  if (!select) return structuredClone(row) as T;
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(select)) projected[key] = structuredClone((row as Record<string, unknown>)[key]);
  return projected as T;
}

function applyData(row: HarnessRow, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "increment" in value) {
      row[key as keyof HarnessRow] = (
        Number(row[key as keyof HarnessRow] as number)
        + Number((value as { increment: number }).increment)
      ) as never;
      continue;
    }
    row[key as keyof HarnessRow] = structuredClone(value) as never;
  }
}

function matches(row: HarnessRow, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      if (!Array.isArray(value) || !value.some((item) => matches(row, item))) return false;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if ("in" in record) {
        if (!(record.in as unknown[]).includes(row[key as keyof HarnessRow] as never)) return false;
        continue;
      }
      if ("lte" in record) {
        const rowValue = row[key as keyof HarnessRow] as Date | null;
        if (!(rowValue instanceof Date) || rowValue.getTime() > (record.lte as Date).getTime()) return false;
        continue;
      }
      if ("gt" in record) {
        const rowValue = row[key as keyof HarnessRow] as Date | null;
        if (!(rowValue instanceof Date) || rowValue.getTime() <= (record.gt as Date).getTime()) return false;
        continue;
      }
      if ("not" in record) {
        if (row[key as keyof HarnessRow] === record.not) return false;
        continue;
      }
    }
    if ((row as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}
