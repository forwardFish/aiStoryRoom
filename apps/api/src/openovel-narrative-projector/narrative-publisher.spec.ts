import assert from "node:assert/strict";
import test from "node:test";
import { NarrativePublisher } from "./narrative-publisher";
import type { NarrativePublicationInputV1 } from "./openovel-narrative-projector.contract";

function publication(overrides: Partial<NarrativePublicationInputV1> = {}): NarrativePublicationInputV1 {
  return {
    taskId: "task.1",
    leaseOwner: "worker.1",
    leaseVersion: 2,
    source: {
      schemaVersion: "openovel-narrative-source-v1",
      sourceKind: "B0_SETTLEMENT",
      sourceCommitHash: "b".repeat(64),
      runId: "run.1",
      nodeId: "node.1",
      windowId: "window.1",
      roleId: "role.a",
      entryType: "B0_NARRATIVE",
      visibility: "private",
      worldSequence: 2,
      dedupeKey: "narrative.logical.1",
      providerInput: {},
      fallbackLines: ["A bounded result was confirmed."],
      forbiddenPhrases: [],
      forbiddenClaims: [],
      sourceTaskResult: { narrativeStatus: "PENDING" },
    },
    content: "A bounded result was confirmed.",
    narrativeStatus: "PUBLISHED",
    failureCode: null,
    model: "deepseek-chat",
    providerRequestId: "provider.1",
    ...overrides,
  };
}

function inMemoryPrisma() {
  const visible = {
    task: {
      id: "task.1",
      taskType: "B0_NARRATIVE_GENERATION",
      status: "running",
      leaseOwner: "worker.1",
      leaseVersion: 2,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      resultJson: { narrativeStatus: "PENDING" } as any,
      outcome: null as string | null,
      completedAt: null as Date | null,
    },
    entries: new Map<string, any>(),
  };
  let transactions = 0;
  const prisma: any = {
    storyTaskOutbox: {
      findUnique: async () => ({ resultJson: visible.task.resultJson }),
      updateMany: async (args: any) => {
        if (args.where.status !== visible.task.status
          || args.where.leaseOwner !== visible.task.leaseOwner
          || args.where.leaseVersion !== visible.task.leaseVersion) return { count: 0 };
        visible.task.resultJson = args.data.resultJson;
        return { count: 1 };
      },
    },
    $transaction: async (callback: any) => {
      transactions += 1;
      const stagedTask = { ...visible.task };
      const stagedEntries = new Map(visible.entries);
      const tx = {
        storyTaskOutbox: {
          updateMany: async (args: any) => {
            const eligible = stagedTask.status === args.where.status
              && stagedTask.leaseOwner === args.where.leaseOwner
              && stagedTask.leaseVersion === args.where.leaseVersion
              && stagedTask.leaseExpiresAt.getTime() > Date.now();
            if (!eligible) return { count: 0 };
            Object.assign(stagedTask, args.data);
            return { count: 1 };
          },
          update: async (args: any) => {
            stagedTask.resultJson = args.data.resultJson;
            return stagedTask;
          },
        },
        narrativeEntry: {
          upsert: async (args: any) => {
            const key = args.where.dedupeKey;
            const existing = stagedEntries.get(key);
            if (existing) {
              const next = {
                ...existing,
                ...args.update,
                projectionAttempt: existing.projectionAttempt + Number(args.update.projectionAttempt?.increment ?? 0),
                updatedAt: new Date(),
              };
              stagedEntries.set(key, next);
              return next;
            }
            const created = { id: "entry.1", ...args.create, createdAt: new Date(), updatedAt: new Date() };
            stagedEntries.set(key, created);
            return created;
          },
        },
      };
      const result = await callback(tx);
      visible.task = stagedTask;
      visible.entries = stagedEntries;
      return result;
    },
  };
  return { prisma, visible, transactionCount: () => transactions };
}

test("NarrativePublisher exposes artifact and completed task atomically", async () => {
  const memory = inMemoryPrisma();
  const publisher = new NarrativePublisher(memory.prisma);

  const result = await publisher.publish(publication());

  assert.equal(result.outcome, "PUBLISHED");
  assert.equal(memory.visible.task.status, "completed");
  assert.equal(memory.visible.task.leaseOwner, null);
  assert.equal(memory.visible.entries.size, 1);
  const entry = [...memory.visible.entries.values()][0];
  assert.equal(entry.projectionStatus, "PUBLISHED");
  assert.equal(entry.sourceCommitHash, "b".repeat(64));
  assert.equal(memory.transactionCount(), 1);
});

test("NarrativePublisher never creates an artifact after losing the lease", async () => {
  const memory = inMemoryPrisma();
  memory.visible.task.leaseOwner = "worker.replacement";
  const publisher = new NarrativePublisher(memory.prisma);

  const result = await publisher.publish(publication());

  assert.equal(result.outcome, "LEASE_LOST");
  assert.equal(memory.visible.entries.size, 0);
});

test("fallback publication can be retried into one logical published artifact", async () => {
  const memory = inMemoryPrisma();
  const publisher = new NarrativePublisher(memory.prisma);
  const fallback = publication({
    narrativeStatus: "FALLBACK_PUBLISHED",
    failureCode: "NARRATIVE_RENDERER_TIMEOUT",
    content: "A bounded result was confirmed.",
  });

  const first = await publisher.publish(fallback);
  assert.equal(first.outcome, "FALLBACK_PUBLISHED");
  assert.equal(memory.visible.entries.size, 1);

  memory.visible.task.status = "running";
  memory.visible.task.leaseOwner = "worker.2";
  memory.visible.task.leaseVersion = 3;
  memory.visible.task.leaseExpiresAt = new Date(Date.now() + 60_000);
  const second = await publisher.publish(publication({
    leaseOwner: "worker.2",
    leaseVersion: 3,
    content: "The verified provider rendering replaces the fallback.",
  }));

  assert.equal(second.outcome, "PUBLISHED");
  assert.equal(memory.visible.entries.size, 1, "dedupeKey must identify one logical NarrativeArtifact");
  const entry = [...memory.visible.entries.values()][0];
  assert.equal(entry.content, "The verified provider rendering replaces the fallback.");
  assert.equal(entry.projectionStatus, "PUBLISHED");
  assert.equal(entry.projectionAttempt, 2);
});

test("projection progress changes only leased outbox metadata", async () => {
  const memory = inMemoryPrisma();
  const publisher = new NarrativePublisher(memory.prisma);

  await publisher.markStatus({ taskId: "task.1", leaseOwner: "worker.1", leaseVersion: 2, status: "GENERATING" });
  assert.equal(memory.visible.task.resultJson.narrativeStatus, "GENERATING");
  assert.equal(memory.visible.entries.size, 0);
});
