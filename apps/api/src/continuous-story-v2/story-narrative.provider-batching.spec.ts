import assert from "node:assert/strict";
import test from "node:test";
import { StoryNarrativeProvider } from "./story-narrative.provider";

function candidate(id: string) {
  return {
    id,
    label: id,
    description: `Description ${id}`,
    risk: "NORMAL",
    concreteCost: "time",
    expectedCountermove: "review",
    visibility: "PRIVATE",
    intentDraft: { objective: "protect the role", target: "records", method: "review" }
  } as never;
}

function decisionInput(turnId: string) {
  return {
    contextRecordId: `context-${turnId}`,
    finalStory: `Final story for ${turnId}`,
    candidates: [candidate(`${turnId}-a`), candidate(`${turnId}-b`)],
    context: {
      identity: {
        runId: "run-batch",
        templateKey: "sangtian",
        engineVersion: "continuous_story_v2",
        roleId: `role-${turnId}`,
        actorTurnId: turnId,
        macroStageKey: "opening",
        worldSequence: 1,
        turnRevision: 1,
        controlEpoch: 4,
        snapshotHash: `snapshot-${turnId}`
      },
      renderedWorkingSet: `Private bounded context for ${turnId}`
    }
  } as never;
}

function providerHarness() {
  const persisted: unknown[] = [];
  const provider = new StoryNarrativeProvider({
    promptExecutionRecord: {
      createMany: async (input: unknown) => {
        persisted.push(input);
        return { count: 1 };
      }
    }
  } as never);
  let providerCalls = 0;
  provider.generate = async (request) => {
    providerCalls += 1;
    const turns = JSON.parse(request.userPrompt).turns as Array<{ turnId: string; controlEpoch: number; candidates: Array<{ id: string }> }>;
    return {
      content: JSON.stringify({ decisions: turns.map((turn) => ({
        turnId: turn.turnId,
        controlEpoch: turn.controlEpoch,
        candidateId: turn.candidates[0]!.id,
        rationale: "This bounded choice protects the role while preserving the shared timeline."
      })) }),
      provider: "test",
      modelName: "batch-test"
    };
  };
  return { provider, persisted, providerCalls: () => providerCalls };
}

test("V2 coalesces multiple AI roles in one run into one provider request", async () => {
  const previous = { enabled: process.env.AI_BATCHING_ENABLED, wait: process.env.AI_BATCH_MAX_WAIT_MS, size: process.env.AI_BATCH_MAX_SIZE };
  process.env.AI_BATCHING_ENABLED = "true";
  process.env.AI_BATCH_MAX_WAIT_MS = "15";
  process.env.AI_BATCH_MAX_SIZE = "6";
  try {
    const harness = providerHarness();
    const [first, second] = await Promise.all([
      harness.provider.decideAgent(decisionInput("turn-1")),
      harness.provider.decideAgent(decisionInput("turn-2"))
    ]);
    assert.equal(harness.providerCalls(), 1);
    assert.equal(first.candidateId, "turn-1-a");
    assert.equal(second.candidateId, "turn-2-a");
    assert.equal(harness.persisted.length, 2);
  } finally {
    restore("AI_BATCHING_ENABLED", previous.enabled);
    restore("AI_BATCH_MAX_WAIT_MS", previous.wait);
    restore("AI_BATCH_MAX_SIZE", previous.size);
  }
});

test("V2 micro-batch releases a lone AI role without waiting for other humans", async () => {
  const previous = { enabled: process.env.AI_BATCHING_ENABLED, wait: process.env.AI_BATCH_MAX_WAIT_MS, size: process.env.AI_BATCH_MAX_SIZE };
  process.env.AI_BATCHING_ENABLED = "true";
  process.env.AI_BATCH_MAX_WAIT_MS = "20";
  process.env.AI_BATCH_MAX_SIZE = "6";
  try {
    const harness = providerHarness();
    const started = Date.now();
    const result = await harness.provider.decideAgent(decisionInput("turn-solo-ai"));
    assert.equal(result.candidateId, "turn-solo-ai-a");
    assert.equal(harness.providerCalls(), 1);
    assert.ok(Date.now() - started < 250, "micro-batch must stay below the configured 250ms ceiling");
  } finally {
    restore("AI_BATCHING_ENABLED", previous.enabled);
    restore("AI_BATCH_MAX_WAIT_MS", previous.wait);
    restore("AI_BATCH_MAX_SIZE", previous.size);
  }
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
