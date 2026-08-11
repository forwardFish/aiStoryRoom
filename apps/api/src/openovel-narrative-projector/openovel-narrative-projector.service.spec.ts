import assert from "node:assert/strict";
import test from "node:test";
import { NarrativeContextCompiler } from "./narrative-context-compiler";
import { NarrativeFallbackRenderer } from "./narrative-fallback-renderer";
import { NarrativeTruthGuard } from "./narrative-truth-guard";
import { OpenNovelNarrativeProjector } from "./openovel-narrative-projector.service";
import type { OpenNovelNarrativeSourceV1 } from "./openovel-narrative-projector.contract";

const fence = { taskId: "task.1", leaseOwner: "worker.1", leaseVersion: 3 };

function source(overrides: Partial<OpenNovelNarrativeSourceV1> = {}): OpenNovelNarrativeSourceV1 {
  return {
    schemaVersion: "openovel-narrative-source-v1",
    sourceKind: "B0_SETTLEMENT",
    sourceCommitHash: "a".repeat(64),
    runId: "run.1",
    nodeId: "node.1",
    windowId: "window.1",
    roleId: "role.a",
    entryType: "B0_NARRATIVE",
    visibility: "private",
    worldSequence: 4,
    dedupeKey: "b0-narrative:batch.1:role.a:SETTLEMENT_ROLE_VIEW",
    providerInput: { recipientActorId: "role.a" },
    fallbackLines: ["The council accepted the bounded settlement."],
    forbiddenPhrases: ["Hidden Chancellor"],
    forbiddenClaims: ["gained 100 gold"],
    sourceTaskResult: null,
    ...overrides,
  };
}

function fixture(render: () => Promise<{ text: string; model: string | null; providerRequestId: string | null }>) {
  const progress: string[] = [];
  const publications: any[] = [];
  const authorityWrites: string[] = [];
  const projector = new OpenNovelNarrativeProjector(
    { read: async () => source() } as any,
    new NarrativeContextCompiler(),
    { render } as any,
    new NarrativeTruthGuard(),
    new NarrativeFallbackRenderer(),
    {
      markStatus: async (input: any) => { progress.push(input.status); },
      publish: async (input: any) => {
        publications.push(input);
        return { outcome: input.narrativeStatus, narrativeEntryId: "entry.1" };
      },
      authoritativeWrite: () => authorityWrites.push("unexpected"),
    } as any,
  );
  return { projector, progress, publications, authorityWrites };
}

test("OpenNovelNarrativeProjector publishes a valid role-scoped rendering after explicit phases", async () => {
  const { projector, progress, publications, authorityWrites } = fixture(async () => ({
    text: "The council accepted the bounded settlement.",
    model: "deepseek-chat",
    providerRequestId: "request.1",
  }));

  const result = await projector.projectTask(fence.taskId, fence);

  assert.equal(result.outcome, "PUBLISHED");
  assert.deepEqual(progress, ["GENERATING", "VALIDATING"]);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].narrativeStatus, "PUBLISHED");
  assert.equal(publications[0].content, "The council accepted the bounded settlement.");
  assert.equal(publications[0].failureCode, null);
  assert.deepEqual(authorityWrites, []);
});

for (const [name, error, code] of [
  ["timeout", new Error("provider timed out"), "NARRATIVE_RENDERER_TIMEOUT"],
  ["HTTP 500", new Error("HTTP 500 from provider"), "NARRATIVE_RENDERER_HTTP_ERROR"],
  ["empty text", new Error("NARRATIVE_RENDERER_EMPTY_TEXT"), "NARRATIVE_RENDERER_EMPTY"],
] as const) {
  test(`OpenNovelNarrativeProjector publishes deterministic fallback on ${name}`, async () => {
    const { projector, progress, publications } = fixture(async () => { throw error; });

    const result = await projector.projectTask(fence.taskId, fence);

    assert.equal(result.outcome, "FALLBACK_PUBLISHED");
    assert.deepEqual(progress, ["GENERATING"]);
    assert.equal(publications[0].narrativeStatus, "FALLBACK_PUBLISHED");
    assert.equal(publications[0].content, "The council accepted the bounded settlement.");
    assert.equal(publications[0].failureCode, code);
  });
}

for (const [name, text, failureCode] of [
  ["unsourced fact", "The role gained 100 gold.", "NARRATIVE_UNSOURCED_FACT"],
  ["cross-seat disclosure", "Hidden Chancellor ordered the vote.", "NARRATIVE_CROSS_AUDIENCE_DISCLOSURE"],
  ["invented victory", "The role won a total victory.", "NARRATIVE_UNSOURCED_OUTCOME"],
] as const) {
  test(`NarrativeTruthGuard converts ${name} to deterministic fallback`, async () => {
    const { projector, progress, publications } = fixture(async () => ({
      text,
      model: "deepseek-chat",
      providerRequestId: "request.guard",
    }));

    await projector.projectTask(fence.taskId, fence);

    assert.deepEqual(progress, ["GENERATING", "VALIDATING"]);
    assert.equal(publications[0].narrativeStatus, "FALLBACK_PUBLISHED");
    assert.equal(publications[0].failureCode, failureCode);
    assert.equal(publications[0].content, "The council accepted the bounded settlement.");
  });
}

test("publisher or worker failure remains retryable and is never converted into authority success", async () => {
  let publishCalls = 0;
  const projector = new OpenNovelNarrativeProjector(
    { read: async () => source() } as any,
    new NarrativeContextCompiler(),
    { render: async () => ({ text: "The council accepted the bounded settlement.", model: null, providerRequestId: null }) } as any,
    new NarrativeTruthGuard(),
    new NarrativeFallbackRenderer(),
    {
      markStatus: async () => undefined,
      publish: async () => { publishCalls += 1; throw new Error("NARRATIVE_PUBLISH_STORAGE_UNAVAILABLE"); },
    } as any,
  );

  await assert.rejects(() => projector.projectTask(fence.taskId, fence), /NARRATIVE_PUBLISH_STORAGE_UNAVAILABLE/);
  assert.equal(publishCalls, 1);
});
