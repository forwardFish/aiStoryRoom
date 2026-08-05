import assert from "node:assert/strict";
import test from "node:test";
import { DefaultOptionsAndMemory } from "../src/options-memory-module.js";

const committedOption = {
  id: "committed.next",
  label: "Act from the committed world state.",
};
const provisionalOption = {
  id: "provisional.next",
  label: "Pre-commit projection that must not win.",
};

function fixture(input?: {
  currentOptions?: () => Promise<any[]>;
  storyComplete?: boolean;
}) {
  const sequence: string[] = [];
  const emitted: any[] = [];
  const sceneEvents: any[] = [];
  const published: any[] = [];
  let nextOptionsCalls = 0;
  let providerCalls = 0;
  const workspace = {
    async enqueueStorykeeper() {
      sequence.push("memory-enqueued");
    },
    async publishTurnOptions(_runId: string, value: any) {
      sequence.push("options-published");
      published.push(value);
    },
    async recordSceneEvent(_runId: string, value: any) {
      sequence.push(`scene:${String(value.type)}`);
      sceneEvents.push(value);
    },
    async recordModelCall() {
      throw new Error("model options must not run for authored decisions");
    },
  } as any;
  const provider = {
    describe() {
      return { provider: "fixture", model: "fixture", configured: true };
    },
    async generate() {
      providerCalls += 1;
      throw new Error("model options must not run for authored decisions");
    },
  } as any;
  const adapter = {
    async currentOptions() {
      sequence.push("committed-options-read");
      return input?.currentOptions
        ? input.currentOptions()
        : [committedOption];
    },
    nextOptions() {
      nextOptionsCalls += 1;
      return [provisionalOption];
    },
  } as any;
  const preparedDecision = {
    storyComplete: input?.storyComplete || false,
  } as any;
  const result = {
    runId: "run.options",
    turnId: "T01",
    turnNumber: 1,
    narration: "Committed Canon.",
    options: [provisionalOption],
    framing: "",
    tension: "reader-directed",
    storyComplete: preparedDecision.storyComplete,
    causalDelta: { events: [] },
    warnings: [],
    narrator: {
      text: "Committed Canon.",
      model: "fixture",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    },
    committedAt: "2026-08-05T00:00:00.000Z",
  } as any;
  const module = new DefaultOptionsAndMemory(
    workspace,
    provider,
    { kick: async () => {} },
  );
  const run = () => module.afterCommit({
    runId: "run.options",
    turnId: "T01",
    action: "Reader action",
    result,
    currentSnapshot: { previousOptions: [] } as any,
    compiled: {
      foregroundGuidance: "",
      durableMemory: "",
      storyMemory: "",
      recentCanonExcerpt: "",
    } as any,
    publishedNarration: result.narration,
    factNarration: result.narration,
    narrativeOwner: "NARRATOR",
    shadowClaims: [],
    selectedOption: null,
    causalDelta: result.causalDelta,
    preparedDecision,
    authoredAdapter: adapter,
    emit(event: any) {
      emitted.push(event);
    },
  });
  return {
    run,
    sequence,
    emitted,
    sceneEvents,
    published,
    providerCalls: () => providerCalls,
    nextOptionsCalls: () => nextOptionsCalls,
  };
}

test("authored Options are derived from committed world state before publication", async () => {
  const state = fixture();
  const output = await state.run();

  assert.deepEqual(output.options, [committedOption]);
  assert.deepEqual(output.warnings, []);
  assert.equal(state.providerCalls(), 0);
  assert.equal(state.nextOptionsCalls(), 0);
  assert.ok(
    state.sequence.indexOf("committed-options-read")
      < state.sequence.indexOf("options-published"),
  );
  assert.equal(state.published[0]?.options[0]?.id, committedOption.id);
  assert.equal(
    state.sceneEvents.find((event) => event.type === "foreground_authored_options")
      ?.optionSource,
    "COMMITTED_WORLD_STATE",
  );
});

test("committed-state lookup failure is advisory and falls back without invalidating Canon", async () => {
  const state = fixture({
    currentOptions: async () => {
      throw new Error("fixture committed state unavailable");
    },
  });
  const output = await state.run();

  assert.deepEqual(output.options, [provisionalOption]);
  assert.equal(output.warnings.length, 1);
  assert.equal(
    output.warnings[0]?.code,
    "AUTHORED_OPTIONS_COMMITTED_STATE_UNAVAILABLE",
  );
  assert.equal(output.warnings[0]?.blocksPlayer, false);
  assert.equal(state.providerCalls(), 0);
  assert.equal(state.nextOptionsCalls(), 0);
  assert.equal(state.published[0]?.options[0]?.id, provisionalOption.id);
  assert.equal(
    state.emitted.some((event) => (
      event.type === "runtime.warning"
      && event.data?.code === "AUTHORED_OPTIONS_COMMITTED_STATE_UNAVAILABLE"
    )),
    true,
  );
});

test("PART_END publishes no next Options and does not query another decision point", async () => {
  const state = fixture({ storyComplete: true });
  const output = await state.run();

  assert.deepEqual(output.options, []);
  assert.equal(output.storyComplete, true);
  assert.equal(state.providerCalls(), 0);
  assert.equal(state.nextOptionsCalls(), 0);
  assert.equal(state.sequence.includes("committed-options-read"), false);
  assert.deepEqual(state.published[0]?.options, []);
});
