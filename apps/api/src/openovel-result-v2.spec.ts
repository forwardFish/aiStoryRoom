import assert from "node:assert/strict";
import test from "node:test";
import {
  NARRATIVE_PROJECTION_STATUSES,
  parseStoredOpenNovelResultV2,
  projectOpenNovelResultV2,
} from "@ai-story/shared";
import {
  readOpenNovelResultV2,
  resolveNarrativeStatusV2,
} from "./openovel-result-v2";

const stored = {
  schemaVersion: "openovel-result-v2",
  authoritativeResultStatus: "FINALIZED",
  structuredResultReady: true,
  sourceKind: "B0_FINALE",
  sourceCommitHash: "a".repeat(64),
  decisionHash: "b".repeat(64),
  worldSequence: 6,
  completedAt: "2026-08-12T00:00:00.000Z",
  room: { id: "run.result", title: "Result Room", worldId: "sangtian" },
  ending: {
    scope: "STORY",
    endingKey: "resolved",
    title: "Authoritative ending",
    summary: "The world result is final.",
    protagonistFate: "The role bears the recorded consequence.",
    aftermath: ["Canon remains unchanged."],
  },
  canon: [{ factKey: "result.final", content: "The result is committed." }],
  result: {
    title: "Authoritative ending",
    summary: "The world result is final.",
    worldOutcome: "Canon remains unchanged.",
  },
  seatResults: [
    {
      roleId: "role.1",
      roleKey: "governor",
      roleName: "Governor",
      outcome: "RESOLVED",
      title: "Recorded fate",
      summary: "Only this role projection is returned.",
      causes: ["Cause A"],
    },
    {
      roleId: "role.2",
      roleKey: "merchant",
      roleName: "Merchant",
      outcome: "LOSS",
      title: "Hidden other seat",
      summary: "Must not be projected to role.1.",
      causes: ["Private cause"],
    },
  ],
  narrativeStatus: "PENDING",
} as const;

test("openovel-result-v2 projects all six narrative states without changing authority", () => {
  const parsed = parseStoredOpenNovelResultV2(stored);
  assert.ok(parsed);
  for (const status of NARRATIVE_PROJECTION_STATUSES) {
    const projected = projectOpenNovelResultV2(parsed, "role.1", {
      status,
      content: status === "PUBLISHED" || status === "FALLBACK_PUBLISHED" ? `content:${status}` : null,
      presentationHash: status === "PUBLISHED" || status === "FALLBACK_PUBLISHED" ? "c".repeat(64) : null,
      updatedAt: "2026-08-12T00:01:00.000Z",
    });
    assert.equal(projected.authoritativeResultStatus, "FINALIZED");
    assert.equal(projected.structuredResultReady, true);
    assert.equal(projected.sourceCommitHash, stored.sourceCommitHash);
    assert.equal(projected.decisionHash, stored.decisionHash);
    assert.equal(projected.worldSequence, stored.worldSequence);
    assert.equal(projected.narrativeStatus, status);
    assert.equal(projected.player?.roleId, "role.1");
    assert.equal(JSON.stringify(projected).includes("Hidden other seat"), false);
  }
});

test("result reader is read-only and prefers published artifact status", async () => {
  const writes: string[] = [];
  const prisma = {
    storyRun: {
      findUnique: async () => ({
        id: "run.result",
        ownerUserId: "user.1",
        selectedRoleKey: "governor",
        stateJson: { openNovelResultV2: stored },
        players: [{ userId: "user.1", role: { id: "role.1", roleKey: "governor", roleName: "Governor" } }],
        roles: [],
      }),
      update: async () => { writes.push("storyRun.update"); },
    },
    narrativeEntry: {
      findFirst: async () => ({
        content: "Published prose",
        presentationHash: "c".repeat(64),
        projectionStatus: "PUBLISHED",
        updatedAt: new Date("2026-08-12T00:02:00.000Z"),
      }),
      create: async () => { writes.push("narrativeEntry.create"); },
    },
    storyTaskOutbox: {
      findFirst: async () => ({
        status: "completed",
        resultJson: { narrativeStatus: "FALLBACK_PUBLISHED" },
        updatedAt: new Date("2026-08-12T00:01:00.000Z"),
      }),
      update: async () => { writes.push("storyTaskOutbox.update"); },
    },
  };
  const result = await readOpenNovelResultV2(prisma as any, { id: "user.1" } as any, "run.result");
  assert.equal(result?.narrativeStatus, "PUBLISHED");
  assert.equal(result?.narrative.content, "Published prose");
  assert.deepEqual(writes, []);
});

test("failed leased task is exposed as FAILED_RETRYABLE before stale task metadata", () => {
  assert.equal(resolveNarrativeStatusV2({
    taskStatus: "failed",
    taskProjectionStatus: "GENERATING",
    fallback: "PENDING",
  }), "FAILED_RETRYABLE");
});
