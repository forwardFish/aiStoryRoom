import assert from "node:assert/strict";
import test from "node:test";
import { DefaultActionGateway } from "../src/action-gateway.js";
import { DefaultPlayerProjection } from "../src/player-projection-module.js";
import { DefaultSurfaceGuard } from "../src/surface-guard-module.js";
import { OpenNovelRuntime } from "../src/runtime.js";
import { ObserveOnlySceneReviewPolicy } from "../src/scene-review-modules.js";
import type { AuthoredDecisionAdapter } from "../src/decision-adapter.js";
import type { SceneTruthObserverModule } from "../src/scene-review-modules.js";
import type { CausalDelta, CompiledForegroundContext, OpenNovelProvider } from "../src/types.js";

const compiled: CompiledForegroundContext = {
  foregroundGuidance: "## Scene\n\n签押房",
  durableMemory: "原册仍在清流县档房。",
  storyMemory: "",
  recentCanonExcerpt: "书吏在屏风外等候。",
  report: {
    usedChars: 0,
    budgets: {},
    truncated: [],
    removedPlayerDirectiveClauses: 0,
    deduplicatedContextCardSections: 0,
  },
};

const causalDelta: CausalDelta = {
  turnId: "T01",
  source: "bound-option",
  readerAction: "暂缓签发，先保住档房现场。",
  immediateIntent: "暂缓签发",
  protagonistScope: "bounded-action",
  stopCondition: "巡抚书吏等待回文",
  allowedKnowledge: [],
  forbiddenKnowledge: [],
  evidenceSubjects: [],
  scenePacket: null,
  beatContract: null,
  durableHints: [],
  requiredNarrativeFacts: [],
};

test("ActionGateway owns input/revision/binding without story semantics", () => {
  const gateway = new DefaultActionGateway();
  assert.equal(gateway.validate({
    runId: "run-1",
    rawAction: "  暂缓签发  ",
    expectedStateRevision: 3,
    currentStateRevision: 3,
  }).action, "暂缓签发");
  assert.throws(() => gateway.validate({
    runId: "run-1",
    rawAction: "继续",
    expectedStateRevision: 2,
    currentStateRevision: 3,
  }), /STATE_REVISION_CONFLICT/u);
  assert.equal(gateway.resolveBoundOption(
    { id: "A", label: "暂缓签发" },
    [{ id: "A", label: "暂缓签发" }],
    "暂缓签发",
  )?.id, "A");
});

test("PlayerProjection emits model-visible messages but not backstage IDs", () => {
  const output = new DefaultPlayerProjection().project({
    causalDelta,
    compiled,
    beatManifest: {
      beatId: "beat.secret-id",
      sourceRef: "claim.secret-id",
      transition: {
        beforeScene: {
          sceneId: "scene.secret-id",
          timeLabel: "当日",
          locationLabel: "签押房",
          presentActorIds: ["actor.secret-id"],
        },
        narrationScene: {
          sceneId: "scene.secret-id",
          timeLabel: "当日",
          locationLabel: "签押房",
          presentActorIds: ["actor.secret-id"],
        },
        afterScene: {
          sceneId: "scene.secret-id",
          timeLabel: "当日",
          locationLabel: "签押房",
          presentActorIds: ["actor.secret-id"],
        },
        transitionRequired: false,
        arrivingActorIds: [],
        departingActorIds: [],
      },
      tickets: [
        {
          ticketId: "ticket.secret-result",
          slot: "PLAYER_RESULT",
          scenePhase: "ACTION_PHASE",
          required: true,
          sourceRefs: ["claim.secret-id"],
          requiredMeaning: "总督暂缓签发。",
        },
        {
          ticketId: "ticket.secret-stop",
          slot: "DECISION_STOP",
          scenePhase: "AFTER_PHASE",
          required: true,
          sourceRefs: ["claim.secret-id"],
          requiredMeaning: "巡抚书吏等待答复。",
        },
      ],
    },
  });
  const visible = output.messages.map((message) => message.content).join("\n");
  assert.match(visible, /总督暂缓签发/u);
  assert.match(visible, /暂缓签发，先保住档房现场/u);
  assert.doesNotMatch(visible, /secret-id/u);
});

test("SurfaceGuard blocks protocol leakage but allows ordinary narrative texture", () => {
  const guard = new DefaultSurfaceGuard();
  assert.equal(guard.inspect({
    text: "灯芯爆了一声，书吏抬起眼，仍隔着屏风等候。",
  }).integrity.ok, true);
  assert.equal(guard.inspect({
    text: "stateRevision=4，requiredVisiblePredicates 如下。",
  }).integrity.reason, "NARRATION_INTERNAL_LEAK");
});

test("runtime exposes one replaceable descriptor for every turn responsibility", () => {
  const provider: OpenNovelProvider = {
    describe: () => ({ provider: "test", model: "test", configured: true }),
    generate: async () => ({
      text: "",
      model: "test",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    }),
  };
  const observer: SceneTruthObserverModule = {
    moduleId: "test.observer.v1",
    observe: async () => ({
      status: "SKIPPED",
      observerModuleId: "test.observer.v1",
      calls: [],
      criticalFindings: [],
      nonCriticalFindings: [],
    }),
  };
  const adapter = {
    moduleIds: { factSettlement: "test.settlement.v1", nextBeatPlanner: "test.beat.v1" },
  } as AuthoredDecisionAdapter;
  const runtime = new OpenNovelRuntime(
    {} as never,
    provider,
    { kick: () => {} },
    { publish: async () => {} },
    {
      decisionMode: "AUTHORED_WHEN_AVAILABLE",
      authoredDecisionAdapter: adapter,
      scenePipelineModules: { observer, policy: new ObserveOnlySceneReviewPolicy() },
    },
  );
  const descriptors = runtime.describeTurnModules();
  assert.equal(descriptors.length, 14);
  assert.equal(new Set(descriptors.map((item) => item.kind)).size, 14);
  assert.equal(
    descriptors.find((item) => item.kind === "FACT_SETTLEMENT")?.moduleId,
    "test.settlement.v1",
  );
  assert.equal(
    descriptors.find((item) => item.kind === "TRUTH_OBSERVER")?.mode,
    "OPTIONAL",
  );
  assert.equal(
    descriptors.find((item) => item.kind === "TRUTH_OBSERVER")?.moduleId,
    "test.observer.v1",
  );
  assert.equal(
    descriptors.find((item) => item.kind === "REVIEW_POLICY")?.moduleId,
    "review-policy.observe-only.v1",
  );
  assert.equal(
    descriptors.find((item) => item.kind === "ENDING")?.moduleId,
    "openovel.basic-ending.v1",
  );
  assert.equal(
    descriptors.find((item) => item.kind === "ENDING")?.mode,
    "REQUIRED",
  );
});
